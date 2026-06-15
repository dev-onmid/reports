import { makeServerPool } from '@/lib/server-db';
import { calcCostUsd } from '@/lib/ai-usage-config';

export type AiUsageSource =
  | 'luna_chat'
  | 'report_performance'
  | 'report_delivery'
  | 'insights'
  | 'copy'
  | 'whatsapp'
  | 'mindmap'
  | 'crm_analysis'
  | 'other';

// Re-export for server-side convenience
export { calcCostUsd, estimateCostUsd, estimateCostBrl, ESTIMATES, USD_TO_BRL } from '@/lib/ai-usage-config';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
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
}

export async function logAiUsage(opts: {
  source: AiUsageSource | string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const costUsd = calcCostUsd(opts.model, opts.inputTokens, opts.outputTokens);
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    await pool.query(
      `INSERT INTO ai_usage_log (source, model, input_tokens, output_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5)`,
      [opts.source, opts.model, opts.inputTokens, opts.outputTokens, costUsd],
    );
  } catch (e) {
    console.error('[ai-usage] falha ao registrar uso:', e);
  } finally {
    await pool.end();
  }
}
