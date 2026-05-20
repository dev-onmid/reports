import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows: steps } = await pool.query(
      `SELECT id, position, subject, body_html, delay_days FROM public.email_flow_steps
       WHERE flow_id=$1 ORDER BY position ASC`,
      [id],
    );
    const { rows: contacts } = await pool.query(
      `SELECT id, email, name, current_step, next_send_at, status, enrolled_at
       FROM public.email_flow_contacts WHERE flow_id=$1 ORDER BY enrolled_at DESC LIMIT 200`,
      [id],
    );
    return Response.json({ steps, contacts });
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
        `INSERT INTO public.email_flow_contacts (flow_id, email, name, next_send_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT DO NOTHING`,
        [id, c.email, c.name ?? null],
      );
    }
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
