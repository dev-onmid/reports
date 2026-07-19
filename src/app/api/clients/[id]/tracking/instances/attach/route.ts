import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { linkInstanceToClient } from '@/lib/instance-link';
import { webhookOrigin } from '@/lib/evolution-api';

// Attach an existing Disparos instance (by its zapi_clients row id) to THIS client,
// so the same WhatsApp connection feeds this client's CRM/AI.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;
  const { sourceId } = await req.json().catch(() => ({})) as { sourceId?: string };
  if (!sourceId) return Response.json({ error: 'sourceId obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [src] } = await pool.query(
      `SELECT name, instance_id, token, provider FROM public.zapi_clients WHERE id = $1`,
      [sourceId],
    );
    if (!src) return Response.json({ error: 'Instância não encontrada' }, { status: 404 });

    const { rowId } = await linkInstanceToClient(pool, {
      instanceId: src.instance_id,
      token: src.token,
      provider: src.provider === 'evolution' ? 'evolution' : 'zapi',
      nome: src.name,
      clientId,
      appOrigin: webhookOrigin(req.url),
    });

    const { rows: [row] } = await pool.query(
      `SELECT id, nome, instance_id, token, ativo, provider, created_at FROM public.client_zapi_instances WHERE id = $1`,
      [rowId],
    );
    return Response.json(row, { status: 201 });
  } finally {
    await pool.end();
  }
}
