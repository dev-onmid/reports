import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const [{ rows: [campaign] }, { rows: numbers }] = await Promise.all([
      pool.query(
        `SELECT c.*, cl.name AS client_name FROM public.zapi_campaigns c
           JOIN public.zapi_clients cl ON cl.id = c.client_id WHERE c.id = $1`,
        [id],
      ),
      pool.query(
        `SELECT phone, name, status, sent_at, error_msg FROM public.zapi_numbers WHERE campaign_id = $1 ORDER BY position ASC`,
        [id],
      ),
    ]);
    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });
    return Response.json({ ...campaign, numbers });
  } finally {
    await pool.end();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const body = await request.json() as Record<string, unknown>;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    const str  = (k: string) => { if (body[k] !== undefined) { sets.push(`${k} = $${i++}`); vals.push(body[k] ?? null); } };
    const num  = (k: string) => { if (body[k] !== undefined) { sets.push(`${k} = $${i++}`); vals.push(body[k]); } };

    str('name'); str('message'); str('image_url');
    str('active_from'); str('active_until'); str('ends_at');
    num('interval_min'); num('interval_max');

    if (body.messages !== undefined) {
      sets.push(`messages = $${i++}`);
      vals.push(body.messages ? JSON.stringify(body.messages) : null);
    }

    if (!sets.length) return Response.json({ ok: true });
    vals.push(id);
    await pool.query(`UPDATE public.zapi_campaigns SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await pool.query(`DELETE FROM public.zapi_campaigns WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
