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
      `SELECT utm_source, utm_medium, utm_campaign, utm_content, utm_term,
              COUNT(*)::int AS clicks
         FROM public.link_redirect_clicks
        WHERE redirect_id = $1
        GROUP BY utm_source, utm_medium, utm_campaign, utm_content, utm_term
        ORDER BY clicks DESC
        LIMIT 100`,
      [id],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as { name?: string; whatsapp?: string; message?: string; slug?: string };
  const pool = makeServerPool();
  try {
    const { rows: [row] } = await pool.query(
      `UPDATE public.link_redirects
          SET name    = COALESCE($2, name),
              whatsapp = COALESCE($3, whatsapp),
              message  = COALESCE($4, message),
              slug     = COALESCE($5, slug)
        WHERE id = $1
        RETURNING *`,
      [id, body.name ?? null, body.whatsapp?.replace(/\D/g, '') ?? null, body.message ?? null, body.slug ?? null],
    );
    return Response.json(row ?? { error: 'Não encontrado' });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505') return Response.json({ error: 'Slug já em uso.' }, { status: 409 });
    throw e;
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
    await pool.query(`DELETE FROM public.link_redirects WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
