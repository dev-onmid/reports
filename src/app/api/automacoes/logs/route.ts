import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, token, config_name, event_type, payload, status, result, error_msg, received_at
       FROM public.webhook_logs
       ORDER BY received_at DESC
       LIMIT 100`,
    );
    return Response.json(rows);
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
