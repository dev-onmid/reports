/**
 * Etiquetas (labels) de uma instância de WhatsApp, para a campanha escolher
 * qual pendurar em quem receber o disparo.
 *
 * Só LISTA o que já existe: criar etiqueta é decisão do cliente, feita no
 * WhatsApp dele. Inventar etiqueta pela API encheria a conta de rótulo que
 * ninguém pediu e que só ele pode limpar.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { fetchEvolutionLabels } from '@/lib/evolution-api';
import { getCallerScope } from '@/lib/disparos-access';
import { carregarVinculos } from '@/lib/disparos-destinos';

export const maxDuration = 20;

export async function GET(request: NextRequest) {
  const instanceId = (new URL(request.url).searchParams.get('instanceId') ?? '').trim();
  if (!instanceId) return Response.json({ etiquetas: [], erro: '' });

  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);

    // ⚠️ A instância precisa ser uma que este usuário já enxerga em Disparos —
    // senão a rota viraria um leitor das etiquetas de qualquer número da VPS,
    // inclusive de carteira de outro parceiro.
    const [vinculos, proprias] = await Promise.all([
      carregarVinculos(pool).catch(() => []),
      pool.query<{ instance_id: string }>(
        `SELECT instance_id FROM public.zapi_clients WHERE ($1::boolean OR owner_id = $2)`,
        [scope.unrestricted, scope.userId],
      ).then(r => r.rows.map(x => x.instance_id)).catch(() => [] as string[]),
    ]);
    const permitida = scope.unrestricted
      ? vinculos.some(v => v.instanceId === instanceId) || proprias.includes(instanceId)
      : proprias.includes(instanceId);
    if (!permitida) {
      return Response.json({ etiquetas: [], erro: 'Sem permissão para esta instância.' }, { status: 403 });
    }

    const etiquetas = await fetchEvolutionLabels(instanceId);
    return Response.json({ etiquetas, erro: '' });
  } catch (err) {
    // A etiqueta é opcional na campanha: Evolution fora do ar não pode impedir
    // o gestor de criar o disparo — a tela mostra o motivo e segue sem etiqueta.
    return Response.json({ etiquetas: [], erro: String(err instanceof Error ? err.message : err) });
  } finally {
    await pool.end();
  }
}
