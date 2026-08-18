import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCached, setCached, cachedJson } from '@/lib/api-cache';
import { buscarAtividadesMeta, buscarMudancasGoogle } from '@/lib/atividade-conta';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_activity_log (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id   TEXT        NOT NULL,
      platform    TEXT        NOT NULL DEFAULT 'system',
      event_type  TEXT        NOT NULL,
      description TEXT        NOT NULL,
      actor_name  TEXT,
      actor_source TEXT       NOT NULL DEFAULT 'system',
      campaign_id   TEXT,
      campaign_name TEXT,
      old_value   TEXT,
      new_value   TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceUnix = Math.floor(since.getTime() / 1000);

  const cacheKey = `activity:${clientId}:${days}`;
  const cached = getCached(cacheKey);
  if (cached) return cachedJson(cached.data, true, cached.cachedAt);

  const pool = makeServerPool();
  try {
    await ensureTable(pool);

    // System logs
    const { rows: systemLogs } = await pool.query(
      `SELECT id::text, platform, event_type, description, actor_name, actor_source,
              campaign_id, campaign_name, old_value, new_value, created_at
       FROM public.client_activity_log
       WHERE client_id = $1 AND created_at >= $2
       ORDER BY created_at DESC LIMIT 100`,
      [clientId, since]
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allLogs: any[] = [...systemLogs];

    // Busca extraída pra @/lib/atividade-conta (o resumo diário do Histórico
    // usa os MESMOS fetchers). Shape de saída preservado.
    const [metaEv, googleEv] = await Promise.all([
      buscarAtividadesMeta(pool, clientId, since),
      buscarMudancasGoogle(pool, clientId, since),
    ]);
    for (const ev of metaEv) {
      allLogs.push({
        id: `meta-${ev.campanha ?? ''}-${ev.criadoEm}`,
        platform: 'meta', event_type: ev.tipo ?? 'change', description: ev.descricao,
        actor_name: ev.autor, actor_source: 'meta',
        campaign_name: ev.campanha, created_at: ev.criadoEm,
      });
    }
    for (const ev of googleEv) {
      allLogs.push({
        id: `google-${ev.criadoEm}-${Math.random()}`,
        platform: 'google', event_type: ev.tipo ?? 'change', description: ev.descricao,
        actor_name: ev.autor, actor_source: 'google', created_at: ev.criadoEm,
      });
    }

    // Sort all by created_at desc
    allLogs.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    const result = allLogs.slice(0, 200);
    setCached(cacheKey, result);
    return cachedJson(result, false);
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const body = await req.json() as {
    platform?: string; event_type: string; description: string;
    actor_name?: string; actor_source?: string;
    campaign_id?: string; campaign_name?: string;
    old_value?: string; new_value?: string;
  };
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    await pool.query(
      `INSERT INTO public.client_activity_log
       (client_id, platform, event_type, description, actor_name, actor_source, campaign_id, campaign_name, old_value, new_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [clientId, body.platform ?? 'system', body.event_type, body.description,
       body.actor_name ?? null, body.actor_source ?? 'system',
       body.campaign_id ?? null, body.campaign_name ?? null,
       body.old_value ?? null, body.new_value ?? null]
    );
    return new Response(null, { status: 201 });
  } finally {
    await pool.end();
  }
}
