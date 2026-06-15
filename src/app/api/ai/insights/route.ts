import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { logAiUsage } from '@/lib/ai-usage-logger';

export type AiInsight = {
  id: string;
  metric: string;
  platform: 'meta' | 'google' | 'geral';
  severity: 'info' | 'warn' | 'critical';
  title: string;
  suggestion: string;
  status: 'new' | 'accepted' | 'dismissed';
  created_at: string;
};

type MetricsPayload = {
  clientIds: string[];
  clientNames: string[];
  period: string;
  meta: {
    spend: number; impressions: number; clicks: number;
    leads: number; ctr: number; cpc: number; cpl: number;
  } | null;
  google: {
    cost: number; impressions: number; clicks: number;
    conversions: number; ctr: number; cpc: number; cpa: number;
  } | null;
  topCreatives?: Array<{
    name: string; spend: number; leads: number; cpl: number; impressions: number;
  }>;
};

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_insights (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_key TEXT NOT NULL,
      period TEXT NOT NULL,
      metric TEXT,
      platform TEXT,
      severity TEXT DEFAULT 'info',
      title TEXT,
      suggestion TEXT,
      status TEXT DEFAULT 'new',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

function buildPrompt(data: MetricsPayload): string {
  const lines: string[] = [
    'Você é um especialista sênior em gestão de tráfego pago (Meta Ads e Google Ads) no mercado brasileiro.',
    'Analise as métricas abaixo e forneça insights práticos e acionáveis para otimização de campanhas.',
    '',
    `PERÍODO: ${data.period}`,
    `CLIENTES: ${data.clientNames.join(', ')}`,
    '',
  ];

  if (data.meta) {
    const m = data.meta;
    lines.push('=== META ADS ===');
    lines.push(`Investimento: R$ ${m.spend.toFixed(2)}`);
    lines.push(`Impressões: ${m.impressions.toLocaleString('pt-BR')}`);
    lines.push(`Cliques: ${m.clicks.toLocaleString('pt-BR')}`);
    lines.push(`Leads: ${m.leads.toLocaleString('pt-BR')}`);
    lines.push(`CTR: ${m.ctr.toFixed(2)}%`);
    lines.push(`CPC: R$ ${m.cpc.toFixed(2)}`);
    lines.push(`CPL: R$ ${m.cpl.toFixed(2)}`);
    lines.push('');
  }

  if (data.google) {
    const g = data.google;
    lines.push('=== GOOGLE ADS ===');
    lines.push(`Investimento: R$ ${g.cost.toFixed(2)}`);
    lines.push(`Impressões: ${g.impressions.toLocaleString('pt-BR')}`);
    lines.push(`Cliques: ${g.clicks.toLocaleString('pt-BR')}`);
    lines.push(`Conversões: ${g.conversions.toLocaleString('pt-BR')}`);
    lines.push(`CTR: ${g.ctr.toFixed(2)}%`);
    lines.push(`CPC: R$ ${g.cpc.toFixed(2)}`);
    lines.push(`CPA: R$ ${g.cpa.toFixed(2)}`);
    lines.push('');
  }

  if (data.topCreatives && data.topCreatives.length > 0) {
    lines.push('=== TOP CRIATIVOS META (por investimento) ===');
    data.topCreatives.slice(0, 5).forEach((c, i) => {
      lines.push(`${i + 1}. "${c.name}" — R$ ${c.spend.toFixed(0)} investido, ${c.leads} leads, CPL R$ ${c.cpl.toFixed(0)}, ${c.impressions.toLocaleString('pt-BR')} impressões`);
    });
    lines.push('');
  }

  lines.push('Retorne APENAS um array JSON válido, sem texto adicional, no seguinte formato:');
  lines.push('[');
  lines.push('  {');
  lines.push('    "metric": "Nome da métrica afetada (ex: CTR, CPL, Budget, Criativos)",');
  lines.push('    "platform": "meta | google | geral",');
  lines.push('    "severity": "info | warn | critical",');
  lines.push('    "title": "Título direto em até 60 caracteres",');
  lines.push('    "suggestion": "Ação concreta e específica em até 180 caracteres"');
  lines.push('  }');
  lines.push(']');
  lines.push('');
  lines.push('REGRAS:');
  lines.push('- Gere de 3 a 6 insights, priorizando os de maior impacto no resultado');
  lines.push('- Benchmarks BR: CTR Feed > 1.5%, CTR Stories > 0.5%, CPM bom R$10-25, Frequência ideal 1.5-3.0 (> 4 = saturação)');
  lines.push('- Se não houver dados de uma plataforma, não gere insights para ela');
  lines.push('- Sugira ações concretas (ex: "Pause criativos com CPL acima de R$X" não "Otimize seus anúncios")');
  lines.push('- severity "critical" = impacto direto no resultado agora, "warn" = atenção necessária, "info" = oportunidade');
  lines.push('- Se as métricas estiverem boas, gere insights de "info" sugerindo como escalar');

  return lines.join('\n');
}

// POST — run new analysis
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY não configurada no servidor.' }, { status: 500 });
  }

  const data = await req.json() as MetricsPayload;
  if (!data.clientIds?.length) {
    return Response.json({ error: 'Nenhum cliente selecionado.' }, { status: 400 });
  }
  if (!data.meta && !data.google) {
    return Response.json({ error: 'Sem métricas disponíveis para analisar.' }, { status: 400 });
  }

  const clientKey = [...data.clientIds].sort().join(',');
  const prompt = buildPrompt(data);

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    return Response.json({ error: `Erro na API Claude: ${err}` }, { status: 502 });
  }

  const claudeData = await claudeRes.json() as { content: Array<{ type: string; text: string }>; usage?: { input_tokens: number; output_tokens: number } };
  void logAiUsage({ source: 'insights', model: 'claude-haiku-4-5-20251001', inputTokens: claudeData.usage?.input_tokens ?? 0, outputTokens: claudeData.usage?.output_tokens ?? 0 });
  const rawText = claudeData.content?.[0]?.text ?? '[]';

  let insights: Array<{
    metric: string; platform: string; severity: string;
    title: string; suggestion: string;
  }>;
  try {
    const match = rawText.match(/\[[\s\S]*\]/);
    insights = match ? JSON.parse(match[0]) : [];
  } catch {
    return Response.json({ error: 'Resposta inválida da IA.', raw: rawText }, { status: 502 });
  }

  const pool = makeServerPool();
  try {
    await ensureTable(pool);

    // Clear previous 'new' insights for same client+period (keep accepted/dismissed)
    await pool.query(
      `DELETE FROM ai_insights WHERE client_key = $1 AND period = $2 AND status = 'new'`,
      [clientKey, data.period],
    );

    const rows: AiInsight[] = [];
    for (const ins of insights) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO ai_insights (client_key, period, metric, platform, severity, title, suggestion)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [clientKey, data.period, ins.metric, ins.platform, ins.severity, ins.title, ins.suggestion],
      );
      rows.push(row as AiInsight);
    }

    return Response.json(rows, { status: 201 });
  } finally {
    await pool.end();
  }
}

// GET — fetch stored non-dismissed insights
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientIds = searchParams.get('clientIds')?.split(',').filter(Boolean) ?? [];
  const period = searchParams.get('period') ?? '';

  if (!clientIds.length || !period) {
    return Response.json([]);
  }

  const clientKey = [...clientIds].sort().join(',');
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      `SELECT * FROM ai_insights
        WHERE client_key = $1 AND period = $2 AND status != 'dismissed'
        ORDER BY
          CASE severity WHEN 'critical' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END,
          created_at DESC`,
      [clientKey, period],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

// PATCH — update insight status
export async function PATCH(req: NextRequest) {
  const { id, status } = await req.json() as { id: string; status: 'accepted' | 'dismissed' };
  if (!id || !['accepted', 'dismissed'].includes(status)) {
    return Response.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    await pool.query(`UPDATE ai_insights SET status = $1 WHERE id = $2`, [status, id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
