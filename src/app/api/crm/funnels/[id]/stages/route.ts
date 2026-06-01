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
      `SELECT id, label, color, position FROM public.crm_stages WHERE funnel_id = $1 ORDER BY position ASC`,
      [id],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: funnelId } = await params;
  const { label, color = '#71717a', clientId } = await req.json().catch(() => ({})) as {
    label?: string; color?: string; clientId?: string;
  };
  if (!label?.trim() || !clientId) return Response.json({ error: 'label and clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [{ max_pos }] } = await pool.query(
      `SELECT COALESCE(MAX(position), -1)::int AS max_pos FROM public.crm_stages WHERE funnel_id = $1`,
      [funnelId],
    );
    const { rows: [stage] } = await pool.query(
      `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, label, color, position`,
      [funnelId, clientId, label.trim(), color, (max_pos as number) + 1],
    );
    return Response.json(stage, { status: 201 });
  } finally {
    await pool.end();
  }
}
