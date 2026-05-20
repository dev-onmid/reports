import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.status, a.nodes_json, a.edges_json, a.created_at, t.token
       FROM public.mc_automations a
       LEFT JOIN public.mc_automation_tokens t ON t.automation_id = a.id
       WHERE a.id = $1`,
      [id],
    );
    if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });
    const { rows: contacts } = await pool.query(
      `SELECT id, name, email, whatsapp, instagram_id, current_node_id, status, enrolled_at
       FROM public.mc_automation_contacts WHERE automation_id = $1 ORDER BY enrolled_at DESC LIMIT 100`,
      [id],
    );
    return Response.json({ automation: rows[0], contacts });
  } finally {
    await pool.end();
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json() as { name?: string; nodesJson?: unknown[]; edgesJson?: unknown[]; status?: string };
  const pool = makeServerPool();
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (body.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(body.name); }
    if (body.nodesJson !== undefined) { sets.push(`nodes_json = $${idx++}`); vals.push(JSON.stringify(body.nodesJson)); }
    if (body.edgesJson !== undefined) { sets.push(`edges_json = $${idx++}`); vals.push(JSON.stringify(body.edgesJson)); }
    if (body.status !== undefined) { sets.push(`status = $${idx++}`); vals.push(body.status); }
    if (sets.length === 0) return Response.json({ error: 'Nothing to update' }, { status: 400 });
    vals.push(id);
    await pool.query(`UPDATE public.mc_automations SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.mc_automations WHERE id = $1', [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
