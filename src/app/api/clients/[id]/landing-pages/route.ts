import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureLpAnalyticsSchema, generateLpTrackingKey } from '@/lib/lp-analytics';
import { webhookOrigin } from '@/lib/evolution-api';

// ── Radar de LP: CRUD de landing pages do cliente ────────────────────────────

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const pool = makeServerPool();
  try {
    await ensureLpAnalyticsSchema(pool);
    const { rows } = await pool.query(
      `SELECT lp.id, lp.name, lp.url, lp.tracking_key, lp.active, lp.created_at,
              (SELECT COUNT(*)::int FROM public.lp_sessions s
                WHERE s.lp_id = lp.id AND s.created_at > NOW() - INTERVAL '30 days') AS sessions_30d,
              (SELECT MAX(s.created_at) FROM public.lp_sessions s WHERE s.lp_id = lp.id) AS last_session_at
         FROM public.client_landing_pages lp
        WHERE lp.client_id = $1
        ORDER BY lp.created_at DESC`,
      [clientId],
    );
    // base canônica pro snippet (env APP_URL — preview/localhost não re-apontam o script)
    return Response.json({ lps: rows, base: webhookOrigin(req.url) });
  } catch (err) {
    console.error('[landing-pages GET]', err);
    return Response.json({ error: 'Erro ao carregar landing pages' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const body = await req.json().catch(() => ({})) as { name?: string; url?: string };
  const name = String(body.name ?? '').trim();
  const rawUrl = String(body.url ?? '').trim();
  if (!name || !rawUrl) return Response.json({ error: 'Nome e URL são obrigatórios' }, { status: 400 });

  let url: URL;
  try {
    url = new URL(rawUrl.match(/^https?:\/\//i) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return Response.json({ error: 'URL inválida' }, { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol)) return Response.json({ error: 'URL inválida' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureLpAnalyticsSchema(pool);
    // tracking_key UNIQUE — colisão (49 bits) é raríssima, mas re-tenta 3x
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { rows: [row] } = await pool.query(
          `INSERT INTO public.client_landing_pages (client_id, name, url, tracking_key)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [clientId, name.slice(0, 120), url.toString().slice(0, 500), generateLpTrackingKey()],
        );
        return Response.json(row, { status: 201 });
      } catch (err) {
        if ((err as { code?: string })?.code !== '23505') throw err;
      }
    }
    return Response.json({ error: 'Falha ao gerar chave única' }, { status: 500 });
  } catch (err) {
    console.error('[landing-pages POST]', err);
    return Response.json({ error: 'Erro ao criar landing page' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const lpId = req.nextUrl.searchParams.get('lpId');
  if (!lpId) return Response.json({ error: 'Missing lpId' }, { status: 400 });

  const pool = makeServerPool();
  try {
    // Sessões caem junto pelo ON DELETE CASCADE
    await pool.query(
      `DELETE FROM public.client_landing_pages WHERE id = $1 AND client_id = $2`,
      [lpId, clientId],
    );
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[landing-pages DELETE]', err);
    return Response.json({ error: 'Erro ao excluir landing page' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
