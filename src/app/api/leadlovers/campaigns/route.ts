import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.leadlovers_campaigns (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id       TEXT NOT NULL,
      name           TEXT NOT NULL,
      webhook_url    TEXT NOT NULL,
      machine_code   TEXT,
      auth_key       TEXT,
      status         TEXT DEFAULT 'rascunho',
      total_contacts INTEGER DEFAULT 0,
      total_sent     INTEGER DEFAULT 0,
      total_errors   INTEGER DEFAULT 0,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE public.leadlovers_campaigns ADD COLUMN IF NOT EXISTS machine_code TEXT;
    ALTER TABLE public.leadlovers_campaigns ADD COLUMN IF NOT EXISTS auth_key TEXT;
    CREATE TABLE IF NOT EXISTS public.leadlovers_schedule_rules (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id      UUID NOT NULL REFERENCES public.leadlovers_campaigns(id) ON DELETE CASCADE,
      date_from        DATE NOT NULL,
      date_to          DATE NOT NULL,
      qty_per_day      INTEGER NOT NULL,
      interval_minutes INTEGER,
      send_time        TIME DEFAULT '09:00',
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const { rows } = await pool.query(
      `SELECT c.*,
              COALESCE(
                (SELECT json_agg(r ORDER BY r.date_from)
                   FROM public.leadlovers_schedule_rules r
                  WHERE r.campaign_id = c.id),
                '[]'
              ) AS rules
         FROM public.leadlovers_campaigns c
        WHERE ($1::boolean OR c.owner_id = $2)
        ORDER BY c.created_at DESC`,
      [scope.unrestricted, scope.userId],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json() as {
      name: string;
      webhook_url: string;
      machine_code?: string;
      auth_key?: string;
    };
    if (!body.name?.trim())        return Response.json({ error: 'Nome obrigatório' }, { status: 400 });
    if (!body.webhook_url?.trim()) return Response.json({ error: 'URL do webhook obrigatória' }, { status: 400 });

    const { rows: [campaign] } = await pool.query(
      `INSERT INTO public.leadlovers_campaigns (owner_id, name, webhook_url, machine_code, auth_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        scope.userId,
        body.name.trim(),
        body.webhook_url.trim(),
        body.machine_code?.trim() ?? null,
        body.auth_key?.trim() ?? null,
      ],
    );
    return Response.json({ ...campaign, rules: [] }, { status: 201 });
  } finally {
    await pool.end();
  }
}
