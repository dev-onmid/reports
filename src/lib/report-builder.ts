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
        opts.clientId,
        opts.clientName,
        `Relatório de Performance — ${opts.clientName}`,
        opts.periodFrom,
        opts.periodTo,
        JSON.stringify(opts.reportData),
        opts.generatedBy,
        opts.configId ?? null,
        'onmid-narrative-performance',
      ],
    );
    return { id: rows[0].id as string, public_token: rows[0].public_token as string };
  } finally {
    await pool.end();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(a: number, b: number): string {
  if (b === 0) return '—';
  const v = ((a - b) / b) * 100;
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function fmtMonth(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
}

// ── Monthly Meta Ads fetch ────────────────────────────────────────────────────

type MonthlyMeta = {
  month: string;
  label: string;
  spend: number;
  impressions: number;
  reach: number;
  results: number;
  newContacts: number;
  purchases: number;
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
        `SELECT 'legacy' AS id, '' AS app_id, access_token, NULL AS token_expiry FROM public.meta_integration WHERE id='global' AND status='connected' LIMIT 1`,
      );
      conn = leg[0] ?? null;
    }
  } finally {
    await pool.end();
  }
  if (!conn) return [];

  const token = await getFreshMetaToken(conn);
  const timeRange = JSON.stringify({ since: from, until: to });
  const monthly = new Map<string, MonthlyMeta>();

  await Promise.allSettled(accountIds.map(async (accountId) => {
    const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
    const url = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    url.searchParams.set('level', 'account');
    url.searchParams.set('fields', 'spend,impressions,reach,actions');
    url.searchParams.set('time_range', timeRange);
    url.searchParams.set('time_increment', 'monthly');
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString()).catch(() => null);
    if (!res?.ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data = [] } = await res.json() as { data?: any[] };
    for (const row of data) {
      const key = String(row.date_start ?? '').slice(0, 7);
      if (!key) continue;
      const prev = monthly.get(key) ?? { month: key, label: fmtMonth(row.date_start), spend: 0, impressions: 0, reach: 0, results: 0, newContacts: 0, purchases: 0 };
      const acts = (row.actions ?? []) as { action_type: string; value: string }[];
      monthly.set(key, {
        ...prev,
        spend: prev.spend + parseFloat(row.spend || '0'),
        impressions: prev.impressions + parseInt(row.impressions || '0', 10),
        reach: prev.reach + parseInt(row.reach || '0', 10),
        results: prev.results + sumActions(acts, RESULT_ACTIONS),
        newContacts: prev.newContacts + sumActions(acts, NEW_CONTACT_ACTIONS),
        purchases: prev.purchases + sumActions(acts, PURCHASE_ACTIONS),
      });
    }
  }));

  return Array.from(monthly.values()).sort((a, b) => a.month.localeCompare(b.month));
}

// ── Monthly CRM fetch ─────────────────────────────────────────────────────────

type MonthlyCrm = {
  month: string;
  label: string;
  registros: number;
  novosClientes: number;
  fechados: number;
  faturamento: number;
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
       GROUP BY 1
       ORDER BY 1`,
      [clientId, from, to],
    ).catch(() => ({ rows: [] as Array<{ month: string; registros: string; fechados: string; faturamento: string }> }));

    return rows.map(r => ({
      month: r.month,
      label: fmtMonth(r.month + '-01'),
      registros: parseInt(r.registros, 10) || 0,
      novosClientes: parseInt(r.fechados, 10) || 0,
      fechados: parseInt(r.fechados, 10) || 0,
      faturamento: parseFloat(r.faturamento) || 0,
    }));
  } finally {
    await pool.end();
  }
}

// ── Data formatters ───────────────────────────────────────────────────────────

function formatMetaData(monthlyMeta: MonthlyMeta[]): string {
  if (!monthlyMeta.length) return 'Sem dados de Meta Ads para este período.';

  const totals = monthlyMeta.reduce(
    (acc, m) => ({
      spend: acc.spend + m.spend,
      impressions: acc.impressions + m.impressions,
      reach: acc.reach + m.reach,
      results: acc.results + m.results,
      purchases: acc.purchases + m.purchases,
    }),
    { spend: 0, impressions: 0, reach: 0, results: 0, purchases: 0 },
  );

  const cpr = totals.results > 0 ? brl(totals.spend / totals.results) : null;
  const cpp = totals.purchases > 0 ? brl(totals.spend / totals.purchases) : null;

  const lines = [
    `Total investido: ${brl(totals.spend)}`,
    `Total de impressões: ${totals.impressions.toLocaleString('pt-BR')}`,
    `Alcance total: ${totals.reach.toLocaleString('pt-BR')} pessoas`,
    `Resultados (leads/mensagens/contatos): ${totals.results}`,
    cpr ? `Custo por resultado: ${cpr}` : null,
    totals.purchases > 0 ? `Compras atribuídas: ${totals.purchases}` : null,
    cpp ? `Custo por compra: ${cpp}` : null,
    '',
    'Detalhamento mensal:',
    ...monthlyMeta.map(m => {
      const parts = [`${m.label}: ${brl(m.spend)} investido | ${m.impressions.toLocaleString('pt-BR')} impressões | ${m.reach.toLocaleString('pt-BR')} alcance | ${m.results} resultados`];
      if (m.purchases > 0) parts.push(`${m.purchases} compras`);
      return parts.join(' | ');
    }),
  ].filter(l => l !== null);

  return lines.join('\n');
}

function formatCrmData(monthlyCrm: MonthlyCrm[]): string {
  if (!monthlyCrm.length) return 'Sem dados de CRM para este período.';

  const totals = monthlyCrm.reduce(
    (acc, m) => ({ registros: acc.registros + m.registros, novosClientes: acc.novosClientes + m.novosClientes, faturamento: acc.faturamento + m.faturamento }),
    { registros: 0, novosClientes: 0, faturamento: 0 },
  );

  const lines = [
    `Total de registros/leads: ${totals.registros}`,
    `Total de novos clientes (conversões): ${totals.novosClientes}`,
    totals.faturamento > 0 ? `Faturamento total registrado: ${brl(totals.faturamento)}` : null,
    '',
    'Detalhamento mensal:',
    ...monthlyCrm.map(m => {
      const parts = [`${m.label}: ${m.registros} registros | ${m.novosClientes} novos clientes`];
      if (m.faturamento > 0) parts.push(`${brl(m.faturamento)} faturamento`);
      return parts.join(' | ');
    }),
  ].filter(l => l !== null);

  return lines.join('\n');
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um analista sênior de marketing digital. Você escreve para donos de negócio — não para marqueteiros.

REGRAS DE COMUNICAÇÃO (sem exceção):
- Toda métrica técnica DEVE ter tradução em linguagem de negócio entre parênteses
  ✓ "Alcance de 12.400 pessoas (cada R$1 investido chegou a 8 pessoas)"
  ✓ "CTR de 2,3% — 23 em cada 1.000 que viram o anúncio clicaram"
- Seções sem dados são OMITIDAS. Nunca: "N/A", "sem dados", seção vazia.
- Toda queda: 1 frase de contexto + 1 ação concreta. Nunca esconda quedas.
- Variações com % E valor absoluto: "+23% (de 254 para 312)"
- Tom direto, português BR. Proibido: "excelente resultado", "ótimo desempenho", "é importante destacar"
- O relatório conta uma história: fizemos → aconteceu → aprendemos → vamos fazer

SEÇÕES (ordem fixa — pule se não houver dados):
1. RESUMO EXECUTIVO — 3 a 5 destaques em 1 frase cada, mais importante para o negócio primeiro
2. RESULTADOS DO NEGÓCIO — só se houver dados de CRM (registros, clientes, faturamento). Conecte com o investimento.
3. FUNIL DE MÍDIA PAGA — investimento → alcance → cliques → resultado. Melhor e pior campanha com plano para a pior.
4. INSTAGRAM ORGÂNICO — crescimento de seguidores, alcance orgânico, top 3 conteúdos e o que indicam
5. ANÁLISE DE PRODUTOS/VENDAS — só se houver dados de planilha. Mais vendidos, variações, oportunidades.
6. COMPARATIVO COM PERÍODO ANTERIOR — métricas lado a lado, variação %, contexto para cada queda
7. RECOMENDAÇÕES — mín. 3, máx. 5. Formato OBRIGATÓRIO: O que fazer → Por que (dado concreto) → Resultado esperado
8. PRÓXIMOS PASSOS — 3 a 4 ações concretas que a agência vai executar no próximo período

QUALIDADE:
- Se não há dados do período anterior: apresente como linha de base e declare isso
- Máximo 8 cards de destaque no Resumo — o resto vai em tabela
- Relatório com poucos dados parece enxuto e completo, não incompleto

DESIGN SYSTEM — use inline styles com estes valores exatos:
verde: #55f52f | fundo: #ffffff | texto: #0e0e0e | hero: #000000
superfície: #f7f7f7 | borda: #cccccc | roxo: #7b2cff | erro: #e52020
verde texto: #1a6600 | cinza texto: #757575
fonte título: font-family:var(--font-bebas),sans-serif
fonte corpo: font-family:var(--font-inter),sans-serif
border-radius: 2px (SEMPRE, nunca maior)

COMPONENTES — use estes padrões exatamente:

Wrapper externo (abre e fecha o documento):
<div style="background:#fff;font-family:var(--font-inter),sans-serif;padding-bottom:80px">
  ...
</div>

Capa:
<div style="background:#000;padding:56px 48px 48px">
  <div style="color:#55f52f;font-family:var(--font-bebas),sans-serif;font-size:12px;letter-spacing:0.15em">ONMID · RELATÓRIO DE MARKETING DIGITAL</div>
  <h1 style="color:#fff;font-family:var(--font-bebas),sans-serif;font-size:80px;line-height:0.9;margin:12px 0 0">NOME DO<br>CLIENTE</h1>
  <div style="color:#999;font-family:var(--font-inter),sans-serif;font-size:14px;margin-top:24px;text-transform:uppercase;letter-spacing:0.05em">Período · Jan/25 a Mar/25</div>
  <div style="display:flex;gap:12px;margin-top:32px;flex-wrap:wrap">
    <!-- KPI pills: use apenas se houver dados concretos -->
    <div style="background:#ffffff15;border:1px solid #ffffff25;padding:12px 20px;border-radius:2px">
      <div style="color:#999;font-family:var(--font-inter),sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.08em">Label</div>
      <div style="color:#fff;font-family:var(--font-bebas),sans-serif;font-size:28px;line-height:1;margin-top:4px">Valor</div>
    </div>
  </div>
</div>

Cabeçalho de seção:
<div style="padding:48px 48px 0">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">
    <div style="width:4px;height:36px;background:#55f52f;flex-shrink:0"></div>
    <h2 style="font-family:var(--font-bebas),sans-serif;font-size:36px;color:#0e0e0e;margin:0;line-height:1">TÍTULO DA SEÇÃO</h2>
  </div>
</div>

Cards de métricas (dentro de uma seção, agrupe em flex row):
<div style="display:flex;gap:16px;flex-wrap:wrap;padding:0 48px;margin-top:24px">
  <div style="background:#f7f7f7;border:1px solid #cccccc;border-radius:2px;padding:24px;flex:1;min-width:150px">
    <div style="font-family:var(--font-inter),sans-serif;font-size:11px;color:#757575;text-transform:uppercase;letter-spacing:0.08em">LABEL</div>
    <div style="font-family:var(--font-bebas),sans-serif;font-size:44px;color:#0e0e0e;line-height:1;margin-top:8px">VALOR</div>
    <div style="font-family:var(--font-inter),sans-serif;font-size:12px;color:#757575;margin-top:8px">tradução em linguagem de negócio</div>
  </div>
</div>

Texto de análise (parágrafos dentro de seção):
<div style="padding:16px 48px 0">
  <p style="font-family:var(--font-inter),sans-serif;font-size:14px;color:#0e0e0e;line-height:1.7;margin:0">Texto aqui.</p>
</div>

Variação positiva: <span style="background:#e8fde0;color:#1a6600;font-size:12px;font-weight:600;padding:2px 8px;border-radius:2px;font-family:var(--font-inter),sans-serif;display:inline-block">+23% (de 254 para 312)</span>
Variação negativa: <span style="background:#fde8e8;color:#e52020;font-size:12px;font-weight:600;padding:2px 8px;border-radius:2px;font-family:var(--font-inter),sans-serif;display:inline-block">-12% (de 312 para 275)</span>

Tabela comparativa:
<div style="padding:0 48px;margin-top:24px;overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-family:var(--font-inter),sans-serif;font-size:13px">
    <thead>
      <tr style="background:#000;color:#fff">
        <th style="padding:12px 16px;text-align:left;font-weight:600">Métrica</th>
        <th style="padding:12px 16px;text-align:right;font-weight:600">Período Anterior</th>
        <th style="padding:12px 16px;text-align:right;font-weight:600">Período Atual</th>
        <th style="padding:12px 16px;text-align:right;font-weight:600">Variação</th>
      </tr>
    </thead>
    <tbody>
      <tr style="border-bottom:1px solid #cccccc">
        <td style="padding:12px 16px;color:#0e0e0e;font-weight:500">Nome da Métrica</td>
        <td style="padding:12px 16px;text-align:right;color:#757575">Valor anterior</td>
        <td style="padding:12px 16px;text-align:right;color:#0e0e0e;font-weight:600">Valor atual</td>
        <td style="padding:12px 16px;text-align:right">[badge de variação]</td>
      </tr>
    </tbody>
  </table>
</div>

Highlight box (para insight central de uma seção):
<div style="background:#000;color:#fff;padding:28px 32px;border-radius:2px;margin:24px 48px 0">
  <div style="font-family:var(--font-bebas),sans-serif;font-size:22px;color:#55f52f;margin-bottom:8px">DESTAQUE</div>
  <div style="font-family:var(--font-inter),sans-serif;font-size:15px;line-height:1.6">insight importante aqui</div>
</div>

Item de recomendação:
<div style="border:1px solid #cccccc;border-radius:2px;padding:20px;border-left:4px solid #55f52f;margin-bottom:12px">
  <div style="font-family:var(--font-inter),sans-serif;font-size:11px;font-weight:700;color:#757575;text-transform:uppercase;letter-spacing:0.08em">O QUE FAZER</div>
  <div style="font-family:var(--font-inter),sans-serif;font-size:14px;color:#0e0e0e;margin-top:6px;font-weight:600">ação específica aqui</div>
  <div style="font-family:var(--font-inter),sans-serif;font-size:13px;color:#757575;margin-top:8px"><span style="font-weight:600;color:#0e0e0e">Por que:</span> dado concreto que sustenta a recomendação</div>
  <div style="font-family:var(--font-inter),sans-serif;font-size:13px;color:#1a6600;margin-top:4px"><span style="font-weight:600">Resultado esperado:</span> métrica ou efeito esperado</div>
</div>

Próximo passo numerado:
<div style="display:flex;gap:16px;align-items:flex-start;padding:16px 0;border-bottom:1px solid #f7f7f7">
  <div style="background:#55f52f;color:#000;font-family:var(--font-bebas),sans-serif;font-size:18px;min-width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:2px">1</div>
  <div>
    <div style="font-family:var(--font-inter),sans-serif;font-size:14px;font-weight:700;color:#0e0e0e">AÇÃO ESPECÍFICA</div>
    <div style="font-family:var(--font-inter),sans-serif;font-size:13px;color:#757575;margin-top:4px">detalhes concretos do que será feito</div>
  </div>
</div>

Divisor entre seções: <div style="height:1px;background:#f7f7f7;margin:0 48px"></div>

Rodapé:
<div style="background:#000;padding:32px 48px;margin-top:64px;display:flex;align-items:center;justify-content:space-between">
  <div style="color:#55f52f;font-family:var(--font-bebas),sans-serif;font-size:20px;letter-spacing:0.1em">ONMID</div>
  <div style="color:#757575;font-family:var(--font-inter),sans-serif;font-size:12px">Relatório gerado por ONMID Reports</div>
</div>

SAÍDA: retorne APENAS o HTML. Sem markdown, sem blocos de código, sem texto antes ou depois.
O HTML começa em <div style="background:#fff e termina em </div>`;

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
    'DADOS INSTAGRAM INSIGHTS:',
    'Sem dados de Instagram Orgânico disponíveis para este período.',
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
  // legacy compat
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

  const period = `${fmtMonth(periodFrom)} a ${fmtMonth(periodTo)}`;

  // Infer segment from data (best effort)
  const segment = 'Marketing Digital';

  // Previous period: month before the first month in the data
  const firstMonth = monthlyCrm[0]?.label ?? monthlyMeta[0]?.label ?? '';
  const prevPeriod = firstMonth ? `mês anterior a ${firstMonth}` : 'não disponível';

  const metaData = formatMetaData(monthlyMeta);
  const crmData = formatCrmData(monthlyCrm);

  const userPrompt = buildUserPrompt(clientName, segment, period, prevPeriod, agencyContext, metaData, crmData);

  let html = '';

  if (apiKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (res.ok) {
        const data = await res.json() as { content?: { type: string; text: string }[] };
        const text = data.content?.find(c => c.type === 'text')?.text ?? '';
        // Strip accidental markdown fences
        html = text.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      }
    } catch { /* fall through to fallback */ }
  }

  if (!html) {
    html = buildFallbackHtml(clientName, period, monthlyCrm, monthlyMeta);
  }

  return { html };
}

// ── Fallback HTML (when Claude is unavailable) ────────────────────────────────

function buildFallbackHtml(
  clientName: string,
  period: string,
  monthlyCrm: MonthlyCrm[],
  monthlyMeta: MonthlyMeta[],
): string {
  const totalRegistros = monthlyCrm.reduce((s, m) => s + m.registros, 0);
  const totalNovosClientes = monthlyCrm.reduce((s, m) => s + m.novosClientes, 0);
  const totalSpend = monthlyMeta.reduce((s, m) => s + m.spend, 0);
  const hasMeta = monthlyMeta.length > 0;

  return `<div style="background:#fff;font-family:var(--font-inter),sans-serif;padding-bottom:80px">
  <div style="background:#000;padding:56px 48px 48px">
    <div style="color:#55f52f;font-family:var(--font-bebas),sans-serif;font-size:12px;letter-spacing:0.15em">ONMID · RELATÓRIO DE MARKETING DIGITAL</div>
    <h1 style="color:#fff;font-family:var(--font-bebas),sans-serif;font-size:80px;line-height:0.9;margin:12px 0 0">${clientName.toUpperCase()}</h1>
    <div style="color:#999;font-family:var(--font-inter),sans-serif;font-size:14px;margin-top:24px;text-transform:uppercase;letter-spacing:0.05em">Período · ${period}</div>
    <div style="display:flex;gap:12px;margin-top:32px;flex-wrap:wrap">
      ${totalRegistros > 0 ? `<div style="background:#ffffff15;border:1px solid #ffffff25;padding:12px 20px;border-radius:2px"><div style="color:#999;font-family:var(--font-inter),sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.08em">Registros</div><div style="color:#fff;font-family:var(--font-bebas),sans-serif;font-size:28px;line-height:1;margin-top:4px">${totalRegistros}</div></div>` : ''}
      ${hasMeta ? `<div style="background:#ffffff15;border:1px solid #ffffff25;padding:12px 20px;border-radius:2px"><div style="color:#999;font-family:var(--font-inter),sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.08em">Investimento</div><div style="color:#fff;font-family:var(--font-bebas),sans-serif;font-size:28px;line-height:1;margin-top:4px">${brl(totalSpend)}</div></div>` : ''}
    </div>
  </div>
  <div style="padding:48px 48px 0">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">
      <div style="width:4px;height:36px;background:#55f52f;flex-shrink:0"></div>
      <h2 style="font-family:var(--font-bebas),sans-serif;font-size:36px;color:#0e0e0e;margin:0;line-height:1">RESUMO DO PERÍODO</h2>
    </div>
  </div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;padding:0 48px;margin-top:24px">
    ${totalRegistros > 0 ? `<div style="background:#f7f7f7;border:1px solid #cccccc;border-radius:2px;padding:24px;flex:1;min-width:150px"><div style="font-family:var(--font-inter),sans-serif;font-size:11px;color:#757575;text-transform:uppercase;letter-spacing:0.08em">REGISTROS</div><div style="font-family:var(--font-bebas),sans-serif;font-size:44px;color:#0e0e0e;line-height:1;margin-top:8px">${totalRegistros}</div><div style="font-family:var(--font-inter),sans-serif;font-size:12px;color:#757575;margin-top:8px">leads e cadastros no período</div></div>` : ''}
    ${totalNovosClientes > 0 ? `<div style="background:#f7f7f7;border:1px solid #cccccc;border-radius:2px;padding:24px;flex:1;min-width:150px"><div style="font-family:var(--font-inter),sans-serif;font-size:11px;color:#757575;text-transform:uppercase;letter-spacing:0.08em">NOVOS CLIENTES</div><div style="font-family:var(--font-bebas),sans-serif;font-size:44px;color:#0e0e0e;line-height:1;margin-top:8px">${totalNovosClientes}</div><div style="font-family:var(--font-inter),sans-serif;font-size:12px;color:#757575;margin-top:8px">conversões no período</div></div>` : ''}
    ${hasMeta ? `<div style="background:#f7f7f7;border:1px solid #cccccc;border-radius:2px;padding:24px;flex:1;min-width:150px"><div style="font-family:var(--font-inter),sans-serif;font-size:11px;color:#757575;text-transform:uppercase;letter-spacing:0.08em">INVESTIMENTO META</div><div style="font-family:var(--font-bebas),sans-serif;font-size:44px;color:#0e0e0e;line-height:1;margin-top:8px">${brl(totalSpend)}</div><div style="font-family:var(--font-inter),sans-serif;font-size:12px;color:#757575;margin-top:8px">em tráfego pago</div></div>` : ''}
  </div>
  <div style="background:#000;padding:32px 48px;margin-top:64px;display:flex;align-items:center;justify-content:space-between">
    <div style="color:#55f52f;font-family:var(--font-bebas),sans-serif;font-size:20px;letter-spacing:0.1em">ONMID</div>
    <div style="color:#757575;font-family:var(--font-inter),sans-serif;font-size:12px">Relatório gerado por ONMID Reports</div>
  </div>
</div>`;
}

// ── Unused but kept for type compatibility with older code ────────────────────
export { pct, fmtMonth };
