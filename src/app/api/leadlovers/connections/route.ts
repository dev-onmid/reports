import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
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
  `);
}

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const clientId = new URL(req.url).searchParams.get('client_id');
    const conditions: string[] = ['($1::boolean OR owner_id = $2)'];
    const params: unknown[] = [scope.unrestricted, scope.userId];
    if (clientId) { conditions.push(`client_id = $${params.length + 1}`); params.push(clientId); }

    const { rows } = await pool.query(
      `SELECT * FROM public.leadlovers_connections
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC`,
      params,
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
      client_id: string;
      name: string;
      webhook_url: string;
      machine_code?: string;
      email_sequence_code?: string;
      sequence_level_code?: string;
      auth_key?: string;
    };
    if (!body.client_id?.trim())    return Response.json({ error: 'Cliente obrigatório' }, { status: 400 });
    if (!body.name?.trim())         return Response.json({ error: 'Nome da conexão obrigatório' }, { status: 400 });
    if (!body.webhook_url?.trim())  return Response.json({ error: 'URL do webhook obrigatória' }, { status: 400 });

    const { rows: [connection] } = await pool.query(
      `INSERT INTO public.leadlovers_connections
         (owner_id, client_id, name, webhook_url, machine_code, email_sequence_code, sequence_level_code, auth_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        scope.userId,
        body.client_id.trim(),
        body.name.trim(),
        body.webhook_url.trim(),
        body.machine_code?.trim() ?? null,
        body.email_sequence_code?.trim() ?? null,
        body.sequence_level_code?.trim() ?? '1',
        body.auth_key?.trim() ?? null,
      ],
    );
    return Response.json(connection, { status: 201 });
  } finally {
    await pool.end();
  }
}
