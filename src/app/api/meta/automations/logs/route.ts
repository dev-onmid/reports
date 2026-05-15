import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT l.*, a.trigger_type, a.keyword, a.account_name
       FROM public.meta_automation_logs l
       LEFT JOIN public.meta_automations a ON a.id = l.automation_id
       ORDER BY l.triggered_at DESC
       LIMIT 100`
    );
    return Response.json(rows);
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
