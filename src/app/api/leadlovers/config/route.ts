import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.leadlovers_config (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id     TEXT NOT NULL,
      webhook_url  TEXT NOT NULL,
      last_test_at TIMESTAMPTZ,
      last_test_ok BOOLEAN,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(owner_id)
    )
  `);
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

    const { webhook_url } = await req.json() as { webhook_url: string };
    if (!webhook_url?.trim()) return Response.json({ error: 'URL obrigatória' }, { status: 400 });

    const { rows: [cfg] } = await pool.query(
      `INSERT INTO public.leadlovers_config (owner_id, webhook_url, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (owner_id) DO UPDATE SET webhook_url = EXCLUDED.webhook_url, updated_at = NOW()
       RETURNING *`,
      [scope.userId, webhook_url.trim()],
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

    const { webhook_url } = await req.json() as { webhook_url: string };
    if (!webhook_url?.trim()) return Response.json({ error: 'URL obrigatória' }, { status: 400 });

    let testOk = false;
    let httpStatus = 0;
    let responseBody = '';
    try {
      const testPayload = {
        nome: 'Teste ONMID',
        email: 'teste@onmid.com.br',
        telefone: '11999999999',
        empresa: 'ONMID',
        _test: true,
      };
      const res = await fetch(webhook_url.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(8000),
      });
      httpStatus = res.status;
      responseBody = await res.text().catch(() => '');
      testOk = res.ok;
    } catch (err: unknown) {
      responseBody = err instanceof Error ? err.message : 'Erro de conexão';
    }

    // Persist last test result
    await pool.query(
      `INSERT INTO public.leadlovers_config (owner_id, webhook_url, last_test_at, last_test_ok, updated_at)
       VALUES ($1, $2, NOW(), $3, NOW())
       ON CONFLICT (owner_id) DO UPDATE SET
         webhook_url = EXCLUDED.webhook_url,
         last_test_at = NOW(),
         last_test_ok = $3,
         updated_at = NOW()`,
      [scope.userId, webhook_url.trim(), testOk],
    );

    return Response.json({ ok: testOk, httpStatus, responseBody });
  } finally {
    await pool.end();
  }
}
