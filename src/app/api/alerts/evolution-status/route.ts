import { fetchDisconnectedInstances, filterMutedInstances } from '@/lib/evolution-instance-alerts';
import { makeServerPool } from '@/lib/server-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const disconnected = await fetchDisconnectedInstances();
    // Instâncias desativadas de propósito (Configurações → Instâncias) não alertam.
    const pool = makeServerPool();
    try {
      const visible = await filterMutedInstances(pool, disconnected);
      return Response.json({ ok: true, disconnected: visible });
    } finally {
      await pool.end();
    }
  } catch (err) {
    return Response.json({ ok: false, error: String(err), disconnected: [] });
  }
}
