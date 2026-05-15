import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import type { AdLibraryAd } from '@/app/api/meta/ad-library/route';

export type SavedAd = AdLibraryAd & {
  id: string;
  clientId: string;
  notes: string | null;
  savedAt: string;
};

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.saved_ads (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id           TEXT        NOT NULL,
      ad_archive_id       TEXT        NOT NULL,
      page_id             TEXT,
      page_name           TEXT,
      ad_snapshot_url     TEXT,
      creative_bodies     JSONB       DEFAULT '[]',
      creative_titles     JSONB       DEFAULT '[]',
      publisher_platforms JSONB       DEFAULT '[]',
      delivery_start_time TEXT,
      delivery_stop_time  TEXT,
      ad_active_status    TEXT        DEFAULT 'ACTIVE',
      spend               JSONB,
      impressions         JSONB,
      currency            TEXT,
      notes               TEXT,
      saved_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, ad_archive_id)
    );
    CREATE INDEX IF NOT EXISTS idx_saved_ads_client_id ON public.saved_ads (client_id);
    ALTER TABLE public.saved_ads ADD COLUMN IF NOT EXISTS image_url TEXT;
    ALTER TABLE public.saved_ads ADD COLUMN IF NOT EXISTS video_url TEXT;
    ALTER TABLE public.saved_ads ADD COLUMN IF NOT EXISTS video_thumbnail_url TEXT;
    ALTER TABLE public.saved_ads ADD COLUMN IF NOT EXISTS link_url TEXT;
    ALTER TABLE public.saved_ads ADD COLUMN IF NOT EXISTS call_to_action TEXT;
    ALTER TABLE public.saved_ads ADD COLUMN IF NOT EXISTS media_type TEXT;
  `);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToSavedAd(r: any): SavedAd {
  return {
    id: r.id,
    clientId: r.client_id,
    adArchiveId: r.ad_archive_id,
    pageId: r.page_id ?? '',
    pageName: r.page_name ?? '',
    adSnapshotUrl: r.ad_snapshot_url ?? '',
    creativeBodies: r.creative_bodies ?? [],
    creativeTitles: r.creative_titles ?? [],
    publisherPlatforms: r.publisher_platforms ?? [],
    deliveryStartTime: r.delivery_start_time ?? null,
    deliveryStopTime: r.delivery_stop_time ?? null,
    adActiveStatus: r.ad_active_status ?? 'UNKNOWN',
    spend: r.spend ?? null,
    impressions: r.impressions ?? null,
    currency: r.currency ?? null,
    notes: r.notes ?? null,
    savedAt: r.saved_at,
    imageUrl: r.image_url ?? null,
    videoUrl: r.video_url ?? null,
    videoThumbnailUrl: r.video_thumbnail_url ?? null,
    linkUrl: r.link_url ?? null,
    callToAction: r.call_to_action ?? null,
    mediaType: r.media_type ?? null,
  };
}

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json([], { status: 200 });

  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const all = clientId === '__all__';
    const { rows } = all
      ? await pool.query('SELECT * FROM public.saved_ads ORDER BY saved_at DESC')
      : await pool.query(
          'SELECT * FROM public.saved_ads WHERE client_id = $1 ORDER BY saved_at DESC',
          [clientId]
        );
    return Response.json(rows.map(rowToSavedAd));
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { clientId: string; ad: AdLibraryAd; notes?: string };
  const { clientId, ad, notes } = body;

  if (!clientId || !ad?.adArchiveId) {
    return Response.json({ error: 'clientId e ad são obrigatórios' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      `INSERT INTO public.saved_ads
         (client_id, ad_archive_id, page_id, page_name, ad_snapshot_url,
          creative_bodies, creative_titles, publisher_platforms,
          delivery_start_time, delivery_stop_time, ad_active_status,
          spend, impressions, currency, notes,
          image_url, video_url, video_thumbnail_url, link_url, call_to_action, media_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (client_id, ad_archive_id) DO UPDATE
         SET notes = EXCLUDED.notes, saved_at = NOW(),
             image_url = EXCLUDED.image_url,
             video_url = EXCLUDED.video_url,
             video_thumbnail_url = EXCLUDED.video_thumbnail_url,
             link_url = EXCLUDED.link_url,
             call_to_action = EXCLUDED.call_to_action,
             media_type = EXCLUDED.media_type
       RETURNING *`,
      [
        clientId,
        ad.adArchiveId,
        ad.pageId,
        ad.pageName,
        ad.adSnapshotUrl,
        JSON.stringify(ad.creativeBodies),
        JSON.stringify(ad.creativeTitles),
        JSON.stringify(ad.publisherPlatforms),
        ad.deliveryStartTime,
        ad.deliveryStopTime,
        ad.adActiveStatus,
        ad.spend ? JSON.stringify(ad.spend) : null,
        ad.impressions ? JSON.stringify(ad.impressions) : null,
        ad.currency,
        notes ?? null,
        ad.imageUrl ?? null,
        ad.videoUrl ?? null,
        ad.videoThumbnailUrl ?? null,
        ad.linkUrl ?? null,
        ad.callToAction ?? null,
        ad.mediaType ?? null,
      ]
    );
    return Response.json(rowToSavedAd(rows[0]), { status: 201 });
  } finally {
    await pool.end();
  }
}
