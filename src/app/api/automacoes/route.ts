import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  return pool.query(`
    CREATE TABLE IF NOT EXISTS public.webhook_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
      description TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_configs_token ON public.webhook_configs (token);
    CREATE TABLE IF NOT EXISTS public.webhook_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token TEXT,
      config_name TEXT,
      event_type TEXT,
      payload JSONB,
      status TEXT NOT NULL DEFAULT 'success',
      result JSONB,
      error_msg TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_logs_received_at ON public.webhook_logs (received_at DESC);
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query(
      `SELECT id, name, token, description, enabled, created_at FROM public.webhook_configs ORDER BY created_at DESC`,
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const { name, description } = await request.json() as { name: string; description?: string };
  if (!name?.trim()) return Response.json({ error: 'Nome obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.webhook_configs (name, description) VALUES ($1, $2) RETURNING *`,
      [name.trim(), description ?? null],
    );
    return Response.json(row, { status: 201 });
  } finally {
    await pool.end();
  }
}
