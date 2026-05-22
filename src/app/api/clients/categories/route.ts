import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_categories (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL UNIQUE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  for (const name of ['Clínica', 'Serviço', 'Delivery/Fast Food']) {
    await pool.query(
      `INSERT INTO public.client_categories (name, is_default) VALUES ($1, TRUE) ON CONFLICT (name) DO NOTHING`,
      [name],
    );
  }
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      `SELECT id, name, is_default FROM public.client_categories ORDER BY is_default DESC, name ASC`,
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const { name } = await req.json() as { name: string };
  if (!name?.trim()) return Response.json({ error: 'Nome obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.client_categories (name) VALUES ($1) RETURNING id, name, is_default`,
      [name.trim()],
    );
    return Response.json(row, { status: 201 });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505') return Response.json({ error: 'Categoria já existe' }, { status: 409 });
    throw e;
  } finally {
    await pool.end();
  }
}
