import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows: flowRows } = await pool.query(
      `SELECT id, account_email, name, status, flow_mode, nodes_json, edges_json
       FROM public.email_flows WHERE id=$1`,
      [id],
    );
    const { rows: steps } = await pool.query(
      `SELECT id, position, subject, body_html, delay_days FROM public.email_flow_steps
       WHERE flow_id=$1 ORDER BY position ASC`,
      [id],
    );
    const { rows: contacts } = await pool.query(
      `SELECT id, email, name, current_step, current_node_id, next_send_at, status, enrolled_at
       FROM public.email_flow_contacts WHERE flow_id=$1 ORDER BY enrolled_at DESC LIMIT 200`,
      [id],
    );
    return Response.json({ flow: flowRows[0] ?? null, steps, contacts });
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json() as { contacts: Array<{ email: string; name?: string }> };
  const pool = makeServerPool();
  try {
    for (const c of body.contacts) {
      await pool.query(
        `INSERT INTO public.email_flow_contacts (flow_id, email, name, current_node_id, next_send_at)
         VALUES ($1,$2,$3,'start',NOW())
         ON CONFLICT DO NOTHING`,
        [id, c.email, c.name ?? null],
      );
    }
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json() as { nodesJson: unknown[]; edgesJson: unknown[] };
  const pool = makeServerPool();
  try {
    await pool.query(
      `UPDATE public.email_flows
       SET nodes_json=$1::jsonb, edges_json=$2::jsonb, flow_mode='graph'
       WHERE id=$3`,
      [JSON.stringify(body.nodesJson), JSON.stringify(body.edgesJson), id],
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
