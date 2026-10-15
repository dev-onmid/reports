import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { analisarCampanhas } from '@/lib/disparos-resultado-server';
import { JANELA_PEDIDO_DIAS } from '@/lib/disparos-resultado';

export const maxDuration = 30;

/** Detalhe do modal "Respostas": resumo + contato a contato (resposta, classe, compra). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    const { rows: [c] } = await pool.query<{ name: string; owner_id: string | null }>(
      `SELECT c.name, cl.owner_id FROM public.zapi_campaigns c JOIN public.zapi_clients cl ON cl.id = c.client_id WHERE c.id = $1`,
      [id],
    );
    if (!c) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });
    if (!scope.unrestricted && c.owner_id !== scope.userId) return Response.json({ error: 'Sem permissão para esta campanha' }, { status: 403 });

    const { resumos, contatos, onmidClientId } = await analisarCampanhas(pool, [id], id);
    return Response.json({
      ok: true, campanha: c.name, onmidClientId, janelaDias: JANELA_PEDIDO_DIAS,
      resumo: resumos.get(id) ?? null,
      contatos,
    });
  } finally {
    await pool.end();
  }
}
