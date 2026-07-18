import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { countMetaResults } from '@/lib/meta-results';
import {
  OPTIMIZER_PERIODS,
  currentWeekLabel,
  segmentToOptimizerNiche,
  objetivoMedidoPorClique,
  ensureOptimizerClientConfigTable,
  ensureOptimizerManualNotesTable,
  type OptimizerPayloadV2,
  type OptimizerCampaignV2,
  type OptimizerObjective,
  type OptimizerModo,
  type OptimizerNiche,
  type OptimizerPeriodKey,
} from '@/lib/optimizer';
import { optimizerDateRangeForDays, optimizerDateRangeForPeriod } from '@/lib/optimizer-period-range';
import { benchmarkParaNicho, loadNicheBenchmarks, type NicheBenchmark } from '@/lib/optimizer-benchmarks';
import {
  optimizerMultiWindowRanges,
  janelasReferencia,
  buildMetaWindowFields,
  parseMetaWindowInsights,
  aggregateGoogleDailyRows,
  janelasComMetricaDeClique,
  calcularTendencia,
  type OptimizerWindowRanges,
  type GoogleDailyRow,
} from '@/lib/optimizer-windows';
import type { OptimizerJanelas } from '@/lib/optimizer';

// 300s (mesmo teto do reports/run-once) — a análise manual síncrona soma busca de campanhas
// (até 24s com fallback 30d) + conjuntos/anúncios (15s) + IA (até 90s); em 60s dava HTTP 504.
export const maxDuration = 300;

const BUDGET_MS = 285_000;

type AnalysisPeriod = {
  key: OptimizerPeriodKey;
  label: string;
  days: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// Extrai o número do primeiro item de um campo "*_watched_actions" da Meta Insights API
// (formato [{action_type: "video_view", value: "8500"}]). Ausente/vazio = não é vídeo.
function firstActionValue(arr: unknown): number | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = Number((arr[0] as { value?: string } | undefined)?.value ?? NaN);
  return Number.isFinite(v) ? v : null;
}

// Dias reais entre duas datas ISO (inclusivo) — usado no lugar de um "days" fixo pois
// this_month/last_month têm duração variável (28-31 dias) por serem meses de calendário.
function isoDateDiffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000) + 1;
}


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
    await pool.end().catch(() => {});
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
  observacoes_fixas: string | null;
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

const CLIENT_SELECT = `SELECT c.id, c.name, c.segment,
        COALESCE(occ.analise_dia_semana, 1) AS analise_dia_semana,
        COALESCE(occ.modo_operacao, 'RECOMENDACAO_COM_APROVACAO') AS modo_operacao,
        COALESCE(occ.acoes_pre_aprovadas, '{}') AS acoes_pre_aprovadas,
        occ.orcamento_diario_maximo, occ.cpr_emergencia,
        COALESCE(occ.min_conjuntos_ativos, 1) AS min_conjuntos_ativos,
        COALESCE(occ.max_conjuntos_ativos, 20) AS max_conjuntos_ativos,
        COALESCE(occ.min_dias_aprendizado, 7) AS min_dias_aprendizado,
        occ.observacoes_fixas
   FROM public.clients c
   LEFT JOIN public.optimizer_client_config occ ON occ.client_id = c.id`;

async function loadClientsForToday(forcedDow?: number, forceClientId?: string, all?: boolean): Promise<ClientRow[]> {
  const dow = forcedDow ?? todayDow();
  const pool = makeServerPool();
  try {
    await ensureOptimizerClientConfigTable(pool);
    // "Analisar todos": carrega TODOS os clientes ativos, ignorando o rodízio por dia da semana.
    if (all && !forceClientId) {
      const { rows } = await pool.query<ClientRow>(
        `${CLIENT_SELECT}
          WHERE c.status NOT IN ('Arquivado', 'Inativo')
            AND COALESCE(occ.ativo, true) = true
          ORDER BY c.name ASC`,
      );
      return rows;
    }
    if (forceClientId) {
      const { rows } = await pool.query<ClientRow>(
        `SELECT c.id, c.name, c.segment,
                COALESCE(occ.analise_dia_semana, 1) AS analise_dia_semana,
                COALESCE(occ.modo_operacao, 'RECOMENDACAO_COM_APROVACAO') AS modo_operacao,
                COALESCE(occ.acoes_pre_aprovadas, '{}') AS acoes_pre_aprovadas,
                occ.orcamento_diario_maximo, occ.cpr_emergencia,
                COALESCE(occ.min_conjuntos_ativos, 1) AS min_conjuntos_ativos,
                COALESCE(occ.max_conjuntos_ativos, 20) AS max_conjuntos_ativos,
                COALESCE(occ.min_dias_aprendizado, 7) AS min_dias_aprendizado,
                occ.observacoes_fixas
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
              COALESCE(occ.min_dias_aprendizado, 7) AS min_dias_aprendizado,
              occ.observacoes_fixas
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
    await pool.end().catch(() => {});
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
    await pool.end().catch(() => {});
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
    await pool.end().catch(() => {});
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
    await pool.end().catch(() => {});
  }
}

// Observações manuais registradas pelo gestor (tela do Otimizador) nos últimos 45 dias — fecha
// o ciclo humano→IA: se o gestor já disse "cliente pediu manter ativo", a próxima análise não
// pode voltar a sugerir pausar o mesmo objeto sem saber disso.
async function loadManualNotesContext(clientId: string): Promise<string | null> {
  const pool = makeServerPool();
  try {
    await ensureOptimizerManualNotesTable(pool);
    const { rows } = await pool.query<{ nivel: string; objeto_nome: string | null; texto: string; autor_nome: string | null; created_at: string }>(
      `SELECT nivel, objeto_nome, texto, autor_nome, created_at
         FROM public.optimizer_manual_notes
        WHERE cliente_id = $1 AND ativo = true
          AND created_at >= NOW() - INTERVAL '45 days'
        ORDER BY created_at DESC
        LIMIT 20`,
      [clientId],
    ).catch(() => ({ rows: [] as { nivel: string; objeto_nome: string | null; texto: string; autor_nome: string | null; created_at: string }[] }));
    if (rows.length === 0) return null;
    const linhas = rows.map((r) => {
      const alvo = r.objeto_nome ? ` em "${r.objeto_nome}"` : '';
      const quando = new Date(r.created_at).toLocaleDateString('pt-BR');
      return `- [${r.nivel}${alvo}, ${quando}${r.autor_nome ? `, ${r.autor_nome}` : ''}]: ${r.texto}`;
    });
    return `OBSERVAÇÕES MANUAIS do gestor humano (considere antes de repetir uma sugestão já tratada):\n${linhas.join('\n')}`;
  } finally {
    await pool.end().catch(() => {});
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
    accountId?: string; loginCustomerId?: string;
    searchImprShare?: number; searchBudgetLostIS?: number; searchAbsTopIS?: number;
  }>>;
}

// video_id pode vir em 3 lugares do creative, dependendo de como o anúncio foi criado.
// Mesma extração usada pelo preview nítido do dashboard (/api/meta/top-creatives).
function extractVideoId(creative: Record<string, unknown>): string | null {
  if (typeof creative.video_id === 'string' && creative.video_id) return creative.video_id;
  const storySpec = (creative.object_story_spec as Record<string, unknown> | undefined) ?? {};
  const videoData = (storySpec.video_data as Record<string, unknown> | undefined) ?? {};
  if (typeof videoData.video_id === 'string' && videoData.video_id) return videoData.video_id;
  const assetFeed = (creative.asset_feed_spec as Record<string, unknown> | undefined) ?? {};
  const feedVideos = (assetFeed.videos as Array<Record<string, unknown>> | undefined) ?? [];
  const feedVideoId = feedVideos.find((v) => typeof v.video_id === 'string')?.video_id;
  return typeof feedVideoId === 'string' ? feedVideoId : null;
}

// Mesma prioridade de resolução de imagem do /api/meta/top-creatives: asset_feed (original
// Advantage+) > thumbnail de vídeo em alta resolução (via videoThumbsById) > image_url do
// anúncio estático > thumbnail_url por último (baixa resolução e expira via `oe=`).
function resolveCreativeImageUrl(
  creative: Record<string, unknown>,
  videoThumbsById: Map<string, string>,
): string | null {
  const assetFeed = (creative.asset_feed_spec as Record<string, unknown> | undefined) ?? {};
  const assetFeedImages = (assetFeed.images as Array<Record<string, string>> | undefined) ?? [];
  const assetFeedImageUrl = assetFeedImages[0]?.url ?? null;
  if (assetFeedImageUrl) return assetFeedImageUrl;

  const videoId = extractVideoId(creative);
  const videoThumb = videoId ? videoThumbsById.get(videoId) : null;
  if (videoThumb) return videoThumb;

  const imageUrl = creative.image_url as string | undefined;
  if (imageUrl) return imageUrl;

  const thumbnailUrl = creative.thumbnail_url as string | undefined;
  return thumbnailUrl ?? null;
}

// Busca as janelas do panorama (30/14/7/3d) das campanhas selecionadas em UMA chamada batch
// (?ids=...) com field expansion aliased. Best-effort: falha/timeout → Map vazio, a análise
// segue sem panorama no nível campanha (nunca lança).
async function fetchMetaCampaignWindows(
  campaignIds: string[],
  token: string,
  ranges: OptimizerWindowRanges,
): Promise<Map<string, OptimizerJanelas>> {
  const result = new Map<string, OptimizerJanelas>();
  if (campaignIds.length === 0 || !token) return result;
  try {
    const url = new URL('https://graph.facebook.com/v21.0/');
    url.searchParams.set('ids', campaignIds.join(','));
    url.searchParams.set('fields', buildMetaWindowFields(ranges));
    url.searchParams.set('access_token', token);
    const res = await fetchWithTimeout(url.toString(), 8_000);
    if (!res?.ok) return result;
    const data = await res.json() as Record<string, Record<string, unknown>>;
    for (const id of campaignIds) {
      const janelas = data?.[id] ? parseMetaWindowInsights(data[id]) : undefined;
      if (janelas) result.set(id, janelas);
    }
    return result;
  } catch {
    return result;
  }
}

// Busca conjuntos + anúncios de uma campanha direto na Meta (best-effort, com deadline)
async function fetchConjuntosForCampaign(
  campaignId: string,
  token: string,
  dateFrom: string,
  dateTo: string,
  deadline: number,
  windowRanges: OptimizerWindowRanges,
): Promise<OptimizerCampaignV2['conjuntos']> {
  if (Date.now() > deadline) return [];
  const insightFields = `insights.time_range(${JSON.stringify({ since: dateFrom, until: dateTo })}){spend,impressions,reach,frequency,clicks,actions,ctr}`;
  const windowFields = buildMetaWindowFields(windowRanges);
  const baseAdsetFields = `id,name,status,effective_status,optimization_goal,daily_budget,created_time,${insightFields}`;
  const url = new URL(`https://graph.facebook.com/v21.0/${campaignId}/adsets`);
  url.searchParams.set('fields', `${baseAdsetFields},${windowFields}`);
  url.searchParams.set('limit', '10');
  url.searchParams.set('access_token', token);

  let res = await fetchWithTimeout(url.toString(), 8_000);
  // Se os aliases das janelas derrubarem o request (conta/versão da API que rejeite as
  // expansões extras), refaz UMA vez sem eles — os conjuntos não podem sumir da árvore por
  // causa do panorama (mesmo padrão do fallback de vídeo dos /ads abaixo).
  if (!res?.ok) {
    const errBody = await res?.text().catch(() => '');
    console.error('[otimizador/weekly] /adsets falhou com janelas, tentando fallback', campaignId, res?.status, errBody?.slice(0, 300));
    const fallbackUrl = new URL(`https://graph.facebook.com/v21.0/${campaignId}/adsets`);
    fallbackUrl.searchParams.set('fields', baseAdsetFields);
    fallbackUrl.searchParams.set('limit', '10');
    fallbackUrl.searchParams.set('access_token', token);
    res = await fetchWithTimeout(fallbackUrl.toString(), 8_000);
  }
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
    const conversoes = countMetaResults(actions);
    const gasto = Number(insights.spend ?? 0);
    const impressoes = Number(insights.impressions ?? 0);
    const cliques = Number(insights.clicks ?? 0);
    const ctr = Number(insights.ctr ?? (impressoes > 0 ? (cliques / impressoes) * 100 : 0));
    const createdTime = String(raw.created_time ?? '');
    const diasAtivo = createdTime ? Math.floor((Date.now() - new Date(createdTime).getTime()) / 86400000) : null;

    // Anúncios com rankings (best-effort, só se houver tempo)
    let anuncios: OptimizerCampaignV2['conjuntos'][number]['anuncios'] = [];
    if (Date.now() < deadline) {
      // Mesmos campos usados pelo preview nítido do dashboard (/api/meta/top-creatives) —
      // creative.thumbnail_url sozinho é baixa resolução e carrega `oe=` (expira). image_url,
      // asset_feed_spec e o vídeo original (via segunda chamada abaixo) dão a imagem de verdade.
      const baseAdsFields = `id,name,effective_status,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,creative{image_url,thumbnail_url,video_id,object_story_spec,asset_feed_spec}`;
      const insightsBase = `spend,impressions,clicks,actions,ctr`;
      const insightsComVideo = `${insightsBase},video_3_sec_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions`;

      const adsUrl = new URL(`https://graph.facebook.com/v21.0/${String(raw.id)}/ads`);
      adsUrl.searchParams.set('fields', `${baseAdsFields},insights.time_range(${JSON.stringify({ since: dateFrom, until: dateTo })}){${insightsComVideo}},${windowFields}`);
      adsUrl.searchParams.set('limit', '8');
      adsUrl.searchParams.set('access_token', token);
      let adsRes = await fetchWithTimeout(adsUrl.toString(), 8_000);

      // Se os campos de retenção de vídeo (ou os aliases das janelas) derrubarem o request
      // inteiro (conta/versão da API que não aceita), os criativos NÃO PODEM sumir da árvore
      // por causa disso — refaz sem vídeo e sem janelas antes de desistir (não cabe um 3º
      // fetch no deadline). Sem este fallback, um 400 aqui zera "Criativos" e some com a
      // árvore inteira (visto em produção com o payload de vídeo).
      if (!adsRes?.ok) {
        const errBody = await adsRes?.text().catch(() => '');
        console.error('[otimizador/weekly] /ads falhou com campos de video/janelas, tentando fallback', raw.id, adsRes?.status, errBody?.slice(0, 300));
        const fallbackUrl = new URL(`https://graph.facebook.com/v21.0/${String(raw.id)}/ads`);
        fallbackUrl.searchParams.set('fields', `${baseAdsFields},insights.time_range(${JSON.stringify({ since: dateFrom, until: dateTo })}){${insightsBase}}`);
        fallbackUrl.searchParams.set('limit', '8');
        fallbackUrl.searchParams.set('access_token', token);
        adsRes = await fetchWithTimeout(fallbackUrl.toString(), 8_000);
      }

      if (adsRes?.ok) {
        const adsData = await adsRes.json() as { data?: Record<string, unknown>[] };
        const ads = adsData.data ?? [];

        // Vídeo tem sua própria imagem de capa (picture, estável, sem expiry) e uma lista de
        // frames em várias resoluções — pega o de maior altura. Uma chamada em lote pra todos
        // os vídeos deste conjunto, em vez de 1 chamada por anúncio.
        const videoIds = [...new Set(
          ads.map((ad) => extractVideoId((ad.creative as Record<string, unknown>) ?? {})).filter((id): id is string => !!id),
        )];
        const videoThumbsById = new Map<string, string>();
        if (videoIds.length > 0 && Date.now() < deadline) {
          const vRes = await fetchWithTimeout(
            `https://graph.facebook.com/v21.0/?ids=${videoIds.join(',')}&fields=picture,thumbnails{uri,height}&access_token=${token}`,
            6_000,
          );
          if (vRes?.ok) {
            const vData = await vRes.json() as Record<string, { picture?: string; thumbnails?: { data?: Array<{ uri: string; height?: number }> } }>;
            for (const [id, v] of Object.entries(vData)) {
              const bestFrame = (v.thumbnails?.data ?? []).sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]?.uri;
              const best = bestFrame ?? v.picture;
              if (best) videoThumbsById.set(id, best);
            }
          }
        }

        anuncios = ads.map((ad) => {
          const ai = (ad.insights as { data?: Record<string, unknown>[] } | undefined)?.data?.[0] ?? {};
          const adActions = (ai.actions as Array<{ action_type: string; value: string }>) ?? [];
          const adConv = countMetaResults(adActions);
          const adGasto = Number(ai.spend ?? 0);
          const adImp = Number(ai.impressions ?? 0);
          const adClicks = Number(ai.clicks ?? 0);

          // Retenção de vídeo (Meta Insights API — video_3_sec/p25/p50/p75_watched_actions).
          // Só existem em criativos de vídeo; imagem/carrossel não traz esses campos (arrays
          // vazios ou ausentes). Taxas normalizadas por impressões, decrescentes por construção
          // (quem assiste p75 já passou por p50, p25 e pelos 3s iniciais).
          const hook3s = firstActionValue(ai.video_3_sec_watched_actions);
          const p25 = firstActionValue(ai.video_p25_watched_actions);
          const p50 = firstActionValue(ai.video_p50_watched_actions);
          const p75 = firstActionValue(ai.video_p75_watched_actions);
          const ehVideo = hook3s != null;
          const videoRate = (n: number | null) => (ehVideo && adImp > 0 && n != null) ? Number(((n / adImp) * 100).toFixed(1)) : null;
          const imagemUrl = resolveCreativeImageUrl((ad.creative as Record<string, unknown>) ?? {}, videoThumbsById);

          return {
            id: String(ad.id),
            nome: String(ad.name ?? ''),
            status: String(ad.effective_status ?? ''),
            gasto: adGasto,
            impressoes: adImp,
            ctr: Number(ai.ctr ?? (adImp > 0 ? (adClicks / adImp) * 100 : 0)),
            cpl: adGasto > 0 && adConv > 0 ? adGasto / adConv : null,
            conversoes: adConv,
            cliques: adClicks,
            dias_ativo: null,
            quality_ranking: ad.quality_ranking ? String(ad.quality_ranking) : null,
            engagement_ranking: ad.engagement_rate_ranking ? String(ad.engagement_rate_ranking) : null,
            conversion_ranking: ad.conversion_rate_ranking ? String(ad.conversion_rate_ranking) : null,
            eh_video: ehVideo,
            video_hook_rate: videoRate(hook3s),
            video_p25_rate: videoRate(p25),
            video_p50_rate: videoRate(p50),
            video_p75_rate: videoRate(p75),
            imagem_url: imagemUrl,
            janelas: parseMetaWindowInsights(ad),
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
      cliques,
      ctr_tendencia_4d: null,
      dias_ativo: diasAtivo,
      janelas: parseMetaWindowInsights(raw),
      anuncios,
    };
  }));

  return conjuntos;
}

// Campanha de TRÁFEGO mede-se por CLIQUE: o custo por resultado é o CPC (gasto/cliques), não o
// CPL. Num tráfego o CPL sai de conversas incidentais e vira número sem sentido (bug Cão Véio:
// "Custo por clique R$351" = R$702,95 ÷ 2 conversas, quando o real é R$0,28 ÷ 2.674 cliques).
// Antes de mandar pra IA e montar a árvore, zera o CPL enganoso e injeta o CPC verdadeiro em toda
// a subárvore; para os demais objetivos só acrescenta o CPC como informação (mantém conversoes/cpl).
function comMetricaDeClique(camp: OptimizerCampaignV2): OptimizerCampaignV2 {
  const cpc = (gasto: number, cliques: number | undefined | null) =>
    cliques && cliques > 0 ? gasto / cliques : null;
  if (!objetivoMedidoPorClique(camp.objetivo)) {
    return { ...camp, cpc: cpc(camp.gasto, camp.cliques) };
  }
  return {
    ...camp,
    cpl: null,
    cpc: cpc(camp.gasto, camp.cliques),
    // Mesma regra dentro do panorama: cpl das janelas de tráfego é enganoso do mesmo jeito.
    janelas: janelasComMetricaDeClique(camp.janelas),
    conjuntos: (camp.conjuntos ?? []).map((cj) => ({
      ...cj,
      cpl: null,
      cpc: cpc(cj.gasto, cj.cliques),
      janelas: janelasComMetricaDeClique(cj.janelas),
      anuncios: (cj.anuncios ?? []).map((ad) => ({
        ...ad,
        cpl: null,
        cpc: cpc(ad.gasto, ad.cliques),
        janelas: janelasComMetricaDeClique(ad.janelas),
      })),
    })),
  };
}

// Calcula a tendência determinística (RECUPERANDO/PIORANDO/ESTAVEL/DADO_INSUFICIENTE) de cada
// nó a partir das janelas, no eixo de medição do objetivo da CAMPANHA (cpc pra tráfego, cpl
// pros demais). Aplicar SEMPRE depois de comMetricaDeClique (que já normalizou cpl/cpc).
function comJanelasETendencia(camp: OptimizerCampaignV2): OptimizerCampaignV2 {
  const usaCpc = objetivoMedidoPorClique(camp.objetivo);
  return {
    ...camp,
    tendencia: calcularTendencia(camp.janelas, usaCpc),
    conjuntos: (camp.conjuntos ?? []).map((cj) => ({
      ...cj,
      tendencia: calcularTendencia(cj.janelas, usaCpc),
      anuncios: (cj.anuncios ?? []).map((ad) => ({
        ...ad,
        tendencia: calcularTendencia(ad.janelas, usaCpc),
      })),
    })),
  };
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
  benchmarks: Record<OptimizerNiche, NicheBenchmark>,
): Promise<OptimizerPayloadV2 | null> {
  const semana = currentWeekLabel();

  // Tenta o período solicitado; se gasto = 0, expande para 30 dias
  const FALLBACK_DAYS = 30;
  let usedPeriod = period;
  // this_month/last_month usam datas de calendário reais (dia 1 ao último dia do mês), não
  // uma janela de N dias fixos — por isso passa a KEY, não period.days, pro cálculo do range.
  let { dateFrom, dateTo } = optimizerDateRangeForPeriod(period.key);

  let rawCampaigns = await fetchCampaignsForClient(client.id, origin, period.key, dateFrom, dateTo);
  let activeCampaigns = rawCampaigns.filter((c) => {
    const s = (c.status ?? '').toUpperCase();
    return ['ACTIVE', 'ENABLED', 'IN_PROCESS', 'WITH_ISSUES'].includes(s) && c.platform === 'meta';
  });

  // Fallback para 30 dias quando o período solicitado não trouxe campanhas com entrega.
  // `/api/campaigns` já descarta campanhas com gasto = 0, então "sem gasto no período" chega
  // aqui como lista VAZIA — por isso o gatilho é length === 0 (antes era código morto).
  // Usa a duração REAL do intervalo (não period.days) — "este mês" no dia 2 é um intervalo
  // curtíssimo na prática, mesmo com days=30 nominal, e também merece o fallback.
  if (activeCampaigns.length === 0 && isoDateDiffDays(dateFrom, dateTo) < FALLBACK_DAYS) {
    ({ dateFrom, dateTo } = optimizerDateRangeForDays(FALLBACK_DAYS));
    usedPeriod = { key: 'last_30d', label: 'Últimos 30 dias', days: FALLBACK_DAYS };
    rawCampaigns = await fetchCampaignsForClient(client.id, origin, 'last_30d', dateFrom, dateTo);
    activeCampaigns = rawCampaigns.filter((c) => {
      const s = (c.status ?? '').toUpperCase();
      return ['ACTIVE', 'ENABLED', 'IN_PROCESS', 'WITH_ISSUES'].includes(s) && c.platform === 'meta';
    });
  }

  if (activeCampaigns.length === 0) return null;

  const topCampaigns = activeCampaigns.slice(0, 5);

  // Panorama multi-janela (30/14/7/3d): as datas independem da janela primária.
  const windowRanges = optimizerMultiWindowRanges();

  // Conjuntos + anúncios das campanhas que gastaram. Busca em PARALELO (uma promise por
  // campanha), com deadline compartilhado — evita a soma sequencial que estourava os 60s.
  // As janelas do nível campanha vão numa chamada batch única, em paralelo com os conjuntos.
  const conjuntosDeadline = Date.now() + 15_000;
  const [campWindows, conjuntosPorCampanha] = await Promise.all([
    fetchMetaCampaignWindows(topCampaigns.map((c) => c.id), token, windowRanges),
    Promise.all(
      topCampaigns.map((camp) =>
        (fetchConjuntos && token && camp.spend > 0)
          ? fetchConjuntosForCampaign(camp.id, token, dateFrom, dateTo, conjuntosDeadline, windowRanges).catch(() => [])
          : Promise.resolve([] as OptimizerCampaignV2['conjuntos']),
      ),
    ),
  ]);

  const campanhas: OptimizerCampaignV2[] = topCampaigns.map((camp, i) => comJanelasETendencia(comMetricaDeClique({
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
    janelas: campWindows.get(camp.id) ?? null,
    conjuntos: conjuntosPorCampanha[i],
  })));

  void accountId; // reservado para opportunity score futuro

  const historico = await loadDecisionHistory(client.id);
  const notasManuais = await loadManualNotesContext(client.id);

  const totalGasto = campanhas.reduce((sum, c) => sum + c.gasto, 0);
  // Régua de custo: meta do cliente SEMPRE tem prioridade; sem meta, cai no benchmark do nicho.
  const nicho = segmentToOptimizerNiche(client.segment ?? undefined);
  const temMetaCpl = planning?.cpl_meta != null || planning?.cpl_maximo != null;
  const bench = temMetaCpl ? null : (benchmarks[nicho] ?? benchmarkParaNicho(nicho));
  const cplIdeal = planning?.cpl_meta ?? bench?.cpl_ideal ?? null;
  const cplMaximo = planning?.cpl_maximo ?? bench?.cpl_maximo ?? null;

  // Injeta contexto quando os dados são escassos para orientar a IA
  const observacoes: string[] = [];
  if (notasManuais) observacoes.push(notasManuais);
  if (totalGasto === 0) {
    observacoes.push(`ALERTA: A conta possui ${campanhas.length} campanha(s) ativas mas registrou R$ 0,00 em gasto no período de ${period.label}. Diagnostique o motivo da não-entrega (pagamento, aprovação, orçamento esgotado, erro de configuração) e oriente o gestor de forma direta sobre o que verificar agora no Gerenciador de Anúncios.`);
  }
  if (bench) {
    observacoes.push(`SEM META CADASTRADA: usei o benchmark do nicho "${nicho}" como régua de referência — custo-alvo ~R$${bench.cpl_ideal} por lead/conversa e teto ~R$${bench.cpl_maximo}. Trate como estimativa de MERCADO (não meta do cliente); recomende cadastrar a meta real do cliente pra afinar as próximas análises.`);
  }

  return {
    cliente_id: client.id,
    cliente_nome: client.name,
    nicho,
    modo_operacao: client.modo_operacao,
    semana_analise: semana,
    acoes_pre_aprovadas: client.acoes_pre_aprovadas ?? [],
    metas: {
      objetivo_principal: (planning?.objetivo as OptimizerObjective) ?? null,
      cpl_ideal: cplIdeal,
      cpl_maximo: cplMaximo,
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
      dias: isoDateDiffDays(dateFrom, dateTo),
      label: usedPeriod.label,
    },
    janelas_referencia: janelasReferencia(windowRanges),
    opportunity_score: null,
    campanhas,
    historico_decisoes: historico,
    observacoes_gestor: observacoes.length > 0 ? observacoes.join(' | ') : null,
    observacoes_fixas: client.observacoes_fixas,
  };
}

// ─── Google Ads (path aditivo — Meta intocado) ─────────────────────────────────
// Espelha o path Meta (buildPayloadForClient) mas puxando ad groups + ads via GAQL. O Google
// não expõe retenção de vídeo nem imagem de criativo via GAQL simples → eh_video=false, taxas e
// imagem_url null (o prompt já trata `eh_video=false`). O objetivo já vem NORMALIZADO por
// /api/campaigns (normalizeGoogleChannelType), então cai nos boards certos sem mudança extra.

const GADS_DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

function normalizeGoogleCustomerId(accountId: string): string {
  return String(accountId ?? '').replace(/\D/g, '');
}

function gadsHeaders(accessToken: string, loginCustomerId?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GADS_DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) h['login-customer-id'] = normalizeGoogleCustomerId(loginCustomerId);
  return h;
}

async function gadsSearch(
  customerId: string,
  query: string,
  accessToken: string,
  loginCustomerId: string | undefined,
  ms: number,
): Promise<{ results?: Record<string, unknown>[] } | null> {
  const cid = normalizeGoogleCustomerId(customerId);
  if (!cid) return null;
  const res = await fetchWithTimeout(
    `https://googleads.googleapis.com/v24/customers/${cid}/googleAds:search`,
    ms,
    { method: 'POST', headers: gadsHeaders(accessToken, loginCustomerId), body: JSON.stringify({ query }) },
  );
  if (!res?.ok) return null;
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

// Renova um access_token via refresh_token no endpoint OAuth cru (mesmo caminho do
// report-builder, que FUNCIONA). Trocado do `oauth2.refreshAccessToken()` da googleapis —
// esse método é depreciado e falhava silenciosamente ("token não resolvido") em contas Google
// do Otimizador enquanto a dashboard/relatórios (que usam este fetch) puxavam normal.
async function refreshGoogleAccessToken(row: { access_token: string; refresh_token: string; token_expiry: string | null }): Promise<string | null> {
  if (row.token_expiry && new Date(row.token_expiry).getTime() > Date.now() + 60_000) {
    return row.access_token;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
  }).catch(() => null);
  if (res?.ok) {
    const data = await res.json().catch(() => null) as { access_token?: string } | null;
    return data?.access_token ?? row.access_token ?? null;
  }
  // Refresh falhou mas ainda temos um access_token não-expirado no banco → usa ele.
  return row.access_token ?? null;
}

async function resolveGoogleToken(connectionId: string): Promise<string | null> {
  const pool = makeServerPool();
  try {
    // 1) Conexão vinculada ao cliente.
    const { rows } = await pool.query<{ access_token: string; refresh_token: string; token_expiry: string | null }>(
      `SELECT access_token, refresh_token, token_expiry FROM public.google_connections WHERE id = $1`,
      [connectionId],
    );
    if (rows[0]) {
      const tok = await refreshGoogleAccessToken(rows[0]);
      if (tok) return tok;
    }
    // 2) Fallback: qualquer conexão Google Ads conectada (o connection_id salvo em
    // client_account_links pode estar defasado/apontar pra uma linha revogada). Mesma
    // estratégia de fallback do report-builder — por isso relatórios funcionam e o Otimizador não.
    const { rows: candidates } = await pool.query<{ access_token: string; refresh_token: string; token_expiry: string | null }>(
      `SELECT access_token, refresh_token, token_expiry
         FROM public.google_connections
        WHERE status = 'connected'
          AND (account_type = 'google_ads' OR scope ILIKE '%adwords%')
        ORDER BY connected_at DESC
        LIMIT 3`,
    ).catch(() => ({ rows: [] as { access_token: string; refresh_token: string; token_expiry: string | null }[] }));
    for (const c of candidates) {
      const tok = await refreshGoogleAccessToken(c);
      if (tok) return tok;
    }
    return null;
  } catch {
    return null;
  } finally {
    await pool.end().catch(() => {});
  }
}

type GoogleConnRow = { connectionId: string; accountId: string };

async function loadGoogleConnections(clientIds: string[]): Promise<Record<string, GoogleConnRow>> {
  if (clientIds.length === 0) return {};
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{ client_id: string; connection_id: string; account_id: string }>(
      `SELECT client_id, connection_id, account_id
         FROM public.client_account_links
        WHERE client_id = ANY($1::text[]) AND platform = 'google_ads'`,
      [clientIds],
    ).catch(() => ({ rows: [] as { client_id: string; connection_id: string; account_id: string }[] }));
    const map: Record<string, GoogleConnRow> = {};
    for (const r of rows) {
      if (!map[r.client_id] && r.connection_id && r.account_id) {
        map[r.client_id] = { connectionId: r.connection_id, accountId: r.account_id };
      }
    }
    return map;
  } finally {
    await pool.end().catch(() => {});
  }
}

function gadsNum(metrics: Record<string, unknown>, key: string): number {
  return Number(metrics[key] ?? 0);
}

// Busca linhas DIÁRIAS (segments.date no SELECT) dos objetos já selecionados e agrega nas 4
// janelas do panorama (30/14/7/3d). A seleção top-N continua na query agregada (sem segmentação)
// — aqui só entram ids já escolhidos, por isso não há LIMIT. FROM campaign/ad_group/ad_group_ad
// (nunca customer) e sem métricas de IS na query segmentada (regras do projeto).
// Premissa: ≤ ~40 objetos × 31 dias ≈ 1.240 linhas — bem abaixo da página default (10k) do
// googleAds:search, então gadsSearch sem paginação continua suficiente.
async function fetchGoogleDailyWindows(
  customerId: string,
  entity: 'campaign' | 'ad_group' | 'ad_group_ad',
  idExpr: string,
  whereClause: string,
  token: string,
  loginCustomerId: string | undefined,
  ranges: OptimizerWindowRanges,
): Promise<Map<string, OptimizerJanelas>> {
  const { dateFrom, dateTo } = ranges.d30;
  const data = await gadsSearch(
    customerId,
    `SELECT ${idExpr}, segments.date,
            metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
       FROM ${entity}
      WHERE ${whereClause} AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`,
    token, loginCustomerId, 8_000,
  );
  const rows: GoogleDailyRow[] = (data?.results ?? []).map((r) => {
    const m = (r.metrics as Record<string, unknown>) ?? {};
    const seg = (r.segments as Record<string, unknown>) ?? {};
    let id = '';
    if (entity === 'campaign') {
      id = String(((r.campaign as Record<string, unknown>) ?? {}).id ?? '');
    } else if (entity === 'ad_group') {
      id = String(((r.adGroup as Record<string, unknown>) ?? {}).id ?? '');
    } else {
      const wrap = (r.adGroupAd as Record<string, unknown>) ?? {};
      id = String(((wrap.ad as Record<string, unknown>) ?? {}).id ?? '');
    }
    return {
      id,
      date: String(seg.date ?? ''),
      costMicros: gadsNum(m, 'costMicros'),
      impressions: gadsNum(m, 'impressions'),
      clicks: gadsNum(m, 'clicks'),
      conversions: gadsNum(m, 'conversions'),
    };
  });
  return aggregateGoogleDailyRows(rows, ranges);
}

// Busca ad groups + ads de uma campanha Google via GAQL. `segments.date` só no WHERE (não no
// SELECT) → o Google agrega as métricas no intervalo em UMA linha por objeto (sem linhas por dia).
async function fetchGoogleAdGroups(
  customerId: string,
  campaignId: string,
  token: string,
  loginCustomerId: string | undefined,
  dateFrom: string,
  dateTo: string,
  deadline: number,
  windowRanges: OptimizerWindowRanges,
): Promise<OptimizerCampaignV2['conjuntos']> {
  if (Date.now() > deadline) return [];
  const dateFilter = `segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`;
  const agData = await gadsSearch(
    customerId,
    `SELECT ad_group.id, ad_group.name, ad_group.status,
            metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
       FROM ad_group
      WHERE campaign.id = ${campaignId} AND ${dateFilter}
        AND ad_group.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 5`,
    token, loginCustomerId, 8_000,
  );
  const agRows = agData?.results ?? [];

  // Janelas do panorama dos ad groups selecionados — 1 query pra campanha inteira, em paralelo
  // com a busca de anúncios abaixo. Best-effort: falha → Map vazio, nós ficam sem janelas.
  const agIds = agRows
    .map((row) => String(((row.adGroup as Record<string, unknown>) ?? {}).id ?? ''))
    .filter(Boolean);
  const agWindowsPromise = (agIds.length > 0 && Date.now() < deadline)
    ? fetchGoogleDailyWindows(
        customerId, 'ad_group', 'ad_group.id',
        `campaign.id = ${campaignId} AND ad_group.id IN (${agIds.join(',')})`,
        token, loginCustomerId, windowRanges,
      ).catch(() => new Map<string, OptimizerJanelas>())
    : Promise.resolve(new Map<string, OptimizerJanelas>());

  return Promise.all(agRows.map(async (row): Promise<OptimizerCampaignV2['conjuntos'][number]> => {
    const ag = (row.adGroup as Record<string, unknown>) ?? {};
    const m = (row.metrics as Record<string, unknown>) ?? {};
    const gasto = gadsNum(m, 'costMicros') / 1_000_000;
    const impressoes = gadsNum(m, 'impressions');
    const cliques = gadsNum(m, 'clicks');
    const conversoes = Math.round(gadsNum(m, 'conversions'));
    const ctr = impressoes > 0 ? (cliques / impressoes) * 100 : 0;
    const agId = String(ag.id ?? '');

    let anuncios: OptimizerCampaignV2['conjuntos'][number]['anuncios'] = [];
    if (Date.now() < deadline && agId) {
      // Query agregada (seleção top-8) em paralelo com as janelas diárias dos anúncios do grupo.
      const [adData, adWindows] = await Promise.all([
        gadsSearch(
          customerId,
          `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,
                  metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
             FROM ad_group_ad
            WHERE ad_group.id = ${agId} AND ${dateFilter}
              AND ad_group_ad.status != 'REMOVED'
            ORDER BY metrics.cost_micros DESC
            LIMIT 8`,
          token, loginCustomerId, 8_000,
        ),
        fetchGoogleDailyWindows(
          customerId, 'ad_group_ad', 'ad_group_ad.ad.id',
          `ad_group.id = ${agId} AND ad_group_ad.status != 'REMOVED'`,
          token, loginCustomerId, windowRanges,
        ).catch(() => new Map<string, OptimizerJanelas>()),
      ]);
      anuncios = (adData?.results ?? []).map((r) => {
        const adWrap = (r.adGroupAd as Record<string, unknown>) ?? {};
        const ad = (adWrap.ad as Record<string, unknown>) ?? {};
        const am = (r.metrics as Record<string, unknown>) ?? {};
        const adGasto = gadsNum(am, 'costMicros') / 1_000_000;
        const adImp = gadsNum(am, 'impressions');
        const adClk = gadsNum(am, 'clicks');
        const adConv = Math.round(gadsNum(am, 'conversions'));
        const adId = String(ad.id ?? '');
        return {
          id: adId,
          nome: String(ad.name ?? ad.id ?? 'Anúncio'),
          status: String(adWrap.status ?? ''),
          gasto: adGasto,
          impressoes: adImp,
          ctr: adImp > 0 ? (adClk / adImp) * 100 : 0,
          cpl: adGasto > 0 && adConv > 0 ? adGasto / adConv : null,
          conversoes: adConv,
          cliques: adClk,
          dias_ativo: null,
          quality_ranking: null,
          engagement_ranking: null,
          conversion_ranking: null,
          eh_video: false,
          video_hook_rate: null,
          video_p25_rate: null,
          video_p50_rate: null,
          video_p75_rate: null,
          imagem_url: null,
          janelas: adWindows.get(adId) ?? null,
        };
      });
    }

    return {
      id: agId,
      nome: String(ag.name ?? 'Grupo de anúncios'),
      status: String(ag.status ?? ''),
      objetivo_otimizacao: '',
      tipo_publico: 'outro',
      orcamento_diario: null,
      gasto,
      impressoes,
      alcance: null,
      frequencia: null,
      ctr,
      cpl: gasto > 0 && conversoes > 0 ? gasto / conversoes : null,
      conversoes,
      cliques,
      ctr_tendencia_4d: null,
      dias_ativo: null,
      janelas: (await agWindowsPromise).get(agId) ?? null,
      anuncios,
    };
  }));
}

async function buildGooglePayloadForClient(
  client: ClientRow,
  planning: PlanningRow | null,
  token: string,
  gConn: GoogleConnRow,
  origin: string,
  period: AnalysisPeriod,
  fetchConjuntos: boolean,
  benchmarks: Record<OptimizerNiche, NicheBenchmark>,
): Promise<{ payload: OptimizerPayloadV2 | null; loginCustomerId?: string }> {
  const semana = currentWeekLabel();
  const FALLBACK_DAYS = 30;
  let usedPeriod = period;
  let { dateFrom, dateTo } = optimizerDateRangeForPeriod(period.key);

  const isGoogleActive = (c: { status: string; platform: string }) =>
    ['ACTIVE', 'ENABLED'].includes((c.status ?? '').toUpperCase()) && c.platform === 'google';

  let rawCampaigns = await fetchCampaignsForClient(client.id, origin, period.key, dateFrom, dateTo);
  let activeCampaigns = rawCampaigns.filter(isGoogleActive);

  if (activeCampaigns.length === 0 && isoDateDiffDays(dateFrom, dateTo) < FALLBACK_DAYS) {
    ({ dateFrom, dateTo } = optimizerDateRangeForDays(FALLBACK_DAYS));
    usedPeriod = { key: 'last_30d', label: 'Últimos 30 dias', days: FALLBACK_DAYS };
    rawCampaigns = await fetchCampaignsForClient(client.id, origin, 'last_30d', dateFrom, dateTo);
    activeCampaigns = rawCampaigns.filter(isGoogleActive);
  }

  if (activeCampaigns.length === 0) return { payload: null };

  const topCampaigns = activeCampaigns.slice(0, 5);
  const loginCustomerId = topCampaigns.find((c) => c.loginCustomerId)?.loginCustomerId;
  const customerId = gConn.accountId;

  // Panorama multi-janela (30/14/7/3d) — mesmo esquema do path Meta.
  const windowRanges = optimizerMultiWindowRanges();

  const conjuntosDeadline = Date.now() + 15_000;
  const [campWindows, conjuntosPorCampanha] = await Promise.all([
    fetchGoogleDailyWindows(
      customerId, 'campaign', 'campaign.id',
      `campaign.id IN (${topCampaigns.map((c) => c.id).join(',')})`,
      token, loginCustomerId, windowRanges,
    ).catch(() => new Map<string, OptimizerJanelas>()),
    Promise.all(
      topCampaigns.map((camp) =>
        (fetchConjuntos && token && camp.spend > 0)
          ? fetchGoogleAdGroups(customerId, camp.id, token, loginCustomerId, dateFrom, dateTo, conjuntosDeadline, windowRanges).catch(() => [])
          : Promise.resolve([] as OptimizerCampaignV2['conjuntos']),
      ),
    ),
  ]);

  const campanhas: OptimizerCampaignV2[] = topCampaigns.map((camp, i) => comJanelasETendencia(comMetricaDeClique({
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
    janelas: campWindows.get(camp.id) ?? null,
    conjuntos: conjuntosPorCampanha[i],
  })));

  const historico = await loadDecisionHistory(client.id);
  const notasManuais = await loadManualNotesContext(client.id);
  const totalGasto = campanhas.reduce((sum, c) => sum + c.gasto, 0);
  const nicho = segmentToOptimizerNiche(client.segment ?? undefined);
  const temMetaCpl = planning?.cpl_meta != null || planning?.cpl_maximo != null;
  const bench = temMetaCpl ? null : (benchmarks[nicho] ?? benchmarkParaNicho(nicho));
  const cplIdeal = planning?.cpl_meta ?? bench?.cpl_ideal ?? null;
  const cplMaximo = planning?.cpl_maximo ?? bench?.cpl_maximo ?? null;

  const observacoes: string[] = [];
  if (notasManuais) observacoes.push(notasManuais);
  if (totalGasto === 0) {
    observacoes.push(`ALERTA: A conta Google Ads possui ${campanhas.length} campanha(s) ativas mas registrou R$ 0,00 em gasto no período de ${period.label}. Diagnostique o motivo (pagamento, aprovação, orçamento) e oriente o gestor sobre o que verificar agora no Google Ads.`);
  }
  if (bench) {
    observacoes.push(`SEM META CADASTRADA: usei o benchmark do nicho "${nicho}" como régua de referência — custo-alvo ~R$${bench.cpl_ideal} por lead/conversa e teto ~R$${bench.cpl_maximo}. Trate como estimativa de MERCADO (não meta do cliente); recomende cadastrar a meta real do cliente.`);
  }
  // Sinais próprios do Google Ads (parcela de impressões — só existem em campanhas de Pesquisa).
  // Perda por ORÇAMENTO = demanda não capturada → sinal forte de ESCALAR. Impression share baixa
  // = espaço pra ganhar presença. Injetados como contexto; o cérebro decide o que fazer.
  const sinaisGoogle: string[] = [];
  for (const c of topCampaigns) {
    if (c.searchBudgetLostIS != null && c.searchBudgetLostIS >= 10) {
      sinaisGoogle.push(`"${c.name}": perdeu ${c.searchBudgetLostIS.toFixed(0)}% das impressões por ORÇAMENTO (demanda não capturada — avalie escalar a verba se o custo/resultado estiver saudável).`);
    }
    if (c.searchImprShare != null && c.searchImprShare > 0 && c.searchImprShare < 60) {
      sinaisGoogle.push(`"${c.name}": parcela de impressões de só ${c.searchImprShare.toFixed(0)}% (espaço pra ganhar presença via orçamento, lance ou qualidade do anúncio).`);
    }
  }
  if (sinaisGoogle.length > 0) {
    observacoes.push(`SINAIS GOOGLE ADS: ${sinaisGoogle.join(' ')}`);
  }

  const payload: OptimizerPayloadV2 = {
    cliente_id: client.id,
    cliente_nome: client.name,
    nicho,
    modo_operacao: client.modo_operacao,
    semana_analise: semana,
    acoes_pre_aprovadas: client.acoes_pre_aprovadas ?? [],
    metas: {
      objetivo_principal: (planning?.objetivo as OptimizerObjective) ?? null,
      cpl_ideal: cplIdeal,
      cpl_maximo: cplMaximo,
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
      dias: isoDateDiffDays(dateFrom, dateTo),
      label: usedPeriod.label,
    },
    janelas_referencia: janelasReferencia(windowRanges),
    opportunity_score: null,
    campanhas,
    historico_decisoes: historico,
    observacoes_gestor: observacoes.length > 0 ? observacoes.join(' | ') : null,
    observacoes_fixas: client.observacoes_fixas,
  };

  return { payload, loginCustomerId };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

type RunOptions = {
  origin: string;
  forceClientId?: string;
  forceAi: boolean;
  all: boolean;
  period: AnalysisPeriod;
};

function parseRunOptions(request: NextRequest): RunOptions {
  return {
    origin: new URL(request.url).origin,
    forceClientId: request.nextUrl.searchParams.get('clientId') ?? undefined,
    forceAi: request.nextUrl.searchParams.get('forceAi') === '1',
    all: request.nextUrl.searchParams.get('all') === '1',
    period: analysisPeriodFromRequest(request),
  };
}

async function loadBenchmarksMap(): Promise<Record<OptimizerNiche, NicheBenchmark>> {
  const pool = makeServerPool();
  try {
    return await loadNicheBenchmarks(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function executeWeekly({ origin, forceClientId, forceAi, all, period }: RunOptions) {
  const startedAt = Date.now();

  const clients = await loadClientsForToday(undefined, forceClientId, all);
  const clientIds = clients.map((c) => c.id);
  const [planningMap, connectionsMap, googleConnMap, benchmarks] = await Promise.all([
    loadPlanning(clientIds),
    loadConnections(clientIds),
    loadGoogleConnections(clientIds),
    loadBenchmarksMap(),
  ]);

  const results: Array<{ clientId: string; clientName: string; status: string; error?: string; canais_ok?: ('meta' | 'google')[] }> = [];

  // Conjuntos/anúncios: LIGADO no manual, mas com busca PARALELA (Promise.all) — antes as
  // chamadas ao Graph API eram sequenciais (5 camp × 5 conj × 8 anúncios em fila = ~20s+) e
  // estouravam os 60s → 504. Paralelizado, a mesma coleta cai para ~4-5s e cabe no tempo.
  const isManual = clients.length === 1;
  const fetchConjuntos = isManual;
  // Concorrência: 1 cliente = sequencial; cron = paralelo p/ cobrir a base dentro do tempo
  const CONCURRENCY = isManual ? 1 : 5;

  // 175s: com max_tokens 32k a IA pode passar de 120s em contas grandes (70+ nós entre
  // campanhas/conjuntos/criativos); a rota analisar tem maxDuration=180 — esperar menos que
  // isso gera "timeout" falso com análise salva.
  async function callAnalisar(body: Record<string, unknown>): Promise<void> {
    const analyzeRes = await fetchWithTimeout(new URL('/api/otimizador/analisar', origin).toString(), 175_000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!analyzeRes) throw new Error('analisar não respondeu (timeout da IA)');
    if (!analyzeRes.ok) {
      const errBody = await analyzeRes.text().catch(() => '');
      throw new Error(`analisar HTTP ${analyzeRes.status}${errBody ? ': ' + errBody.slice(0, 200) : ''}`);
    }
  }

  async function processClient(client: ClientRow): Promise<void> {
    const metaConn = connectionsMap[client.id];
    const gConn = googleConnMap[client.id];
    if (!metaConn && !gConn) {
      results.push({ clientId: client.id, clientName: client.name, status: 'sem_conexao_meta' });
      return;
    }

    // Roda cada canal conectado e coleta o desfecho de cada um. Consolida em UM resultado por
    // cliente no fim — senão, numa conta Meta+Google, a tela pegava o 1º resultado (Meta) e
    // mostrava a falha da Meta mesmo quando o Google tinha analisado com sucesso.
    const outcomes: Array<{ canal: 'meta' | 'google'; status: 'ok' | 'sem_campanhas_ativas' | 'erro'; error?: string }> = [];

    if (metaConn) {
      try {
        const token = await resolveToken(metaConn.id).catch(() => null);
        const payload = await buildPayloadForClient(
          client, planningMap[client.id] ?? null, token ?? '', metaConn.account_id, origin, period, fetchConjuntos, benchmarks,
        );
        if (!payload) {
          outcomes.push({ canal: 'meta', status: 'sem_campanhas_ativas' });
        } else {
          await callAnalisar({ payload_v2: payload, connection_id: metaConn.id, account_id: metaConn.account_id, canal: 'meta', force_ai: forceAi });
          outcomes.push({ canal: 'meta', status: 'ok' });
        }
      } catch (err) {
        outcomes.push({ canal: 'meta', status: 'erro', error: `[meta] ${String(err)}` });
      }
    }

    if (gConn) {
      try {
        const gToken = await resolveGoogleToken(gConn.connectionId).catch(() => null);
        if (!gToken) {
          outcomes.push({ canal: 'google', status: 'erro', error: 'autenticação falhou — reconecte o Google Ads deste cliente em Integrações (a conexão pode ter expirado)' });
        } else {
          const { payload, loginCustomerId } = await buildGooglePayloadForClient(
            client, planningMap[client.id] ?? null, gToken, gConn, origin, period, fetchConjuntos, benchmarks,
          );
          if (!payload) {
            outcomes.push({ canal: 'google', status: 'sem_campanhas_ativas' });
          } else {
            await callAnalisar({ payload_v2: payload, connection_id: gConn.connectionId, account_id: gConn.accountId, login_customer_id: loginCustomerId, canal: 'google', force_ai: forceAi });
            outcomes.push({ canal: 'google', status: 'ok' });
          }
        }
      } catch (err) {
        outcomes.push({ canal: 'google', status: 'erro', error: `[google] ${String(err)}` });
      }
    }

    // Consolidação: 'ok' se QUALQUER canal analisou; senão o erro mais informativo; senão
    // "sem campanhas" em todos os canais conectados. `canais_ok` diz o que de fato rodou.
    const okCanais = outcomes.filter((o) => o.status === 'ok').map((o) => o.canal);
    if (okCanais.length > 0) {
      results.push({ clientId: client.id, clientName: client.name, status: 'ok', canais_ok: okCanais });
      return;
    }
    // Um canal só: preserva o status limpo (sem_campanhas / erro) pra mensagem amigável.
    if (outcomes.length === 1) {
      results.push({ clientId: client.id, clientName: client.name, status: outcomes[0].status, error: outcomes[0].error });
      return;
    }
    // Dois canais, nenhum deu certo: mostra o desfecho de CADA um (senão um esconde o outro).
    const resumo = outcomes.map((o) => {
      const nome = o.canal === 'meta' ? 'Meta' : 'Google';
      const txt = o.status === 'sem_campanhas_ativas' ? 'sem campanhas ativas no período' : (o.error ?? 'erro');
      return `${nome}: ${txt}`;
    }).join(' · ');
    results.push({ clientId: client.id, clientName: client.name, status: 'erro', error: resumo });
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
  const clients = await loadClientsForToday(undefined, opts.forceClientId, opts.all);
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
    const last7 = optimizerDateRangeForDays(7);
    const last30 = optimizerDateRangeForDays(30);
    const [d7, d30, metaDireto] = await Promise.all([
      fetchCampaignsForClient(client.id, opts.origin, 'last_7d', last7.dateFrom, last7.dateTo).catch(() => []),
      fetchCampaignsForClient(client.id, opts.origin, 'last_30d', last30.dateFrom, last30.dateTo).catch(() => []),
      token ? fetchMetaCampaignsRaw(conn.account_id, token, last30.dateFrom, last30.dateTo).catch(() => ({ ok: false, erro: 'falha na consulta direta' })) : Promise.resolve({ ok: false, erro: 'sem token' }),
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
  try {
    if (request.nextUrl.searchParams.get('dryRun') === '1') {
      return Response.json({ dry_run: true, diagnostics: await diagnoseClients(parseRunOptions(request)) });
    }
    return Response.json(await executeWeekly(parseRunOptions(request)));
  } catch (err) {
    console.error('[otimizador/weekly GET] falha não tratada:', err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
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
    await pool.end().catch(() => {});
  }

  const opts = parseRunOptions(request);
  try {
    // dryRun=1: diagnóstico sem IA — só mostra de onde vêm (ou não) os dados.
    if (request.nextUrl.searchParams.get('dryRun') === '1') {
      return Response.json({ dry_run: true, diagnostics: await diagnoseClients(opts) });
    }
    // Síncrono: roda a análise (busca + IA) e só responde quando gravou o resultado.
    return Response.json(await executeWeekly(opts));
  } catch (err) {
    // Sem isso, uma falha aqui (ex: query sem .catch() em loadClientsForToday) vira um 500
    // opaco do Next.js e a UI só consegue mostrar "Erro na análise: HTTP 500" sem contexto.
    console.error('[otimizador/weekly POST] falha não tratada:', err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
