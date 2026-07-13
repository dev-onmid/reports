import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    -- precisa existir antes da FK connection_id abaixo
    CREATE TABLE IF NOT EXISTS public.leadlovers_connections (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id             TEXT NOT NULL,
      client_id            TEXT NOT NULL,
      name                 TEXT NOT NULL,
      webhook_url          TEXT NOT NULL,
      machine_code         TEXT,
      email_sequence_code  TEXT,
      sequence_level_code  TEXT DEFAULT '1',
      auth_key             TEXT,
      created_at           TIMESTAMPTZ DEFAULT NOW(),
      updated_at           TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.leadlovers_campaigns (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id       TEXT NOT NULL,
      name           TEXT NOT NULL,
      webhook_url    TEXT NOT NULL,
      machine_code        TEXT,
      email_sequence_code TEXT,
      sequence_level_code TEXT DEFAULT '1',
      auth_key             TEXT,
      status              TEXT DEFAULT 'rascunho',
      total_contacts INTEGER DEFAULT 0,
      total_sent     INTEGER DEFAULT 0,
      total_errors   INTEGER DEFAULT 0,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE public.leadlovers_campaigns ADD COLUMN IF NOT EXISTS machine_code TEXT;
    ALTER TABLE public.leadlovers_campaigns ADD COLUMN IF NOT EXISTS email_sequence_code TEXT;
    ALTER TABLE public.leadlovers_campaigns ADD COLUMN IF NOT EXISTS sequence_level_code TEXT DEFAULT '1';
    ALTER TABLE public.leadlovers_campaigns ADD COLUMN IF NOT EXISTS auth_key TEXT;
    ALTER TABLE public.leadlovers_campaigns ADD COLUMN IF NOT EXISTS client_id TEXT;
    ALTER TABLE public.leadlovers_campaigns ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES public.leadlovers_connections(id) ON DELETE SET NULL;
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
      `SELECT c.*, cl.name AS client_name, conn.name AS connection_name,
              COALESCE(
                (SELECT json_agg(r ORDER BY r.date_from)
                   FROM public.leadlovers_schedule_rules r
                  WHERE r.campaign_id = c.id),
                '[]'
              ) AS rules
         FROM public.leadlovers_campaigns c
         LEFT JOIN public.clients cl ON cl.id = c.client_id
         LEFT JOIN public.leadlovers_connections conn ON conn.id = c.connection_id
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
      client_id: string;
      connection_id?: string;
      new_connection?: {
        name: string;
        webhook_url: string;
        machine_code?: string;
        email_sequence_code?: string;
        sequence_level_code?: string;
        auth_key?: string;
      };
    };
    if (!body.name?.trim())      return Response.json({ error: 'Nome obrigatório' }, { status: 400 });
    if (!body.client_id?.trim()) return Response.json({ error: 'Cliente obrigatório' }, { status: 400 });
    if (!body.connection_id && !body.new_connection) {
      return Response.json({ error: 'Selecione uma conexão existente ou informe as credenciais de uma nova' }, { status: 400 });
    }

    let connection: {
      id: string; webhook_url: string; machine_code: string | null;
      email_sequence_code: string | null; sequence_level_code: string | null; auth_key: string | null;
    };

    if (body.new_connection) {
      const nc = body.new_connection;
      if (!nc.name?.trim())        return Response.json({ error: 'Nome da conexão obrigatório' }, { status: 400 });
      if (!nc.webhook_url?.trim()) return Response.json({ error: 'URL do webhook obrigatória' }, { status: 400 });

      const { rows: [created] } = await pool.query(
        `INSERT INTO public.leadlovers_connections
           (owner_id, client_id, name, webhook_url, machine_code, email_sequence_code, sequence_level_code, auth_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          scope.userId,
          body.client_id.trim(),
          nc.name.trim(),
          nc.webhook_url.trim(),
          nc.machine_code?.trim() ?? null,
          nc.email_sequence_code?.trim() ?? null,
          nc.sequence_level_code?.trim() ?? '1',
          nc.auth_key?.trim() ?? null,
        ],
      );
      connection = created;
    } else {
      const { rows: [found] } = await pool.query(
        `SELECT * FROM public.leadlovers_connections
          WHERE id = $1 AND client_id = $2 AND ($3::boolean OR owner_id = $4)`,
        [body.connection_id, body.client_id.trim(), scope.unrestricted, scope.userId],
      );
      if (!found) return Response.json({ error: 'Conexão não encontrada para este cliente' }, { status: 404 });
      connection = found;
    }

    const { rows: [campaign] } = await pool.query(
      `INSERT INTO public.leadlovers_campaigns
         (owner_id, client_id, connection_id, name, webhook_url, machine_code, email_sequence_code, sequence_level_code, auth_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        scope.userId,
        body.client_id.trim(),
        connection.id,
        body.name.trim(),
        connection.webhook_url,
        connection.machine_code,
        connection.email_sequence_code,
        connection.sequence_level_code,
        connection.auth_key,
      ],
    );
    return Response.json({ ...campaign, rules: [] }, { status: 201 });
  } finally {
    await pool.end();
  }
}
