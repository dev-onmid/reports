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

type PlanningRow = {
  client_id: string;
  cpl_meta: number | null;
  cpl_maximo: number | null;
  roas_minimo: number | null;
  orcamento_diario: number | null;
  orcamento_mensal: number | null;
  volume_leads_meta: number | null;
  ticket_medio: number | null;
  objetivo: string | null;
};

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
    const { rows } = await pool.query<PlanningRow>(
      `SELECT client_id, cpl_meta::float AS cpl_meta, cpl_maximo::float AS cpl_maximo,
              roas_minimo::float AS roas_minimo, orcamento_diario::float AS orcamento_diario,
              orcamento_mensal::float AS orcamento_mensal, volume_leads_meta::float AS volume_leads_meta,
              ticket_medio::float AS ticket_medio, objetivo
         FROM public.client_planning
        WHERE client_id = ANY($1::text[])`,
      [clientIds],
    ).catch(() => ({ rows: [] as PlanningRow[] }));
    return Object.fromEntries(rows.map((r) => [r.client_id, r]));
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
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json() as Promise<Array<{
    id: string; name: string; status: string; objective?: string;
    dailyBudget?: number; spend: number; impressions: number; clicks: number;
    leads: number; ctr: number; cpl: number; platform: string;
  }>>;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

async function buildPayloadForClient(
  client: ClientRow,
  planning: PlanningRow | null,
  _token: string,
  _accountId: string,
  origin: string,
  period: AnalysisPeriod,
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

  // Fallback para 30 dias se não tiver dados no período solicitado
  if (activeCampaigns.length > 0 && activeCampaigns.every((c) => c.spend === 0) && period.days < FALLBACK_DAYS) {
    dateFrom = isoDate(FALLBACK_DAYS);
    usedPeriod = { key: 'last_30d', label: 'Últimos 30 dias', days: FALLBACK_DAYS };
    rawCampaigns = await fetchCampaignsForClient(client.id, origin, 'last_30d', dateFrom, dateTo);
    activeCampaigns = rawCampaigns.filter((c) => {
      const s = (c.status ?? '').toUpperCase();
      return ['ACTIVE', 'ENABLED', 'IN_PROCESS', 'WITH_ISSUES'].includes(s) && c.platform === 'meta';
    });
  }

  if (activeCampaigns.length === 0) return null;

  const campanhas: OptimizerCampaignV2[] = activeCampaigns.slice(0, 5).map((camp) => ({
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
    conjuntos: [],
  }));

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

async function runWeeklyOptimizer(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const forceClientId = request.nextUrl.searchParams.get('clientId') ?? undefined;
  const forceAi = request.nextUrl.searchParams.get('forceAi') === '1';
  const period = analysisPeriodFromRequest(request);
  const startedAt = Date.now();

  const clients = await loadClientsForToday(undefined, forceClientId);
  const clientIds = clients.map((c) => c.id);
  const [planningMap, connectionsMap] = await Promise.all([
    loadPlanning(clientIds),
    loadConnections(clientIds),
  ]);

  const results: Array<{ clientId: string; clientName: string; status: string; error?: string }> = [];

  for (const client of clients) {
    if (Date.now() - startedAt > BUDGET_MS) break;

    const conn = connectionsMap[client.id];
    if (!conn) {
      results.push({ clientId: client.id, clientName: client.name, status: 'sem_conexao_meta' });
      continue;
    }

    try {
      const payload = await buildPayloadForClient(
        client,
        planningMap[client.id] ?? null,
        '',
        '',
        origin,
        period,
      );
      if (!payload) {
        results.push({ clientId: client.id, clientName: client.name, status: 'sem_campanhas_ativas' });
        continue;
      }

      const analyzeRes = await fetch(new URL('/api/otimizador/analisar', origin).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload_v2: payload, connection_id: conn.id, force_ai: forceAi }),
      });

      if (!analyzeRes.ok) throw new Error(`analisar HTTP ${analyzeRes.status}`);
      results.push({ clientId: client.id, clientName: client.name, status: 'ok' });
    } catch (err) {
      results.push({ clientId: client.id, clientName: client.name, status: 'erro', error: String(err) });
    }
  }

  return Response.json({
    ok: true,
    semana: currentWeekLabel(),
    periodo: period.key,
    periodo_label: period.label,
    dow: todayDow(),
    processados: results.length,
    ok_count: results.filter((r) => r.status === 'ok').length,
    erros: results.filter((r) => r.status === 'erro').length,
    results,
  });
}

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runWeeklyOptimizer(request);
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

  return runWeeklyOptimizer(request);
}
