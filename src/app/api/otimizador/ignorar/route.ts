import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureOptimizerRecStatusTable } from '@/lib/optimizer';
import { upsertRecStatus } from '@/lib/optimizer-execucao';

// Marca uma recomendação como ignorada (com autor/timestamp/motivo). Não toca a conta de
// anúncio. Some da fila e não reaparece a menos que uma nova análise a gere de novo.

type IgnorarBody = {
  rec_id: string;
  analise_id?: string;
  cliente_id: string;
  objeto_id?: string;
  motivo?: string;
  autor_id?: string;
  autor_nome?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as IgnorarBody;
  if (!body.rec_id || !body.cliente_id) {
    return Response.json({ error: 'rec_id e cliente_id são obrigatórios.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureOptimizerRecStatusTable(pool);
    await upsertRecStatus(pool, {
      rec_id: body.rec_id,
      analise_id: body.analise_id,
      cliente_id: body.cliente_id,
      objeto_id: body.objeto_id,
      status: 'ignorado',
      autor_id: body.autor_id,
      autor_nome: body.autor_nome,
      motivo: body.motivo,
    });
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
