// Biblioteca de Anúncios do Meta (facebook.com/ads/library) — busca e parsing
// server-side dos criativos de uma página/anúncio a partir do link público.
//
// Como funciona (validado em 2026-08-07 contra a Ads Library real):
// - A página pública devolve 403 com um desafio JS (`/__rd_verify_...`) na
//   primeira visita sem cookie. Reproduzimos o fluxo do browser: POST no
//   desafio → cookie `rd_challenge` → repetir o GET. O cookie é cacheado em
//   módulo (~30min) pra não pagar o round-trip extra em toda busca.
// - O HTML já vem com os anúncios da primeira página embutidos como JSON
//   (objetos `{"ad_archive_id":...,"snapshot":{...}}`) — inclusive as URLs
//   diretas de vídeo HD/SD e imagem original no fbcdn. Não precisa de browser
//   headless nem de token de API.
// - Limite conhecido: só os anúncios renderizados server-side (~30 primeiros,
//   na ordenação do link). Paginar além disso exigiria a chamada GraphQL
//   autenticada da própria página — fora do escopo desta versão.

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

const FETCH_TIMEOUT_MS = 15_000;

// Params que repassamos ao Facebook — o resto do link (tracking, lixo) é descartado.
const ALLOWED_PARAMS = [
  'id',
  'view_all_page_id',
  'q',
  'active_status',
  'ad_type',
  'country',
  'is_targeted_country',
  'media_type',
  'search_type',
  'content_languages[0]',
  'sort_data[mode]',
  'sort_data[direction]',
];

export interface AdMedia {
  type: 'video' | 'image';
  /** Melhor URL disponível (vídeo HD > SD; imagem original > redimensionada). */
  url: string;
  /** Vídeo: URL SD alternativa, quando existir. */
  sdUrl?: string;
  /** Vídeo: thumbnail/poster. */
  previewImage?: string;
}

export interface LibraryAd {
  adArchiveId: string;
  pageName: string;
  pageProfilePicture: string | null;
  isActive: boolean;
  /** epoch em segundos, como a Ads Library entrega. */
  startDate: number | null;
  endDate: number | null;
  publisherPlatforms: string[];
  displayFormat: string | null;
  bodyText: string | null;
  ctaText: string | null;
  linkUrl: string | null;
  media: AdMedia[];
}

export interface AdsLibraryResult {
  ads: LibraryAd[];
  /** Nome da página dominante nos resultados (pra título da tela). */
  pageName: string | null;
}

/** Normaliza qualquer link da Ads Library pro GET que fazemos no servidor. */
export function parseAdsLibraryUrl(raw: string): { url: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: 'Link inválido — cole a URL completa da Biblioteca de Anúncios.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (!/(^|\.)facebook\.com$/.test(host) || !parsed.pathname.startsWith('/ads/library')) {
    return { error: 'O link precisa ser da Biblioteca de Anúncios do Meta (facebook.com/ads/library).' };
  }
  const out = new URL('https://www.facebook.com/ads/library/');
  for (const key of ALLOWED_PARAMS) {
    const v = parsed.searchParams.get(key);
    if (v) out.searchParams.set(key, v);
  }
  const hasTarget =
    out.searchParams.get('id') || out.searchParams.get('view_all_page_id') || out.searchParams.get('q');
  if (!hasTarget) {
    return {
      error:
        'O link não aponta pra nenhum anúncio ou página (faltou id, view_all_page_id ou termo de busca).',
    };
  }
  // Defaults que a Ads Library exige pra busca por página renderizar resultados.
  if (!out.searchParams.get('id')) {
    if (!out.searchParams.get('ad_type')) out.searchParams.set('ad_type', 'all');
    if (!out.searchParams.get('active_status')) out.searchParams.set('active_status', 'active');
    if (!out.searchParams.get('country')) out.searchParams.set('country', 'BR');
    if (!out.searchParams.get('search_type')) out.searchParams.set('search_type', 'page');
    if (!out.searchParams.get('media_type')) out.searchParams.set('media_type', 'all');
  }
  return { url: out.toString() };
}

// ---------------------------------------------------------------------------
// Fetch com o desafio anti-bot do Facebook

let cookieCache: { value: string; at: number } | null = null;
const COOKIE_TTL_MS = 30 * 60 * 1000;

function mergeCookies(existing: string, setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const part of existing.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k) jar.set(k, rest.join('='));
  }
  for (const sc of setCookies) {
    const first = sc.split(';')[0];
    const [k, ...rest] = first.trim().split('=');
    if (k) jar.set(k, rest.join('='));
  }
  return [...jar.entries()]
    .filter(([, v]) => v !== '' && v !== 'deleted')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function getSetCookies(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

async function fbGet(url: string, cookie: string): Promise<Response> {
  return fetch(url, {
    headers: { ...BROWSER_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/**
 * Busca o HTML da Ads Library resolvendo o desafio `__rd_verify` quando o
 * Facebook o apresenta. Lança Error com mensagem legível em caso de bloqueio.
 *
 * Visto em teste real: logo após verificar o desafio, o Facebook às vezes
 * responde 200 com a CASCA da página (sem os anúncios embutidos). Uma segunda
 * tentativa com cookie zerado resolve — por isso o retry quando o HTML vem
 * sem `ad_archive_id`.
 */
export async function fetchAdsLibraryHtml(url: string): Promise<string> {
  const first = await fetchAdsLibraryHtmlOnce(url);
  if (first.includes('"ad_archive_id"')) return first;
  cookieCache = null;
  return fetchAdsLibraryHtmlOnce(url);
}

async function fetchAdsLibraryHtmlOnce(url: string): Promise<string> {
  let cookie = cookieCache && Date.now() - cookieCache.at < COOKIE_TTL_MS ? cookieCache.value : '';

  let res = await fbGet(url, cookie);
  let html = await res.text();

  if (res.status === 403 && html.includes('__rd_verify')) {
    const match = html.match(/\/__rd_verify_[^'"\\]+/);
    if (!match) throw new Error('O Facebook apresentou um desafio desconhecido — tente de novo em instantes.');
    cookie = mergeCookies(cookie, getSetCookies(res));
    const challenge = await fetch(`https://www.facebook.com${match[0]}`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    cookie = mergeCookies(cookie, getSetCookies(challenge));
    res = await fbGet(url, cookie);
    html = await res.text();
  }

  if (!res.ok) {
    throw new Error(
      `O Facebook recusou a busca (HTTP ${res.status}). Pode ser bloqueio temporário do IP do servidor — tente de novo em alguns minutos.`,
    );
  }
  cookieCache = { value: cookie, at: Date.now() };
  return html;
}

// ---------------------------------------------------------------------------
// Parsing do JSON embutido

/** Extrai o objeto JSON balanceado que começa em `start` (respeitando strings). */
export function extractBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else {
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

type Raw = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function collectMedia(snapshot: Raw): AdMedia[] {
  const media: AdMedia[] = [];
  const seen = new Set<string>();

  const pushVideo = (v: Raw) => {
    const url = str(v.video_hd_url) ?? str(v.video_sd_url) ?? str(v.watermarked_video_hd_url) ?? str(v.watermarked_video_sd_url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    media.push({
      type: 'video',
      url,
      sdUrl: str(v.video_sd_url) ?? undefined,
      previewImage: str(v.video_preview_image_url) ?? undefined,
    });
  };
  const pushImage = (v: Raw) => {
    const url = str(v.original_image_url) ?? str(v.resized_image_url) ?? str(v.image_url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    media.push({ type: 'image', url });
  };
  const asArray = (v: unknown): Raw[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Raw[]) : []);

  for (const v of asArray(snapshot.videos)) pushVideo(v);
  for (const v of asArray(snapshot.extra_videos)) pushVideo(v);
  for (const v of asArray(snapshot.images)) pushImage(v);
  for (const v of asArray(snapshot.extra_images)) pushImage(v);
  // Carrossel: cada card pode carregar vídeo OU imagem próprios.
  for (const card of asArray(snapshot.cards)) {
    pushVideo(card);
    pushImage(card);
  }
  return media;
}

/** Varre o HTML atrás dos objetos de anúncio embutidos e normaliza. */
export function extractAdsFromHtml(html: string): AdsLibraryResult {
  const byId = new Map<string, LibraryAd>();
  let pos = 0;
  const needle = '{"ad_archive_id"';
  while (true) {
    const idx = html.indexOf(needle, pos);
    if (idx < 0) break;
    pos = idx + needle.length;
    const jsonText = extractBalancedJson(html, idx);
    if (!jsonText) continue;
    let raw: Raw;
    try {
      raw = JSON.parse(jsonText) as Raw;
    } catch {
      continue;
    }
    const adArchiveId = str(raw.ad_archive_id);
    const snapshot = raw.snapshot && typeof raw.snapshot === 'object' ? (raw.snapshot as Raw) : null;
    if (!adArchiveId || !snapshot) continue;

    const media = collectMedia(snapshot);
    const body = snapshot.body && typeof snapshot.body === 'object' ? (snapshot.body as Raw) : null;
    const ad: LibraryAd = {
      adArchiveId,
      pageName: str(raw.page_name) ?? str(snapshot.page_name) ?? '',
      pageProfilePicture: str(snapshot.page_profile_picture_url),
      isActive: raw.is_active === true,
      startDate: typeof raw.start_date === 'number' ? raw.start_date : null,
      endDate: typeof raw.end_date === 'number' ? raw.end_date : null,
      publisherPlatforms: Array.isArray(raw.publisher_platform)
        ? (raw.publisher_platform.filter((p) => typeof p === 'string') as string[])
        : [],
      displayFormat: str(snapshot.display_format),
      bodyText: body ? str(body.text) : null,
      ctaText: str(snapshot.cta_text),
      linkUrl: str(snapshot.link_url),
      media,
    };
    const existing = byId.get(adArchiveId);
    // O mesmo anúncio pode aparecer 2x no HTML (deeplink + lista) — fica a
    // versão com mais mídia extraída.
    if (!existing || media.length > existing.media.length) byId.set(adArchiveId, ad);
  }

  const ads = [...byId.values()];
  const nameCounts = new Map<string, number>();
  for (const ad of ads) {
    if (ad.pageName) nameCounts.set(ad.pageName, (nameCounts.get(ad.pageName) ?? 0) + 1);
  }
  const pageName = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { ads, pageName };
}

// ---------------------------------------------------------------------------
// Download proxy — validação de origem

/** Só deixamos o proxy de download buscar mídia dos CDNs do próprio Meta. */
export function isAllowedMediaUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return (
    /(^|\.)fbcdn\.net$/.test(host) ||
    /(^|\.)cdninstagram\.com$/.test(host) ||
    /(^|\.)facebook\.com$/.test(host)
  );
}

/** Nome de arquivo seguro pro Content-Disposition. */
export function safeFilename(name: string, fallbackExt: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  if (!cleaned) return `criativo.${fallbackExt}`;
  return /\.[a-z0-9]{2,4}$/i.test(cleaned) ? cleaned : `${cleaned}.${fallbackExt}`;
}
