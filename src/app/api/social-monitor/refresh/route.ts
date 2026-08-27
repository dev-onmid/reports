import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import {
  ensureSocialMonitorSchema, fetchClientSnapshot, resolverInsumosMeta, upsertSnapshot,
  type SocialSnapshot,
} from '@/lib/instagram-monitor';
import { sendSocialMonitorAlert, type AlertSendResult } from '@/lib/social-monitor-alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// A Vercel chama crons com `Authorization: Bearer $CRON_SECRET` e NÃO interpola
// `${CRON_SECRET}` no path. Além disso, o CRON_SECRET da Vercel é *Sensitive*
// (ilegível), então os workflows do GitHub usam REPORTS_CRON_SECRET. Aceitamos a
// mesma família dos outros crons (query OU Bearer) — mesmo padrão do balance-cron.
function isAuthorized(req: NextRequest): boolean {
  const urlSecret = req.nextUrl.searchParams.get('secret');
  const authHeader = req.headers.get('authorization');
  const secrets = [
    process.env.CRON_SECRET,
    process.env.REPORTS_CRON_SECRET,
    process.env.CRM_CRON_SECRET,
  ].filter(Boolean);
  if (secrets.length === 0) return false;
  return secrets.some(s => urlSecret === s || authHeader === `Bearer ${s}`);
}

const BUDGET_MS = 280_000;
const CONCURRENCY = 4;


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

    // Resolução (links → conexão → token fresco) mora em `instagram-monitor`:
    // o Planejador de Publicações precisa exatamente da mesma, e duas cópias
    // divergiriam na primeira mudança.
    const insumos = await resolverInsumosMeta(pool, ids, getFreshMetaToken);
    const insumoPorCliente = new Map(insumos.map(x => [x.clientId, x]));

    // Dois clientes podem compartilhar a mesma conta de anúncio/página: dedupe
    // pela chave de resolução, para não repetir as chamadas na Graph.
    const snapshotCache = new Map<string, Promise<SocialSnapshot>>();
    let updated = 0, errors = 0, skipped = 0;

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      if (Date.now() > deadline) { skipped += ids.length - i; break; }
      const chunk = ids.slice(i, i + CONCURRENCY);
      await Promise.allSettled(chunk.map(async (clientId) => {
        const ins = insumoPorCliente.get(clientId);
        if (!ins) { errors++; return; }
        const { accountId, directIgId, cacheKey } = ins;

        if (!snapshotCache.has(cacheKey)) {
          snapshotCache.set(cacheKey, (async () => {
            const token = await ins.token;
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

// Cron (GitHub Actions): GET secret-guarded — atualiza todos os clientes ativos
// e, com os dados frescos, dispara o aviso WhatsApp (se configurado/ativo).
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runRefresh(null);

  let alert: AlertSendResult;
  const pool = makeServerPool();
  try {
    alert = await sendSocialMonitorAlert(pool);
  } catch (e) {
    // Aviso é best-effort: falha no WhatsApp não pode marcar o cron como erro.
    alert = { sent: false, reason: e instanceof Error ? e.message : 'Erro no envio' };
  } finally {
    await pool.end();
  }

  return Response.json({ ...result, alert });
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
