import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { dispatchBatch, ensureDispatchLogTable } from '@/lib/leadlovers-worker';

const CRON_LIMIT = 5;   // seguro dentro do limite de 10s do Vercel
const USER_LIMIT = 10;  // front-end polling pode pedir até 50

async function processContacts(opts: {
  isCron: boolean;
  userId: string | null;
  unrestricted: boolean;
  campaignId?: string;
  limit: number;
}): Promise<Response> {
  const pool = makeServerPool();
  try {
    await ensureDispatchLogTable(pool);

    const r = await dispatchBatch(pool, {
      campaignId: opts.campaignId,
      limit: opts.limit,
      selection: { mode: 'due' },
      scope: { unrestricted: opts.unrestricted, userId: opts.userId },
      isCron: opts.isCron,
    });
    return Response.json({ sent: r.sent, errors: r.errors, results: r.results, done: false });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization') ?? '';
    const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`);

    const pool = makeServerPool();
    const scope = await getCallerScope(req, pool).finally(() => pool.end());
    if (!scope.userId && !isCron) {
      return Response.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({})) as { campaign_id?: string; limit?: number };
    const limit = isCron ? CRON_LIMIT : Math.min(body.limit ?? USER_LIMIT, 50);

    return await processContacts({
      isCron,
      userId: scope.userId,
      unrestricted: scope.unrestricted,
      campaignId: body.campaign_id,
      limit,
    });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
}

// GET endpoint for cron (GitHub Actions + Vercel cron)
export async function GET(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const secret = new URL(req.url).searchParams.get('secret');
    if (!cronSecret || secret !== cronSecret) {
      return Response.json({ error: 'Não autorizado' }, { status: 401 });
    }
    return await processContacts({
      isCron: true,
      userId: null,
      unrestricted: true,
      limit: CRON_LIMIT,
    });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
}
