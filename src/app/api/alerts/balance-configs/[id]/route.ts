import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json() as { whatsappGroup?: string; zapiClientId?: string; active?: boolean };
  const pool = makeServerPool();
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (body.whatsappGroup !== undefined) { sets.push(`whatsapp_group = $${idx++}`); vals.push(body.whatsappGroup); }
    if (body.zapiClientId !== undefined)  { sets.push(`zapi_client_id = $${idx++}`); vals.push(body.zapiClientId); }
    if (body.active !== undefined)        { sets.push(`active = $${idx++}`);         vals.push(body.active); }
    if (sets.length === 0) return Response.json({ error: 'nothing to update' }, { status: 400 });
    vals.push(id);
    await pool.query(`UPDATE public.balance_alert_configs SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.balance_alert_configs WHERE id = $1', [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
