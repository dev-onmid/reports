import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const ENSURE = `
  CREATE TABLE IF NOT EXISTS public.client_vault (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   TEXT NOT NULL,
    title       TEXT NOT NULL,
    url         TEXT,
    login       TEXT,
    password_enc TEXT,
    category    TEXT NOT NULL DEFAULT 'Outros',
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_client_vault_client ON public.client_vault (client_id);
`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const pool = makeServerPool();
  try {
    await pool.query(ENSURE);
    const { rows } = await pool.query(
      `SELECT id::text, title, url, login, password_enc, category, notes, created_at, updated_at
       FROM public.client_vault WHERE client_id = $1
       ORDER BY category, title`,
      [clientId]
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const body = await req.json() as {
    title: string; url?: string; login?: string;
    password_enc?: string; category?: string; notes?: string;
  };
  if (!body.title?.trim()) return Response.json({ error: 'Título obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await pool.query(ENSURE);
    const { rows } = await pool.query(
      `INSERT INTO public.client_vault (client_id, title, url, login, password_enc, category, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id::text, title, url, login, password_enc, category, notes, created_at, updated_at`,
      [clientId, body.title.trim(), body.url ?? null, body.login ?? null,
       body.password_enc ?? null, body.category ?? 'Outros', body.notes ?? null]
    );
    return Response.json(rows[0], { status: 201 });
  } finally {
    await pool.end();
  }
}
