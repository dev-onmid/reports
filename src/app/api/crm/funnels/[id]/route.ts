import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { name, clientId } = await req.json().catch(() => ({})) as { name?: string; clientId?: string };
  if (!name?.trim() || !clientId) return Response.json({ error: 'name and clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [funnel] } = await pool.query(
      `UPDATE public.crm_funnels SET name = $1 WHERE id = $2 AND client_id = $3 RETURNING id, name, created_at`,
      [name.trim(), id, clientId],
    );
    if (!funnel) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json(funnel);
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows: [funnel] } = await pool.query(
      `SELECT client_id FROM public.crm_funnels WHERE id = $1`,
      [id],
    );
    if (!funnel) return Response.json({ error: 'not found' }, { status: 404 });

    const { rows: remaining } = await pool.query(
      `SELECT id FROM public.crm_funnels WHERE client_id = $1`,
      [funnel.client_id],
    );
    if (remaining.length <= 1) {
      return Response.json({ error: 'Não é possível excluir o único funil' }, { status: 400 });
    }

    // Move leads to the first remaining funnel before deletion
    const nextFunnelId = remaining.find(r => r.id !== id)?.id;
    if (nextFunnelId) {
      await pool.query(
        `UPDATE public.crm_leads SET funnel_id = $1 WHERE funnel_id = $2`,
        [nextFunnelId, id],
      );
    }

    await pool.query(`DELETE FROM public.crm_funnels WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
