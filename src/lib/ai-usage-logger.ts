import { makeServerPool } from '@/lib/server-db';
import { calcCostUsd } from '@/lib/ai-usage-config';

export type AiUsageSource =
  | 'luna_chat'
  | 'report_performance'
  | 'report_delivery'
  | 'report_delivery_csv'
  | 'insights'
  | 'copy'
  | 'whatsapp'
  | 'mindmap'
  | 'crm_analysis'
  | 'crm_attendance_audit'
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
    );
    ALTER TABLE ai_usage_log
      ADD COLUMN IF NOT EXISTS cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;
  `);
}

export async function logAiUsage(opts: {
  source: AiUsageSource | string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  // Tokens servidos/gravados pelo prompt caching (usage.cache_read_input_tokens /
  // usage.cache_creation_input_tokens). input_tokens da API é SÓ o resto não cacheado.
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): Promise<void> {
  const cacheRead = opts.cacheReadTokens ?? 0;
  const cacheWrite = opts.cacheWriteTokens ?? 0;
  const costUsd = calcCostUsd(opts.model, opts.inputTokens, opts.outputTokens, cacheRead, cacheWrite);
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    await pool.query(
      `INSERT INTO ai_usage_log (source, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [opts.source, opts.model, opts.inputTokens, opts.outputTokens, cacheRead, cacheWrite, costUsd],
    );
  } catch (e) {
    console.error('[ai-usage] falha ao registrar uso:', e);
  } finally {
    await pool.end();
  }
}
