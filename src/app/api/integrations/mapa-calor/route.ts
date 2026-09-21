// ── /api/integrations/mapa-calor ──────────────────────────────────────────────
// Máquina→máquina (header x-onmid-secret = MAKE_INTEGRATION_SECRET, mesmo
// contrato das outras /api/integrations/*). Consumidor: ~/Documents/lps/bin/gtag
// calor — o rastreio padrão das LPs passou a incluir o Mapa de Calor do reports
// (aba Integrações → Mapa de Calor) e a página é criada sem ninguém clicar em
// "Nova página".
//
//   GET  ?cliente=<id ou nome>                 → páginas do cliente com a chave
//   POST { cliente, url, nome? }               → cria a página; IDEMPOTENTE pelo
//        host da URL (www. ignorado): se o cliente já tem página no mesmo site,
//        devolve a existente com criada:false. O tag.js coleta o path de cada
//        visita, então UMA página por domínio cobre todas as rotas da LP.
//
// Devolve também o snippet pronto (`<script src=".../api/lp/tag.js?k=..." defer>`).

import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureLpAnalyticsSchema, generateLpTrackingKey } from '@/lib/lp-analytics';
import { resolverCliente } from '@/lib/google-conversion-actions';
import { webhookOrigin } from '@/lib/evolution-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function autoriza(req: NextRequest): Response | null {
  const esperado = process.env.MAKE_INTEGRATION_SECRET;
  if (!esperado) return Response.json({ erro: 'integracao_nao_configurada' }, { status: 503 });
  const a = Buffer.from(req.headers.get('x-onmid-secret') ?? '');
  const b = Buffer.from(esperado);
  if (!(a.length === b.length && timingSafeEqual(a, b))) return Response.json({ erro: 'nao_autorizado' }, { status: 401 });
  return null;
}

/** "https://WWW.Site.com.br/x?y" → "site.com.br" */
export function hostDe(u: string): string {
  try { return new URL(u.match(/^https?:\/\//i) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

type Pagina = { id: string; name: string; url: string; tracking_key: string; active: boolean; created_at: string };

function comSnippet(base: string, p: Pagina) {
  return { ...p, snippet: `<script src="${base}/api/lp/tag.js?k=${p.tracking_key}" defer></script>`, tag_url: `${base}/api/lp/tag.js?k=${p.tracking_key}` };
}

async function cliente(pool: ReturnType<typeof makeServerPool>, ref: string) {
  const c = await resolverCliente(pool, ref);
  if (c.length === 0) return { erro: Response.json({ erro: 'cliente_nao_encontrado', cliente: ref }, { status: 404 }) };
  if (c.length > 1) return { erro: Response.json({ erro: 'cliente_ambiguo', candidatos: c }, { status: 409 }) };
  return { cliente: c[0] };
}

export async function GET(req: NextRequest) {
  const neg = autoriza(req); if (neg) return neg;
  const ref = req.nextUrl.searchParams.get('cliente') ?? '';
  if (!ref.trim()) return Response.json({ erro: 'cliente_obrigatorio' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureLpAnalyticsSchema(pool);
    const r = await cliente(pool, ref); if ('erro' in r) return r.erro;
    const { rows } = await pool.query<Pagina>(
      `SELECT id, name, url, tracking_key, active, created_at FROM public.client_landing_pages WHERE client_id = $1 ORDER BY created_at`,
      [r.cliente.id],
    );
    const base = webhookOrigin(req.url);
    return Response.json({ cliente: r.cliente, paginas: rows.map(p => comSnippet(base, p)) });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const neg = autoriza(req); if (neg) return neg;
  const body = await req.json().catch(() => null) as { cliente?: string; url?: string; nome?: string } | null;
  const ref = String(body?.cliente ?? '').trim();
  const rawUrl = String(body?.url ?? '').trim();
  if (!ref || !rawUrl) return Response.json({ erro: 'cliente_e_url_obrigatorios' }, { status: 400 });
  let url: URL;
  try { url = new URL(rawUrl.match(/^https?:\/\//i) ? rawUrl : `https://${rawUrl}`); }
  catch { return Response.json({ erro: 'url_invalida' }, { status: 400 }); }
  if (!/^https?:$/.test(url.protocol)) return Response.json({ erro: 'url_invalida' }, { status: 400 });
  const host = hostDe(url.toString());
  const nome = String(body?.nome ?? '').trim() || url.hostname;

  const pool = makeServerPool();
  try {
    await ensureLpAnalyticsSchema(pool);
    const r = await cliente(pool, ref); if ('erro' in r) return r.erro;
    const base = webhookOrigin(req.url);
    const { rows } = await pool.query<Pagina>(
      `SELECT id, name, url, tracking_key, active, created_at FROM public.client_landing_pages WHERE client_id = $1`,
      [r.cliente.id],
    );
    const existente = rows.find(p => hostDe(p.url) === host);
    if (existente) return Response.json({ criada: false, cliente: r.cliente, pagina: comSnippet(base, existente) });
    for (let t = 0; t < 3; t++) {
      try {
        const { rows: [p] } = await pool.query<Pagina>(
          `INSERT INTO public.client_landing_pages (client_id, name, url, tracking_key)
           VALUES ($1, $2, $3, $4) RETURNING id, name, url, tracking_key, active, created_at`,
          [r.cliente.id, nome.slice(0, 120), url.toString().slice(0, 500), generateLpTrackingKey()],
        );
        return Response.json({ criada: true, cliente: r.cliente, pagina: comSnippet(base, p) }, { status: 201 });
      } catch (e) {
        if ((e as { code?: string })?.code !== '23505') throw e;
      }
    }
    return Response.json({ erro: 'falha_chave_unica' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
