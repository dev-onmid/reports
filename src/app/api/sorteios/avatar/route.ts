import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolveContaDoCliente } from '@/lib/sorteio-fonte';

// Foto de perfil do vencedor pro card do sorteio. O unavatar sozinho falha
// com frequência (o Instagram bloqueia o scraper deles), então a rota tenta
// em cascata e devolve a IMAGEM mesma-origem (canvas nunca fica tainted):
//   1. Graph Business Discovery (conta do cliente como âncora) — só resolve
//      vencedor com conta business/creator, mas é 100% oficial;
//   2. endpoint web do Instagram com o x-ig-app-id público (funciona pra
//      conta pessoal na maioria dos casos);
//   3. unavatar.io como último recurso.
// Nada encontrado → 404 e a UI cai na inicial do nome.

export const maxDuration = 30;

async function fetchImagem(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok || !res.body) return null;
    const ct = res.headers.get('content-type') ?? 'image/jpeg';
    if (!ct.startsWith('image/')) return null;
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch { return null; }
}

async function viaBusinessDiscovery(igId: string, pageToken: string, username: string): Promise<string | null> {
  try {
    const url = `https://graph.facebook.com/v21.0/${igId}?fields=business_discovery.username(${encodeURIComponent(username)}){profile_picture_url}&access_token=${encodeURIComponent(pageToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as { business_discovery?: { profile_picture_url?: string } };
    return data.business_discovery?.profile_picture_url ?? null;
  } catch { return null; }
}

async function viaWebProfile(username: string): Promise<string | null> {
  try {
    const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        // App id público do site do Instagram — sem ele o endpoint recusa.
        'x-ig-app-id': '936619743392459',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        accept: '*/*',
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: { user?: { profile_pic_url_hd?: string; profile_pic_url?: string } } };
    return data.data?.user?.profile_pic_url_hd ?? data.data?.user?.profile_pic_url ?? null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const username = (req.nextUrl.searchParams.get('u') ?? '').trim().replace(/^@/, '');
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  if (!username || !/^[a-z0-9._]{1,30}$/i.test(username)) {
    return Response.json({ error: 'username inválido' }, { status: 400 });
  }

  // 1) Business Discovery — precisa da conta do cliente como âncora.
  if (clientId) {
    const pool = makeServerPool();
    try {
      const conta = await resolveContaDoCliente(pool, clientId);
      if (conta) {
        const url = await viaBusinessDiscovery(conta.igId, conta.pageToken, username);
        if (url) {
          const img = await fetchImagem(url);
          if (img) return img;
        }
      }
    } catch { /* segue pras próximas tentativas */ } finally {
      await pool.end();
    }
  }

  // 2) Endpoint web do Instagram.
  const webUrl = await viaWebProfile(username);
  if (webUrl) {
    const img = await fetchImagem(webUrl);
    if (img) return img;
  }

  // 3) unavatar como último recurso.
  const un = await fetchImagem(`https://unavatar.io/instagram/${encodeURIComponent(username)}?fallback=false`);
  if (un) return un;

  return Response.json({ error: 'sem avatar' }, { status: 404 });
}
