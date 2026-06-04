import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getEvolutionState } from '@/lib/evolution-api';

type InstanceRow = {
  id: string;
  nome: string;
  instance_id: string;
  token: string;
  provider: string;
};

type InstanceResult = {
  id: string;
  nome: string;
  provider: string;
  status: 'connected' | 'disconnected' | 'unknown';
};

async function checkInstance(inst: InstanceRow): Promise<InstanceResult> {
  try {
    if (inst.provider === 'evolution') {
      const state = await getEvolutionState(inst.instance_id);
      return {
        id: inst.id,
        nome: inst.nome,
        provider: inst.provider,
        status: state.state === 'open' ? 'connected' : 'disconnected',
      };
    }

    // Z-API — endpoint de status
    const res = await fetch(
      `https://api.z-api.io/instances/${inst.instance_id}/token/${inst.token}/status`,
      { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return { id: inst.id, nome: inst.nome, provider: inst.provider, status: 'unknown' };
    const data = await res.json() as { connected?: boolean; status?: string; value?: string };
    const connected = data.connected === true
      || data.value === 'CONNECTED'
      || data.status === 'CONNECTED';
    return {
      id: inst.id,
      nome: inst.nome,
      provider: inst.provider,
      status: connected ? 'connected' : 'disconnected',
    };
  } catch {
    return { id: inst.id, nome: inst.nome, provider: inst.provider, status: 'unknown' };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<InstanceRow>(
      `SELECT id, nome, instance_id, token, provider
       FROM public.client_zapi_instances
       WHERE client_id = $1 AND ativo = true
       ORDER BY created_at ASC`,
      [clientId],
    );

    if (rows.length === 0) {
      return Response.json({ status: 'no_instance', instances: [] });
    }

    const results = await Promise.all(rows.map(checkInstance));
    const overallStatus = results.some(r => r.status === 'connected')
      ? 'connected'
      : results.every(r => r.status === 'unknown')
        ? 'unknown'
        : 'disconnected';

    return Response.json({ status: overallStatus, instances: results });
  } finally {
    await pool.end();
  }
}
