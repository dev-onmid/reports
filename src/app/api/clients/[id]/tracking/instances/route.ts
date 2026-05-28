import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, instance_id, token, ativo, created_at
       FROM public.client_zapi_instances
       WHERE client_id = $1 ORDER BY created_at ASC`,
      [id],
    );
    return Response.json(rows);
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    nome?: string;
    instance_id?: string;
    token?: string;
  };

  if (!body.nome || !body.instance_id || !body.token) {
    return Response.json({ error: 'nome, instance_id e token são obrigatórios' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const { rows: [row] } = await pool.query(`
      INSERT INTO public.client_zapi_instances (client_id, nome, instance_id, token)
      VALUES ($1, $2, $3, $4)
      RETURNING id, nome, instance_id, token, ativo, created_at
    `, [id, body.nome, body.instance_id, body.token]);
    return Response.json(row, { status: 201 });
  } finally {
    await pool.end();
  }
}
