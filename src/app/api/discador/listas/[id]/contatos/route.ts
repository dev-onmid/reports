import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureDiscadorSchema } from '@/lib/discador';

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Contatos da lista para a tabela de revisão. `filtro` agrupa os status do
 * jeito que a pessoa pensa: quem falta, quem atendeu, quem não atendeu.
 */
const FILTROS: Record<string, string> = {
  fila: `status = 'fila'`,
  atenderam: `status IN ('atendeu','retornar')`,
  sem_resposta: `status IN ('nao_atendeu','caixa_postal')`,
  numero_errado: `status = 'numero_errado'`,
  leads: `lead_id IS NOT NULL`,
  todos: `TRUE`,
};

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!getSession(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'id inválido' }, { status: 400 });
  const sp = req.nextUrl.searchParams;
  const filtro = FILTROS[sp.get('filtro') ?? 'todos'] ?? FILTROS.todos;
  const q = (sp.get('q') ?? '').trim().toLowerCase();
  const limite = Math.min(Number(sp.get('limite')) || 300, 1000);

  const pool = makeServerPool();
  try {
    await ensureDiscadorSchema(pool);
    const vals: unknown[] = [id, limite];
    let busca = '';
    if (q) {
      vals.push(`%${q}%`);
      busca = `AND (LOWER(COALESCE(empresa,'')) LIKE $3 OR LOWER(COALESCE(nome_contato,'')) LIKE $3
                    OR LOWER(COALESCE(cidade,'')) LIKE $3 OR telefone LIKE $3)`;
    }
    const { rows } = await pool.query(
      `SELECT * FROM public.discador_contatos
        WHERE lista_id = $1 AND ${filtro} ${busca}
        ORDER BY CASE WHEN status = 'retornar' THEN 0 ELSE 1 END, proxima_tentativa_at ASC NULLS LAST, posicao ASC
        LIMIT $2`,
      vals,
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
