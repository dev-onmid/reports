import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { RESULT_ACTIONS, NEW_CONTACT_ACTIONS, PURCHASE_ACTIONS, sumActions, brl } from './report-runner';

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

// ── Monthly Meta Ads fetch ────────────────────────────────────────────────────

type MonthlyMeta = {
  month: string; label: string;
  spend: number; impressions: number; reach: number;
  results: number; newContacts: number; purchases: number;
};

async function fetchMonthlyMeta(connectionId: string, accountIds: string[], from: string, to: string): Promise<MonthlyMeta[]> {
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

// ── Data text formatters ──────────────────────────────────────────────────────

function formatMetaData(monthlyMeta: MonthlyMeta[]): string {
  if (!monthlyMeta.length) return 'Sem dados de Meta Ads para este período.';

  const t = monthlyMeta.reduce(
    (acc, m) => ({ spend: acc.spend + m.spend, impressions: acc.impressions + m.impressions, reach: acc.reach + m.reach, results: acc.results + m.results, purchases: acc.purchases + m.purchases }),
    { spend: 0, impressions: 0, reach: 0, results: 0, purchases: 0 },
  );

  const cpr = t.results   > 0 ? brl(t.spend / t.results)   : null;
  const cpp = t.purchases > 0 ? brl(t.spend / t.purchases) : null;

  return [
    `Total investido: ${brl(t.spend)}`,
    `Impressões totais: ${t.impressions.toLocaleString('pt-BR')}`,
    `Alcance total: ${t.reach.toLocaleString('pt-BR')} pessoas`,
    `Resultados (leads/mensagens/contatos): ${t.results}`,
    cpr ? `Custo por resultado: ${cpr}` : null,
    t.purchases > 0 ? `Compras atribuídas: ${t.purchases}` : null,
    cpp ? `Custo por compra: ${cpp}` : null,
    '',
    'Detalhamento mensal:',
    ...monthlyMeta.map(m => {
      const p = [`${m.label}: ${brl(m.spend)} | ${m.impressions.toLocaleString('pt-BR')} impressões | ${m.reach.toLocaleString('pt-BR')} alcance | ${m.results} resultados`];
      if (m.purchases > 0) p.push(`${m.purchases} compras`);
      return p.join(' | ');
    }),
  ].filter(l => l !== null).join('\n');
}

function formatCrmData(monthlyCrm: MonthlyCrm[]): string {
  if (!monthlyCrm.length) return 'Sem dados de CRM para este período.';

  const t = monthlyCrm.reduce(
    (acc, m) => ({ registros: acc.registros + m.registros, novosClientes: acc.novosClientes + m.novosClientes, faturamento: acc.faturamento + m.faturamento }),
    { registros: 0, novosClientes: 0, faturamento: 0 },
  );

  return [
    `Total de registros/leads: ${t.registros}`,
    `Total de conversões (novos clientes): ${t.novosClientes}`,
    t.faturamento > 0 ? `Faturamento total: ${brl(t.faturamento)}` : null,
    '',
    'Detalhamento mensal:',
    ...monthlyCrm.map(m => {
      const p = [`${m.label}: ${m.registros} registros | ${m.novosClientes} novos clientes`];
      if (m.faturamento > 0) p.push(`${brl(m.faturamento)} faturamento`);
      return p.join(' | ');
    }),
  ].filter(l => l !== null).join('\n');
}

// ── System Prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um analista sênior de marketing digital. Você escreve para donos de negócio — não para marqueteiros.

MISSÃO: transformar dados de tráfego pago e base de clientes em um diagnóstico claro e um plano de ação concreto.

REGRAS SEM EXCEÇÃO:
1. Nunca invente dados. Campo ausente = slide omitido.
2. Todo slide termina com insight ou recomendação em linguagem de dono de negócio.
3. Quedas não são escondidas: 1 frase de contexto + 1 ação concreta.
4. Variações sempre com % e valor absoluto: "+23% (de 254 para 312)"
5. Proibido: "excelente resultado", "é importante destacar", "N/A", seção vazia.
6. Tom direto, português BR. Métricas técnicas sempre com tradução entre parênteses.
   ✓ "ROAS de 4,2× (para cada R$1 investido, R$4,20 vieram em resultados atribuídos)"
   ✓ "CTR de 2,3% — 23 em cada 1.000 que viram o anúncio clicaram"

━━ ESTRUTURA DOS SLIDES (ordem fixa — pule slides sem dados) ━━

SLIDE 1 — CAPA (sempre)
• Título, período, período anterior, objetivo do relatório
• 3–4 KPI cards com os números mais importantes do período

SLIDE 2 — RESULTADOS DO MÊS (só com dados de CRM ou Meta Ads)
• Faturamento | Leads/Conversões | Ticket médio
• Linha atual vs anterior com badges de variação
• Card "Leitura principal": o que os números significam para o negócio

SLIDE 3 — FUNIL DE MÍDIA PAGA (só com Meta Ads)
• KPIs: Investimento | Impressões | Alcance | Cliques | Resultados | Custo por resultado
• Top campanhas com métricas individuais + insight por campanha
• Recomendação: melhor campanha para escalar, pior campanha e o que mudar

SLIDE 4 — BASE DE CLIENTES (só com dados de CRM)
• KPIs: Total de leads | Novos clientes (conversões) | Taxa de conversão
• Evolução mensal em tabela
• Insight: tendência e oportunidade

SLIDE 5 — COMPARATIVO COM PERÍODO ANTERIOR (só com 2+ meses de dados)
• Tabela lado a lado: mês atual vs anterior
• Variação em % com seta e cor para cada métrica
• Contexto: por que subiu ou caiu, o que vai mudar

SLIDE 6 — RECOMENDAÇÕES (sempre)
• Mínimo 3, máximo 5 recomendações
• Formato obrigatório: O que fazer → Por que (dado) → Resultado esperado

SLIDE 7 — PRÓXIMOS PASSOS (sempre o último)
• 3–5 ações concretas numeradas que a agência vai executar

━━ DESIGN SYSTEM — SIGA EXATAMENTE ━━

DIMENSÃO: 1440×810px por slide
CORES:
  Verde primário:     #00C853
  Verde claro (bg):   #E8F5E9
  Texto principal:    #111111
  Texto secundário:   #555555
  Fundo slide:        #FFFFFF
  Fundo card:         #FAFAFA
  Borda card:         #F0F0F0
  Positivo bg:        #E8F5E9  | texto: #00C853
  Negativo bg:        #FFEBEE  | texto: #FF5252
  Período anterior:   bg #E3F2FD | texto: #1565C0
  Container externo:  #F4F4F4
FONTES:
  Números KPI grandes e nome ONMID: font-family:var(--font-bebas),sans-serif
  Todo o resto: font-family:var(--font-inter),sans-serif
RADIUS: cards 12px | badges 6px | barras 4px
SOMBRA: 0 2px 8px rgba(0,0,0,0.05) em cards

━━ PADRÕES HTML OBRIGATÓRIOS ━━

WRAPPER DO DOCUMENTO:
<div style="background:#F4F4F4;padding:28px;font-family:var(--font-inter),sans-serif">[slides]</div>

SLIDE GENÉRICO:
<div style="width:1440px;min-height:810px;background:#FFFFFF;margin:0 auto 20px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column">
  <div style="height:52px;padding:0 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #F0F0F0;flex-shrink:0">
    <span style="font-family:var(--font-bebas),sans-serif;font-size:22px;color:#00C853;letter-spacing:0.06em">ONMID</span>
    <span style="font-size:12px;color:#AAAAAA;font-family:var(--font-inter),sans-serif">NN/NN</span>
  </div>
  <div style="flex:1;padding:36px 48px 40px">[conteúdo]</div>
</div>

TÍTULO DE SEÇÃO:
<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:24px">
  <div style="width:4px;min-height:38px;background:#00C853;border-radius:2px;flex-shrink:0;margin-top:2px"></div>
  <div>
    <h2 style="font-family:var(--font-inter),sans-serif;font-size:28px;font-weight:800;color:#111111;margin:0;line-height:1.1">TÍTULO</h2>
    <p style="font-size:14px;color:#555555;margin:4px 0 0">subtítulo</p>
  </div>
</div>

CARD DE KPI:
<div style="background:#FAFAFA;border:1px solid #F0F0F0;border-radius:12px;padding:22px;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
    <div style="width:34px;height:34px;background:#E8F5E9;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00C853" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">[path]</svg>
    </div>
    <span style="font-size:11px;font-weight:700;color:#777777;text-transform:uppercase;letter-spacing:0.08em">LABEL</span>
  </div>
  <div style="font-family:var(--font-bebas),sans-serif;font-size:42px;color:#111111;line-height:1;margin-bottom:6px">VALOR</div>
  <div style="font-size:12px;color:#555555;line-height:1.5">contexto business</div>
</div>

BADGE POSITIVO: <span style="background:#E8F5E9;color:#00C853;font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px">↑ +23% (de 254 para 312)</span>
BADGE NEGATIVO: <span style="background:#FFEBEE;color:#FF5252;font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px">↓ -12% (de 312 para 275)</span>
BADGE ANTERIOR: <span style="background:#E3F2FD;color:#1565C0;font-size:12px;font-weight:600;padding:3px 10px;border-radius:6px">mai/25: R$134.535</span>

TABELA DE COMPARATIVO:
<table style="width:100%;border-collapse:collapse;font-family:var(--font-inter),sans-serif;font-size:13px">
  <thead><tr style="background:#111111;color:#FFFFFF">
    <th style="padding:11px 16px;text-align:left;font-weight:600">Métrica</th>
    <th style="padding:11px 16px;text-align:right;font-weight:600">Período Anterior</th>
    <th style="padding:11px 16px;text-align:right;font-weight:600">Período Atual</th>
    <th style="padding:11px 16px;text-align:right;font-weight:600">Variação</th>
  </tr></thead>
  <tbody>[linhas com border-bottom:1px solid #F5F5F5]</tbody>
</table>

CARD DE INSIGHT:
<div style="background:#F0FAF3;border:1px solid #C8E6C9;border-radius:12px;padding:18px 20px">
  <div style="font-size:11px;font-weight:700;color:#00C853;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">LEITURA PRINCIPAL</div>
  <p style="font-size:14px;color:#111111;line-height:1.6;margin:0">insight aqui</p>
</div>

CARD DE RECOMENDAÇÃO:
<div style="background:#FFFFFF;border:1px solid #F0F0F0;border-radius:12px;padding:18px 20px;border-left:4px solid #00C853;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
  <div style="font-size:11px;font-weight:700;color:#AAAAAA;text-transform:uppercase;letter-spacing:0.08em">O QUE FAZER</div>
  <div style="font-size:14px;font-weight:600;color:#111111;margin-top:5px">ação específica</div>
  <div style="font-size:13px;color:#555555;margin-top:6px"><span style="font-weight:600;color:#111111">Por que:</span> dado concreto</div>
  <div style="font-size:13px;color:#00C853;font-weight:600;margin-top:4px">Resultado esperado: efeito mensurável</div>
</div>

PRÓXIMO PASSO:
<div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-bottom:1px solid #F5F5F5">
  <div style="width:30px;height:30px;background:#00C853;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <span style="font-size:15px;font-weight:800;color:#FFFFFF">1</span>
  </div>
  <div>
    <div style="font-size:14px;font-weight:700;color:#111111">AÇÃO</div>
    <div style="font-size:12px;color:#555555;margin-top:2px">detalhe concreto</div>
  </div>
</div>

SAÍDA: retorne APENAS o HTML. Sem markdown, sem blocos de código, sem texto antes ou depois.
O HTML começa com <div style="background:#F4F4F4 e termina com </div>`;

// ── User Prompt ───────────────────────────────────────────────────────────────

function buildUserPrompt(
  clientName: string,
  segment: string,
  period: string,
  prevPeriod: string,
  agencyContext: string,
  metaData: string,
  crmData: string,
): string {
  return [
    `Cliente: ${clientName}`,
    `Segmento: ${segment}`,
    `Período: ${period}`,
    `Período anterior para comparação: ${prevPeriod || 'não disponível — apresente como linha de base'}`,
    agencyContext ? `Contexto da agência: ${agencyContext}` : null,
    '',
    'DADOS META ADS:',
    metaData,
    '',
    'DADOS CRM / RESULTADOS DO NEGÓCIO:',
    crmData,
  ].filter(l => l !== null).join('\n');
}

// ── Build ─────────────────────────────────────────────────────────────────────

export async function buildOmniReport(input: {
  clientId: string;
  clientName: string;
  connectionId?: string | null;
  accountIds?: string[];
  periodFrom: string;
  periodTo: string;
  agencyContext?: string;
  apiKey: string;
  manualNotes?: string;
}): Promise<{ html: string }> {
  const { clientId, clientName, connectionId, accountIds, periodFrom, periodTo, apiKey } = input;
  const agencyContext = input.agencyContext ?? input.manualNotes ?? '';

  const [monthlyMeta, monthlyCrm] = await Promise.all([
    connectionId && accountIds?.length
      ? fetchMonthlyMeta(connectionId, accountIds, periodFrom, periodTo)
      : Promise.resolve([] as MonthlyMeta[]),
    fetchMonthlyCrm(clientId, periodFrom, periodTo),
  ]);

  const period     = `${fmtMonth(periodFrom)} a ${fmtMonth(periodTo)}`;
  const firstMonth = monthlyCrm[0]?.label ?? monthlyMeta[0]?.label ?? '';
  const prevPeriod = firstMonth ? `mês anterior a ${firstMonth}` : 'não disponível';

  const metaData = formatMetaData(monthlyMeta);
  const crmData  = formatCrmData(monthlyCrm);
  const segment  = 'Marketing Digital';

  const userPrompt = buildUserPrompt(clientName, segment, period, prevPeriod, agencyContext, metaData, crmData);

  let html = '';

  if (apiKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body:    JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 8192,
          system:     SYSTEM_PROMPT,
          messages:   [{ role: 'user', content: userPrompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: { type: string; text: string }[] };
        const text = data.content?.find(c => c.type === 'text')?.text ?? '';
        html = text.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      }
    } catch { /* fall through to fallback */ }
  }

  if (!html) html = buildFallbackHtml(clientName, period, monthlyCrm, monthlyMeta);

  return { html };
}

// ── Fallback HTML ─────────────────────────────────────────────────────────────

function buildFallbackHtml(
  clientName: string,
  period: string,
  monthlyCrm: MonthlyCrm[],
  monthlyMeta: MonthlyMeta[],
): string {
  const totalRegistros    = monthlyCrm.reduce((s, m) => s + m.registros, 0);
  const totalNovosClientes= monthlyCrm.reduce((s, m) => s + m.novosClientes, 0);
  const totalSpend        = monthlyMeta.reduce((s, m) => s + m.spend, 0);
  const hasMeta           = monthlyMeta.length > 0;

  return `<div style="background:#F4F4F4;padding:28px;font-family:var(--font-inter),sans-serif">
  <div style="width:1440px;min-height:810px;background:#111111;margin:0 auto 20px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column">
    <div style="height:52px;padding:0 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #222222;flex-shrink:0">
      <span style="font-family:var(--font-bebas),sans-serif;font-size:22px;color:#00C853;letter-spacing:0.06em">ONMID</span>
      <span style="font-size:12px;color:#777777">01/01</span>
    </div>
    <div style="flex:1;padding:56px 48px 48px;display:flex;flex-direction:column;justify-content:space-between">
      <div>
        <div style="font-size:11px;font-weight:700;color:#00C853;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:16px">ONMID · RELATÓRIO DE PERFORMANCE</div>
        <h1 style="font-family:var(--font-bebas),sans-serif;font-size:80px;color:#FFFFFF;line-height:0.9;margin:0">${clientName.toUpperCase()}</h1>
        <div style="font-size:13px;color:#777777;margin-top:20px;text-transform:uppercase;letter-spacing:0.08em">Período · ${period}</div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        ${totalRegistros > 0 ? `<div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:18px 24px"><div style="font-size:11px;color:#777777;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">LEADS</div><div style="font-family:var(--font-bebas),sans-serif;font-size:36px;color:#FFFFFF;line-height:1">${totalRegistros}</div></div>` : ''}
        ${totalNovosClientes > 0 ? `<div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:18px 24px"><div style="font-size:11px;color:#777777;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">NOVOS CLIENTES</div><div style="font-family:var(--font-bebas),sans-serif;font-size:36px;color:#FFFFFF;line-height:1">${totalNovosClientes}</div></div>` : ''}
        ${hasMeta ? `<div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:18px 24px"><div style="font-size:11px;color:#777777;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">INVESTIMENTO META</div><div style="font-family:var(--font-bebas),sans-serif;font-size:36px;color:#FFFFFF;line-height:1">${brl(totalSpend)}</div></div>` : ''}
      </div>
    </div>
  </div>
</div>`;
}
