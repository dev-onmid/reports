/**
 * Taxa de resposta por campanha de disparo.
 *
 * Rota separada da listagem de campanhas de propósito: a conta cruza a lista de
 * envios com as mensagens recebidas do CRM e é bem mais cara que o resto do
 * card. Pendurada no GET das campanhas, deixaria a tela inteira lenta por um
 * número que é informativo, não bloqueante.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { taxaDeRespostaPorCampanha } from '@/lib/disparos-respostas';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const ids = (new URL(request.url).searchParams.get('ids') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
  if (ids.length === 0) return Response.json({});

  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    // Só as campanhas que este usuário pode ver — o parceiro não lê a reputação
    // da carteira alheia.
    const { rows } = await pool.query<{ id: string }>(
      `SELECT c.id FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
        WHERE c.id = ANY($1::uuid[]) AND ($2::boolean OR cl.owner_id = $3)`,
      [ids, scope.unrestricted, scope.userId],
    );
    const permitidos = rows.map(r => r.id);
    if (permitidos.length === 0) return Response.json({});

    const mapa = await taxaDeRespostaPorCampanha(pool, permitidos);
    return Response.json(Object.fromEntries(mapa));
  } catch {
    // A taxa é informativa: falhar aqui não pode derrubar a tela de Disparos.
    return Response.json({});
  } finally {
    await pool.end();
  }
}
