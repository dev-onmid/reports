import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { checkEvolutionStatus } from '@/lib/evolution-api';

export async function POST(request: NextRequest) {
  const { clientId } = await request.json() as { clientId: string };
  if (!clientId) return Response.json({ error: 'clientId obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [client] } = await pool.query(
      `SELECT instance_id, token, security_token, provider FROM public.zapi_clients WHERE id = $1`,
      [clientId],
    );
    if (!client) return Response.json({ error: 'Instância não encontrada' }, { status: 404 });

    if (client.provider === 'evolution') {
      const connected = await checkEvolutionStatus(client.instance_id);
      return Response.json({ connected });
    }

    const url = `https://api.z-api.io/instances/${client.instance_id}/token/${client.token}/status`;

    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
    };
    if (client.security_token) headers['Client-Token'] = client.security_token;

    const res = await fetch(url, { headers });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON response */ }

    if (!res.ok) {
      const zapiMsg = body?.message ?? body?.error ?? body?.value ?? JSON.stringify(body);
      return Response.json({
        connected: false,
        error: `Z-API retornou ${res.status}: ${zapiMsg}`,
        debug: { url: url.replace(client.token, '***'), body },
      });
    }

    const connected =
      body?.connected === true ||
      body?.status === 'connected' ||
      body?.value === 'CONNECTED' ||
      body?.smartphoneConnected === true;

    return Response.json({ connected, raw: body });
  } catch (err) {
    return Response.json({ connected: false, error: String(err) });
  } finally {
    await pool.end();
  }
}
