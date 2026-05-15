import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

export type AdCard = {
  imageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  body: string | null;
  linkUrl: string | null;
};

export type AdLibraryAd = {
  adArchiveId: string;
  pageId: string;
  pageName: string;
  adSnapshotUrl: string;
  creativeBodies: string[];
  creativeTitles: string[];
  publisherPlatforms: string[];
  deliveryStartTime: string | null;
  deliveryStopTime: string | null;
  adActiveStatus: string;
  spend: { lower_bound?: string; upper_bound?: string } | null;
  impressions: { lower_bound?: string; upper_bound?: string } | null;
  currency: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  linkUrl: string | null;
  callToAction: string | null;
  mediaType: 'image' | 'video' | 'carousel' | 'text' | null;
  cards: AdCard[];
  ogImageUrl: string | null;
};

// Fetch OG image from a landing page — used for link/text ads with no creative image
async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const html = await res.text();
    // Try og:image first, then twitter:image
    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m?.[1] && m[1].startsWith('http')) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get('q')?.trim() ?? '';
  const country = searchParams.get('country') ?? 'BR';
  const status = searchParams.get('status') ?? 'ALL';
  const after = searchParams.get('after') ?? '';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20'), 50);

  if (!q) return Response.json({ data: [], paging: null }, { status: 200 });

  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conn: any = null;
  try {
    const { rows } = await pool.query(
      "SELECT * FROM public.meta_connections WHERE status = 'connected' LIMIT 1"
    );
    conn = rows[0] ?? null;
  } finally {
    await pool.end();
  }

  if (!conn) {
    return Response.json({ error: 'Nenhuma conexão Meta ativa encontrada.' }, { status: 400 });
  }

  const token = await getFreshMetaToken(conn);

  const url = new URL('https://graph.facebook.com/v21.0/ads_archive');
  url.searchParams.set('search_terms', q);
  url.searchParams.set('ad_reached_countries', JSON.stringify([country]));
  url.searchParams.set('ad_active_status', status);
  url.searchParams.set('ad_type', 'ALL');
  url.searchParams.set('fields', [
    'id',
    'page_id',
    'page_name',
    'ad_snapshot_url',
    'ad_creative_bodies',
    'ad_creative_link_titles',
    'publisher_platforms',
    'ad_delivery_start_time',
    'ad_delivery_stop_time',
    'ad_active_status',
    'snapshot',
  ].join(','));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('access_token', token);
  if (after) url.searchParams.set('after', after);

  const res = await fetch(url.toString());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json();

  if (!res.ok) {
    return Response.json(
      { error: raw?.error?.message ?? 'Erro na Meta Ad Library API' },
      { status: 502 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = (raw.data ?? []).map((ad: any) => {
    const snap = ad.snapshot ?? {};
    const images: string[] = (snap.images ?? [])
      .map((img: any) => img.original_image_url ?? img.resized_image_url ?? '')
      .filter(Boolean);
    const videos = snap.videos ?? [];
    const firstVideo = videos[0] ?? null;
    const cards = snap.cards ?? [];

    let mediaType: AdLibraryAd['mediaType'] = 'text';
    if (videos.length > 0) mediaType = 'video';
    else if (images.length > 0) mediaType = 'image';
    else if (cards.length > 0) mediaType = 'carousel';

    const imageUrl = images[0] ?? (cards[0]?.original_image_url ?? cards[0]?.resized_image_url ?? null);
    const videoUrl = firstVideo ? (firstVideo.video_hd_url ?? firstVideo.video_sd_url ?? null) : null;
    const videoThumbnailUrl = firstVideo?.video_preview_image_url ?? null;
    const linkUrl = snap.link_url ?? snap.caption ?? null;
    const callToAction = snap.call_to_action?.type ?? null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cardItems: AdCard[] = (snap.cards ?? []).map((c: any) => ({
      imageUrl: c.original_image_url ?? c.resized_image_url ?? null,
      videoUrl: c.video_hd_url ?? c.video_sd_url ?? null,
      thumbnailUrl: c.video_preview_image_url ?? null,
      title: c.title ?? null,
      body: c.body ?? null,
      linkUrl: c.link_url ?? null,
    }));

    return {
      adArchiveId: ad.id,
      pageId: ad.page_id ?? '',
      pageName: ad.page_name ?? '',
      adSnapshotUrl: ad.ad_snapshot_url ?? '',
      creativeBodies: ad.ad_creative_bodies ?? [],
      creativeTitles: ad.ad_creative_link_titles ?? [],
      publisherPlatforms: ad.publisher_platforms ?? [],
      deliveryStartTime: ad.ad_delivery_start_time ?? null,
      deliveryStopTime: ad.ad_delivery_stop_time ?? null,
      adActiveStatus: ad.ad_active_status ?? 'UNKNOWN',
      spend: ad.spend ?? null,
      impressions: ad.impressions ?? null,
      currency: ad.currency ?? null,
      imageUrl,
      videoUrl,
      videoThumbnailUrl,
      linkUrl,
      callToAction,
      mediaType,
      cards: cardItems,
      _needsOg: !imageUrl && !videoUrl && !!linkUrl,
      _linkUrl: linkUrl,
    };
  });

  // Fetch OG images in parallel for link/text ads that have no creative image
  const data: AdLibraryAd[] = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parsed.map(async (ad: any) => {
      const { _needsOg, _linkUrl, ...rest } = ad;
      const ogImageUrl = _needsOg ? await fetchOgImage(_linkUrl) : null;
      return { ...rest, ogImageUrl } as AdLibraryAd;
    })
  );

  return Response.json({
    data,
    paging: raw.paging ?? null,
  });
}
