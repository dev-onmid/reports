import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { fetchEvolutionInstances } from '@/lib/evolution-api';
import { getCallerScope } from '@/lib/disparos-access';
import { carregarVinculos, montarDestinos, instanciasOrfas } from '@/lib/disparos-destinos';

/**
 * Destinos de disparo = CLIENTES com instância de WhatsApp, com o status lido
 * ao vivo da Evolution. Substitui a lista de `zapi_clients` que a tela usava:
 * ela só mostrava as instâncias criadas pela própria tela de Disparos (3), e
 * não os 18 clientes que realmente têm número vinculado.
 */
export async function GET(request: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);

    const [vinculos, zapiRows] = await Promise.all([
      carregarVinculos(pool).catch(() => []),
      pool.query<{ instance_id: string }>(
        `SELECT instance_id FROM public.zapi_clients WHERE ($1::boolean OR owner_id = $2)`,
        [scope.unrestricted, scope.userId],
      ).then(r => r.rows).catch(() => []),
    ]);

    // Instância fora do ar não pode derrubar a tela inteira: sem a Evolution
    // ninguém aparece como conectado (falha FECHADA — melhor bloquear o disparo
    // do que deixar criar campanha contra um servidor que não respondeu).
    let vivas: { name: string; connectionStatus: string | null }[] = [];
    let erroEvolution = '';
    try {
      vivas = await fetchEvolutionInstances();
    } catch (err) {
      erroEvolution = String(err instanceof Error ? err.message : err);
    }

    return Response.json({
      clientes: montarDestinos(vinculos, vivas),
      orfas: instanciasOrfas(vivas, vinculos, zapiRows.map(r => r.instance_id)),
      erroEvolution,
    });
  } catch (err) {
    return Response.json({ clientes: [], orfas: [], erroEvolution: String(err) });
  } finally {
    await pool.end();
  }
}
