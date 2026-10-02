import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureDiscadorSchema, normalizarTelefone } from '@/lib/discador';

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

/** Um contato escolhido à mão na tabela ("ligar para este agora"). */
export async function GET(req: NextRequest, ctx: Ctx) {
  if (!getSession(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'id inválido' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureDiscadorSchema(pool);
    const { rows: [contato] } = await pool.query(`SELECT * FROM public.discador_contatos WHERE id = $1`, [id]);
    if (!contato) return Response.json({ error: 'Contato não encontrado.' }, { status: 404 });
    const { rows: chamadas } = await pool.query(
      `SELECT resultado, interesse, observacao, registrada_at FROM public.discador_chamadas
        WHERE contato_id = $1 ORDER BY registrada_at DESC LIMIT 10`,
      [id],
    );
    return Response.json({ ...contato, chamadas });
  } finally {
    await pool.end();
  }
}

/**
 * Correções pequenas sem passar pelo fluxo de ligação: nome de quem atende,
 * telefone digitado errado, observação, pular (vai para o fim) ou devolver
 * para a fila alguém que foi marcado por engano.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!getSession(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'id inválido' }, { status: 400 });
  const body = await req.json().catch(() => ({})) as {
    nome_contato?: unknown; observacao?: unknown; telefone?: unknown; empresa?: unknown;
    acao?: 'pular' | 'voltar_fila';
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : undefined);

  const nome = str(body.nome_contato, 120);
  if (nome !== undefined) { vals.push(nome); sets.push(`nome_contato = $${vals.length}`); }
  const empresa = str(body.empresa, 200);
  if (empresa !== undefined) { vals.push(empresa); sets.push(`empresa = $${vals.length}`); }
  const obs = str(body.observacao, 2000);
  if (obs !== undefined) { vals.push(obs); sets.push(`observacao = $${vals.length}`); }
  if (body.telefone !== undefined) {
    const tel = normalizarTelefone(body.telefone);
    if (!tel) return Response.json({ error: 'Telefone inválido.' }, { status: 400 });
    vals.push(tel); sets.push(`telefone = $${vals.length}`);
  }
  if (body.acao === 'pular') sets.push(`pulado_at = NOW()`);
  if (body.acao === 'voltar_fila') sets.push(`status = 'fila'`, `proxima_tentativa_at = NULL`, `pulado_at = NULL`);
  if (sets.length === 0) return Response.json({ error: 'Nada para alterar.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureDiscadorSchema(pool);
    vals.push(id);
    const { rows: [contato] } = await pool.query(
      `UPDATE public.discador_contatos SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    if (!contato) return Response.json({ error: 'Contato não encontrado.' }, { status: 404 });
    return Response.json(contato);
  } finally {
    await pool.end();
  }
}
