import type { NextRequest } from 'next/server';
import { parseAdsLibraryUrl, fetchAdsLibraryHtml, extractAdsFromHtml } from '@/lib/ads-library';

// POST /api/ads-library { url }
// Recebe um link da Biblioteca de Anúncios do Meta e devolve os criativos
// embutidos na primeira página de resultados (com URLs diretas de vídeo/imagem).
// Auth: deny-by-default do proxy (src/proxy.ts) — só usuário logado chega aqui.

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let url: string;
  try {
    const body = await req.json();
    url = String(body?.url ?? '');
  } catch {
    return Response.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const parsed = parseAdsLibraryUrl(url);
  if ('error' in parsed) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  try {
    const html = await fetchAdsLibraryHtml(parsed.url);
    const { ads, pageName } = extractAdsFromHtml(html);
    // Link com ?id= aponta pra um anúncio específico — ele vem primeiro na lista
    // (a página deeplink embute também os demais anúncios da mesma página).
    const targetId = new URL(parsed.url).searchParams.get('id');
    if (targetId) {
      ads.sort((a, b) => Number(b.adArchiveId === targetId) - Number(a.adArchiveId === targetId));
    }
    if (ads.length === 0) {
      return Response.json({
        ok: true,
        ads: [],
        pageName: null,
        error:
          'Nenhum anúncio encontrado nesse link. Confira se a página tem anúncios ativos no filtro do link (país, status).',
      });
    }
    return Response.json({ ok: true, ads, pageName });
  } catch (err) {
    console.error('[ads-library]', err);
    return Response.json(
      { ok: false, ads: [], error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}
