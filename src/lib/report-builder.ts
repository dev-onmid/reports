import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { RESULT_ACTIONS, NEW_CONTACT_ACTIONS, PURCHASE_ACTIONS, sumActions, brl } from './report-runner';
import { logAiUsage } from '@/lib/ai-usage-logger';

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

// ── Google Ads fetch ──────────────────────────────────────────────────────────

type GoogleAdsTotals = { spend: number; impressions: number; clicks: number; conversions: number };

async function fetchGoogleAdsTotals(connectionId: string, accountIds: string[], from: string, to: string): Promise<GoogleAdsTotals> {
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

  const empty: GoogleAdsTotals = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
  if (!conn) return empty;

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

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';
  const result = { ...empty };

  await Promise.allSettled(accountIds.map(async (accountId) => {
    const customerId = accountId.replace(/\D/g, '');
    if (!customerId) return;
    const res = await fetch(
      `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'developer-token': devToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status != 'REMOVED'`,
        }),
      },
    ).catch(() => null);
    if (!res?.ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as { results?: any[] };
    for (const row of (data.results ?? [])) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = ((row as any).metrics ?? {}) as Record<string, number>;
      result.spend += (m.costMicros ?? 0) / 1_000_000;
      result.impressions += m.impressions ?? 0;
      result.clicks += m.clicks ?? 0;
      result.conversions += m.conversions ?? 0;
    }
  }));

  return result;
}

function formatGoogleData(g: GoogleAdsTotals): string {
  if (!g.spend && !g.impressions) return '';
  return [
    `Total investido: ${brl(g.spend)}`,
    `Impressões: ${g.impressions.toLocaleString('pt-BR')}`,
    `Cliques: ${g.clicks.toLocaleString('pt-BR')}`,
    g.impressions > 0 ? `CTR: ${((g.clicks / g.impressions) * 100).toFixed(2)}%` : null,
    `Conversões atribuídas: ${g.conversions}`,
    g.conversions > 0 ? `Custo por conversão: ${brl(g.spend / g.conversions)}` : null,
    g.clicks > 0 ? `CPC médio: ${brl(g.spend / g.clicks)}` : null,
  ].filter(Boolean).join('\n');
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

const SYSTEM_PROMPT = `Você é um analista sênior de marketing digital. Você escreve para donos de negócio — não para marqueteiros. O resultado deve parecer uma apresentação executiva premium, não um dashboard exportado.

MISSÃO: transformar dados de tráfego pago e base de clientes em diagnóstico claro e plano de ação concreto, com hierarquia visual que guia o olho do leitor.

━━ REGRAS SEM EXCEÇÃO ━━
1. Nunca invente dados. Dado ausente = diga "Dado não integrado neste período" em faixa discreta. Não crie card grande com "—".
2. Todo slide tem UMA conclusão executiva clara no final (faixa border-left verde com texto direto).
3. Cada slide tem UMA tese: o título não descreve o conteúdo, ele afirma uma conclusão. Exemplos corretos: "Uma campanha concentra o ROAS e deve receber mais verba", "A base inativa é o maior ativo escondido do mês". Exemplos errados: "Meta Ads", "Base de Clientes".
4. Não crie todos os cards com o mesmo peso visual. Use 1 KPI hero grande + máximo 3 secundários por slide.
5. Quedas são contextualizadas: 1 frase de causa + 1 ação corretiva.
6. Variações sempre com % e valor absoluto: "+23% (de 254 para 312)".
7. Proibido: "excelente resultado", "é importante destacar", "N/A", seções vazias.
8. Tom direto, português BR. Métricas técnicas com tradução: "ROAS de 4,2× (R$4,20 de resultado por R$1 investido)".

━━ HIERARQUIA VISUAL OBRIGATÓRIA POR TIPO DE SLIDE ━━

A) CAPA / RESUMO EXECUTIVO (slide 1):
- Layout igual à referência: lado esquerdo com título grande "Relatório de Performance — [Cliente]", texto de apoio, período analisado e comparativo; lado direito com composição visual de relatório (cards flutuantes, gráfico de linha, donut, barras, mapa/ícones); card largo de "Objetivo do relatório" no rodapé direito.
- A capa NÃO é dashboard de KPI. Ela é abertura editorial/premium com elementos gráficos laterais.
- O nome do cliente deve ser tão evidente quanto o título.

B) RESULTADOS / VISÃO GERAL (slide 2):
- Layout igual à referência: título "Visão geral do mês", subtítulo "Comparativo de [mês atual] com [mês anterior]".
- Mostrar primeiro o mês atual com 3 cards grandes, nesta ordem: Faturamento, Pedidos, Ticket médio.
- Logo abaixo, se houver comparativo, mostrar o mês comparativo com os mesmos 3 cards e a mesma ordem.
- Abaixo disso, criar uma faixa de comparativo entre períodos com variação percentual de Faturamento, Pedidos e Ticket médio.
- Finalizar com card "Leitura principal" resumindo o que aconteceu no mês.
- Reduzir dados secundários como clientes ativos, inativos, potenciais e frequência média; não deixar esses dados competirem com os 3 indicadores principais.

C) MÍDIA PAGA / META ADS / GOOGLE ADS:
- Layout: 4 KPIs compactos no topo + scoreboard de campanhas abaixo
- Campanha vencedora (maior ROAS ou resultado) = card maior com badge "CAMPEÃ" em verde
- Campanha com pior CPA ou menor resultado = card com badge "ATENÇÃO" em vermelho
- Não criar todos os cards de campanha com o mesmo tamanho e cor

D) RECOMENDAÇÕES / PRÓXIMOS PASSOS:
- Layout: 3+2 grid (linha de 3 cards + linha de 2 cards) — nunca 5 colunas iguais
- Cada card: número em destaque + ação + por que (dado) + resultado esperado + mensagem sugerida

━━ ESTRUTURA DOS SLIDES (ordem fixa — pule slides sem dados) ━━

SLIDE 1 — CAPA (sempre) [Layout A]
• Título obrigatório: "Relatório de Performance —" em uma linha e o nome do cliente na linha seguinte.
• Texto de apoio obrigatório: "Análise de faturamento, pedidos, tráfego, base de clientes, produtos e oportunidades para [mês/próximo ciclo]".
• Mostrar claramente: "Período analisado: [atual]" e "Comparativo: [anterior]".
• Lado direito: composição visual com janela de gráfico de linha, card de donut/legenda, card com miniatura abstrata + linhas, card de barras, card de mapa e card de linha menor. Use SVG/CSS, sem imagens externas.
• Rodapé/lateral inferior: card largo "Objetivo do relatório" com ícone de alvo e texto executivo do objetivo.
• Manter logo ONMID no topo esquerdo, contador 01/TOTAL no topo direito e assinatura ONMID Reports no rodapé.

SLIDE 2 — RESULTADOS DO MÊS (com CRM ou Meta) [Layout B]
• Título obrigatório: "Visão geral do mês".
• Subtítulo: "Comparativo de [mês atual] com [mês anterior]" quando houver comparativo; caso contrário "Resultado de [mês atual]".
• Primeira linha: mês atual + cards de Faturamento, Pedidos e Ticket médio, nessa ordem, com ícones.
• Segunda linha: mês comparativo + cards de Faturamento, Pedidos e Ticket médio, nessa ordem, somente quando houver dados anteriores.
• Terceira linha: faixa/bloco de comparativo com variação percentual dos 3 indicadores, somente quando houver dados anteriores.
• Rodapé: card "Leitura principal" com 1-2 frases executivas sobre o que aconteceu.
• Não inserir clientes ativos/inativos/potenciais/frequência como cards principais neste slide.

SLIDE 3 — META ADS [Layout C]
• Tese: "Uma campanha concentra o ROAS — priorizar sua verba aumenta o retorno"
• 4 KPIs compactos: Investimento, Alcance, Impressões, CPC
• Scoreboard: campanha vencedora (card maior, badge CAMPEÃ) + demais (menores, badge ATENÇÃO se aplicável)

SLIDE 3B — GOOGLE ADS [Layout C] (só se houver dados)
• Tese: ex. "Google Ads gerou X conversões — CTR indica oportunidade de expansão"
• Mesma estrutura de scoreboard

SLIDE 4 — BASE DE CLIENTES (com CRM) [Layout B]
• Tese: ex. "X% dos leads nunca converteu — a nutrição é o gargalo principal"
• Área principal: evolução mensal em tabela com mini-barras
• Lateral: taxa de conversão hero + insight tendência

SLIDE 5 — COMPARATIVO ANTERIOR×ATUAL (sempre) [Layout B]
• Tabela lado a lado com variação em badge colorido por linha
• Contexto: por que subiu/caiu e o que muda

SLIDE 6 — DIAGNÓSTICO / PRIORIDADES [Matriz Impacto × Esforço]
• 2×2 matrix: Prioridade Imediata | Aposta Estratégica | Manter Monitorado | Evitar Agora
• Preencher com as recomendações mapeadas por impacto×esforço
• Conclusão: a ação de prioridade imediata nomeada claramente

SLIDE 7 — PRÓXIMOS PASSOS (sempre) [Layout D: 3+2 grid]
• 5 ações no grid 3+2, cada uma com: número, ação, dado que justifica, resultado esperado

━━ DESIGN SYSTEM ON_REPORTS — SIGA EXATAMENTE ━━

DIMENSÃO: 1440×810px por slide.
CORES:
  Fundo externo:       #EEF1F5   (canvas do relatório)
  Fundo slide:         #F7F8FA   (off-white premium, nunca branco puro)
  Fundo card:          #FFFFFF   (superfície dos blocos)
  Fundo linha/faixa:   #F1F5F9   (tabelas e faixas discretas)
  Borda:               #D6DEE8
  Texto principal:     #0F172A   (títulos, valores — quase preto)
  Texto secundário:    #334155   (cinza chumbo — labels, body)
  Verde gráfico:      #55f52f   (fills de barra, bordas, corner squares — NÃO usar em texto pequeno)
  Verde texto:        #1a8a00   (verde legível — labels, "Conclusão", nomes de seção)
  Vermelho:           #DC2626  (risco, queda, atenção)
  Azul Meta:          #0B84FF  (Meta Ads, tráfego pago)
  Azul Google:        #4285F4  (Google Ads)
  Laranja conversão:  #FF6B35  (compras, conversão)
FONTES:
  KPIs/títulos fortes: font-family:var(--font-bebas),"Bebas Neue",sans-serif
  Todo resto:          font-family:var(--font-inter),Inter,sans-serif
RADIUS: capa pode usar 14–18px em cards flutuantes para seguir a referência; demais slides podem manter radius pequeno.
SOMBRAS: capa deve usar sombras suaves em cards flutuantes; demais slides usam sombras discretas apenas quando ajudam a separar blocos.

━━ PADRÕES HTML OBRIGATÓRIOS ━━

WRAPPER:
<div style="background:#EEF1F5;padding:28px;font-family:var(--font-inter),Inter,sans-serif">[slides]</div>

CAPA PADRÃO OBRIGATÓRIA:
<div style="width:1440px;min-height:810px;background:#F7F8FA;border:1px solid #D6DEE8;margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="height:92px;padding:34px 48px 0;display:flex;align-items:flex-start;justify-content:space-between">
    [logo ONMID à esquerda]
    <div style="font-size:22px;font-weight:900;color:#0F172A">01/TOTAL<div style="height:2px;background:#55f52f;margin-top:9px;width:58px;margin-left:auto"></div></div>
  </div>
  <div style="position:relative;z-index:1;flex:1;padding:82px 48px 68px;display:grid;grid-template-columns:650px 1fr;column-gap:40px">
    <div>
      <h1 style="font-size:58px;font-weight:900;color:#0F172A;line-height:1.04;margin:0 0 20px">Relatório de Performance —<br>[CLIENTE]</h1>
      <p style="font-size:20px;font-weight:500;color:#163461;line-height:1.48;margin:0 0 34px">Análise de faturamento, pedidos, tráfego, base de clientes, produtos e oportunidades para [MÊS/PRÓXIMO CICLO]</p>
      [duas linhas com ícones: Período analisado e Comparativo]
    </div>
    <div style="position:relative">[composição visual lateral com cards flutuantes: gráfico linha, donut, barras, mapa, mini-card de campanha]</div>
  </div>
  <div data-conclusion="1" style="position:absolute;right:70px;bottom:78px;width:850px;border-radius:18px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 42px rgba(15,23,42,.08);display:grid;grid-template-columns:112px 1fr;align-items:center;padding:26px 34px">[Objetivo do relatório]</div>
  <div style="height:56px;border-top:1px solid #D6DEE8;display:flex;align-items:center;padding:0 48px">ONMID Reports</div>
</div>

SLIDE GENÉRICO:
<div style="width:1440px;min-height:810px;background:#F7F8FA;border:1px solid #D6DEE8;margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column">
  <div style="height:52px;padding:0 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #D6DEE8;flex-shrink:0">
    <span style="font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:22px;color:#55f52f;letter-spacing:0.06em">ONMID</span>
    <span style="font-size:11px;color:#64748B;font-family:var(--font-inter),Inter,sans-serif;font-weight:600">N / TOTAL</span>
  </div>
  <div style="flex:1;padding:32px 48px;display:flex;flex-direction:column">[conteúdo]</div>
</div>

TÍTULO DE SLIDE (tese, não descrição):
<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:22px">
  <div style="width:4px;flex-shrink:0;background:#55f52f;align-self:stretch;min-height:42px;margin-top:2px"></div>
  <div>
    <h2 style="font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:34px;color:#0F172A;margin:0;line-height:1;letter-spacing:0.02em">TESE DO SLIDE</h2>
    <p style="font-size:11px;font-weight:600;color:#334155;text-transform:uppercase;letter-spacing:0.1em;margin:5px 0 0;font-family:var(--font-inter)">contexto técnico</p>
  </div>
</div>

KPI HERO (1 por slide — o maior número):
<div style="position:relative;overflow:hidden;border:1px solid #55f52f40;background:#FFFFFF;padding:24px 24px 20px">
  <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#55f52f,#55f52f00)"></div>
  <div style="position:absolute;top:0;left:0;width:14px;height:14px;background:#55f52f"></div>
  <p style="font-size:10px;font-weight:700;color:#1a8a00;text-transform:uppercase;letter-spacing:0.12em;font-family:var(--font-inter);margin:4px 0 10px">LABEL</p>
  <p style="font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:72px;color:#0F172A;line-height:0.9;margin:0 0 10px">VALOR</p>
  <p style="font-size:13px;color:#334155;font-family:var(--font-inter);line-height:1.5;margin:0">sub-contexto</p>
</div>

KPI SECUNDÁRIO (até 3 por slide):
<div style="position:relative;overflow:hidden;border:1px solid #D6DEE8;background:#FFFFFF;padding:18px 16px">
  <div style="position:absolute;top:0;left:0;right:0;height:2px;background:#55f52f"></div>
  <div style="position:absolute;top:0;left:0;width:12px;height:12px;background:#55f52f"></div>
  <p style="font-size:10px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.1em;font-family:var(--font-inter);margin:4px 0 8px">LABEL</p>
  <p style="font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:36px;color:#0F172A;line-height:1;margin:0 0 5px">VALOR</p>
  <p style="font-size:11px;color:#334155;font-family:var(--font-inter);margin:0">contexto</p>
</div>

BADGE POSITIVO: <span style="font-size:11px;font-weight:700;color:#55f52f;font-family:var(--font-inter)">↑ +23%</span>
BADGE NEGATIVO: <span style="font-size:11px;font-weight:700;color:#DC2626;font-family:var(--font-inter)">↓ -12%</span>
BADGE CAMPEÃ: <span style="font-size:9px;font-weight:800;color:#FFFFFF;background:#55f52f;padding:2px 7px;letter-spacing:0.08em;font-family:var(--font-inter)">CAMPEÃ</span>
BADGE ATENÇÃO: <span style="font-size:9px;font-weight:800;color:#FFFFFF;background:#FF6B35;padding:2px 7px;letter-spacing:0.08em;font-family:var(--font-inter)">ATENÇÃO</span>

TABELA DE COMPARATIVO:
<table style="width:100%;border-collapse:collapse;font-family:var(--font-inter),Inter,sans-serif">
  <thead><tr style="background:#F1F5F9;border-bottom:1px solid #D6DEE8">
    <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748B">Métrica</th>
    <th style="padding:9px 14px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748B">Anterior</th>
    <th style="padding:9px 14px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748B">Atual</th>
    <th style="padding:9px 14px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748B">Var.</th>
  </tr></thead>
  <tbody>[linhas alternadas #FFFFFF / #F1F5F9, border-bottom:1px solid #D6DEE8]</tbody>
</table>

CARD DE CAMPANHA (scoreboard):
<div style="position:relative;overflow:hidden;border:1px solid #55f52f60;background:#FFFFFF;padding:16px">
  <div style="position:absolute;top:0;left:0;right:0;height:2px;background:#55f52f"></div>
  <div style="position:absolute;top:0;left:0;width:12px;height:12px;background:#55f52f"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin:4px 0 12px">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:24px;color:#55f52f;line-height:1">#1</span>
      <span style="font-size:12px;font-weight:700;color:#0F172A;font-family:var(--font-inter);line-height:1.3">NOME CAMPANHA</span>
    </div>
    [badge CAMPEÃ ou ATENÇÃO]
  </div>
  [métricas: display:flex;justify-content:space-between; padding:5px 0;border-bottom:1px solid #D6DEE8]
</div>

CARD DE INSIGHT / CONCLUSÃO (obrigatório em todo slide):
<div style="margin-top:auto;padding-top:16px;padding-bottom:24px">
  <div style="border-left:3px solid #55f52f;background:#55f52f0D;padding:12px 20px;display:flex;align-items:center;gap:14px">
    <span style="font-size:10px;font-weight:800;color:#1a8a00;text-transform:uppercase;letter-spacing:0.12em;font-family:var(--font-inter);flex-shrink:0">Conclusão</span>
    <span style="font-size:13px;color:#0F172A;font-family:var(--font-inter);line-height:1.6">conclusão executiva aqui — dado → decisão → resultado esperado</span>
  </div>
</div>

BARRA HORIZONTAL (gráficos):
<div style="margin-bottom:11px">
  <div style="display:flex;justify-content:space-between;margin-bottom:5px">
    <span style="font-size:12px;font-weight:600;color:#0F172A;font-family:var(--font-inter)">label</span>
    <span style="font-size:12px;font-weight:700;color:#55f52f;font-family:var(--font-inter)">valor</span>
  </div>
  <div style="height:8px;background:#D6DEE8;overflow:hidden">
    <div style="height:100%;background:#55f52f;width:XX%"></div>
  </div>
</div>

DADO AUSENTE (não criar card grande — usar faixa discreta):
<div style="border-left:2px solid #64748B;padding:8px 14px;background:#FFFFFF;margin:8px 0">
  <p style="font-size:11px;color:#64748B;font-family:var(--font-inter);margin:0">Dado não integrado neste período — [nome do dado] não foi encontrado nos dados fornecidos.</p>
</div>

SAÍDA: retorne APENAS o HTML. Sem markdown, sem blocos de código, sem texto antes ou depois.
O HTML começa com <div style="background:#EEF1F5 e termina com </div>`;

// ── User Prompt ───────────────────────────────────────────────────────────────

function buildUserPrompt(
  clientName: string,
  segment: string,
  period: string,
  prevPeriodLabel: string,
  agencyContext: string,
  metaData: string,
  crmData: string,
  metaPrevData?: string,
  crmPrevData?: string,
  googleData?: string,
  googlePrevData?: string,
  supplementary?: string,
): string {
  return [
    `Cliente: ${clientName}`,
    `Segmento: ${segment}`,
    `PERÍODO ATUAL: ${period}`,
    `PERÍODO ANTERIOR (para comparação no slide 5): ${prevPeriodLabel}`,
    agencyContext ? `Contexto da agência: ${agencyContext}` : null,
    '',
    `DADOS META ADS — PERÍODO ATUAL (${period}):`,
    metaData,
    metaPrevData ? `\nDADOS META ADS — PERÍODO ANTERIOR (${prevPeriodLabel}):` : null,
    metaPrevData ?? null,
    googleData ? `\nDADOS GOOGLE ADS — PERÍODO ATUAL (${period}):` : null,
    googleData ?? null,
    googlePrevData ? `\nDADOS GOOGLE ADS — PERÍODO ANTERIOR (${prevPeriodLabel}):` : null,
    googlePrevData ?? null,
    '',
    `DADOS CRM / RESULTADOS DO NEGÓCIO — PERÍODO ATUAL (${period}):`,
    crmData,
    crmPrevData ? `\nDADOS CRM — PERÍODO ANTERIOR (${prevPeriodLabel}):` : null,
    crmPrevData ?? null,
    supplementary ? `\nDADOS SUPLEMENTARES (planilha anexada pelo cliente):` : null,
    supplementary ?? null,
  ].filter(l => l !== null).join('\n');
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
  agencyContext?: string;
  apiKey: string;
  manualNotes?: string;
  supplementaryContent?: string;
}): Promise<{ html: string }> {
  const { clientId, clientName, connectionId, accountIds, periodFrom, periodTo, apiKey } = input;
  const googleConnectionId = input.googleConnectionId ?? null;
  const googleAccountIds = input.googleAccountIds ?? [];
  const agencyContext = input.agencyContext ?? input.manualNotes ?? '';
  const supplementaryContent = input.supplementaryContent ?? '';

  const prev = calcPrevPeriod(periodFrom, periodTo);
  const hasGoogle = Boolean(googleConnectionId && googleAccountIds.length);

  const [monthlyMeta, monthlyCrm, prevMonthlyMeta, prevMonthlyCrm, googleTotals, googlePrevTotals] = await Promise.all([
    connectionId && accountIds?.length
      ? fetchMonthlyMeta(connectionId, accountIds, periodFrom, periodTo)
      : Promise.resolve([] as MonthlyMeta[]),
    fetchMonthlyCrm(clientId, periodFrom, periodTo),
    connectionId && accountIds?.length
      ? fetchMonthlyMeta(connectionId, accountIds, prev.from, prev.to)
      : Promise.resolve([] as MonthlyMeta[]),
    fetchMonthlyCrm(clientId, prev.from, prev.to),
    hasGoogle
      ? fetchGoogleAdsTotals(googleConnectionId!, googleAccountIds, periodFrom, periodTo)
      : Promise.resolve({ spend: 0, impressions: 0, clicks: 0, conversions: 0 }),
    hasGoogle
      ? fetchGoogleAdsTotals(googleConnectionId!, googleAccountIds, prev.from, prev.to)
      : Promise.resolve({ spend: 0, impressions: 0, clicks: 0, conversions: 0 }),
  ]);

  const period          = `${fmtMonth(periodFrom)} a ${fmtMonth(periodTo)}`;
  const prevPeriodLabel = `${fmtMonth(prev.from)} a ${fmtMonth(prev.to)}`;

  const metaData     = formatMetaData(monthlyMeta);
  const metaPrevData = formatMetaData(prevMonthlyMeta);
  const crmData      = formatCrmData(monthlyCrm);
  const crmPrevData  = formatCrmData(prevMonthlyCrm);
  const googleData   = formatGoogleData(googleTotals) || undefined;
  const googlePrevData = formatGoogleData(googlePrevTotals) || undefined;
  const segment      = 'Marketing Digital';

  const userPrompt = buildUserPrompt(
    clientName, segment, period, prevPeriodLabel, agencyContext,
    metaData, crmData, metaPrevData, crmPrevData, googleData, googlePrevData,
    supplementaryContent || undefined,
  );

  let html = '';

  if (apiKey && process.env.SKIP_AI !== 'true') {
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
        const data = await res.json() as { content?: { type: string; text: string }[]; usage?: { input_tokens: number; output_tokens: number } };
        void logAiUsage({ source: 'report_performance', model: 'claude-sonnet-4-6', inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 });
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
  _monthlyCrm: MonthlyCrm[],
  _monthlyMeta: MonthlyMeta[],
): string {
  void _monthlyCrm;
  void _monthlyMeta;

  return `<div style="background:#EEF1F5;padding:28px;font-family:var(--font-inter),sans-serif">
  <div style="width:1440px;min-height:810px;background:#F7F8FA;border:1px solid #D6DEE8;margin:0 auto 20px;box-shadow:0 16px 42px rgba(15,23,42,0.12);overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;position:relative">
    <div style="position:absolute;left:-110px;bottom:-130px;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,#55f52f33 0%,#55f52f16 38%,transparent 72%)"></div>
    <div style="position:absolute;right:96px;top:88px;width:520px;height:520px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.68),rgba(255,255,255,.2));opacity:.72"></div>
    <div style="height:92px;padding:34px 48px 0;display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-family:var(--font-inter),sans-serif;font-size:34px;font-weight:900;letter-spacing:-0.06em;color:#0F172A;line-height:1">onmid</span>
        <span style="width:44px;height:22px;border-radius:999px;background:#55f52f;display:inline-flex;align-items:center;justify-content:flex-end;padding-right:4px;box-sizing:border-box;box-shadow:0 8px 20px #55f52f55"><span style="width:14px;height:14px;border-radius:50%;background:#FFFFFF;display:block"></span></span>
        <span style="font-size:9px;font-weight:700;color:#334155;align-self:flex-start;margin-top:1px">®</span>
      </div>
      <div style="font-family:var(--font-inter),sans-serif;font-size:22px;font-weight:900;color:#0F172A;line-height:1;text-align:right">01/01<div style="height:2px;background:#55f52f;margin-top:9px;width:58px;margin-left:auto"></div></div>
    </div>
    <div style="position:relative;z-index:1;flex:1;padding:82px 48px 68px;display:grid;grid-template-columns:650px 1fr;column-gap:40px">
      <div style="display:flex;flex-direction:column;min-width:0">
        <h1 style="font-family:var(--font-inter),sans-serif;font-size:58px;font-weight:900;letter-spacing:-0.045em;color:#0F172A;line-height:1.04;margin:0 0 20px">Relatório de Performance —<br>${clientName}</h1>
        <p style="font-size:20px;font-weight:500;color:#163461;line-height:1.48;margin:0 0 34px;max-width:590px">Análise de faturamento, pedidos, tráfego, base de clientes, produtos e oportunidades para o próximo ciclo.</p>
        <div style="display:flex;flex-direction:column;gap:18px;margin-top:4px">
          <div style="display:flex;align-items:center;gap:20px"><div style="width:48px;height:48px;border-radius:15px;background:#55f52f16;display:flex;align-items:center;justify-content:center;font-size:24px;color:#1a8a00">□</div><p style="font-size:18px;color:#14305B;margin:0"><strong style="color:#0F172A">Período analisado:</strong> ${period}</p></div>
          <div style="display:flex;align-items:center;gap:20px"><div style="width:48px;height:48px;border-radius:15px;background:#0B84FF12;display:flex;align-items:center;justify-content:center;font-size:24px;color:#0B84FF">i</div><p style="font-size:18px;color:#14305B;margin:0"><strong style="color:#0F172A">Comparativo:</strong> período anterior disponível nos dados</p></div>
        </div>
      </div>
      <div style="position:relative;min-height:440px">
        <div style="position:absolute;right:70px;top:10px;width:360px;height:150px;border-radius:18px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 42px rgba(15,23,42,.09);padding:22px"><div style="display:flex;gap:8px;margin-bottom:16px"><span style="width:10px;height:10px;border-radius:50%;background:#55f52f"></span><span style="width:10px;height:10px;border-radius:50%;background:#55f52f55"></span><span style="width:10px;height:10px;border-radius:50%;background:#D7DEE8"></span></div><svg viewBox="0 0 460 110" width="100%" height="86"><rect x="0" y="4" width="460" height="104" fill="#F8FAFD" stroke="#E6EDF6"/><path d="M0 86 C46 72 42 34 86 44 C120 52 130 12 164 20 C198 28 190 70 232 62 C270 54 270 18 308 28 C342 38 330 72 378 46 C410 30 414 8 446 12" fill="none" stroke="#0B84FF" stroke-width="3" stroke-linecap="round"/></svg></div>
        <div style="position:absolute;left:56px;top:144px;width:230px;height:112px;border-radius:17px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 38px rgba(15,23,42,.10);display:flex;align-items:center;gap:18px;padding:18px"><div style="width:72px;height:72px;border-radius:50%;background:conic-gradient(#55f52f 0 68%,#55f52f55 68% 82%,#DBEAFE 82% 100%);position:relative;flex-shrink:0"><span style="position:absolute;inset:21px;border-radius:50%;background:#FFFFFF"></span></div><div style="flex:1;display:flex;flex-direction:column;gap:12px"><span style="height:8px;border-radius:8px;background:#55f52f;width:18px"></span><span style="height:8px;border-radius:8px;background:#D9E2EE;width:86px"></span><span style="height:8px;border-radius:8px;background:#D9E2EE;width:64px"></span></div></div>
        <div style="position:absolute;right:0;top:250px;width:196px;height:112px;border-radius:15px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 38px rgba(15,23,42,.09);display:flex;align-items:flex-end;gap:14px;padding:22px 24px">${[34, 50, 66, 84, 104].map((h, i) => `<span style="width:15px;height:${h}px;border-radius:5px;background:#55f52f;opacity:${0.38 + i * 0.14}"></span>`).join('')}</div>
      </div>
    </div>
    <div data-conclusion="1" style="position:absolute;right:70px;bottom:78px;width:850px;min-height:116px;border-radius:18px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 42px rgba(15,23,42,.08);display:grid;grid-template-columns:112px 1fr;align-items:center;padding:26px 34px"><div style="width:78px;height:78px;border-radius:50%;background:#55f52f16;display:flex;align-items:center;justify-content:center;color:#1a8a00;font-size:44px">◎</div><div style="border-left:2px solid #55f52f;padding-left:24px"><p style="font-size:22px;font-weight:900;color:#0F172A;margin:0 0 8px">Objetivo do relatório</p><p style="font-size:16px;font-weight:500;color:#163461;line-height:1.55;margin:0">Apresentar uma leitura clara dos resultados do período, entender o que compôs a performance e indicar oportunidades para aumentar recorrência, reativar clientes e otimizar campanhas.</p></div></div>
    <div style="height:56px;border-top:1px solid #D6DEE8;display:flex;align-items:center;padding:0 48px;gap:12px"><span style="width:34px;height:18px;border-radius:999px;background:#55f52f;display:inline-flex;align-items:center;justify-content:flex-end;padding-right:3px;box-sizing:border-box"><span style="width:11px;height:11px;border-radius:50%;background:#FFFFFF"></span></span><span style="font-size:13px;font-weight:900;color:#0F172A;letter-spacing:.03em">ONMID</span><span style="font-size:13px;color:#163461">Reports</span></div>
  </div>
</div>`;
}
