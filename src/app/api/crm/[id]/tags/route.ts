// Tags de qualificação de UM lead — a recepção marca/desmarca direto no card.
//
// PUT define a lista COMPLETA (`{ tagIds: [] }` limpa). É a única porta de
// escrita de associação: o proxy já resolve o dono do lead pelo id do caminho,
// e a lib confere de novo que cada tag é do mesmo cliente do lead.
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { definirTagsDoLead, ensureCrmTagsSchema } from '@/lib/crm-tags';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null) as { tagIds?: unknown } | null;
  if (!body || !Array.isArray(body.tagIds)) return Response.json({ error: 'tagIds (lista) é obrigatório.' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureCrmTagsSchema(pool);
    const { rows: [lead] } = await pool.query<{ client_id: string }>(`SELECT client_id FROM public.crm_leads WHERE id = $1`, [id]);
    if (!lead) return Response.json({ error: 'Lead não encontrado.' }, { status: 404 });
    const tags = await definirTagsDoLead(pool, lead.client_id, id, body.tagIds.filter((t): t is string => typeof t === 'string'));
    return Response.json({ tags: tags ?? [] });
  } catch (err) {
    console.error('[crm/[id]/tags PUT]', err);
    return Response.json({ error: 'Não foi possível salvar as tags.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
