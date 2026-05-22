import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

function randomSlug(len = 6) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT lr.*, c.name AS client_name,
              COUNT(lrc.id)::int AS clicks,
              MAX(lrc.created_at) AS last_click
         FROM public.link_redirects lr
         LEFT JOIN public.clients c ON c.id = lr.client_id
         LEFT JOIN public.link_redirect_clicks lrc ON lrc.redirect_id = lr.id
        ${clientId ? 'WHERE lr.client_id = $1' : ''}
        GROUP BY lr.id, c.name
        ORDER BY lr.created_at DESC`,
      clientId ? [clientId] : [],
    );
    return Response.json(rows);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '42P01') return Response.json([]);
    throw e;
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    clientId?: string;
    name: string;
    slug?: string;
    whatsapp: string;
    message?: string;
  };

  if (!body.name || !body.whatsapp)
    return Response.json({ error: 'name e whatsapp são obrigatórios' }, { status: 400 });

  const slug = (body.slug ?? '').trim() || randomSlug();
  const pool = makeServerPool();
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.link_redirects (client_id, name, slug, whatsapp, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        body.clientId ?? null,
        body.name,
        slug,
        body.whatsapp.replace(/\D/g, ''),
        body.message ?? 'Olá, vim pelo anúncio!',
      ],
    );
    return Response.json(row, { status: 201 });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505') return Response.json({ error: 'Slug já em uso, escolha outro.' }, { status: 409 });
    throw e;
  } finally {
    await pool.end();
  }
}
