import { makeServerPool } from '@/lib/server-db';
import { USD_TO_BRL } from '@/lib/ai-usage-logger';

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

    const costUsd = parseFloat(month.cost_usd);

    return Response.json({
      month: {
        calls:         parseInt(month.calls),
        input_tokens:  parseInt(month.input_tokens),
        output_tokens: parseInt(month.output_tokens),
        cost_usd:      costUsd,
        cost_brl:      costUsd * USD_TO_BRL,
      } satisfies AiUsageMonth,
      by_source: bySource.map(r => ({
        source:    r.source,
        calls:     parseInt(r.calls),
        cost_usd:  parseFloat(r.cost_usd),
        cost_brl:  parseFloat(r.cost_usd) * USD_TO_BRL,
      })) satisfies AiUsageBySource[],
    });
  } finally {
    await pool.end();
  }
}
