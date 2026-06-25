import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const { rows } = await pool.query(
      `SELECT r.* FROM public.leadlovers_schedule_rules r
         JOIN public.leadlovers_campaigns c ON c.id = r.campaign_id
        WHERE r.campaign_id = $1 AND ($2::boolean OR c.owner_id = $3)
        ORDER BY r.date_from`,
      [id, scope.unrestricted, scope.userId],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    // Verify ownership
    const { rows: [campaign] } = await pool.query(
      `SELECT id FROM public.leadlovers_campaigns WHERE id = $1 AND ($2::boolean OR owner_id = $3)`,
      [id, scope.unrestricted, scope.userId],
    );
    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });

    const body = await req.json() as {
      date_from: string; date_to: string; qty_per_day: number;
      interval_minutes?: number | null; send_time?: string;
    };

    if (!body.date_from || !body.date_to || !body.qty_per_day) {
      return Response.json({ error: 'Campos obrigatórios: date_from, date_to, qty_per_day' }, { status: 400 });
    }

    const { rows: [rule] } = await pool.query(
      `INSERT INTO public.leadlovers_schedule_rules
         (campaign_id, date_from, date_to, qty_per_day, interval_minutes, send_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, body.date_from, body.date_to, body.qty_per_day,
       body.interval_minutes ?? null, body.send_time ?? '09:00'],
    );
    return Response.json(rule, { status: 201 });
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

    const url = new URL(req.url);
    const ruleId = url.searchParams.get('rule_id');
    if (!ruleId) return Response.json({ error: 'rule_id obrigatório' }, { status: 400 });

    const body = await req.json() as Partial<{
      date_from: string; date_to: string; qty_per_day: number;
      interval_minutes: number | null; send_time: string;
    }>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (body.send_time !== undefined)        { sets.push(`send_time = $${idx++}`);        vals.push(body.send_time); }
    if (body.qty_per_day !== undefined)      { sets.push(`qty_per_day = $${idx++}`);      vals.push(body.qty_per_day); }
    if (body.interval_minutes !== undefined) { sets.push(`interval_minutes = $${idx++}`); vals.push(body.interval_minutes); }
    if (body.date_from !== undefined)        { sets.push(`date_from = $${idx++}`);        vals.push(body.date_from); }
    if (body.date_to !== undefined)          { sets.push(`date_to = $${idx++}`);          vals.push(body.date_to); }

    if (sets.length === 0) return Response.json({ error: 'Nada para atualizar' }, { status: 400 });

    vals.push(ruleId, id, scope.unrestricted, scope.userId);
    const { rows: [rule] } = await pool.query(
      `UPDATE public.leadlovers_schedule_rules r
          SET ${sets.join(', ')}
         FROM public.leadlovers_campaigns c
        WHERE r.id = $${idx} AND r.campaign_id = $${idx + 1}
          AND c.id = r.campaign_id AND ($${idx + 2}::boolean OR c.owner_id = $${idx + 3})
       RETURNING r.*`,
      vals,
    );
    if (!rule) return Response.json({ error: 'Regra não encontrada' }, { status: 404 });
    return Response.json(rule);
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

    const url = new URL(req.url);
    const ruleId = url.searchParams.get('rule_id');
    if (!ruleId) return Response.json({ error: 'rule_id obrigatório' }, { status: 400 });

    const { rowCount } = await pool.query(
      `DELETE FROM public.leadlovers_schedule_rules r
        USING public.leadlovers_campaigns c
        WHERE r.id = $1 AND r.campaign_id = $2 AND c.id = r.campaign_id
          AND ($3::boolean OR c.owner_id = $4)`,
      [ruleId, id, scope.unrestricted, scope.userId],
    );
    if (!rowCount) return Response.json({ error: 'Regra não encontrada' }, { status: 404 });
    return Response.json({ deleted: true });
  } finally {
    await pool.end();
  }
}
