import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.leadlovers_config (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id     TEXT NOT NULL,
      webhook_url  TEXT NOT NULL,
      machine_code TEXT,
      auth_key     TEXT,
      last_test_at TIMESTAMPTZ,
      last_test_ok BOOLEAN,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(owner_id)
    );
    ALTER TABLE public.leadlovers_config ADD COLUMN IF NOT EXISTS machine_code TEXT;
    ALTER TABLE public.leadlovers_config ADD COLUMN IF NOT EXISTS auth_key TEXT;
  `);
}

function buildHeaders(authKey?: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authKey?.trim()) headers['Authorization'] = `Bearer ${authKey.trim()}`;
  return headers;
}

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const { rows: [cfg] } = await pool.query(
      `SELECT * FROM public.leadlovers_config WHERE owner_id = $1`,
      [scope.userId],
    );
    return Response.json(cfg ?? null);
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
      webhook_url: string;
      machine_code?: string;
      auth_key?: string;
    };
    if (!body.webhook_url?.trim()) return Response.json({ error: 'URL obrigatória' }, { status: 400 });

    const { rows: [cfg] } = await pool.query(
      `INSERT INTO public.leadlovers_config (owner_id, webhook_url, machine_code, auth_key, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (owner_id) DO UPDATE SET
         webhook_url  = EXCLUDED.webhook_url,
         machine_code = EXCLUDED.machine_code,
         auth_key     = EXCLUDED.auth_key,
         updated_at   = NOW()
       RETURNING *`,
      [scope.userId, body.webhook_url.trim(), body.machine_code?.trim() ?? null, body.auth_key?.trim() ?? null],
    );
    return Response.json(cfg);
  } finally {
    await pool.end();
  }
}

export async function PUT(req: NextRequest) {
  // Test connection
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json() as {
      webhook_url: string;
      machine_code?: string;
      email_sequence_code?: string;
      sequence_level_code?: string;
      auth_key?: string;
    };
    if (!body.webhook_url?.trim()) return Response.json({ error: 'URL obrigatória' }, { status: 400 });

    let testOk = false;
    let httpStatus = 0;
    let responseBody = '';
    try {
      const testPayload: Record<string, unknown> = {
        Name:  'Teste ONMID',
        Email: 'teste@onmid.com.br',
        Phone: '11999999999',
      };
      if (body.machine_code?.trim())        testPayload.MachineCode       = body.machine_code.trim();
      if (body.email_sequence_code?.trim()) testPayload.EmailSequenceCode = body.email_sequence_code.trim();
      if (body.sequence_level_code?.trim()) testPayload.SequenceLevelCode = body.sequence_level_code.trim();

      const res = await fetch(body.webhook_url.trim(), {
        method: 'POST',
        headers: buildHeaders(body.auth_key),
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(8000),
      });
      httpStatus = res.status;
      responseBody = await res.text().catch(() => '');
      testOk = res.ok;
    } catch (err: unknown) {
      responseBody = err instanceof Error ? err.message : 'Erro de conexão';
    }

    // Persist
    await pool.query(
      `INSERT INTO public.leadlovers_config
         (owner_id, webhook_url, machine_code, auth_key, last_test_at, last_test_ok, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), $5, NOW())
       ON CONFLICT (owner_id) DO UPDATE SET
         webhook_url  = EXCLUDED.webhook_url,
         machine_code = EXCLUDED.machine_code,
         auth_key     = EXCLUDED.auth_key,
         last_test_at = NOW(),
         last_test_ok = $5,
         updated_at   = NOW()`,
      [scope.userId, body.webhook_url.trim(), body.machine_code?.trim() ?? null, body.auth_key?.trim() ?? null, testOk],
    );

    return Response.json({ ok: testOk, httpStatus, responseBody });
  } finally {
    await pool.end();
  }
}
