import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import {
  OPTIMIZER_PERIODS,
  currentWeekLabel,
  segmentToOptimizerNiche,
  type OptimizerPayloadV2,
  type OptimizerCampaignV2,
  type OptimizerObjective,
  type OptimizerModo,
  type OptimizerPeriodKey,
} from '@/lib/optimizer';

export const maxDuration = 60;

const BUDGET_MS = 52_000;

type AnalysisPeriod = {
  key: OptimizerPeriodKey;
  label: string;
  days: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function todayDow(): number {
  // JS: 0=Sun,1=Mon,...,6=Sat → convert to 1=Mon,...,5=Fri
  const dow = new Date().getDay();
  return dow === 0 ? 7 : dow; // Sun=7 (never matches 1-5)
}

function analysisPeriodFromRequest(request: NextRequest): AnalysisPeriod {
  const requested = request.nextUrl.searchParams.get('period');
  return OPTIMIZER_PERIODS.find((period) => period.key === requested)
    ?? OPTIMIZER_PERIODS.find((period) => period.key === 'last_7d')!;
}

function sumActions(actions: Array<{ action_type: string; value: string }>, types: string[]): number {
  return actions
    .filter((a) => types.includes(a.action_type))
    .reduce((sum, a) => sum + Number(a.value), 0);
}

// fetch com timeout — impede que um request travado da Meta/interno derrube a rota inteira (504 vazio)
async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const LEAD_ACTIONS = [
  'lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.lead', 'onsite_conversion.lead', 'onsite_web_lead',
  'onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection',
  'messaging_conversation_started_7d', 'total_messaging_connection',
];

// ─── Token resolver ───────────────────────────────────────────────────────────

async function resolveToken(connectionId: string): Promise<string | null> {
  const pool = makeServerPool();
  try {
    if (connectionId) {
      const { rows } = await pool.query(
        `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
        [connectionId],
      );
      if (rows[0]) return getFreshMetaToken(rows[0] as Parameters<typeof getFreshMetaToken>[0]);
    }
    const { rows } = await pool.query(
      `SELECT 'legacy' AS id, '' AS app_id, access_token, token_expiry
         FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
    );
    if (rows[0]) return getFreshMetaToken(rows[0] as Parameters<typeof getFreshMetaToken>[0]);
    return null;
  } finally {
    await pool.end();
  }
}

// ─── Data loaders ─────────────────────────────────────────────────────────────

type ClientRow = {
  id: string;
  name: string;
  segment: string | null;
  analise_dia_semana: number;
  modo_operacao: OptimizerModo;
  acoes_pre_aprovadas: string[];
  orcamento_diario_maximo: number | null;
  cpr_emergencia: number | null;
  min_conjuntos_ativos: number;
  max_conjuntos_ativos: number;
  min_dias_aprendizado: number;
};

// Dados de planejamento derivados do client_planning + client_goals (mesma fonte do dashboard)
type PlanningRow = {
  client_id: string;
  cpl_meta: number | null;       // CPL ideal definido no planejamento
  cpl_maximo: number | null;     // CPL máximo (1.6x o ideal — tolerância antes de crise)
  roas_minimo: number | null;
  orcamento_diario: number | null;
  orcamento_mensal: number | null; // investimento planejado = topo do funil × CPL
  volume_leads_meta: number | null; // meta de leads mensal = topo do funil
  ticket_medio: number | null;
  objetivo: string | null;       // derivado do tipo da meta: leads | vendas
};

type FunnelStage = { conversion: number };

// Replica computeFunnel/plannedFunnelFromGoal do painel do cliente (server-side)
function computeLeadsGoal(
  goalType: string,
  goalTarget: number,
  stages: FunnelStage[],
  ticket: number,
): { topVol: number; botVol: number } {
  const n = stages.length;
  if (n === 0 || goalTarget <= 0) return { topVol: 0, botVol: 0 };
  const vols = new Array<number>(n).fill(0);

  if (goalType === 'leads') {
    vols[0] = Math.ceil(goalTarget);
    for (let i = 1; i < n; i++) {
      const rate = stages[i - 1].conversion / 100;
      vols[i] = rate > 0 ? Math.ceil(vols[i - 1] * rate) : 0;
    }
  } else {
    // revenue/enrollments: parte do fundo do funil (vendas) e sobe
    vols[n - 1] = goalType === 'revenue'
      ? (ticket > 0 ? Math.ceil(goalTarget / ticket) : 0)
      : Math.ceil(goalTarget);
    for (let i = n - 2; i >= 0; i--) {
      const rate = stages[i].conversion / 100;
      vols[i] = rate > 0 ? Math.ceil(vols[i + 1] / rate) : 0;
    }
  }
  return { topVol: vols[0] ?? 0, botVol: vols[n - 1] ?? 0 };
}

type ConnectionRow = {
  id: string;
  account_id: string;
  app_id: string;
  access_token: string;
  token_expiry: string | null;
};

async function loadClientsForToday(forcedDow?: number, forceClientId?: string): Promise<ClientRow[]> {
  const dow = forcedDow ?? todayDow();
  const pool = makeServerPool();
  try {
    if (forceClientId) {
      const { rows } = await pool.query<ClientRow>(
        `SELECT c.id, c.name, c.segment,
                COALESCE(occ.analise_dia_semana, 1) AS analise_dia_semana,
                COALESCE(occ.modo_operacao, 'RECOMENDACAO_COM_APROVACAO') AS modo_operacao,
                COALESCE(occ.acoes_pre_aprovadas, '{}') AS acoes_pre_aprovadas,
                occ.orcamento_diario_maximo, occ.cpr_emergencia,
                COALESCE(occ.min_conjuntos_ativos, 1) AS min_conjuntos_ativos,
                COALESCE(occ.max_conjuntos_ativos, 20) AS max_conjuntos_ativos,
                COALESCE(occ.min_dias_aprendizado, 7) AS min_dias_aprendizado
           FROM public.clients c
           LEFT JOIN public.optimizer_client_config occ ON occ.client_id = c.id
          WHERE c.id = $1 AND c.status NOT IN ('Arquivado', 'Inativo')`,
        [forceClientId],
      );
      return rows;
    }
    const { rows } = await pool.query<ClientRow>(
      `SELECT c.id, c.name, c.segment,
              COALESCE(occ.analise_dia_semana, 1) AS analise_dia_semana,
              COALESCE(occ.modo_operacao, 'RECOMENDACAO_COM_APROVACAO') AS modo_operacao,
              COALESCE(occ.acoes_pre_aprovadas, '{}') AS acoes_pre_aprovadas,
              occ.orcamento_diario_maximo, occ.cpr_emergencia,
              COALESCE(occ.min_conjuntos_ativos, 1) AS min_conjuntos_ativos,
              COALESCE(occ.max_conjuntos_ativos, 20) AS max_conjuntos_ativos,
              COALESCE(occ.min_dias_aprendizado, 7) AS min_dias_aprendizado
         FROM public.clients c
         LEFT JOIN public.optimizer_client_config occ ON occ.client_id = c.id
        WHERE c.status NOT IN ('Arquivado', 'Inativo')
          AND COALESCE(occ.ativo, true) = true
          AND COALESCE(occ.analise_dia_semana, 1) = $1
        ORDER BY c.name ASC`,
      [dow],
    );
    return rows;
  } finally {
    await pool.end();
  }
}

async function loadPlanning(clientIds: string[]): Promise<Record<string, PlanningRow>> {
  if (clientIds.length === 0) return {};
  const pool = makeServerPool();
  try {
    // Planejamento e metas vêm das MESMAS tabelas que alimentam o painel do cliente
    const [planRes, goalRes] = await Promise.all([
      pool.query<{ client_id: string; tkm: number | null; cpl_meta: number | null; stages: unknown }>(
        `SELECT client_id, tkm::float AS tkm, cpl_meta::float AS cpl_meta, stages
           FROM public.client_planning WHERE client_id = ANY($1::text[])`,
        [clientIds],
      ).then((r) => r.rows).catch(() => []),
      pool.query<{ client_id: string; type: string; target: number | null }>(
        `SELECT client_id, type, target::float AS target
           FROM public.client_goals WHERE client_id = ANY($1::text[])`,
        [clientIds],
      ).then((r) => r.rows).catch(() => []),
    ]);

    const goalByClient = new Map(goalRes.map((g) => [g.client_id, g]));
    const result: Record<string, PlanningRow> = {};

    for (const plan of planRes) {
      const goal = goalByClient.get(plan.client_id);
      const tkm = plan.tkm ?? 0;
      const cplMeta = plan.cpl_meta ?? null;
      const stages: FunnelStage[] = Array.isArray(plan.stages)
        ? (plan.stages as Array<{ conversion?: number }>).map((s) => ({ conversion: Number(s?.conversion ?? 0) }))
        : [];

      let volumeLeadsMeta: number | null = null;
      let orcamentoMensal: number | null = null;
      if (goal && goal.target && goal.target > 0 && stages.length > 0) {
        const { topVol } = computeLeadsGoal(goal.type ?? 'revenue', goal.target, stages, tkm);
        volumeLeadsMeta = topVol > 0 ? topVol : null;
        if (volumeLeadsMeta && cplMeta) orcamentoMensal = volumeLeadsMeta * cplMeta;
      }

      // Objetivo de negócio: meta em leads → leads; faturamento/matrículas → vendas
      const objetivo = goal?.type === 'leads' ? 'leads'
        : goal?.type === 'revenue' || goal?.type === 'enrollments' ? 'vendas'
        : null;

      result[plan.client_id] = {
        client_id: plan.client_id,
        cpl_meta: cplMeta,
        cpl_maximo: cplMeta ? Number((cplMeta * 1.6).toFixed(2)) : null,
        roas_minimo: null,
        orcamento_diario: orcamentoMensal ? Number((orcamentoMensal / 30).toFixed(2)) : null,
        orcamento_mensal: orcamentoMensal,
        volume_leads_meta: volumeLeadsMeta,
        ticket_medio: tkm > 0 ? tkm : null,
        objetivo,
      };
    }

    return result;
  } finally {
    await pool.end();
  }
}

async function loadConnections(clientIds: string[]): Promise<Record<string, ConnectionRow>> {
  if (clientIds.length === 0) return {};
  const pool = makeServerPool();
  try {
    const [calRows, legacyRows, allConns, globalIntegration] = await Promise.all([
      // Modern: client_account_links → meta_connections
      pool.query<{ client_id: string; connection_id: string; account_id: string }>(
        `SELECT cal.client_id, cal.connection_id, cal.account_id
           FROM public.client_account_links cal
          WHERE cal.client_id = ANY($1::text[])
            AND cal.platform = 'meta_ads'`,
        [clientIds],
      ).then((r) => r.rows).catch(() => [] as { client_id: string; connection_id: string; account_id: string }[]),
      // Legacy: meta_ads_connections (account_ids array, no token)
      pool.query<{ client_id: string; account_ids: string[] }>(
        `SELECT client_id, account_ids FROM public.meta_ads_connections WHERE client_id = ANY($1::text[])`,
        [clientIds],
      ).then((r) => r.rows).catch(() => [] as { client_id: string; account_ids: string[] }[]),
      // All connected meta_connections
      pool.query<ConnectionRow>(
        `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE status = 'connected' ORDER BY connected_at DESC`,
      ).then((r) => r.rows).catch(() => [] as ConnectionRow[]),
      // Global legacy integration token
      pool.query<{ access_token: string; token_expiry: string | null }>(
        `SELECT access_token, token_expiry FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
      ).then((r) => r.rows[0] ?? null).catch(() => null),
    ]);

    const connById = new Map(allConns.map((c) => [c.id, c]));
    const map: Record<string, ConnectionRow> = {};

    // Modern path: pick connection via client_account_links
    for (const link of calRows) {
      if (map[link.client_id]) continue;
      const conn = connById.get(link.connection_id);
      if (conn) map[link.client_id] = { ...conn, account_id: link.account_id };
    }

    // Legacy path: meta_ads_connections + first available meta_connections (or global integration)
    const fallbackConn: ConnectionRow | null = allConns[0] ?? (globalIntegration
      ? { id: 'legacy-global', app_id: '', access_token: globalIntegration.access_token, token_expiry: globalIntegration.token_expiry, account_id: '' }
      : null);

    for (const leg of legacyRows) {
      if (map[leg.client_id]) continue;
      const accountId = leg.account_ids?.[0];
      if (accountId && fallbackConn) {
        map[leg.client_id] = { ...fallbackConn, account_id: accountId };
      }
    }

    return map;
  } finally {
    await pool.end();
  }
}

async function loadDecisionHistory(clientId: string): Promise<OptimizerPayloadV2['historico_decisoes']> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{ semana_analise: string; acao_executada: string; resultado: string }>(
      `SELECT COALESCE(oal.semana_analise, 'semana anterior') AS semana_analise,
              oal2.acao_executada, COALESCE(oal2.resultado_da_acao, 'pendente') AS resultado
         FROM public.optimizer_ai_logs oal
         LEFT JOIN public.optimizer_action_logs oal2 ON oal2.cliente_id = oal.cliente_id
        WHERE oal.cliente_id = $1
          AND oal.created_at >= NOW() - INTERVAL '28 days'
          AND oal2.acao_executada IS NOT NULL
        ORDER BY oal.created_at DESC
        LIMIT 5`,
      [clientId],
    ).catch(() => ({ rows: [] as { semana_analise: string; acao_executada: string; resultado: string }[] }));
    return rows.map((r) => ({ semana: r.semana_analise, acao_executada: r.acao_executada, resultado: r.resultado }));
  } finally {
    await pool.end();
  }
}

// Busca campanhas via API interna (mesma que alimenta o dashboard)
async function fetchCampaignsForClient(clientId: string, origin: string, periodKey: OptimizerPeriodKey, dateFrom: string, dateTo: string) {
  const url = new URL('/api/campaigns', origin);
  url.searchParams.set('clientIds', clientId);
  url.searchParams.set('period', 'custom');
  url.searchParams.set('dateFrom', dateFrom);
  url.searchParams.set('dateTo', dateTo);
  url.searchParams.set('sortBy', 'spend');
  url.searchParams.set('limit', '10');
  const res = await fetchWithTimeout(url.toString(), 12_000, { cache: 'no-store' });
  if (!res?.ok) return [];
  return res.json() as Promise<Array<{
    id: string; name: string; status: string; objective?: string;
    dailyBudget?: number; spend: number; impressions: number; clicks: number;
    leads: number; ctr: number; cpl: number; platform: string;
  }>>;
}

// Busca conjuntos + anúncios de uma campanha direto na Meta (best-effort, com deadline)
async function fetchConjuntosForCampaign(
  campaignId: string,
  token: string,
  dateFrom: string,
  dateTo: string,
  deadline: number,
): Promise<OptimizerCampaignV2['conjuntos']> {
  if (Date.now() > deadline) return [];
  const insightFields = `insights.time_range(${JSON.stringify({ since: dateFrom, until: dateTo })}){spend,impressions,reach,frequency,clicks,actions,ctr}`;
  const url = new URL(`https://graph.facebook.com/v21.0/${campaignId}/adsets`);
  url.searchParams.set('fields', `id,name,status,effective_status,optimization_goal,daily_budget,created_time,${insightFields}`);
  url.searchParams.set('limit', '10');
  url.searchParams.set('access_token', token);

  const res = await fetchWithTimeout(url.toString(), 8_000);
  if (!res?.ok) return [];
  const data = await res.json() as { data?: Record<string, unknown>[] };

  const activeAdsets = (data.data ?? []).filter((raw) => {
    const status = String(raw.effective_status ?? raw.status ?? '').toUpperCase();
    return ['ACTIVE', 'IN_PROCESS', 'WITH_ISSUES'].includes(status);
  }).slice(0, 5);

  // Busca os anúncios de TODOS os conjuntos em paralelo (uma promise por conjunto).
  const conjuntos = await Promise.all(activeAdsets.map(async (raw): Promise<OptimizerCampaignV2['conjuntos'][number]> => {
    const insights = (raw.insights as { data?: Record<string, unknown>[] } | undefined)?.data?.[0] ?? {};
    const actions = (insights.actions as Array<{ action_type: string; value: string }>) ?? [];
    const conversoes = sumActions(actions, LEAD_ACTIONS);
    const gasto = Number(insights.spend ?? 0);
    const impressoes = Number(insights.impressions ?? 0);
    const cliques = Number(insights.clicks ?? 0);
    const ctr = Number(insights.ctr ?? (impressoes > 0 ? (cliques / impressoes) * 100 : 0));
    const createdTime = String(raw.created_time ?? '');
    const diasAtivo = createdTime ? Math.floor((Date.now() - new Date(createdTime).getTime()) / 86400000) : null;

    // Anúncios com rankings (best-effort, só se houver tempo)
    let anuncios: OptimizerCampaignV2['conjuntos'][number]['anuncios'] = [];
    if (Date.now() < deadline) {
      const adsUrl = new URL(`https://graph.facebook.com/v21.0/${String(raw.id)}/ads`);
      adsUrl.searchParams.set('fields', `id,name,effective_status,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,insights.time_range(${JSON.stringify({ since: dateFrom, until: dateTo })}){spend,impressions,clicks,actions,ctr}`);
      adsUrl.searchParams.set('limit', '8');
      adsUrl.searchParams.set('access_token', token);
      const adsRes = await fetchWithTimeout(adsUrl.toString(), 8_000);
      if (adsRes?.ok) {
        const adsData = await adsRes.json() as { data?: Record<string, unknown>[] };
        anuncios = (adsData.data ?? []).map((ad) => {
          const ai = (ad.insights as { data?: Record<string, unknown>[] } | undefined)?.data?.[0] ?? {};
          const adActions = (ai.actions as Array<{ action_type: string; value: string }>) ?? [];
          const adConv = sumActions(adActions, LEAD_ACTIONS);
          const adGasto = Number(ai.spend ?? 0);
          const adImp = Number(ai.impressions ?? 0);
          const adClicks = Number(ai.clicks ?? 0);
          return {
            id: String(ad.id),
            nome: String(ad.name ?? ''),
            status: String(ad.effective_status ?? ''),
            gasto: adGasto,
            impressoes: adImp,
            ctr: Number(ai.ctr ?? (adImp > 0 ? (adClicks / adImp) * 100 : 0)),
            cpl: adGasto > 0 && adConv > 0 ? adGasto / adConv : null,
            conversoes: adConv,
            dias_ativo: null,
            quality_ranking: ad.quality_ranking ? String(ad.quality_ranking) : null,
            engagement_ranking: ad.engagement_rate_ranking ? String(ad.engagement_rate_ranking) : null,
            conversion_ranking: ad.conversion_rate_ranking ? String(ad.conversion_rate_ranking) : null,
          };
        });
      }
    }

    return {
      id: String(raw.id),
      nome: String(raw.name ?? ''),
      status: String(raw.effective_status ?? raw.status ?? ''),
      objetivo_otimizacao: String(raw.optimization_goal ?? ''),
      tipo_publico: 'outro',
      orcamento_diario: raw.daily_budget ? Number(raw.daily_budget) / 100 : null,
      gasto,
      impressoes,
      alcance: insights.reach ? Number(insights.reach) : null,
      frequencia: insights.frequency ? Number(insights.frequency) : null,
      ctr,
      cpl: gasto > 0 && conversoes > 0 ? gasto / conversoes : null,
      conversoes,
      ctr_tendencia_4d: null,
      dias_ativo: diasAtivo,
      anuncios,
    };
  }));

  return conjuntos;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

async function buildPayloadForClient(
  client: ClientRow,
  planning: PlanningRow | null,
  token: string,
  accountId: string,
  origin: string,
  period: AnalysisPeriod,
  fetchConjuntos: boolean,
): Promise<OptimizerPayloadV2 | null> {
  const semana = currentWeekLabel();

  // Tenta o período solicitado; se gasto = 0, expande para 30 dias
  const FALLBACK_DAYS = 30;
  let usedPeriod = period;
  let dateFrom = isoDate(period.days);
  let dateTo = isoDate(1);

  let rawCampaigns = await fetchCampaignsForClient(client.id, origin, period.key, dateFrom, dateTo);
  let activeCampaigns = rawCampaigns.filter((c) => {
    const s = (c.status ?? '').toUpperCase();
    return ['ACTIVE', 'ENABLED', 'IN_PROCESS', 'WITH_ISSUES'].includes(s) && c.platform === 'meta';
  });

  // Fallback para 30 dias quando o período solicitado não trouxe campanhas com entrega.
  // `/api/campaigns` já descarta campanhas com gasto = 0, então "sem gasto no período" chega
  // aqui como lista VAZIA — por isso o gatilho é length === 0 (antes era código morto).
  if (activeCampaigns.length === 0 && period.days < FALLBACK_DAYS) {
    dateFrom = isoDate(FALLBACK_DAYS);
    usedPeriod = { key: 'last_30d', label: 'Últimos 30 dias', days: FALLBACK_DAYS };
    rawCampaigns = await fetchCampaignsForClient(client.id, origin, 'last_30d', dateFrom, dateTo);
    activeCampaigns = rawCampaigns.filter((c) => {
      const s = (c.status ?? '').toUpperCase();
      return ['ACTIVE', 'ENABLED', 'IN_PROCESS', 'WITH_ISSUES'].includes(s) && c.platform === 'meta';
    });
  }

  if (activeCampaigns.length === 0) return null;

  const topCampaigns = activeCampaigns.slice(0, 5);

  // Conjuntos + anúncios das campanhas que gastaram. Busca em PARALELO (uma promise por
  // campanha), com deadline compartilhado — evita a soma sequencial que estourava os 60s.
  const conjuntosDeadline = Date.now() + 15_000;
  const conjuntosPorCampanha = await Promise.all(
    topCampaigns.map((camp) =>
      (fetchConjuntos && token && camp.spend > 0)
        ? fetchConjuntosForCampaign(camp.id, token, dateFrom, dateTo, conjuntosDeadline).catch(() => [])
        : Promise.resolve([] as OptimizerCampaignV2['conjuntos']),
    ),
  );

  const campanhas: OptimizerCampaignV2[] = topCampaigns.map((camp, i) => ({
    id: camp.id,
    nome: camp.name,
    objetivo: camp.objective ?? '',
    status: camp.status,
    orcamento_diario: camp.dailyBudget ?? null,
    gasto: camp.spend,
    impressoes: camp.impressions,
    cliques: camp.clicks,
    ctr: camp.ctr,
    cpl: camp.cpl > 0 ? camp.cpl : null,
    conversoes: camp.leads,
    roas: null,
    dias_rodando: null,
    conjuntos: conjuntosPorCampanha[i],
  }));

  void accountId; // reservado para opportunity score futuro

  const historico = await loadDecisionHistory(client.id);

  const totalGasto = campanhas.reduce((sum, c) => sum + c.gasto, 0);
  const semMetaConfigurada = !planning?.objetivo && !planning?.cpl_maximo && !planning?.orcamento_diario;

  // Injeta contexto quando os dados são escassos para orientar a IA
  const observacoes: string[] = [];
  if (totalGasto === 0) {
    observacoes.push(`ALERTA: A conta possui ${campanhas.length} campanha(s) ativas mas registrou R$ 0,00 em gasto no período de ${period.label}. Diagnostique o motivo da não-entrega (pagamento, aprovação, orçamento esgotado, erro de configuração) e oriente o gestor de forma direta sobre o que verificar agora no Gerenciador de Anúncios.`);
  }
  if (semMetaConfigurada) {
    observacoes.push('CONTEXTO: Este cliente ainda não possui metas de CPL, orçamento ou objetivo configurados na plataforma. Faça uma análise baseada nos dados absolutos disponíveis e recomende configurar as metas para análises futuras mais precisas.');
  }

  return {
    cliente_id: client.id,
    cliente_nome: client.name,
    nicho: segmentToOptimizerNiche(client.segment ?? undefined),
    modo_operacao: client.modo_operacao,
    semana_analise: semana,
    acoes_pre_aprovadas: client.acoes_pre_aprovadas ?? [],
    metas: {
      objetivo_principal: (planning?.objetivo as OptimizerObjective) ?? null,
      cpl_ideal: planning?.cpl_meta ?? null,
      cpl_maximo: planning?.cpl_maximo ?? null,
      roas_minimo: planning?.roas_minimo ?? null,
      orcamento_diario_total: planning?.orcamento_diario ?? null,
      orcamento_mensal_total: planning?.orcamento_mensal ?? null,
      volume_leads_meta_mensal: planning?.volume_leads_meta ?? null,
      ticket_medio: planning?.ticket_medio ?? null,
    },
    limites_globais: {
      orcamento_diario_maximo_conta: client.orcamento_diario_maximo,
      cpr_emergencia: client.cpr_emergencia,
      min_conjuntos_ativos: client.min_conjuntos_ativos,
      max_conjuntos_ativos: client.max_conjuntos_ativos,
      min_dias_aprendizado: client.min_dias_aprendizado,
    },
    periodo_analise: {
      data_inicio: dateFrom,
      data_fim: dateTo,
      dias: usedPeriod.days,
      label: usedPeriod.label,
    },
    opportunity_score: null,
    campanhas,
    historico_decisoes: historico,
    observacoes_gestor: observacoes.length > 0 ? observacoes.join(' | ') : null,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

type RunOptions = {
  origin: string;
  forceClientId?: string;
  forceAi: boolean;
  period: AnalysisPeriod;
};

function parseRunOptions(request: NextRequest): RunOptions {
  return {
    origin: new URL(request.url).origin,
    forceClientId: request.nextUrl.searchParams.get('clientId') ?? undefined,
    forceAi: request.nextUrl.searchParams.get('forceAi') === '1',
    period: analysisPeriodFromRequest(request),
  };
}

async function executeWeekly({ origin, forceClientId, forceAi, period }: RunOptions) {
  const startedAt = Date.now();

  const clients = await loadClientsForToday(undefined, forceClientId);
  const clientIds = clients.map((c) => c.id);
  const [planningMap, connectionsMap] = await Promise.all([
    loadPlanning(clientIds),
    loadConnections(clientIds),
  ]);

  const results: Array<{ clientId: string; clientName: string; status: string; error?: string }> = [];

  // Conjuntos/anúncios: LIGADO no manual, mas com busca PARALELA (Promise.all) — antes as
  // chamadas ao Graph API eram sequenciais (5 camp × 5 conj × 8 anúncios em fila = ~20s+) e
  // estouravam os 60s → 504. Paralelizado, a mesma coleta cai para ~4-5s e cabe no tempo.
  const isManual = clients.length === 1;
  const fetchConjuntos = isManual;
  // Concorrência: 1 cliente = sequencial; cron = paralelo p/ cobrir a base dentro do tempo
  const CONCURRENCY = isManual ? 1 : 5;

  async function processClient(client: ClientRow): Promise<void> {
    const conn = connectionsMap[client.id];
    if (!conn) {
      results.push({ clientId: client.id, clientName: client.name, status: 'sem_conexao_meta' });
      return;
    }
    try {
      const token = await resolveToken(conn.id).catch(() => null);
      const payload = await buildPayloadForClient(
        client,
        planningMap[client.id] ?? null,
        token ?? '',
        conn.account_id,
        origin,
        period,
        fetchConjuntos,
      );
      if (!payload) {
        results.push({ clientId: client.id, clientName: client.name, status: 'sem_campanhas_ativas' });
        return;
      }

      const analyzeRes = await fetchWithTimeout(new URL('/api/otimizador/analisar', origin).toString(), 55_000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload_v2: payload, connection_id: conn.id, force_ai: forceAi }),
      });

      if (!analyzeRes) throw new Error('analisar não respondeu (timeout da IA)');
      if (!analyzeRes.ok) {
        const errBody = await analyzeRes.text().catch(() => '');
        throw new Error(`analisar HTTP ${analyzeRes.status}${errBody ? ': ' + errBody.slice(0, 200) : ''}`);
      }
      results.push({ clientId: client.id, clientName: client.name, status: 'ok' });
    } catch (err) {
      results.push({ clientId: client.id, clientName: client.name, status: 'erro', error: String(err) });
    }
  }

  // Processa em lotes paralelos, respeitando o orçamento de tempo
  const queue = [...clients];
  let pulou = 0;
  while (queue.length > 0) {
    if (Date.now() - startedAt > BUDGET_MS) {
      pulou = queue.length;
      break;
    }
    const batch = queue.splice(0, CONCURRENCY);
    await Promise.all(batch.map(processClient));
  }

  return {
    pulados_por_tempo: pulou,
    ok: true,
    semana: currentWeekLabel(),
    periodo: period.key,
    periodo_label: period.label,
    dow: todayDow(),
    processados: results.length,
    ok_count: results.filter((r) => r.status === 'ok').length,
    erros: results.filter((r) => r.status === 'erro').length,
    results,
  };
}

// ─── Diagnóstico (dry-run, sem IA, sem custo) ──────────────────────────────────
// Mostra EXATAMENTE onde o dado morre para cada cliente: conexão, token, account_id e
// quantas campanhas com gasto /api/campaigns retorna em 7d e 30d. Não chama o Claude.
type ClientDiagnostic = {
  cliente: string;
  conexao_resolvida: boolean;
  connection_id?: string;
  account_id?: string;
  token_ok?: boolean;
  campanhas_7d?: number;
  campanhas_30d?: number;
  amostra?: Array<{ nome: string; status: string; gasto: number; leads: number; plataforma: string }>;
  // Consulta direta à Meta (mesma conexão da dashboard) — sem nenhum filtro do Otimizador
  meta_direto?: { ok: boolean; status?: number; erro?: string; total?: number; com_gasto?: number; campanhas?: Array<{ nome: string; status: string; gasto: number }> };
  planejamento: { cpl_meta: number | null; volume_leads_meta: number | null; objetivo: string | null; tem_planejamento: boolean };
  veredito: string;
};

// Consulta a Meta DIRETO (act_<id>/campaigns) com gasto no período — ignora /api/campaigns
// e todos os filtros do Otimizador. Mostra a verdade: o que existe, status e gasto real.
async function fetchMetaCampaignsRaw(accountId: string, token: string, since: string, until: string) {
  const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const url = new URL(`https://graph.facebook.com/v21.0/${acct}/campaigns`);
  url.searchParams.set('fields', `name,effective_status,insights.time_range(${JSON.stringify({ since, until })}){spend}`);
  url.searchParams.set('limit', '50');
  url.searchParams.set('access_token', token);
  const res = await fetchWithTimeout(url.toString(), 10_000);
  if (!res) return { ok: false, erro: 'timeout/sem resposta da Meta' };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, erro: body.slice(0, 300) };
  }
  const data = await res.json() as { data?: Array<Record<string, unknown>> };
  const campanhas = (data.data ?? []).map((c) => {
    const ins = (c.insights as { data?: Array<{ spend?: string }> } | undefined)?.data?.[0];
    return { nome: String(c.name ?? ''), status: String(c.effective_status ?? ''), gasto: Number(ins?.spend ?? 0) };
  });
  return { ok: true, total: campanhas.length, com_gasto: campanhas.filter((c) => c.gasto > 0).length, campanhas: campanhas.slice(0, 12) };
}

async function diagnoseClients(opts: RunOptions): Promise<ClientDiagnostic[]> {
  const clients = await loadClientsForToday(undefined, opts.forceClientId);
  const clientIds = clients.map((c) => c.id);
  const [planningMap, connectionsMap] = await Promise.all([
    loadPlanning(clientIds),
    loadConnections(clientIds),
  ]);

  const out: ClientDiagnostic[] = [];
  for (const client of clients) {
    const planning = planningMap[client.id] ?? null;
    const planejamento = {
      cpl_meta: planning?.cpl_meta ?? null,
      volume_leads_meta: planning?.volume_leads_meta ?? null,
      objetivo: planning?.objetivo ?? null,
      tem_planejamento: !!planning,
    };
    const conn = connectionsMap[client.id];
    if (!conn) {
      out.push({
        cliente: client.name, conexao_resolvida: false, planejamento,
        veredito: 'SEM CONEXAO META — cliente não vinculado a nenhuma conta de anúncios (client_account_links / meta_ads_connections).',
      });
      continue;
    }
    const token = await resolveToken(conn.id).catch(() => null);
    const [d7, d30, metaDireto] = await Promise.all([
      fetchCampaignsForClient(client.id, opts.origin, 'last_7d', isoDate(7), isoDate(1)).catch(() => []),
      fetchCampaignsForClient(client.id, opts.origin, 'last_30d', isoDate(30), isoDate(1)).catch(() => []),
      token ? fetchMetaCampaignsRaw(conn.account_id, token, isoDate(30), isoDate(0)).catch(() => ({ ok: false, erro: 'falha na consulta direta' })) : Promise.resolve({ ok: false, erro: 'sem token' }),
    ]);
    const meta7 = d7.filter((c) => c.platform === 'meta');
    const meta30 = d30.filter((c) => c.platform === 'meta');
    const direto = metaDireto as ClientDiagnostic['meta_direto'];

    let veredito: string;
    if (!token) {
      veredito = 'TOKEN NAO RESOLVIDO — a conexão existe mas não há access_token válido (reconectar Meta).';
    } else if (direto && !direto.ok) {
      veredito = `ERRO AO CONSULTAR A META DIRETO (HTTP ${direto.status ?? '?'}): ${direto.erro ?? 'desconhecido'}. account_id=${conn.account_id}.`;
    } else if (direto && (direto.com_gasto ?? 0) > 0 && meta30.length === 0) {
      veredito = `A META TEM ${direto.com_gasto} campanha(s) com gasto, mas o Otimizador (via /api/campaigns) recebeu 0 — algum filtro está derrubando (status ou gasto). Veja a lista direta abaixo.`;
    } else if (direto && (direto.total ?? 0) === 0) {
      veredito = `A conta Meta (act_${String(conn.account_id).replace(/^act_/, '')}) não tem NENHUMA campanha — account_id vinculado pode estar errado.`;
    } else if (meta7.length === 0 && meta30.length === 0) {
      veredito = `Nenhuma campanha com gasto em 7d nem 30d via /api/campaigns. Direto na Meta: ${direto?.total ?? 0} campanha(s), ${direto?.com_gasto ?? 0} com gasto.`;
    } else if (meta7.length === 0) {
      veredito = `SEM GASTO nos últimos 7 dias, mas ${meta30.length} campanha(s) com gasto em 30 dias. Analise com período "Últimos 30 dias".`;
    } else {
      veredito = `DADOS OK — ${meta7.length} campanha(s) com gasto em 7d, ${meta30.length} em 30d.`;
    }
    out.push({
      cliente: client.name, conexao_resolvida: true, connection_id: conn.id, account_id: conn.account_id,
      token_ok: !!token, campanhas_7d: meta7.length, campanhas_30d: meta30.length,
      amostra: meta30.slice(0, 5).map((c) => ({ nome: c.name, status: c.status, gasto: c.spend, leads: c.leads, plataforma: c.platform })),
      meta_direto: direto,
      planejamento, veredito,
    });
  }
  return out;
}

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get('dryRun') === '1') {
    return Response.json({ dry_run: true, diagnostics: await diagnoseClients(parseRunOptions(request)) });
  }
  return Response.json(await executeWeekly(parseRunOptions(request)));
}

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-onmid-user-id') ?? '';
  const roleHint = request.headers.get('x-onmid-role') ?? '';

  if (!userId && roleHint !== 'Administrador') {
    return Response.json({ error: 'Apenas administradores podem iniciar a análise geral.' }, { status: 403 });
  }

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{ role: string }>(
      `SELECT role FROM public.users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    if (rows[0]?.role !== 'Administrador' && roleHint !== 'Administrador') {
      return Response.json({ error: 'Apenas administradores podem iniciar a análise geral.' }, { status: 403 });
    }
  } catch {
    if (roleHint !== 'Administrador') {
      return Response.json({ error: 'Apenas administradores.' }, { status: 403 });
    }
  } finally {
    await pool.end();
  }

  const opts = parseRunOptions(request);
  // dryRun=1: diagnóstico sem IA — só mostra de onde vêm (ou não) os dados.
  if (request.nextUrl.searchParams.get('dryRun') === '1') {
    return Response.json({ dry_run: true, diagnostics: await diagnoseClients(opts) });
  }
  // Síncrono: roda a análise (busca + IA) e só responde quando gravou o resultado.
  return Response.json(await executeWeekly(opts));
}
