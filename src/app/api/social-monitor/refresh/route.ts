import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import {
  ensureSocialMonitorSchema, fetchClientSnapshot, upsertSnapshot,
  type ConnRow, type SocialSnapshot,
} from '@/lib/instagram-monitor';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BUDGET_MS = 280_000;
const CONCURRENCY = 4;

type LinkRow = { client_id: string; connection_id: string | null; account_id: string | null; platform: string };

async function runRefresh(clientIds: string[] | null) {
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const pool = makeServerPool();
  try {
    await ensureSocialMonitorSchema(pool);

    // Sem lista explícita (cron/"atualizar todos"): pula clientes ocultos do monitor
    // (monitored = FALSE — só tráfego pago) para não gastar chamadas na Graph à toa.
    const { rows: clients } = clientIds?.length
      ? await pool.query(`SELECT id FROM public.clients WHERE id = ANY($1)`, [clientIds])
      : await pool.query(
          `SELECT c.id FROM public.clients c
            WHERE c.status NOT IN ('Arquivado','Inativo')
              AND NOT EXISTS (
                SELECT 1 FROM public.social_monitor_snapshots s
                 WHERE s.client_id = c.id AND s.monitored = FALSE
              )`,
        );
    const ids = (clients as { id: string }[]).map(c => c.id);
    if (!ids.length) return { ok: true, updated: 0, errors: 0, skipped: 0, tookMs: Date.now() - started };

    const { rows: links } = await pool.query(
      `SELECT client_id, connection_id, account_id, platform
         FROM public.client_account_links
        WHERE client_id = ANY($1) AND platform IN ('meta_ads','meta','instagram')
        ORDER BY created_at ASC`,
      [ids],
    );
    const linksByClient = new Map<string, LinkRow[]>();
    for (const l of links as LinkRow[]) {
      const list = linksByClient.get(l.client_id) ?? [];
      list.push(l);
      linksByClient.set(l.client_id, list);
    }

    const { rows: fallbackRows } = await pool.query(
      `SELECT id FROM public.meta_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`,
    );
    const fallbackConnId: string | null = fallbackRows[0]?.id ?? null;

    const connIds = [...new Set([
      ...(links as LinkRow[]).map(l => l.connection_id).filter((id): id is string => Boolean(id)),
      ...(fallbackConnId ? [fallbackConnId] : []),
    ])];
    const { rows: conns } = connIds.length
      ? await pool.query(`SELECT * FROM public.meta_connections WHERE id = ANY($1) AND status = 'connected'`, [connIds])
      : { rows: [] };
    const connMap = new Map<string, ConnRow>((conns as ConnRow[]).map(c => [c.id, c]));

    // Token renovado uma vez por conexão, não por cliente.
    const tokenCache = new Map<string, Promise<string | null>>();
    const tokenFor = (connId: string | null): Promise<string | null> => {
      if (!connId) return Promise.resolve(null);
      if (!tokenCache.has(connId)) {
        const conn = connMap.get(connId);
        tokenCache.set(connId, conn ? getFreshMetaToken(conn).catch(() => null) : Promise.resolve(null));
      }
      return tokenCache.get(connId)!;
    };

    // Dois clientes podem compartilhar a mesma conta de anúncio/página: dedupe
    // pela chave de resolução, para não repetir as chamadas na Graph.
    const snapshotCache = new Map<string, Promise<SocialSnapshot>>();
    let updated = 0, errors = 0, skipped = 0;

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      if (Date.now() > deadline) { skipped += ids.length - i; break; }
      const chunk = ids.slice(i, i + CONCURRENCY);
      await Promise.allSettled(chunk.map(async (clientId) => {
        const clientLinks = linksByClient.get(clientId) ?? [];
        const igLink = clientLinks.find(l => l.platform === 'instagram' && l.account_id);
        const adsLink = clientLinks.find(l => l.platform !== 'instagram' && (l.connection_id || l.account_id));
        const connId = adsLink?.connection_id ?? igLink?.connection_id ?? fallbackConnId;
        const accountId = adsLink?.account_id ?? '';
        const directIgId = igLink?.account_id ?? null;

        const cacheKey = `${connId ?? ''}|${accountId}|${directIgId ?? ''}`;
        if (!snapshotCache.has(cacheKey)) {
          snapshotCache.set(cacheKey, (async () => {
            const token = await tokenFor(connId);
            return fetchClientSnapshot({ clientId, accountId, directIgId, token });
          })());
        }
        const snap = { ...(await snapshotCache.get(cacheKey)!), clientId };

        await upsertSnapshot(pool, snap);
        if (snap.error) errors++; else updated++;
      }));
    }

    return { ok: true, updated, errors, skipped, tookMs: Date.now() - started };
  } finally {
    await pool.end();
  }
}

// Cron (GitHub Actions): GET secret-guarded — atualiza todos os clientes ativos.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runRefresh(null);
  return Response.json(result);
}

// UI: POST { clientIds?: string[] } — sem body/lista = todos; com lista = só esses.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { clientIds?: unknown } | null;
  let clientIds: string[] | null = null;
  if (Array.isArray(body?.clientIds)) {
    clientIds = body.clientIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (!clientIds.length) return Response.json({ error: 'clientIds vazio' }, { status: 400 });
  }
  const result = await runRefresh(clientIds);
  return Response.json(result);
}
