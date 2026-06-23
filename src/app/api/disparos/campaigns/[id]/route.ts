import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    const [{ rows: [campaign] }, { rows: numbers }] = await Promise.all([
      pool.query(
        `SELECT c.*, cl.name AS client_name, cl.owner_id FROM public.zapi_campaigns c
           JOIN public.zapi_clients cl ON cl.id = c.client_id WHERE c.id = $1`,
        [id],
      ),
      pool.query(
        `SELECT phone, name, status, sent_at, error_msg FROM public.zapi_numbers WHERE campaign_id = $1 ORDER BY position ASC`,
        [id],
      ),
    ]);
    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });
    if (!scope.unrestricted && campaign.owner_id !== scope.userId) {
      return Response.json({ error: 'Sem permissão para esta campanha' }, { status: 403 });
    }
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
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) {
      const { rows: [owned] } = await pool.query(
        `SELECT 1 FROM public.zapi_campaigns c JOIN public.zapi_clients cl ON cl.id = c.client_id
          WHERE c.id = $1 AND cl.owner_id = $2`,
        [id, scope.userId],
      );
      if (!owned) return Response.json({ error: 'Sem permissão para esta campanha' }, { status: 403 });
    }

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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    await pool.query(
      `DELETE FROM public.zapi_campaigns c USING public.zapi_clients cl
        WHERE c.id = $1 AND cl.id = c.client_id AND ($2::boolean OR cl.owner_id = $3)`,
      [id, scope.unrestricted, scope.userId],
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
