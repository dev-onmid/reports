import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

// Leads guardam a etapa como TEXTO em crm_leads.status (não por stage_id). Por isso,
// renomear/excluir uma etapa PRECISA migrar o status dos leads junto — senão eles
// viram "órfãos" e o Kanban (que agrupa por rótulo) os esconde silenciosamente.

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { label, color, position } = await req.json().catch(() => ({})) as {
    label?: string; color?: string; position?: number;
  };

  const pool = makeServerPool();
  try {
    // Estado atual ANTES do update — precisamos do rótulo antigo pra migrar os leads
    const { rows: [before] } = await pool.query<{ label: string; funnel_id: string; client_id: string }>(
      `SELECT label, funnel_id, client_id FROM public.crm_stages WHERE id = $1`,
      [id],
    );
    if (!before) return Response.json({ error: 'not found' }, { status: 404 });

    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (label !== undefined) { sets.push(`label = $${n++}`); vals.push(label.trim()); }
    if (color !== undefined) { sets.push(`color = $${n++}`); vals.push(color); }
    if (position !== undefined) { sets.push(`position = $${n++}`); vals.push(position); }
    if (sets.length === 0) return Response.json({ error: 'nothing to update' }, { status: 400 });

    vals.push(id);
    const { rows: [stage] } = await pool.query(
      `UPDATE public.crm_stages SET ${sets.join(', ')} WHERE id = $${n} RETURNING id, label, color, position`,
      vals,
    );
    if (!stage) return Response.json({ error: 'not found' }, { status: 404 });

    // Migra os leads da coluna renomeada pro novo rótulo (mesmo funil)
    const newLabel = label?.trim();
    if (newLabel && newLabel !== before.label) {
      await pool.query(
        `UPDATE public.crm_leads
            SET status = $1, updated_at = NOW()
          WHERE funnel_id = $2 AND status = $3`,
        [newLabel, before.funnel_id, before.label],
      ).catch(err => console.error('[crm stages] migrate leads on rename', err));
    }

    return Response.json(stage);
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
    const { rows: [stage] } = await pool.query<{ label: string; funnel_id: string }>(
      `SELECT label, funnel_id FROM public.crm_stages WHERE id = $1`,
      [id],
    );
    await pool.query(`DELETE FROM public.crm_stages WHERE id = $1`, [id]);

    // Move os leads da etapa excluída pra primeira etapa restante do funil —
    // sem isso eles ficam com um status que não existe mais e somem do board.
    if (stage) {
      const { rows: [fallback] } = await pool.query<{ label: string }>(
        `SELECT label FROM public.crm_stages
          WHERE funnel_id = $1
          ORDER BY position ASC, created_at ASC
          LIMIT 1`,
        [stage.funnel_id],
      );
      if (fallback?.label && fallback.label !== stage.label) {
        await pool.query(
          `UPDATE public.crm_leads
              SET status = $1, updated_at = NOW()
            WHERE funnel_id = $2 AND status = $3`,
          [fallback.label, stage.funnel_id, stage.label],
        ).catch(err => console.error('[crm stages] migrate leads on delete', err));
      }
    }

    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
