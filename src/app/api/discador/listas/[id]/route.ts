import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import {
  ensureDiscadorSchema, contadoresDaLista, proximoContato, pendentesDaLista,
} from '@/lib/discador';

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f-]{36}$/i;

/** Tudo que a tela de discagem precisa numa chamada: lista, contadores, próximo e histórico recente. */
export async function GET(req: NextRequest, ctx: Ctx) {
  if (!getSession(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'id inválido' }, { status: 400 });
  const excluir = req.nextUrl.searchParams.get('excluir');

  const pool = makeServerPool();
  try {
    await ensureDiscadorSchema(pool);
    const { rows: [lista] } = await pool.query(
      `SELECT l.*, c.name AS client_name
         FROM public.discador_listas l
         LEFT JOIN public.clients c ON c.id = l.client_id
        WHERE l.id = $1`,
      [id],
    );
    if (!lista) return Response.json({ error: 'Lista não encontrada.' }, { status: 404 });

    const [contadores, proximo, pendentes, historico] = await Promise.all([
      contadoresDaLista(pool, id),
      proximoContato(pool, id, excluir && UUID.test(excluir) ? excluir : null),
      pendentesDaLista(pool, id),
      pool.query(
        `SELECT ch.id, ch.contato_id, ch.resultado, ch.interesse, ch.observacao, ch.registrada_at,
                co.empresa, co.nome_contato, co.telefone, co.lead_id
           FROM public.discador_chamadas ch
           JOIN public.discador_contatos co ON co.id = ch.contato_id
          WHERE ch.lista_id = $1
          ORDER BY ch.registrada_at DESC
          LIMIT 12`,
        [id],
      ).then(r => r.rows),
    ]);

    return Response.json({ lista, contadores, proximo: proximo.contato, motivo: proximo.motivo, pendentes, historico });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!getSession(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'id inválido' }, { status: 400 });
  const body = await req.json().catch(() => ({})) as { nome?: unknown; client_id?: unknown; arquivada?: unknown };

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.nome === 'string' && body.nome.trim()) { vals.push(body.nome.trim().slice(0, 120)); sets.push(`nome = $${vals.length}`); }
  if (body.client_id === null || typeof body.client_id === 'string') { vals.push(body.client_id || null); sets.push(`client_id = $${vals.length}`); }
  if (typeof body.arquivada === 'boolean') { vals.push(body.arquivada); sets.push(`arquivada = $${vals.length}`); }
  if (sets.length === 0) return Response.json({ error: 'Nada para alterar.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureDiscadorSchema(pool);
    vals.push(id);
    const { rows: [lista] } = await pool.query(
      `UPDATE public.discador_listas SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    if (!lista) return Response.json({ error: 'Lista não encontrada.' }, { status: 404 });
    return Response.json(lista);
  } finally {
    await pool.end();
  }
}

/** Apaga a lista e os contatos. Os leads que já foram para o CRM ficam lá — são do CRM. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!getSession(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'id inválido' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureDiscadorSchema(pool);
    const { rowCount } = await pool.query(`DELETE FROM public.discador_listas WHERE id = $1`, [id]);
    if (!rowCount) return Response.json({ error: 'Lista não encontrada.' }, { status: 404 });
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
