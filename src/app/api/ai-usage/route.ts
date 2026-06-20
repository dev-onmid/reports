import { makeServerPool } from '@/lib/server-db';
import { USD_TO_BRL } from '@/lib/ai-usage-logger';
import { getAiBillingSettings, type AiBillingSettings } from '@/lib/ai-billing-settings';

export type AiUsageMonth = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cost_brl: number;
};

export type AiUsageBySource = {
  source: string;
  calls: number;
  cost_usd: number;
  cost_brl: number;
};

export type AiUsageBilling = {
  credit_brl: number;
  credit_usd: number;
  used_brl: number;
  used_usd: number;
  balance_brl: number;
  balance_usd: number;
  used_pct: number;
} | null;

export type AiUsageProvider = {
  provider: 'openai' | 'claude';
  label: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cost_brl: number;
  credit_usd: number;
  credit_brl: number;
  balance_usd: number;
  balance_brl: number;
  used_pct: number;
};

function providerFromModel(model: string): 'openai' | 'claude' {
  return model.toLowerCase().includes('claude') ? 'claude' : 'openai';
}

function buildBilling(creditUsd: number, usedUsd: number): AiUsageBilling {
  if (!creditUsd || creditUsd <= 0) return null;
  return {
    credit_usd: creditUsd,
    credit_brl: creditUsd * USD_TO_BRL,
    used_usd: usedUsd,
    used_brl: usedUsd * USD_TO_BRL,
    balance_usd: Math.max(creditUsd - usedUsd, 0),
    balance_brl: Math.max(creditUsd - usedUsd, 0) * USD_TO_BRL,
    used_pct: Math.min((usedUsd / creditUsd) * 100, 100),
  };
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_usage_log (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source        TEXT NOT NULL,
        model         TEXT NOT NULL,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd      NUMERIC(12,8) NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const { rows: [month] } = await pool.query<{
      calls: string; input_tokens: string; output_tokens: string; cost_usd: string;
    }>(`
      SELECT
        COUNT(*)                           AS calls,
        COALESCE(SUM(input_tokens),  0)    AS input_tokens,
        COALESCE(SUM(output_tokens), 0)    AS output_tokens,
        COALESCE(SUM(cost_usd),      0)    AS cost_usd
      FROM ai_usage_log
      WHERE created_at >= date_trunc('month', NOW())
    `);

    const { rows: bySource } = await pool.query<{
      source: string; calls: string; cost_usd: string;
    }>(`
      SELECT
        source,
        COUNT(*)                        AS calls,
        COALESCE(SUM(cost_usd), 0)      AS cost_usd
      FROM ai_usage_log
      WHERE created_at >= date_trunc('month', NOW())
      GROUP BY source
      ORDER BY cost_usd DESC
    `);

    const { rows: byProviderRows } = await pool.query<{
      model: string; calls: string; cost_usd: string; input_tokens: string; output_tokens: string;
    }>(`
      SELECT
        model,
        COUNT(*) AS calls,
        COALESCE(SUM(cost_usd), 0) AS cost_usd,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens
      FROM ai_usage_log
      WHERE created_at >= date_trunc('month', NOW())
      GROUP BY model
    `);

    const costUsd = parseFloat(month.cost_usd);
    const costBrl = costUsd * USD_TO_BRL;
    const settings: AiBillingSettings = await getAiBillingSettings(pool);
    const providerTotals = {
      openai: { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 },
      claude: { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 },
    };
    byProviderRows.forEach(row => {
      const provider = providerFromModel(row.model);
      providerTotals[provider].calls += parseInt(row.calls);
      providerTotals[provider].cost_usd += parseFloat(row.cost_usd);
      providerTotals[provider].input_tokens += parseInt(row.input_tokens);
      providerTotals[provider].output_tokens += parseInt(row.output_tokens);
    });
    const providers: AiUsageProvider[] = [
      {
        provider: 'claude',
        label: 'Claude',
        calls: providerTotals.claude.calls,
        input_tokens: providerTotals.claude.input_tokens,
        output_tokens: providerTotals.claude.output_tokens,
        cost_usd: providerTotals.claude.cost_usd,
        cost_brl: providerTotals.claude.cost_usd * USD_TO_BRL,
        credit_usd: settings.claude_credit_usd,
        credit_brl: settings.claude_credit_usd * USD_TO_BRL,
        balance_usd: Math.max(settings.claude_credit_usd - providerTotals.claude.cost_usd, 0),
        balance_brl: Math.max(settings.claude_credit_usd - providerTotals.claude.cost_usd, 0) * USD_TO_BRL,
        used_pct: settings.claude_credit_usd > 0 ? Math.min((providerTotals.claude.cost_usd / settings.claude_credit_usd) * 100, 100) : 0,
      },
      {
        provider: 'openai',
        label: 'OpenAI',
        calls: providerTotals.openai.calls,
        input_tokens: providerTotals.openai.input_tokens,
        output_tokens: providerTotals.openai.output_tokens,
        cost_usd: providerTotals.openai.cost_usd,
        cost_brl: providerTotals.openai.cost_usd * USD_TO_BRL,
        credit_usd: settings.openai_credit_usd,
        credit_brl: settings.openai_credit_usd * USD_TO_BRL,
        balance_usd: Math.max(settings.openai_credit_usd - providerTotals.openai.cost_usd, 0),
        balance_brl: Math.max(settings.openai_credit_usd - providerTotals.openai.cost_usd, 0) * USD_TO_BRL,
        used_pct: settings.openai_credit_usd > 0 ? Math.min((providerTotals.openai.cost_usd / settings.openai_credit_usd) * 100, 100) : 0,
      },
    ];
    const totalCreditUsd = settings.openai_credit_usd + settings.claude_credit_usd;
    const billing = buildBilling(totalCreditUsd, costUsd);

    return Response.json({
      month: {
        calls:         parseInt(month.calls),
        input_tokens:  parseInt(month.input_tokens),
        output_tokens: parseInt(month.output_tokens),
        cost_usd:      costUsd,
        cost_brl:      costBrl,
      } satisfies AiUsageMonth,
      by_source: bySource.map(r => ({
        source:    r.source,
        calls:     parseInt(r.calls),
        cost_usd:  parseFloat(r.cost_usd),
        cost_brl:  parseFloat(r.cost_usd) * USD_TO_BRL,
      })) satisfies AiUsageBySource[],
      billing,
      providers,
      settings,
    });
  } finally {
    await pool.end();
  }
}
