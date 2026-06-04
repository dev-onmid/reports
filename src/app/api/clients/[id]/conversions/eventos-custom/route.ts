import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureConversionSchema } from '@/lib/conversions';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureConversionSchema(pool);
    const { rows } = await pool.query(
      `SELECT id, status_gatilho, meta_event_name, google_conversion_label, ativo
         FROM public.client_conversion_eventos_custom
        WHERE client_id = $1
        ORDER BY created_at ASC`,
      [id],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as {
    status_gatilho: string;
    meta_event_name?: string | null;
    google_conversion_label?: string | null;
    ativo?: boolean;
  };
  const pool = makeServerPool();
  try {
    await ensureConversionSchema(pool);
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.client_conversion_eventos_custom
         (client_id, status_gatilho, meta_event_name, google_conversion_label, ativo)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_id, status_gatilho) DO UPDATE SET
         meta_event_name = EXCLUDED.meta_event_name,
         google_conversion_label = EXCLUDED.google_conversion_label,
         ativo = EXCLUDED.ativo
       RETURNING *`,
      [id, body.status_gatilho, body.meta_event_name ?? null, body.google_conversion_label ?? null, body.ativo ?? true],
    );
    return Response.json(row);
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const eventoId = url.searchParams.get('eventoId');
  if (!eventoId) return Response.json({ error: 'eventoId required' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await pool.query(
      `DELETE FROM public.client_conversion_eventos_custom WHERE id = $1 AND client_id = $2`,
      [eventoId, id],
    );
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
