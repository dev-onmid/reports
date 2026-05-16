import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.agent_external_tools (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT        NOT NULL,
      description TEXT        NOT NULL,
      type        TEXT        NOT NULL CHECK (type IN ('webhook', 'zapi_whatsapp')),
      config      JSONB       NOT NULL DEFAULT '{}',
      enabled     BOOLEAN     NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      'SELECT id, name, description, type, config, enabled, created_at FROM public.agent_external_tools ORDER BY created_at DESC'
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    role?: string;
    id?: string;
    name: string;
    description: string;
    type: 'webhook' | 'zapi_whatsapp';
    config: Record<string, unknown>;
    enabled?: boolean;
  };

  if (body.role !== 'Administrador') {
    return Response.json({ error: 'Acesso negado' }, { status: 403 });
  }

  const pool = makeServerPool();
  try {
    await ensureTable(pool);

    if (body.id) {
      // Update existing
      await pool.query(
        `UPDATE public.agent_external_tools
         SET name=$2, description=$3, type=$4, config=$5, enabled=$6
         WHERE id=$1`,
        [body.id, body.name, body.description, body.type, JSON.stringify(body.config), body.enabled ?? true]
      );
      return Response.json({ ok: true });
    }

    const { rows } = await pool.query(
      `INSERT INTO public.agent_external_tools (name, description, type, config, enabled)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.name, body.description, body.type, JSON.stringify(body.config), body.enabled ?? true]
    );
    return Response.json(rows[0], { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  const role = req.nextUrl.searchParams.get('role');
  if (role !== 'Administrador') return Response.json({ error: 'Acesso negado' }, { status: 403 });
  if (!id) return Response.json({ error: 'ID obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.agent_external_tools WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
