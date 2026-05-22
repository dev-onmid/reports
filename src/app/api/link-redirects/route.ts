import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

function randomSlug(len = 6) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.link_redirects (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL UNIQUE,
      whatsapp    TEXT NOT NULL,
      message     TEXT NOT NULL DEFAULT 'Olá, vim pelo anúncio!',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.link_redirect_clicks (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      redirect_id UUID REFERENCES public.link_redirects(id) ON DELETE CASCADE,
      utm_source  TEXT,
      utm_medium  TEXT,
      utm_campaign TEXT,
      utm_content TEXT,
      utm_term    TEXT,
      ip          TEXT,
      user_agent  TEXT,
      referer     TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
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
    await ensureTables(pool);
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
