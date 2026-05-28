import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { createEvolutionInstance } from '@/lib/evolution-api';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, instance_id, token, ativo, provider, created_at
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
    provider?: 'zapi' | 'evolution';
  };

  if (!body.nome) {
    return Response.json({ error: 'nome é obrigatório' }, { status: 400 });
  }

  const provider = body.provider === 'evolution' ? 'evolution' : 'zapi';
  let instanceId = (body.instance_id ?? '').trim();
  let token = (body.token ?? '').trim();

  if (provider === 'zapi') {
    if (!instanceId || !token) {
      return Response.json({ error: 'instance_id e token são obrigatórios para Z-API' }, { status: 400 });
    }
  }

  if (provider === 'evolution') {
    if (!instanceId) {
      return Response.json({ error: 'Nome da instância (Evolution API) é obrigatório' }, { status: 400 });
    }
    try {
      const created = await createEvolutionInstance(instanceId);
      token = created.hash;
    } catch (err) {
      return Response.json(
        { error: `Erro ao criar instância na Evolution API: ${String(err)}` },
        { status: 502 },
      );
    }
  }

  const pool = makeServerPool();
  try {
    const { rows: [row] } = await pool.query(`
      INSERT INTO public.client_zapi_instances (client_id, nome, instance_id, token, provider)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, nome, instance_id, token, ativo, provider, created_at
    `, [id, body.nome, instanceId, token, provider]);
    return Response.json(row, { status: 201 });
  } finally {
    await pool.end();
  }
}
