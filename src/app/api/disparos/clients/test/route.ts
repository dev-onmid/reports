import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function POST(request: NextRequest) {
  const { clientId } = await request.json() as { clientId: string };
  if (!clientId) return Response.json({ error: 'clientId obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [client] } = await pool.query(
      `SELECT instance_id, token FROM public.zapi_clients WHERE id = $1`,
      [clientId],
    );
    if (!client) return Response.json({ error: 'Instância não encontrada' }, { status: 404 });

    const res = await fetch(
      `https://api.z-api.io/instances/${client.instance_id}/token/${client.token}/status`,
      { headers: { 'Cache-Control': 'no-cache' } },
    );

    if (!res.ok) {
      return Response.json({ connected: false, error: `HTTP ${res.status}` });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const connected = data?.connected === true || data?.status === 'connected' || data?.value === 'CONNECTED';

    return Response.json({ connected, raw: data });
  } catch (err) {
    return Response.json({ connected: false, error: String(err) });
  } finally {
    await pool.end();
  }
}
