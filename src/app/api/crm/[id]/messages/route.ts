import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, direction, text, created_at
       FROM public.crm_messages
       WHERE lead_id = $1
       ORDER BY created_at ASC
       LIMIT 200`,
      [id],
    );
    return Response.json({ messages: rows });
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { text, direction = 'out' } = await req.json().catch(() => ({})) as { text?: string; direction?: string };
  if (!text?.trim()) return Response.json({ error: 'text required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [lead] } = await pool.query(
      `SELECT client_id FROM public.crm_leads WHERE id = $1`,
      [id],
    );
    if (!lead) return Response.json({ error: 'lead not found' }, { status: 404 });

    const { rows: [msg] } = await pool.query(
      `INSERT INTO public.crm_messages (lead_id, client_id, direction, text)
       VALUES ($1, $2, $3, $4) RETURNING id, direction, text, created_at`,
      [id, lead.client_id, direction, text.trim()],
    );
    await pool.query(`UPDATE public.crm_leads SET updated_at = NOW() WHERE id = $1`, [id]);
    return Response.json(msg, { status: 201 });
  } finally {
    await pool.end();
  }
}
