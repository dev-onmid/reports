import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const ENSURE = `
  CREATE TABLE IF NOT EXISTS public.client_anota_ai_stores (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id          TEXT NOT NULL,
    store_name         TEXT NOT NULL,
    store_id           TEXT NOT NULL,
    ifood_store_id     TEXT,
    integration_token  TEXT NOT NULL,
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_status   TEXT,
    last_test_message  TEXT,
    last_test_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_client_anota_ai_stores_client ON public.client_anota_ai_stores (client_id);
`;

type AnotaAiPayload = {
  id?: string;
  storeName?: string;
  storeId?: string;
  ifoodStoreId?: string;
  integrationToken?: string;
  active?: boolean;
};

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;
  const pool = makeServerPool();
  try {
    await pool.query(ENSURE);
    const { rows } = await pool.query(
      `SELECT
         id::text,
         store_name AS "storeName",
         store_id AS "storeId",
         ifood_store_id AS "ifoodStoreId",
         integration_token AS "integrationToken",
         active,
         last_test_status AS "lastTestStatus",
         last_test_message AS "lastTestMessage",
         last_test_at AS "lastTestAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM public.client_anota_ai_stores
       WHERE client_id = $1
       ORDER BY active DESC, store_name ASC`,
      [clientId],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;
  const body = await req.json() as AnotaAiPayload;
  const storeName = clean(body.storeName);
  const storeId = clean(body.storeId);
  const integrationToken = clean(body.integrationToken);

  if (!storeName || !storeId || !integrationToken) {
    return Response.json({ error: 'Nome da loja, ID da loja e token são obrigatórios.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await pool.query(ENSURE);
    const { rows } = await pool.query(
      `INSERT INTO public.client_anota_ai_stores
         (client_id, store_name, store_id, ifood_store_id, integration_token, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING
         id::text,
         store_name AS "storeName",
         store_id AS "storeId",
         ifood_store_id AS "ifoodStoreId",
         integration_token AS "integrationToken",
         active,
         last_test_status AS "lastTestStatus",
         last_test_message AS "lastTestMessage",
         last_test_at AS "lastTestAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [clientId, storeName, storeId, clean(body.ifoodStoreId) || null, integrationToken, body.active ?? true],
    );
    return Response.json(rows[0], { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;
  const body = await req.json() as AnotaAiPayload;
  const id = clean(body.id);
  const storeName = clean(body.storeName);
  const storeId = clean(body.storeId);
  const integrationToken = clean(body.integrationToken);

  if (!id || !storeName || !storeId || !integrationToken) {
    return Response.json({ error: 'ID, nome da loja, ID da loja e token são obrigatórios.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await pool.query(ENSURE);
    const { rows } = await pool.query(
      `UPDATE public.client_anota_ai_stores
       SET store_name = $3,
           store_id = $4,
           ifood_store_id = $5,
           integration_token = $6,
           active = $7,
           updated_at = NOW()
       WHERE id = $1 AND client_id = $2
       RETURNING
         id::text,
         store_name AS "storeName",
         store_id AS "storeId",
         ifood_store_id AS "ifoodStoreId",
         integration_token AS "integrationToken",
         active,
         last_test_status AS "lastTestStatus",
         last_test_message AS "lastTestMessage",
         last_test_at AS "lastTestAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [id, clientId, storeName, storeId, clean(body.ifoodStoreId) || null, integrationToken, body.active ?? true],
    );
    if (!rows[0]) return Response.json({ error: 'Loja não encontrada.' }, { status: 404 });
    return Response.json(rows[0]);
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return Response.json({ error: 'storeId obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await pool.query(ENSURE);
    await pool.query(
      `DELETE FROM public.client_anota_ai_stores WHERE id = $1 AND client_id = $2`,
      [storeId, clientId],
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
