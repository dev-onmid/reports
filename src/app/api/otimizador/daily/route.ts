import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  OPTIMIZER_PERIODS,
  buildOptimizerPayloadFromCampaign,
  type OptimizerCampaignInput,
  type OptimizerClientInput,
  type OptimizerPeriodKey,
} from '@/lib/optimizer';

export const maxDuration = 60;

type ClientRow = OptimizerClientInput & {
  status: string;
};

type PlanningRow = {
  client_id: string;
  cplMeta: number | null;
};

const BUDGET_MS = 52_000;

function isoDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

function rangeForPeriod(period: OptimizerPeriodKey): { dateFrom: string; dateTo: string } {
  const days = OPTIMIZER_PERIODS.find((item) => item.key === period)?.days ?? 7;
  return {
    dateFrom: isoDate(days),
    dateTo: isoDate(1),
  };
}

async function loadClients(limit: number, clientId?: string): Promise<ClientRow[]> {
  const pool = makeServerPool();
  try {
    if (clientId) {
      const { rows } = await pool.query<ClientRow>(
        `SELECT id, name, segment, status
           FROM public.clients
          WHERE id = $1
            AND status NOT IN ('Arquivado', 'Inativo')`,
        [clientId],
      );
      return rows;
    }
    const { rows } = await pool.query<ClientRow>(
      `SELECT id, name, segment, status
         FROM public.clients
        WHERE status NOT IN ('Arquivado', 'Inativo')
        ORDER BY name ASC
        LIMIT $1`,
      [limit],
    );
    return rows;
  } finally {
    await pool.end();
  }
}

async function loadPlanning(clientIds: string[]): Promise<Record<string, number | null>> {
  if (clientIds.length === 0) return {};
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<PlanningRow>(
      `SELECT client_id, cpl_meta::float AS "cplMeta"
         FROM public.client_planning
        WHERE client_id = ANY($1::text[])`,
      [clientIds],
    );
    return Object.fromEntries(rows.map((row) => [row.client_id, Number(row.cplMeta ?? 0) || null]));
  } catch {
    return {};
  } finally {
    await pool.end();
  }
}

async function fetchCampaigns(origin: string, clientId: string, period: OptimizerPeriodKey, limit: number): Promise<OptimizerCampaignInput[]> {
  const range = rangeForPeriod(period);
  const url = new URL('/api/campaigns', origin);
  url.searchParams.set('clientIds', clientId);
  url.searchParams.set('period', 'custom');
  url.searchParams.set('dateFrom', range.dateFrom);
  url.searchParams.set('dateTo', range.dateTo);
  url.searchParams.set('sortBy', 'spend');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return [];
  const all = await res.json() as OptimizerCampaignInput[];
  return all.filter((c) => {
    const s = (c.status ?? '').toUpperCase();
    return ['ACTIVE', 'ENABLED', 'IN_PROCESS', 'WITH_ISSUES'].includes(s);
  });
}

async function analyzeCampaign(origin: string, payload: ReturnType<typeof buildOptimizerPayloadFromCampaign>) {
  const res = await fetch(new URL('/api/otimizador/analisar', origin).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, force_ai: false }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const userId = request.headers.get('x-onmid-user-id') ?? '';
  const roleHint = request.headers.get('x-onmid-role') ?? '';
  if (!userId && roleHint !== 'Administrador') return false;

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<{ role: string }>(
      `SELECT role FROM public.users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    return rows[0]?.role === 'Administrador';
  } catch {
    return roleHint === 'Administrador';
  } finally {
    await pool.end();
  }
}

async function runDailyOptimizer(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const limitClients = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limitClients') ?? 60), 1), 200);
  const limitCampaigns = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limitCampaigns') ?? 8), 1), 30);
  const requestedPeriod = request.nextUrl.searchParams.get('period') as OptimizerPeriodKey | null;
  const periods = requestedPeriod && OPTIMIZER_PERIODS.some((period) => period.key === requestedPeriod)
    ? [requestedPeriod]
    : OPTIMIZER_PERIODS.map((period) => period.key);

  const clientId = request.nextUrl.searchParams.get('clientId') ?? undefined;
  const startedAt = Date.now();
  const clients = await loadClients(limitClients, clientId);
  const planning = await loadPlanning(clients.map((client) => client.id));
  const results: Array<{ clientId: string; clientName: string; period: string; campaigns: number; analyzed: number; errors: number }> = [];

  for (const client of clients) {
    if (Date.now() - startedAt > BUDGET_MS) break;

    for (const period of periods) {
      if (Date.now() - startedAt > BUDGET_MS) break;

      const campaigns = await fetchCampaigns(origin, client.id, period, limitCampaigns);
      let analyzed = 0;
      let errors = 0;

      for (const campaign of campaigns) {
        if (Date.now() - startedAt > BUDGET_MS) break;
        try {
          const payload = buildOptimizerPayloadFromCampaign({
            client,
            campaign,
            periodKey: period,
            cplMeta: planning[client.id] ?? null,
            requestKind: 'analise_completa',
          });
          await analyzeCampaign(origin, payload);
          analyzed += 1;
        } catch {
          errors += 1;
        }
      }

      results.push({
        clientId: client.id,
        clientName: client.name,
        period,
        campaigns: campaigns.length,
        analyzed,
        errors,
      });
    }
  }

  return Response.json({
    ok: true,
    processedClients: clients.length,
    processedWindows: results.length,
    analyzed: results.reduce((sum, item) => sum + item.analyzed, 0),
    errors: results.reduce((sum, item) => sum + item.errors, 0),
    stoppedByBudget: Date.now() - startedAt > BUDGET_MS,
    results,
  });
}

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runDailyOptimizer(request);
}

export async function POST(request: NextRequest) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: 'Apenas administradores podem iniciar a análise geral.' }, { status: 403 });
  }
  return runDailyOptimizer(request);
}
