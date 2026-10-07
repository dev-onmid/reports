import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { RESULT_ACTIONS, NEW_CONTACT_ACTIONS, PURCHASE_ACTIONS, sumActions } from './report-runner';
import {
  fetchBairros, fetchMetaData, fetchInstagramData, autoPreviousPeriod, rotuloPeriodo, mesesCheios, sanitizeJsonValue, comprasReaisGoogle,
  sCapa, sVisaoGeral, sFunilComercial, sCanais, sSiteResumo, sSiteAudiencia, sRegioes, sPaidTrafficResumo, sMetaAdsResumo, sMetaAdsCampanhas, sCriativos,
  sGoogleAdsResumo, sGoogleAdsCampanhas, sGoogleAdsPalavrasChave,
  sInstagram, sInstagramCalendar, sInstagramPosts, sInstagramSpotlight,
  sInstagramTodosConteudos, ordenarPostsPorData, TODOS_CONTEUDOS_POR_PAGINA,
  monthsBetweenInclusive, FONT_LINK, CANVAS, INTER,
  resolveReportCover, fetchReportRotationSeed,
  type ParsedData, type DiagJson, type GoogleAdsFull, type CampanhaGoogleDetalhada, type PalavraChaveGoogle, type MetaBreakdownLevel, type CompareOverride,
} from './delivery-report-builder';
import { sectionEnabled } from './report-sections';
import { fetchCrmDoRelatorio, fetchSiteDoRelatorio, degrausDoFunil, ehMesCheio } from './report-crm-dados';
import type { CrmDoPeriodo } from './crm-metricas';

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
        // sanitizeJsonValue OBRIGATÓRIO: sem ele, um byte nulo/surrogate órfão vindo de
        // legenda do Instagram ou nome de campanha faz o Postgres recusar o INSERT com
        // "invalid input syntax for type json" e o relatório inteiro se perde no fim.
        JSON.stringify(sanitizeJsonValue(opts.reportData)),
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
// Delega ao helper canônico calendar-aware (mês cheio → mês anterior; senão janela
// de mesma duração). Evita o bug do rótulo "Maio" ao analisar Julho (31 dias corridos
// recuavam para 31/mai). Fonte única em delivery-report-builder.
function calcPrevPeriod(from: string, to: string): { from: string; to: string } {
  return autoPreviousPeriod(from, to);
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
// Categorias de ação de conversão do Google Ads que são VENDA de fato.
const CATEGORIAS_DE_COMPRA = new Set(['PURCHASE', 'STORE_SALE']);

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
  // Série diária (soma das contas) para o gráfico do resumo.
  const porDia = new Map<string, { date: string; investimento: number; cliques: number; conversoes: number }>();
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
        `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
                    FROM campaign
                    WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED'
                    LIMIT 50`,
        candidate.accessToken,
        devToken,
        loginCustomerId,
      );
      if (!data) return;
      pendingAccounts.delete(customerId);

      // COMPRAS de verdade por campanha, pela CATEGORIA da ação de conversão.
      // ⚠️ `conversions_value > 0` não serve de sinal: o Google dá R$ 1,00 de valor
      // padrão a toda conversão, e campanha de lead virava "Vendas / Shopping".
      // Query à parte porque segmentar por categoria proíbe custo/cliques na mesma.
      const comprasData = await googleAdsSearchWithFallback(
        customerId,
        `SELECT campaign.id, segments.conversion_action_category, metrics.conversions, metrics.conversions_value
                    FROM campaign
                    WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED'`,
        candidate.accessToken,
        devToken,
        loginCustomerId,
      );
      const comprasPorCampanha = new Map<string, { compras: number; valor: number }>();
      for (const row of (comprasData?.results ?? [])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        if (!CATEGORIAS_DE_COMPRA.has(String(r.segments?.conversionActionCategory ?? ''))) continue;
        const id = String(r.campaign?.id ?? '');
        const atual = comprasPorCampanha.get(id) ?? { compras: 0, valor: 0 };
        atual.compras += googleMetricNumber(r.metrics?.conversions);
        atual.valor   += googleMetricNumber(r.metrics?.conversionsValue);
        comprasPorCampanha.set(id, atual);
      }

      for (const row of (data.results ?? [])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        const m = (r.metrics ?? {}) as Record<string, number>;
        const tipo = String(r.campaign?.advertisingChannelType ?? '');
        const conversoes = googleMetricNumber(m.conversions);
        const valorConversoes = googleMetricNumber(m.conversionsValue);
        // A consulta por categoria falhou (null) numa campanha de SHOPPING: lá
        // conversão É compra, então não zera — nas demais, sem prova não há compra.
        const semCategoria = !comprasData && tipo.toUpperCase() === 'SHOPPING';
        const c = comprasPorCampanha.get(String(r.campaign?.id ?? ''));
        const reais = semCategoria
          ? { compras: conversoes, valorCompras: valorConversoes }
          : comprasReaisGoogle(tipo, c?.compras ?? 0, c?.valor ?? 0);
        const metricas = {
          investimento:     googleMetricNumber(m.costMicros) / 1_000_000,
          impressoes:       googleMetricNumber(m.impressions),
          cliques:          googleMetricNumber(m.clicks),
          conversoes,
          valorConversoes,
          compras:          reais.compras,
          valorCompras:     reais.valorCompras,
        };
        if (!hasGoogleActivity(metricas)) continue;
        campanhas.push({
          nome: String(r.campaign?.name ?? 'Sem nome'),
          tipo,
          metricas,
        });
      }

      // Evolução diária — mesmas campanhas (ENABLED) do total, para o gráfico fechar
      // com os KPIs do topo da página.
      const diaData = await googleAdsSearchWithFallback(
        customerId,
        `SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.conversions
                    FROM campaign
                    WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED'`,
        candidate.accessToken,
        devToken,
        loginCustomerId,
      );
      for (const row of (diaData?.results ?? [])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        const date = String(r.segments?.date ?? '');
        if (!date) continue;
        const d = porDia.get(date) ?? { date, investimento: 0, cliques: 0, conversoes: 0 };
        d.investimento += googleMetricNumber(r.metrics?.costMicros) / 1_000_000;
        d.cliques      += googleMetricNumber(r.metrics?.clicks);
        d.conversoes   += googleMetricNumber(r.metrics?.conversions);
        porDia.set(date, d);
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
    compras:         acc.compras         + (c.metricas.compras ?? 0),
    valorCompras:    acc.valorCompras    + (c.metricas.valorCompras ?? 0),
  }), { investimento: 0, impressoes: 0, cliques: 0, conversoes: 0, valorConversoes: 0, compras: 0, valorCompras: 0 });

  return {
    ...totals,
    diario: [...porDia.values()].sort((a, b) => a.date.localeCompare(b.date)),
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

// ── CRM do período ────────────────────────────────────────────────────────────

// CRM do período no shape que os slides de visão geral consomem ("pedidos" = vendas
// fechadas). Os números vêm de `consultarCrmDoPeriodo` — a MESMA conta do card de
// Faturamento da dashboard (venda pelo mês do GANHO + lei de contagem). A query
// própria que havia aqui contava pelo mês de criação do lead e fazia o relatório
// divergir da tela.
function toParsedData(crm: CrmDoPeriodo | null): ParsedData {
  return {
    ativos: 0, inativos: 0, potenciais: 0,
    faturamento: crm?.revenue ?? 0,
    pedidos_ativos: crm?.sales ?? 0,
    ticket: crm?.ticket ?? 0,
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
  // Período de comparação escolhido na geração (undefined = automático; null = não comparar).
  compare?: CompareOverride;
}): Promise<{ html: string }> {
  const { clientId, clientName, connectionId, accountIds, googleConnectionId, googleAccountIds, periodFrom, periodTo, coverId, metaLevel = 'campaign', sections = null, compare } = input;

  // Janela de comparação: override explícito vence; null desliga; undefined = automática.
  const prev = compare === null ? null : (compare ?? calcPrevPeriod(periodFrom, periodTo));
  const fromDate = new Date(periodFrom + 'T12:00:00');
  const toDate   = new Date(periodTo   + 'T12:00:00');
  // Rótulo cobre o período INTEIRO ("Julho a Setembro/2026"), não só o mês inicial.
  const periodo     = rotuloPeriodo(periodFrom, periodTo);
  const prevPeriodo = prev ? rotuloPeriodo(prev.from, prev.to) : '';
  // Um mês cheio é a unidade natural do relatório; fora disso as páginas dizem "período".
  const periodoEhMes = mesesCheios(periodFrom, periodTo) === 1;

  const [crm, site, metaDetailed, googleDetailed, instagramFull, bairros, rotationSeed] = await Promise.all([
    fetchCrmDoRelatorio(clientId, periodFrom, periodTo, prev),
    fetchSiteDoRelatorio(clientId, periodFrom, periodTo),
    connectionId && accountIds?.length
      ? fetchMetaData(connectionId, accountIds, periodFrom, periodTo, metaLevel)
      : Promise.resolve({ meta: null, creatives: [] }),
    fetchGoogleAdsDetailed(googleConnectionId, googleAccountIds ?? [], periodFrom, periodTo),
    // Called unconditionally — fetchInstagramData resolves a directly-linked Instagram
    // account (client_account_links platform='instagram') on its own even without a
    // Meta Ads connection/account for this client.
    fetchInstagramData(clientId, connectionId ?? null, accountIds ?? [], periodFrom, periodTo, compare),
    fetchBairros(clientId, periodFrom, periodTo),
    fetchReportRotationSeed(),
  ]);
  const cover = resolveReportCover(coverId, rotationSeed);

  const data    = toParsedData(crm.atual);
  const hasPrevData = !!crm.anterior && (crm.anterior.revenue > 0 || crm.anterior.sales > 0);
  const prevData = hasPrevData ? toParsedData(crm.anterior) : null;

  const degraus = crm.funil ? degrausDoFunil(crm.funil) : [];
  const canaisLeads   = (crm.canais?.leads ?? []).map(c => ({ label: c.label, valor: c.leads }));
  const canaisReceita = (crm.canais?.origens ?? []).map(c => ({ label: c.label, valor: c.receita, vendas: c.vendas }));

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
  // Funil só com gente no topo; canais só com algum lead ou receita no período.
  const hasFunil              = degraus.length >= 2 && degraus[0].valor > 0 && en('funil');
  const hasCanais             = !!crm.canais && (crm.canais.leadsTotal > 0 || crm.canais.total > 0) && en('canais');
  const hasRegiao             = bairros.length > 0 && en('regioes');
  // Site (GA4): só com propriedade vinculada E visita no período.
  const hasSite               = !!site && site.atual.sessoes > 0 && en('site_resumo');
  const hasSiteAudiencia      = !!site && site.atual.sessoes > 0 && en('site_audiencia');
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
    + (hasFunil      ? 1 : 0)
    + (hasCanais     ? 1 : 0)
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
    + (hasSite ? 1 : 0)
    + (hasSiteAudiencia ? 1 : 0)
    + (hasCriativos   ? 1 : 0);

  const slides: string[] = [];
  let i = 1;

  slides.push(sCapa(data, meta, clientName, periodo, prevPeriodo, diag, total, cover));

  if (hasVisao) {
    const brl2 = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const leads = crm.atual?.leads ?? 0;
    const leadsAnt = crm.anterior?.leads ?? 0;
    const mesAtual = periodo.split('/')[0];
    const mesAnt = prevPeriodo.split('/')[0];
    const fraseLeads = leads > 0
      ? `Entraram ${leads.toLocaleString('pt-BR')} leads em ${mesAtual}${hasPrevData && leadsAnt > 0 ? ` (${leadsAnt.toLocaleString('pt-BR')} em ${mesAnt})` : ''}.`
      : '';
    // A meta cadastrada é MENSAL: só vale comparar quando o período é um mês cheio.
    const fraseMeta = crm.metaFaturamento && ehMesCheio(periodFrom, periodTo)
      ? ` A meta de faturamento do mês era ${brl2(crm.metaFaturamento)} — o realizado chegou a ${((data.faturamento / crm.metaFaturamento) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% dela.`
      : '';
    slides.push(sVisaoGeral(data, prevData, ++i, total, periodo, prevPeriodo, {
      unidade: periodoEhMes ? 'mês' : 'período',
      rotuloVendas: 'Vendas',
      leituraSemComparativo: `${periodo} fechou com ${brl2(data.faturamento)} em ${data.pedidos_ativos.toLocaleString('pt-BR')} vendas, ticket médio de ${brl2(data.ticket)}.`,
      leituraFinal: `${fraseLeads}${fraseMeta}`.trim(),
    }));
  }
  if (hasFunil) {
    slides.push(sFunilComercial(degraus, {
      mesCheio: periodoEhMes,
      vendasDoMes: crm.atual?.sales ?? 0,
      vendasDeLeadsAnteriores: crm.funil?.vendasCohort?.anteriores ?? 0,
      periodo,
    }, ++i, total));
  }
  if (hasCanais) {
    slides.push(sCanais({
      leads: canaisLeads, leadsTotal: crm.canais!.leadsTotal,
      receita: canaisReceita, receitaTotal: crm.canais!.total,
      semAtribuicao: crm.canais!.semAtribuicao, periodo,
    }, ++i, total));
  }
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

  // Site vem depois da mídia paga (é para onde ela manda a visita) e antes do orgânico.
  // ⚠️ O comparativo do GA4 é sempre a janela anterior automática da rota; com um
  // período de comparação escolhido à mão (ou desligado), as variações ficam de fora.
  if (hasSite)          slides.push(sSiteResumo(site!, { periodo, prevPeriodo, comparar: compare === undefined && !!prev }, ++i, total));
  if (hasSiteAudiencia) slides.push(sSiteAudiencia(site!, { periodo }, ++i, total));

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
