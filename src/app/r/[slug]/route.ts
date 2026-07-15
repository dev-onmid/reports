import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureLeadTrackingSchema, generateClickCode, geoFromHeaders } from '@/lib/lead-tracking';

export const dynamic = 'force-dynamic';

// Parâmetros com coluna própria em link_redirect_clicks. Qualquer outro
// parâmetro da URL vai para extra_params (JSONB) — nada se perde.
const KNOWN_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'wbraid', 'gbraid', 'fbclid', 'ttclid', 'msclkid',
  'keyword', 'matchtype', 'device', 'network', 'placement', 'loc',
]);

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
        client_id   TEXT,
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
    await ensureLeadTrackingSchema(pool);

    const { rows: [link] } = await pool.query(
      `SELECT id, whatsapp, message FROM public.link_redirects WHERE slug = $1`,
      [slug],
    );

    if (!link) {
      await pool.end().catch(() => null);
      return new Response('Link não encontrado', { status: 404 });
    }

    // Extras: qualquer parâmetro sem coluna própria (macros custom, ids crus…)
    const extras: Record<string, string> = {};
    for (const [key, value] of sp.entries()) {
      if (!KNOWN_PARAMS.has(key) && value) extras[key] = value;
    }

    // Geo do clique via headers da Vercel (sem API externa)
    const geo = geoFromHeaders(req.headers);

    // Código curto que liga este clique ao lead quando ele mandar a mensagem.
    // Vai embutido no texto do WhatsApp; o webhook casa o código com esta linha.
    const clickCode = generateClickCode();

    // Log click (fire and forget pattern — don't block redirect)
    pool.query(
      `INSERT INTO public.link_redirect_clicks
        (redirect_id, click_code, url,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term,
         gclid, wbraid, gbraid, fbclid, ttclid, msclkid,
         keyword, matchtype, device, network, placement, loc_physical,
         geo_country, geo_region, geo_city, extra_params,
         ip, user_agent, referer)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [
        link.id as string,
        clickCode,
        req.nextUrl.toString(),
        sp.get('utm_source'),
        sp.get('utm_medium'),
        sp.get('utm_campaign'),
        sp.get('utm_content'),
        sp.get('utm_term'),
        sp.get('gclid'),
        sp.get('wbraid'),
        sp.get('gbraid'),
        sp.get('fbclid'),
        sp.get('ttclid'),
        sp.get('msclkid'),
        sp.get('keyword'),
        sp.get('matchtype'),
        sp.get('device'),
        sp.get('network'),
        sp.get('placement'),
        sp.get('loc'),
        geo.country,
        geo.region,
        geo.city,
        Object.keys(extras).length > 0 ? JSON.stringify(extras) : null,
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        req.headers.get('user-agent'),
        req.headers.get('referer'),
      ],
    ).catch(() => null).finally(() => pool.end());

    const waNumber = (link.whatsapp as string).replace(/\D/g, '');
    // O código substitui a URL crua de antes: mais curto, menos "spam" e a
    // atribuição completa fica gravada server-side no clique — mesmo que o lead
    // edite o resto da mensagem, basta a linha do código sobreviver.
    const messageWithTracking = `${link.message as string}\n\nCód: ${clickCode}`;
    const waText = encodeURIComponent(messageWithTracking);
    const waUrl = `https://wa.me/${waNumber}?text=${waText}`;

    // Client-side JS redirect so crawlers (that don't run JS) see a real HTML page
    // while real users are taken directly to WhatsApp.
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Redirecionando...</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:420px;width:90%}
    p{color:#374151;font-size:1rem;margin-bottom:24px}
    .spinner{width:40px;height:40px;border:3px solid #e5e7eb;border-top-color:#25D366;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="card">
    <p>Estamos te redirecionando para o contato</p>
    <div class="spinner"></div>
  </div>
  <script>window.location.href=${JSON.stringify(waUrl)};</script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch {
    await pool.end();
    return new Response('Erro interno', { status: 500 });
  }
}
