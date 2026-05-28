import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> },
) {
  const { id, instanceId } = await params;
  const body = await req.json().catch(() => ({})) as { ativo?: boolean };

  const pool = makeServerPool();
  try {
    await pool.query(
      `UPDATE public.client_zapi_instances
       SET ativo = $1
       WHERE id = $2 AND client_id = $3`,
      [body.ativo ?? true, instanceId, id],
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> },
) {
  const { id, instanceId } = await params;
  const pool = makeServerPool();
  try {
    await pool.query(
      `DELETE FROM public.client_zapi_instances WHERE id = $1 AND client_id = $2`,
      [instanceId, id],
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
