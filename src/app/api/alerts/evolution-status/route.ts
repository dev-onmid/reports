import {
  fetchDisconnectedInstances, fetchDisconnectedZapiInstances, filterMutedInstances,
  type DisconnectedAlert,
} from '@/lib/evolution-instance-alerts';
import { makeServerPool } from '@/lib/server-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pool = makeServerPool();
  try {
    // Cada fonte é isolada: a Evolution (VPS) fora do ar não pode esconder um
    // alerta de Z-API caído, e vice-versa.
    let evolution: DisconnectedAlert[] = [];
    try {
      evolution = await filterMutedInstances(pool, await fetchDisconnectedInstances());
    } catch { /* Evolution API indisponível — segue só com Z-API */ }

    let zapi: DisconnectedAlert[] = [];
    try {
      zapi = await fetchDisconnectedZapiInstances(pool);
    } catch { /* Z-API indisponível — segue só com Evolution */ }

    return Response.json({ ok: true, disconnected: [...evolution, ...zapi] });
  } catch (err) {
    return Response.json({ ok: false, error: String(err), disconnected: [] });
  } finally {
    await pool.end();
  }
}
