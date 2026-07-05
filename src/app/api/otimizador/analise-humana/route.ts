import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureOptimizerRecStatusTable } from '@/lib/optimizer';
import { upsertRecStatus } from '@/lib/optimizer-execucao';

// Envia uma recomendação de baixa confiança / não aplicável para análise de um humano.
// Não executa nada na conta de anúncio. Sai da fila do operador e fica marcada como
// "em análise humana", atribuída a um responsável.

type AnaliseHumanaBody = {
  rec_id: string;
  analise_id?: string;
  cliente_id: string;
  objeto_id?: string;
  atribuido_a?: string;   // id/nome do analista designado
  motivo?: string;
  autor_id?: string;
  autor_nome?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as AnaliseHumanaBody;
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
      status: 'em_analise_humana',
      autor_id: body.autor_id,
      autor_nome: body.autor_nome,
      motivo: body.motivo,
      atribuido_a: body.atribuido_a,
    });
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
