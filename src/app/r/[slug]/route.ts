import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const sp = req.nextUrl.searchParams;

  const pool = makeServerPool();
  try {
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

    const { rows: [link] } = await pool.query(
      `SELECT id, whatsapp, message FROM public.link_redirects WHERE slug = $1`,
      [slug],
    );

    if (!link) {
      return new Response('Link não encontrado', { status: 404 });
    }

    // Log click (fire and forget pattern — don't block redirect)
    pool.query(
      `INSERT INTO public.link_redirect_clicks
        (redirect_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ip, user_agent, referer)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        link.id as string,
        sp.get('utm_source'),
        sp.get('utm_medium'),
        sp.get('utm_campaign'),
        sp.get('utm_content'),
        sp.get('utm_term'),
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        req.headers.get('user-agent'),
        req.headers.get('referer'),
      ],
    ).catch(() => null).finally(() => pool.end());

    const waNumber = (link.whatsapp as string).replace(/\D/g, '');
    const waText = encodeURIComponent(link.message as string);
    const waUrl = `https://wa.me/${waNumber}?text=${waText}`;

    return Response.redirect(waUrl, 302);
  } catch {
    await pool.end();
    return new Response('Erro interno', { status: 500 });
  }
}
