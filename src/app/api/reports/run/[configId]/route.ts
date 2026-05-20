import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import type { DiagnosticoData, CriativoItem, OrigemItem, ClienteItem } from '@/components/diagnostico-template/types';

export const maxDuration = 60;

// ── Helpers ────────────────────────────────────────────────────────────────

function brl(n: number) {
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function numFmt(n: number) { return n.toLocaleString('pt-BR'); }

function prevMonth(): { from: string; to: string; label: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const label = `01/${String(first.getMonth()+1).padStart(2,'0')}/${first.getFullYear()} a ${String(last.getDate()).padStart(2,'0')}/${String(last.getMonth()+1).padStart(2,'0')}/${last.getFullYear()}`;
  return { from: fmt(first), to: fmt(last), label };
}

// ── Meta Ads fetch ─────────────────────────────────────────────────────────

const RESULT_ACTIONS = [
  'messaging_conversation_started_7d',
  'onsite_conversion.messaging_conversation_started_7d',
  'lead', 'onsite_conversion.lead_grouped',
];
const NEW_CONTACT_ACTIONS = ['messaging_new_connection', 'onsite_conversion.messaging_new_connection'];
const TOTAL_CONTACT_ACTIONS = ['total_messaging_connection'];
const PURCHASE_ACTIONS = ['offsite_conversion.fb_pixel_purchase', 'purchase'];

function sumActions(actions: { action_type: string; value: string }[], types: string[]) {
  return actions.filter(a => types.includes(a.action_type)).reduce((s, a) => s + parseInt(a.value || '0', 10), 0);
}

async function fetchMetaReport(connectionId: string, accountIds: string[], from: string, to: string) {
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
        `SELECT 'legacy' AS id, '' AS app_id, access_token, NULL AS token_expiry FROM public.meta_integration WHERE id='global' AND status='connected' LIMIT 1`,
      );
      conn = leg[0] ?? null;
    }
  } finally {
    await pool.end();
  }

  const empty = {
    spend: 0, impressions: 0, reach: 0, results: 0, newContacts: 0,
    totalContacts: 0, purchases: 0,
    facebook: { spend: 0, results: 0, newContacts: 0 },
    instagram: { spend: 0, results: 0, newContacts: 0 },
    criativos: [] as CriativoItem[],
  };
  if (!conn) return empty;

  const token = await getFreshMetaToken(conn);
  const timeRange = JSON.stringify({ since: from, until: to });

  let spend = 0, impressions = 0, reach = 0, results = 0, newContacts = 0, totalContacts = 0, purchases = 0;
  const fbData = { spend: 0, results: 0, newContacts: 0 };
  const igData = { spend: 0, results: 0, newContacts: 0 };
  const criatvosMap: Map<string, { spend: number; results: number; name: string }> = new Map();

  await Promise.allSettled(accountIds.map(async (accountId) => {
    const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

    // Overall stats
    const urlOverall = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlOverall.searchParams.set('level', 'account');
    urlOverall.searchParams.set('fields', 'spend,impressions,reach,actions');
    urlOverall.searchParams.set('time_range', timeRange);
    urlOverall.searchParams.set('access_token', token);
    const resOverall = await fetch(urlOverall.toString()).catch(() => null);
    if (resOverall?.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data = [] } = await resOverall.json() as { data?: any[] };
      for (const row of data) {
        spend += parseFloat(row.spend || '0');
        impressions += parseInt(row.impressions || '0', 10);
        reach += parseInt(row.reach || '0', 10);
        const acts = (row.actions ?? []) as { action_type: string; value: string }[];
        results += sumActions(acts, RESULT_ACTIONS);
        newContacts += sumActions(acts, NEW_CONTACT_ACTIONS);
        totalContacts += sumActions(acts, TOTAL_CONTACT_ACTIONS);
        purchases += sumActions(acts, PURCHASE_ACTIONS);
      }
    }

    // Platform breakdown
    const urlPlatform = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlPlatform.searchParams.set('level', 'account');
    urlPlatform.searchParams.set('fields', 'spend,actions');
    urlPlatform.searchParams.set('breakdowns', 'publisher_platform');
    urlPlatform.searchParams.set('time_range', timeRange);
    urlPlatform.searchParams.set('access_token', token);
    const resPlatform = await fetch(urlPlatform.toString()).catch(() => null);
    if (resPlatform?.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data = [] } = await resPlatform.json() as { data?: any[] };
      for (const row of data) {
        const platform = String(row.publisher_platform ?? '').toLowerCase();
        const s = parseFloat(row.spend || '0');
        const acts = (row.actions ?? []) as { action_type: string; value: string }[];
        const r = sumActions(acts, RESULT_ACTIONS);
        const nc = sumActions(acts, NEW_CONTACT_ACTIONS);
        if (platform === 'facebook') { fbData.spend += s; fbData.results += r; fbData.newContacts += nc; }
        if (platform === 'instagram') { igData.spend += s; igData.results += r; igData.newContacts += nc; }
      }
    }

    // Creatives (top 20 → will keep top 10 by results)
    const urlAds = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlAds.searchParams.set('level', 'ad');
    urlAds.searchParams.set('fields', 'ad_name,spend,actions');
    urlAds.searchParams.set('time_range', timeRange);
    urlAds.searchParams.set('limit', '50');
    urlAds.searchParams.set('access_token', token);
    const resAds = await fetch(urlAds.toString()).catch(() => null);
    if (resAds?.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data = [] } = await resAds.json() as { data?: any[] };
      for (const row of data) {
        const name = String(row.ad_name ?? 'Criativo');
        const s = parseFloat(row.spend || '0');
        const acts = (row.actions ?? []) as { action_type: string; value: string }[];
        const r = sumActions(acts, RESULT_ACTIONS);
        const prev = criatvosMap.get(name) ?? { spend: 0, results: 0, name };
        criatvosMap.set(name, { name, spend: prev.spend + s, results: prev.results + r });
      }
    }
  }));

  const sortedCreativos = Array.from(criatvosMap.values())
    .sort((a, b) => b.results - a.results)
    .slice(0, 10);
  const maxResults = sortedCreativos[0]?.results ?? 1;
  const criativos: CriativoItem[] = sortedCreativos.map(c => ({
    nome: c.name,
    investimento: brl(c.spend),
    resultados: c.results,
    custo_resultado: c.results > 0 ? brl(c.spend / c.results) : '—',
    bar_pct: Math.round((c.results / maxResults) * 100),
  }));

  return {
    spend, impressions, reach, results, newContacts, totalContacts, purchases,
    facebook: fbData, instagram: igData, criativos,
  };
}

// ── CRM fetch ──────────────────────────────────────────────────────────────

async function fetchCrmReport(clientId: string, from: string, to: string) {
  const pool = makeServerPool();
  try {
    const [sumRes, origemRes, clientesRes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) AS registros,
           COUNT(DISTINCT COALESCE(lead_name, nome)) AS pacientes_unicos,
           COALESCE(SUM(COALESCE(NULLIF(revenue,0), valor_rs, 0)), 0) AS faturamento_total
         FROM public.crm_leads
         WHERE client_id = $1
           AND COALESCE(lead_date, data::date) BETWEEN $2 AND $3
           AND (fechou = true OR COALESCE(NULLIF(revenue,0), valor_rs, 0) > 0)`,
        [clientId, from, to],
      ),
      pool.query(
        `SELECT
           COALESCE(source, canal, 'Não informado') AS canal,
           COUNT(*) AS registros,
           COALESCE(SUM(COALESCE(NULLIF(revenue,0), valor_rs, 0)), 0) AS faturamento
         FROM public.crm_leads
         WHERE client_id = $1
           AND COALESCE(lead_date, data::date) BETWEEN $2 AND $3
           AND (fechou = true OR COALESCE(NULLIF(revenue,0), valor_rs, 0) > 0)
         GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
        [clientId, from, to],
      ),
      pool.query(
        `SELECT
           COALESCE(lead_name, nome, 'Sem nome') AS nome,
           COALESCE(source, canal, 'Não informado') AS origem,
           COUNT(*) AS registros,
           COALESCE(SUM(COALESCE(NULLIF(revenue,0), valor_rs, 0)), 0) AS valor_total
         FROM public.crm_leads
         WHERE client_id = $1
           AND COALESCE(lead_date, data::date) BETWEEN $2 AND $3
           AND (fechou = true OR COALESCE(NULLIF(revenue,0), valor_rs, 0) > 0)
         GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 40`,
        [clientId, from, to],
      ),
    ]);

    const sum = sumRes.rows[0] ?? { registros: 0, pacientes_unicos: 0, faturamento_total: 0 };
    const totalFat = parseFloat(sum.faturamento_total) || 0;
    const registros = parseInt(sum.registros, 10) || 0;
    const pacientes = parseInt(sum.pacientes_unicos, 10) || 0;

    const maxOrFat = Math.max(...origemRes.rows.map(r => parseFloat(r.faturamento) || 0), 1);
    const porOrigem: OrigemItem[] = origemRes.rows.map(r => {
      const fat = parseFloat(r.faturamento) || 0;
      return {
        canal: String(r.canal),
        registros: parseInt(r.registros, 10),
        faturamento: brl(fat),
        faturamento_num: fat,
        bar_pct: Math.round((fat / maxOrFat) * 100),
      };
    });

    const clientes: ClienteItem[] = clientesRes.rows.map(r => ({
      nome: String(r.nome).toUpperCase(),
      origem: String(r.origem),
      registros: parseInt(r.registros, 10),
      valor_total: brl(parseFloat(r.valor_total) || 0),
      valor_num: parseFloat(r.valor_total) || 0,
    }));

    return { registros, pacientes, totalFat, porOrigem, clientes };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '42P01' || code === '42703') return { registros: 0, pacientes: 0, totalFat: 0, porOrigem: [], clientes: [] };
    throw e;
  } finally {
    await pool.end();
  }
}

// ── Claude analysis ────────────────────────────────────────────────────────

async function generateAnalysis(summary: unknown, apiKey: string): Promise<{
  leitura_visao_geral: string;
  leitura_plataformas: string;
  leitura_criativos: string;
  leitura_faturamento: string;
  leitura_origem: string;
  diagnostico: string;
  cenario_periodo: string;
  o_que_indica: string;
  proximo_passo: string;
}> {
  const fallback = {
    leitura_visao_geral: 'A campanha teve desempenho registrado no período.',
    leitura_plataformas: 'As plataformas apresentaram desempenhos distintos no período.',
    leitura_criativos: 'Os criativos com melhor equilíbrio entre volume e custo foram os mais eficientes.',
    leitura_faturamento: 'A base interna registrou faturamento no período analisado.',
    leitura_origem: 'A origem registrada deve ser validada no atendimento para garantir a análise correta.',
    diagnostico: 'A campanha apresentou resultados no período. A análise completa requer validação das origens registradas.',
    cenario_periodo: 'Período com movimentação registrada em mídia paga e base interna.',
    o_que_indica: 'Existe movimentação comercial e conversão dentro do período.',
    proximo_passo: 'Manter a qualidade da informação de origem no atendimento para análises mais precisas.',
  };

  if (!apiKey) return fallback;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1800,
        messages: [{
          role: 'user',
          content: `Você é analista de marketing digital da Onmid. Analise os dados abaixo e gere textos de leitura para um relatório profissional de performance. Seja objetivo, direto e use os números concretos.

DADOS DO PERÍODO:
${JSON.stringify(summary, null, 2)}

Retorne JSON com exatamente estas chaves (strings curtas, máx 3 frases cada):
- leitura_visao_geral: leitura da visão geral da mídia paga
- leitura_plataformas: comparativo Facebook x Instagram
- leitura_criativos: análise dos principais criativos
- leitura_faturamento: análise do faturamento da base interna
- leitura_origem: aviso sobre validação de origens
- diagnostico: diagnóstico geral cruzando mídia + faturamento (máx 4 frases)
- cenario_periodo: como foi o período (2 frases)
- o_que_indica: o que os resultados indicam (1-2 frases)
- proximo_passo: próximo passo recomendado (1-2 frases)

Responda apenas com o JSON.`,
        }],
      }),
    });
    if (!res.ok) return fallback;
    const data = await res.json() as { content?: { type: string; text: string }[] };
    const text = data.content?.find(c => c.type === 'text')?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    return { ...fallback, ...JSON.parse(jsonMatch[0]) as typeof fallback };
  } catch {
    return fallback;
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: { params: Promise<{ configId: string }> }) {
  const { configId } = await params;
  const body = await request.json().catch(() => ({})) as { dateFrom?: string; dateTo?: string; periodLabel?: string };

  const pool = makeServerPool();
  let config: {
    client_id: string; client_name: string; whatsapp_group: string | null;
    zapi_client_id: string | null; meta_connection_id: string | null;
    meta_account_ids: string[]; google_connection_id: string | null; google_account_id: string | null;
  } | null = null;

  try {
    const { rows } = await pool.query(`
      SELECT
        rc.client_id, c.name AS client_name,
        rc.whatsapp_group, rc.zapi_client_id,
        (SELECT cal.connection_id FROM public.client_account_links cal
         WHERE cal.client_id = rc.client_id AND cal.platform = 'meta' LIMIT 1) AS meta_connection_id,
        ARRAY(SELECT cal.account_id FROM public.client_account_links cal
              WHERE cal.client_id = rc.client_id AND cal.platform = 'meta') AS meta_account_ids,
        (SELECT cal.connection_id FROM public.client_account_links cal
         WHERE cal.client_id = rc.client_id AND cal.platform = 'google' LIMIT 1) AS google_connection_id,
        (SELECT cal.account_id FROM public.client_account_links cal
         WHERE cal.client_id = rc.client_id AND cal.platform = 'google' LIMIT 1) AS google_account_id
      FROM public.report_configs rc
      JOIN public.clients c ON c.id = rc.client_id
      WHERE rc.id = $1
    `, [configId]);
    config = rows[0] ?? null;
  } finally {
    await pool.end();
  }

  if (!config) return Response.json({ error: 'Config not found' }, { status: 404 });

  const period = body.dateFrom
    ? { from: body.dateFrom, to: body.dateTo ?? body.dateFrom, label: body.periodLabel ?? `${body.dateFrom} a ${body.dateTo}` }
    : prevMonth();

  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

  // Fetch all data in parallel
  const [metaData, crmData] = await Promise.all([
    config.meta_connection_id && config.meta_account_ids.length > 0
      ? fetchMetaReport(config.meta_connection_id, config.meta_account_ids, period.from, period.to)
      : Promise.resolve(null),
    fetchCrmReport(config.client_id, period.from, period.to),
  ]);

  const meta = metaData ?? {
    spend: 0, impressions: 0, reach: 0, results: 0,
    newContacts: 0, totalContacts: 0, purchases: 0,
    facebook: { spend: 0, results: 0, newContacts: 0 },
    instagram: { spend: 0, results: 0, newContacts: 0 },
    criativos: [],
  };

  // Build summary for Claude
  const analysisSummary = {
    cliente: config.client_name,
    periodo: period.label,
    meta_ads: {
      investimento: brl(meta.spend),
      resultados: meta.results,
      custo_resultado: meta.results > 0 ? brl(meta.spend / meta.results) : '—',
      impressoes: numFmt(meta.impressions),
      alcance: numFmt(meta.reach),
      facebook: {
        investimento: brl(meta.facebook.spend),
        resultados: meta.facebook.results,
        custo_resultado: meta.facebook.results > 0 ? brl(meta.facebook.spend / meta.facebook.results) : '—',
      },
      instagram: {
        investimento: brl(meta.instagram.spend),
        resultados: meta.instagram.results,
        custo_resultado: meta.instagram.results > 0 ? brl(meta.instagram.spend / meta.instagram.results) : '—',
      },
      top_criativos: meta.criativos.slice(0, 5).map(c => c.nome),
    },
    crm: {
      registros: crmData.registros,
      pacientes_unicos: crmData.pacientes,
      faturamento_total: brl(crmData.totalFat),
      relacao_fat_investimento: meta.spend > 0 ? `${(crmData.totalFat / meta.spend).toFixed(2)}x` : '—',
      por_origem: crmData.porOrigem.map(o => ({ canal: o.canal, registros: o.registros, faturamento: o.faturamento })),
    },
  };

  const analysis = await generateAnalysis(analysisSummary, apiKey);

  // Build full DiagnosticoData
  const fatorFat = meta.spend > 0 ? crmData.totalFat / meta.spend : 0;
  const reportData: DiagnosticoData = {
    cliente: config.client_name,
    periodo: period.label,
    subtitulo: 'Relatório de mídia paga + base interna de faturamento',
    capa: {
      faturamento: brl(crmData.totalFat),
      investimento: brl(meta.spend),
      roas: fatorFat > 0 ? `${fatorFat.toFixed(2).replace('.', ',')}x` : '—',
      leads: numFmt(meta.results + crmData.registros),
    },
    meta: {
      investimento_total: brl(meta.spend),
      resultados: meta.results,
      custo_resultado: meta.results > 0 ? brl(meta.spend / meta.results) : '—',
      impressoes: numFmt(meta.impressions),
      alcance: numFmt(meta.reach),
      total_contatos: meta.totalContacts,
      novos_contatos: meta.newContacts,
      custo_novo_contato: meta.newContacts > 0 ? brl(meta.spend / meta.newContacts) : '—',
      compras: meta.purchases,
      leitura: analysis.leitura_visao_geral,
      facebook: {
        investimento: brl(meta.facebook.spend),
        resultados: meta.facebook.results,
        custo_resultado: meta.facebook.results > 0 ? brl(meta.facebook.spend / meta.facebook.results) : '—',
        novos_contatos: meta.facebook.newContacts,
        custo_novo_contato: meta.facebook.newContacts > 0 ? brl(meta.facebook.spend / meta.facebook.newContacts) : '—',
      },
      instagram: {
        investimento: brl(meta.instagram.spend),
        resultados: meta.instagram.results,
        custo_resultado: meta.instagram.results > 0 ? brl(meta.instagram.spend / meta.instagram.results) : '—',
        novos_contatos: meta.instagram.newContacts,
        custo_novo_contato: meta.instagram.newContacts > 0 ? brl(meta.instagram.spend / meta.instagram.newContacts) : '—',
      },
      leitura_plataformas: analysis.leitura_plataformas,
      criativos: meta.criativos,
      leitura_criativos: analysis.leitura_criativos,
    },
    crm: {
      registros: crmData.registros,
      pacientes_unicos: crmData.pacientes,
      faturamento_total: brl(crmData.totalFat),
      ticket_medio_registro: crmData.registros > 0 ? brl(crmData.totalFat / crmData.registros) : '—',
      ticket_medio_paciente: crmData.pacientes > 0 ? brl(crmData.totalFat / crmData.pacientes) : '—',
      relacao_fat_investimento: fatorFat > 0 ? `${fatorFat.toFixed(2).replace('.', ',')}x` : '—',
      leitura_faturamento: analysis.leitura_faturamento,
      por_origem: crmData.porOrigem,
      leitura_origem: analysis.leitura_origem,
      clientes: crmData.clientes,
    },
    diagnostico: {
      texto: analysis.diagnostico,
      cenario_periodo: analysis.cenario_periodo,
      o_que_indica: analysis.o_que_indica,
      proximo_passo: analysis.proximo_passo,
    },
  };

  // Save to DB
  const pool2 = makeServerPool();
  let reportId: string;
  let publicToken: string;
  try {
    const { rows } = await pool2.query(
      `INSERT INTO public.diagnostic_reports
         (client_id, client_name, title, period_from, period_to, report_data, generated_by, config_id, template_slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, public_token`,
      [
        config.client_id,
        config.client_name,
        `Diagnóstico de Performance — ${config.client_name}`,
        period.from,
        period.to,
        JSON.stringify(reportData),
        'auto',
        configId,
        'diagnostico-performance',
      ],
    );
    reportId = rows[0].id as string;
    publicToken = rows[0].public_token as string;
  } finally {
    await pool2.end();
  }

  return Response.json({ ok: true, id: reportId, public_token: publicToken });
}
