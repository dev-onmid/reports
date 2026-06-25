import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const { rows: [campaign] } = await pool.query(
      `SELECT c.*,
              COALESCE(
                (SELECT json_agg(r ORDER BY r.date_from)
                   FROM public.leadlovers_schedule_rules r
                  WHERE r.campaign_id = c.id),
                '[]'
              ) AS rules
         FROM public.leadlovers_campaigns c
        WHERE c.id = $1 AND ($2::boolean OR c.owner_id = $3)`,
      [id, scope.unrestricted, scope.userId],
    );
    if (!campaign) return Response.json({ error: 'Não encontrado' }, { status: 404 });
    return Response.json(campaign);
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json() as Partial<{
      name: string; webhook_url: string; machine_code: string;
      email_sequence_code: string; sequence_level_code: string;
      auth_key: string; status: string;
    }>;

    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [];
    let idx = 1;

    if (body.name !== undefined)                { sets.push(`name = $${idx++}`);                vals.push(body.name); }
    if (body.webhook_url !== undefined)         { sets.push(`webhook_url = $${idx++}`);         vals.push(body.webhook_url); }
    if (body.machine_code !== undefined)        { sets.push(`machine_code = $${idx++}`);        vals.push(body.machine_code); }
    if (body.email_sequence_code !== undefined) { sets.push(`email_sequence_code = $${idx++}`); vals.push(body.email_sequence_code); }
    if (body.sequence_level_code !== undefined) { sets.push(`sequence_level_code = $${idx++}`); vals.push(body.sequence_level_code); }
    if (body.auth_key !== undefined)            { sets.push(`auth_key = $${idx++}`);            vals.push(body.auth_key); }
    if (body.status !== undefined)              { sets.push(`status = $${idx++}`);              vals.push(body.status); }

    if (sets.length === 1) return Response.json({ error: 'Nada para atualizar' }, { status: 400 });

    vals.push(id, scope.unrestricted, scope.userId);
    const { rows: [campaign] } = await pool.query(
      `UPDATE public.leadlovers_campaigns SET ${sets.join(', ')}
        WHERE id = $${idx} AND ($${idx + 1}::boolean OR owner_id = $${idx + 2})
       RETURNING *`,
      vals,
    );
    if (!campaign) return Response.json({ error: 'Não encontrado' }, { status: 404 });
    return Response.json(campaign);
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const { rowCount } = await pool.query(
      `DELETE FROM public.leadlovers_campaigns
        WHERE id = $1 AND ($2::boolean OR owner_id = $3)`,
      [id, scope.unrestricted, scope.userId],
    );
    if (!rowCount) return Response.json({ error: 'Não encontrado' }, { status: 404 });
    return Response.json({ deleted: true });
  } finally {
    await pool.end();
  }
}
