import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { RESULT_ACTIONS, NEW_CONTACT_ACTIONS, PURCHASE_ACTIONS, sumActions } from './report-runner';
import {
  fetchBairros, fetchMetaData, fetchInstagramData,
  sCapa, sVisaoGeral, sRegioes, sPaidTrafficResumo, sMetaAdsResumo, sMetaAdsCampanhas, sCriativos,
  sGoogleAdsResumo, sGoogleAdsCampanhas, sGoogleAdsPalavrasChave,
  sInstagram, sInstagramCalendar, sInstagramPosts, sInstagramSpotlight,
  sInstagramTodosConteudos, ordenarPostsPorData, TODOS_CONTEUDOS_POR_PAGINA,
  monthsBetweenInclusive, FONT_LINK, CANVAS, INTER,
  resolveReportCover, fetchReportRotationSeed,
  type ParsedData, type DiagJson, type GoogleAdsFull, type CampanhaGoogleDetalhada, type PalavraChaveGoogle, type MetaBreakdownLevel,
} from './delivery-report-builder';
import { sectionEnabled } from './report-sections';

// ── Persist ───────────────────────────────────────────────────────────────────

export async function saveOmniReport(opts: {
  clientId: string;
  clientName: string;
  periodFrom: string;
  periodTo: string;
  reportData: { html: string };
  generatedBy: string;
  configId?: string;
}): Promise<{ id: string; public_token: string }> {
  const pool = makeServerPool();
  try {
    await pool.query(`
      ALTER TABLE public.diagnostic_reports
        ADD COLUMN IF NOT EXISTS public_token TEXT DEFAULT encode(gen_random_bytes(16), 'hex'),
        ADD COLUMN IF NOT EXISTS template_slug TEXT,
        ADD COLUMN IF NOT EXISTS config_id UUID,
        ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ
    `);
    const { rows } = await pool.query(
      `INSERT INTO public.diagnostic_reports
         (client_id, client_name, title, period_from, period_to, report_data, generated_by, config_id, template_slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, public_token`,
      [
        opts.clientId, opts.clientName,
        `Relatório de Performance — ${opts.clientName}`,
        opts.periodFrom, opts.periodTo,
        JSON.stringify(opts.reportData),
        opts.generatedBy, opts.configId ?? null,
        'onmid-narrative-performance',
      ],
    );
    return { id: rows[0].id as string, public_token: rows[0].public_token as string };
  } finally {
    await pool.end();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function pct(a: number, b: number): string {
  if (b === 0) return '—';
  const v = ((a - b) / b) * 100;
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

export function fmtMonth(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
}

// ── Previous period helper ────────────────────────────────────────────────────

function calcPrevPeriod(from: string, to: string): { from: string; to: string } {
  const d1 = new Date(from + 'T00:00:00Z');
  const d2 = new Date(to + 'T00:00:00Z');
  const durationMs = d2.getTime() - d1.getTime() + 86400000;
  const prevTo = new Date(d1.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - durationMs + 86400000);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { from: fmt(prevFrom), to: fmt(prevTo) };
}

// ── Google Ads fetch (used by the lead-funnel-by-city dashboard, not by this report) ─

export type GoogleAdsTotals = { spend: number; impressions: number; clicks: number; conversions: number };

const GOOGLE_ADS_API_VERSION = 'v24';
const GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '1vR8GhAk4UMZoPaqo7Qq8Q';

type GoogleConnectionToken = { id: string; accessToken: string };

function googleMetricNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function hasGoogleActivity(metrics: CampanhaGoogleDetalhada['metricas']): boolean {
  return metrics.investimento > 0
    || metrics.impressoes > 0
    || metrics.cliques > 0
    || metrics.conversoes > 0
    || metrics.valorConversoes > 0;
}

async function getGoogleAccessToken(connectionId: string): Promise<string | null> {
  const pool = makeServerPool();
  let conn: { access_token: string; refresh_token: string; token_expiry: string | null } | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT access_token, refresh_token, token_expiry FROM public.google_connections WHERE id = $1 AND status = 'connected'`,
      [connectionId],
    );
    conn = rows[0] ?? null;
  } finally {
    await pool.end();
  }
  if (!conn) return null;

  let accessToken = conn.access_token;
  if (!conn.token_expiry || new Date(conn.token_expiry).getTime() < Date.now() + 60_000) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        refresh_token: conn.refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json() as { access_token?: string };
      accessToken = data.access_token ?? accessToken;
    }
  }
  return accessToken;
}

async function getGoogleAccessCandidates(connectionId: string | null | undefined): Promise<GoogleConnectionToken[]> {
  const pool = makeServerPool();
  let rows: Array<{ id: string; access_token: string; refresh_token: string; token_expiry: string | null }> = [];
  try {
    const { rows: found } = await pool.query(
      `SELECT id, access_token, refresh_token, token_expiry
       FROM public.google_connections
       WHERE status = 'connected'
         AND (account_type = 'google_ads' OR scope ILIKE '%adwords%')
       ORDER BY
         CASE WHEN id::text = $1 THEN 0 ELSE 1 END,
         connected_at DESC`,
      [connectionId ?? ''],
    );
    rows = found;
    if (!rows.length) {
      const { rows: connected } = await pool.query(
        `SELECT id, access_token, refresh_token, token_expiry
         FROM public.google_connections
         WHERE status = 'connected'
         ORDER BY
           CASE WHEN id::text = $1 THEN 0 ELSE 1 END,
           connected_at DESC`,
        [connectionId ?? ''],
      );
      rows = connected;
    }
  } finally {
    await pool.end();
  }

  const candidates: GoogleConnectionToken[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);

    let accessToken = row.access_token;
    if (!row.token_expiry || new Date(row.token_expiry).getTime() < Date.now() + 60_000) {
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
        const data = await res.json() as { access_token?: string };
        accessToken = data.access_token ?? accessToken;
      }
    }

    if (accessToken) candidates.push({ id: row.id, accessToken });
  }

  return candidates;
}

function googleAdsHeaders(accessToken: string, developerToken: string, loginCustomerId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  return headers;
}

async function googleAdsSearch(
  customerId: string,
  query: string,
  accessToken: string,
  developerToken: string,
  loginCustomerId?: string,
) {
  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: googleAdsHeaders(accessToken, developerToken, loginCustomerId),
      body: JSON.stringify({ query }),
    },
  ).catch(() => null);

  if (!res?.ok) {
    const body = await res?.text().catch(() => '') ?? '';
    console.error('[reports/google] Google Ads query failed', {
      customerId,
      loginCustomerId,
      status: res?.status,
      body: body.slice(0, 500),
    });
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res.json() as Promise<{ results?: any[] }>;
}

async function googleAdsSearchWithFallback(
  customerId: string,
  query: string,
  accessToken: string,
  developerToken: string,
  loginCustomerId?: string,
) {
  let data = await googleAdsSearch(customerId, query, accessToken, developerToken, loginCustomerId);
  if (data) return data;

  const fallbackLogin = loginCustomerId ? undefined : customerId;
  data = await googleAdsSearch(customerId, query, accessToken, developerToken, fallbackLogin);
  return data;
}

async function buildGoogleLoginCustomerMap(
  accountIds: string[],
  accessToken: string,
  developerToken: string,
): Promise<Record<string, string>> {
  const wanted = new Set(accountIds.map((id) => id.replace(/\D/g, '')).filter(Boolean));
  if (wanted.size === 0) return {};

  const listRes = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
    { headers: googleAdsHeaders(accessToken, developerToken) },
  ).catch(() => null);

  if (!listRes?.ok) {
    const body = await listRes?.text().catch(() => '') ?? '';
    console.error('[reports/google] listAccessibleCustomers failed while resolving MCC', {
      status: listRes?.status,
      body: body.slice(0, 500),
    });
    return {};
  }

  const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };
  const map: Record<string, string> = {};

  await Promise.allSettled(resourceNames.map(async (resourceName) => {
    const managerId = resourceName.replace('customers/', '').replace(/\D/g, '');
    if (!managerId) return;

    const managerInfo = await googleAdsSearch(
      managerId,
      'SELECT customer.id, customer.manager FROM customer LIMIT 1',
      accessToken,
      developerToken,
    );
    const isManager = Boolean(managerInfo?.results?.[0]?.customer?.manager);
    if (!isManager) return;

    const childData = await googleAdsSearch(
      managerId,
      'SELECT customer_client.id, customer_client.manager, customer_client.level FROM customer_client WHERE customer_client.level >= 1',
      accessToken,
      developerToken,
      managerId,
    );

    for (const row of childData?.results ?? []) {
      const childId = String(row.customerClient?.id ?? '').replace(/\D/g, '');
      if (wanted.has(childId) && !map[childId]) map[childId] = managerId;
    }
  }));

  return map;
}

export async function fetchGoogleAdsTotals(connectionId: string, accountIds: string[], from: string, to: string): Promise<GoogleAdsTotals> {
  const empty: GoogleAdsTotals = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
  const candidates = await getGoogleAccessCandidates(connectionId);
  if (!candidates.length) {
    const accessToken = await getGoogleAccessToken(connectionId);
    if (!accessToken) return empty;
    candidates.push({ id: connectionId, accessToken });
  }

  const devToken = GOOGLE_ADS_DEVELOPER_TOKEN;
  const result = { ...empty };
  const pendingAccounts = new Set(accountIds.map((accountId) => accountId.replace(/\D/g, '')).filter(Boolean));

  for (const candidate of candidates) {
    if (pendingAccounts.size === 0) break;
    const accountList = [...pendingAccounts];
    const loginCustomerByAccount = await buildGoogleLoginCustomerMap(accountList, candidate.accessToken, devToken);

    await Promise.allSettled(accountList.map(async (customerId) => {
      const data = await googleAdsSearchWithFallback(
        customerId,
        `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED'`,
        candidate.accessToken,
        devToken,
        loginCustomerByAccount[customerId],
      );
      if (!data) return;
      pendingAccounts.delete(customerId);
      for (const row of (data.results ?? [])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = ((row as any).metrics ?? {}) as Record<string, number>;
        result.spend += googleMetricNumber(m.costMicros) / 1_000_000;
        result.impressions += googleMetricNumber(m.impressions);
        result.clicks += googleMetricNumber(m.clicks);
        result.conversions += googleMetricNumber(m.conversions);
      }
    }));
  }

  return result;
}

// Campaign-level Google Ads fetch (mirrors fetchMetaData's shape) — each GAQL row
// already aggregates a campaign's metrics over the whole date range, so no extra
// per-campaign request is needed beyond what fetchGoogleAdsTotals already does.
export async function fetchGoogleAdsDetailed(
  connectionId: string | null | undefined,
  accountIds: string[],
  from: string, to: string,
): Promise<GoogleAdsFull | null> {
  if (!connectionId || !accountIds.length) return null;
  const candidates = await getGoogleAccessCandidates(connectionId);
  if (!candidates.length) {
    const accessToken = await getGoogleAccessToken(connectionId);
    if (!accessToken) return null;
    candidates.push({ id: connectionId, accessToken });
  }

  const devToken = GOOGLE_ADS_DEVELOPER_TOKEN;
  const campanhas: CampanhaGoogleDetalhada[] = [];
  // Palavras-chave agregadas por texto+correspondência (a mesma keyword pode existir
  // em vários grupos de anúncios/campanhas — somamos as métricas de todas as ocorrências).
  const keywordAgg = new Map<string, PalavraChaveGoogle>();
  const pendingAccounts = new Set(accountIds.map((accountId) => accountId.replace(/\D/g, '')).filter(Boolean));

  for (const candidate of candidates) {
    if (pendingAccounts.size === 0) break;
    const accountList = [...pendingAccounts];
    const loginCustomerByAccount = await buildGoogleLoginCustomerMap(accountList, candidate.accessToken, devToken);

    await Promise.allSettled(accountList.map(async (customerId) => {
      const loginCustomerId = loginCustomerByAccount[customerId];
      const data = await googleAdsSearchWithFallback(
        customerId,
        `SELECT campaign.name, campaign.advertising_channel_type, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
                    FROM campaign
                    WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED'
                    LIMIT 50`,
        candidate.accessToken,
        devToken,
        loginCustomerId,
      );
      if (!data) return;
      pendingAccounts.delete(customerId);
      for (const row of (data.results ?? [])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        const m = (r.metrics ?? {}) as Record<string, number>;
        const metricas = {
          investimento:     googleMetricNumber(m.costMicros) / 1_000_000,
          impressoes:       googleMetricNumber(m.impressions),
          cliques:          googleMetricNumber(m.clicks),
          conversoes:       googleMetricNumber(m.conversions),
          valorConversoes:  googleMetricNumber(m.conversionsValue),
        };
        if (!hasGoogleActivity(metricas)) continue;
        campanhas.push({
          nome: String(r.campaign?.name ?? 'Sem nome'),
          tipo: String(r.campaign?.advertisingChannelType ?? ''),
          metricas,
        });
      }

      // Top palavras-chave (keyword_view) — só campanhas de Pesquisa têm keywords.
      // segments.date fica só no WHERE para agregar o período inteiro por keyword.
      const kwData = await googleAdsSearchWithFallback(
        customerId,
        `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
                    FROM keyword_view
                    WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED' AND ad_group_criterion.status = 'ENABLED'
                    ORDER BY metrics.conversions DESC
                    LIMIT 100`,
        candidate.accessToken,
        devToken,
        loginCustomerId,
      );
      for (const row of (kwData?.results ?? [])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        const texto = String(r.adGroupCriterion?.keyword?.text ?? '').trim();
        if (!texto) continue;
        const correspondencia = String(r.adGroupCriterion?.keyword?.matchType ?? '');
        const m = (r.metrics ?? {}) as Record<string, number>;
        const key = `${texto.toLowerCase()}|${correspondencia}`;
        const acc = keywordAgg.get(key) ?? {
          texto, correspondencia,
          investimento: 0, impressoes: 0, cliques: 0, conversoes: 0, valorConversoes: 0,
        };
        acc.investimento    += googleMetricNumber(m.costMicros) / 1_000_000;
        acc.impressoes      += googleMetricNumber(m.impressions);
        acc.cliques         += googleMetricNumber(m.clicks);
        acc.conversoes      += googleMetricNumber(m.conversions);
        acc.valorConversoes += googleMetricNumber(m.conversionsValue);
        keywordAgg.set(key, acc);
      }
    }));
  }

  if (!campanhas.length) return null;

  // Top por conversões (desempate por cliques → investimento); só keywords com atividade.
  const palavrasChave = [...keywordAgg.values()]
    .filter((k) => k.impressoes > 0 || k.cliques > 0 || k.conversoes > 0)
    .sort((a, b) =>
      b.conversoes - a.conversoes ||
      b.cliques - a.cliques ||
      b.investimento - a.investimento,
    )
    .slice(0, 10);

  const totals = campanhas.reduce((acc, c) => ({
    investimento:    acc.investimento    + c.metricas.investimento,
    impressoes:      acc.impressoes      + c.metricas.impressoes,
    cliques:         acc.cliques         + c.metricas.cliques,
    conversoes:      acc.conversoes      + c.metricas.conversoes,
    valorConversoes: acc.valorConversoes + c.metricas.valorConversoes,
  }), { investimento: 0, impressoes: 0, cliques: 0, conversoes: 0, valorConversoes: 0 });

  return {
    ...totals,
    campanhas: campanhas.sort((a, b) => b.metricas.investimento - a.metricas.investimento).slice(0, 8),
    palavrasChave,
  };
}

// ── Monthly Meta Ads fetch (used by the lead-funnel-by-city dashboard, not by this report) ─

export type MonthlyMeta = {
  month: string; label: string;
  spend: number; impressions: number; reach: number;
  results: number; newContacts: number; purchases: number;
};

export async function fetchMonthlyMeta(connectionId: string, accountIds: string[], from: string, to: string): Promise<MonthlyMeta[]> {
  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
      [connectionId],
    );
    conn = rows[0] ?? null;
    if (!conn) {
      const { rows: leg } = await pool.query(
        `SELECT 'legacy' AS id, '' AS app_id, access_token, NULL AS token_expiry
         FROM public.meta_integration WHERE id='global' AND status='connected' LIMIT 1`,
      );
      conn = leg[0] ?? null;
    }
  } finally {
    await pool.end();
  }
  if (!conn) return [];

  const token     = await getFreshMetaToken(conn);
  const timeRange = JSON.stringify({ since: from, until: to });
  const monthly   = new Map<string, MonthlyMeta>();

  await Promise.allSettled(accountIds.map(async (accountId) => {
    const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
    const url  = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    url.searchParams.set('level',          'account');
    url.searchParams.set('fields',         'spend,impressions,reach,actions');
    url.searchParams.set('time_range',     timeRange);
    url.searchParams.set('time_increment', 'monthly');
    url.searchParams.set('access_token',   token);

    const res = await fetch(url.toString()).catch(() => null);
    if (!res?.ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data = [] } = await res.json() as { data?: any[] };
    for (const row of data) {
      const key  = String(row.date_start ?? '').slice(0, 7);
      if (!key) continue;
      const prev = monthly.get(key) ?? { month: key, label: fmtMonth(row.date_start), spend: 0, impressions: 0, reach: 0, results: 0, newContacts: 0, purchases: 0 };
      const acts = (row.actions ?? []) as { action_type: string; value: string }[];
      monthly.set(key, {
        ...prev,
        spend:       prev.spend       + parseFloat(row.spend       || '0'),
        impressions: prev.impressions + parseInt(row.impressions   || '0', 10),
        reach:       prev.reach       + parseInt(row.reach         || '0', 10),
        results:     prev.results     + sumActions(acts, RESULT_ACTIONS),
        newContacts: prev.newContacts + sumActions(acts, NEW_CONTACT_ACTIONS),
        purchases:   prev.purchases   + sumActions(acts, PURCHASE_ACTIONS),
      });
    }
  }));

  return Array.from(monthly.values()).sort((a, b) => a.month.localeCompare(b.month));
}

// ── Monthly CRM fetch ─────────────────────────────────────────────────────────

type MonthlyCrm = {
  month: string; label: string;
  registros: number; novosClientes: number; fechados: number; faturamento: number;
};

async function fetchMonthlyCrm(clientId: string, from: string, to: string): Promise<MonthlyCrm[]> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', COALESCE(data::date, lead_date, created_at::date)), 'YYYY-MM') AS month,
         COUNT(*) AS registros,
         COUNT(*) FILTER (WHERE fechou = true OR COALESCE(NULLIF(valor_rs,0), 0) > 0) AS fechados,
         COALESCE(SUM(COALESCE(NULLIF(valor_rs,0), 0)), 0) AS faturamento
       FROM public.crm_leads
       WHERE client_id = $1
         AND COALESCE(data::date, lead_date, created_at::date) BETWEEN $2 AND $3
       GROUP BY 1 ORDER BY 1`,
      [clientId, from, to],
    ).catch(() => ({ rows: [] as Array<{ month: string; registros: string; fechados: string; faturamento: string }> }));

    return rows.map(r => ({
      month:         r.month,
      label:         fmtMonth(r.month + '-01'),
      registros:     parseInt(r.registros,  10) || 0,
      novosClientes: parseInt(r.fechados,   10) || 0,
      fechados:      parseInt(r.fechados,   10) || 0,
      faturamento:   parseFloat(r.faturamento)  || 0,
    }));
  } finally {
    await pool.end();
  }
}

// Aggregates CRM rows into the same shape the delivery report builds from CSVs
// (faturamento/pedidos/ticket), so the performance report reuses the exact same
// slide builders — "pedidos" maps to closed deals (fechados) since there's no order count.
function toParsedData(rows: MonthlyCrm[]): ParsedData {
  const totals = rows.reduce(
    (acc, r) => ({ faturamento: acc.faturamento + r.faturamento, pedidos: acc.pedidos + r.fechados }),
    { faturamento: 0, pedidos: 0 },
  );
  return {
    ativos: 0, inativos: 0, potenciais: 0,
    faturamento: totals.faturamento,
    pedidos_ativos: totals.pedidos,
    ticket: totals.pedidos > 0 ? totals.faturamento / totals.pedidos : 0,
    uma_compra: 0, recorrentes: 0,
    produtos: [], inativos_faixas: [], por_dia: [],
  };
}

// ── Build ─────────────────────────────────────────────────────────────────────

export async function buildOmniReport(input: {
  clientId: string;
  clientName: string;
  connectionId?: string | null;
  accountIds?: string[];
  googleConnectionId?: string | null;
  googleAccountIds?: string[];
  periodFrom: string;
  periodTo: string;
  coverId?: string | null;
  metaLevel?: MetaBreakdownLevel;
  // Páginas habilitadas (keys de src/lib/report-sections.ts). null/undefined = todas.
  sections?: string[] | null;
}): Promise<{ html: string }> {
  const { clientId, clientName, connectionId, accountIds, googleConnectionId, googleAccountIds, periodFrom, periodTo, coverId, metaLevel = 'campaign', sections = null } = input;

  const prev = calcPrevPeriod(periodFrom, periodTo);
  const fromDate = new Date(periodFrom + 'T12:00:00');
  const toDate   = new Date(periodTo   + 'T12:00:00');
  const MONTHS   = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodo     = `${MONTHS[fromDate.getMonth()]}/${fromDate.getFullYear()}`;
  const prevFromDate = new Date(prev.from + 'T12:00:00');
  const prevPeriodo  = `${MONTHS[prevFromDate.getMonth()]}/${prevFromDate.getFullYear()}`;

  const [monthlyCrm, prevMonthlyCrm, metaDetailed, googleDetailed, instagramFull, bairros, rotationSeed] = await Promise.all([
    fetchMonthlyCrm(clientId, periodFrom, periodTo),
    fetchMonthlyCrm(clientId, prev.from, prev.to),
    connectionId && accountIds?.length
      ? fetchMetaData(connectionId, accountIds, periodFrom, periodTo, metaLevel)
      : Promise.resolve({ meta: null, creatives: [] }),
    fetchGoogleAdsDetailed(googleConnectionId, googleAccountIds ?? [], periodFrom, periodTo),
    // Called unconditionally — fetchInstagramData resolves a directly-linked Instagram
    // account (client_account_links platform='instagram') on its own even without a
    // Meta Ads connection/account for this client.
    fetchInstagramData(clientId, connectionId ?? null, accountIds ?? [], periodFrom, periodTo),
    fetchBairros(clientId, periodFrom, periodTo),
    fetchReportRotationSeed(),
  ]);
  const cover = resolveReportCover(coverId, rotationSeed);

  const data    = toParsedData(monthlyCrm);
  const hasPrevData = prevMonthlyCrm.some(m => m.faturamento > 0 || m.fechados > 0);
  const prevData = hasPrevData ? toParsedData(prevMonthlyCrm) : null;

  const { meta, creatives } = metaDetailed;
  const instagram = instagramFull?.insights ?? null;
  const igPosts    = instagramFull?.posts ?? [];
  const instagramCalendarMonths = monthsBetweenInclusive(fromDate, toDate);

  // sCapa/sMetaAdsCampanhas accept a DiagJson but never render its text — same as in
  // the delivery report — so there's no need to spend an AI call producing one here.
  const diag: DiagJson = { insight_campanha_conversa: '', insight_campanha_conversao: '' };

  // Cada página só entra se tem dados E se a seção está habilitada na geração
  // (checkboxes "Personalizar páginas"; sections=null mantém o padrão: todas).
  const en = (key: string) => sectionEnabled(sections, key);

  const hasVisao              = (data.faturamento > 0 || data.pedidos_ativos > 0) && en('visao_geral');
  const hasRegiao             = bairros.length > 0 && en('regioes');
  const hasMeta               = meta !== null && en('meta_resumo');
  const hasGoogle             = googleDetailed !== null && en('google_resumo');
  const hasPaidTraffic        = (meta !== null || googleDetailed !== null) && en('trafego_resumo');
  const hasInstagram          = instagram !== null && en('instagram_resumo');
  const hasInstagramPosts     = igPosts.length > 0;
  const hasTodosConteudos     = hasInstagramPosts && en('todos_conteudos');
  const hasCalendario         = hasInstagramPosts && en('calendario');
  const hasTopConteudos       = hasInstagramPosts && en('top_conteudos');
  const hasInstagramSpotlight = hasInstagramPosts && en('melhor_conteudo');
  const hasDestaques          = meta !== null && meta.campanhas.length > 0 && en('meta_campanhas');
  const hasGoogleDestaques    = googleDetailed !== null && googleDetailed.campanhas.length > 0 && en('google_campanhas');
  const hasGooglePalavras     = googleDetailed !== null && googleDetailed.palavrasChave.length > 0 && en('google_keywords');
  const hasCriativos          = creatives.length > 0 && en('criativos');
  const destaquePages         = hasDestaques ? Math.ceil(meta!.campanhas.length / 4) : 0;
  const googleDestaquePages   = hasGoogleDestaques ? Math.ceil(googleDetailed!.campanhas.length / 4) : 0;
  const todosConteudosPages   = hasTodosConteudos ? Math.ceil(igPosts.length / TODOS_CONTEUDOS_POR_PAGINA) : 0;

  const total = 1
    + (hasVisao      ? 1 : 0)
    + (hasRegiao     ? 1 : 0)
    + (hasPaidTraffic ? 1 : 0)
    + (hasMeta       ? 1 : 0)
    + (hasGoogle     ? 1 : 0)
    + (hasInstagram  ? 1 : 0)
    + todosConteudosPages
    + (hasCalendario ? instagramCalendarMonths.length : 0)
    + (hasTopConteudos ? 1 : 0)
    + (hasInstagramSpotlight ? 1 : 0)
    + destaquePages
    + googleDestaquePages
    + (hasGooglePalavras ? 1 : 0)
    + (hasCriativos   ? 1 : 0);

  const slides: string[] = [];
  let i = 1;

  slides.push(sCapa(data, meta, clientName, periodo, prevPeriodo, diag, total, cover));

  if (hasVisao)   slides.push(sVisaoGeral(data, prevData, ++i, total, periodo, prevPeriodo));
  if (hasRegiao)  slides.push(sRegioes(bairros, ++i, total));

  if (hasPaidTraffic) slides.push(sPaidTrafficResumo(meta, googleDetailed, ++i, total));

  if (hasMeta)        slides.push(sMetaAdsResumo(meta!, ++i, total));
  if (hasDestaques) {
    for (let start = 0; start < meta!.campanhas.length; start += 4) {
      slides.push(sMetaAdsCampanhas(meta!, diag, ++i, total, periodo, meta!.campanhas.slice(start, start + 4)));
    }
  }
  if (hasCriativos)   slides.push(sCriativos(creatives, ++i, total));

  if (hasGoogle)      slides.push(sGoogleAdsResumo(googleDetailed!, ++i, total));
  if (hasGoogleDestaques) {
    for (let start = 0; start < googleDetailed!.campanhas.length; start += 4) {
      slides.push(sGoogleAdsCampanhas(googleDetailed!, ++i, total, periodo, googleDetailed!.campanhas.slice(start, start + 4)));
    }
  }
  if (hasGooglePalavras) slides.push(sGoogleAdsPalavrasChave(googleDetailed!, ++i, total, periodo));

  if (hasInstagram)   slides.push(sInstagram(instagram!, ++i, total, periodo));
  if (hasCalendario) {
    for (const monthDate of instagramCalendarMonths) {
      slides.push(sInstagramCalendar(igPosts, ++i, total, monthDate));
    }
  }
  if (hasTodosConteudos) {
    const ordered = ordenarPostsPorData(igPosts);
    for (let start = 0, page = 1; start < ordered.length; start += TODOS_CONTEUDOS_POR_PAGINA, page++) {
      slides.push(sInstagramTodosConteudos(ordered.slice(start, start + TODOS_CONTEUDOS_POR_PAGINA), ++i, total, page, todosConteudosPages));
    }
  }
  if (hasTopConteudos)       slides.push(sInstagramPosts(igPosts, ++i, total));
  if (hasInstagramSpotlight) slides.push(sInstagramSpotlight(igPosts, ++i, total));

  return { html: `${FONT_LINK}<div class="onmid-report" style="background:${CANVAS};padding:28px;font-family:${INTER}">${slides.join('')}</div>` };
}
