/**
 * Aplica no banco o plano de `funil-externo.ts`.
 *
 * Separado da lib pura porque toca `pg` — mesmo par que `agendor.ts` /
 * `agendor-server.ts`. Serve qualquer fonte externa (SULTS, Agendor,
 * Datalytics, planilha): quem chama passa as etapas NA ORDEM de lá.
 */

import type { Pool } from 'pg';
import {
  CORES_ETAPA, normalizarRotulo, planejarFunil, type PlanoFunil, type UsoEtapa,
} from '@/lib/funil-externo';

export type ResultadoFunil = {
  modo: PlanoFunil['modo'];
  criadas: number;
  removidas: number;
  reordenadas: number;
  preservadas: PlanoFunil['preservadas'];
};

/**
 * Quantos leads e quantos gatilhos apontam para cada rótulo de etapa.
 *
 * ⚠️ É o que impede apagar coluna viva. `crm_leads.status` é TEXTO livre, e as
 * automações (`client_conversion_eventos_custom.status_gatilho`,
 * `crm_followup_regras.status_gatilho`) também miram pelo rótulo — nenhuma
 * delas tem chave estrangeira para `crm_stages`, então o banco não protegeria
 * nada sozinho.
 */
async function levantarUso(pool: Pool, clientId: string): Promise<Map<string, UsoEtapa>> {
  const uso = new Map<string, UsoEtapa>();
  const soma = (rotulo: string, campo: keyof UsoEtapa, n: number) => {
    const k = normalizarRotulo(rotulo);
    const atual = uso.get(k) ?? { leads: 0, gatilhos: 0 };
    atual[campo] += n;
    uso.set(k, atual);
  };

  const { rows: leads } = await pool.query<{ status: string; n: string }>(
    `SELECT COALESCE(status, '') status, COUNT(*)::text n
       FROM public.crm_leads WHERE client_id = $1 GROUP BY 1`, [clientId],
  ).catch(() => ({ rows: [] }));
  for (const l of leads) soma(l.status, 'leads', Number(l.n) || 0);

  for (const tabela of ['client_conversion_eventos_custom', 'crm_followup_regras']) {
    const { rows } = await pool.query<{ status_gatilho: string | null }>(
      `SELECT status_gatilho FROM public.${tabela} WHERE client_id = $1`, [clientId],
    ).catch(() => ({ rows: [] }));
    for (const g of rows) if (g.status_gatilho) soma(g.status_gatilho, 'gatilhos', 1);
  }

  return uso;
}

/**
 * Faz o funil do cliente refletir o funil do CRM externo.
 *
 * Idempotente: rodar de novo com as mesmas etapas não muda nada.
 */
export async function aplicarFunilExterno(
  pool: Pool, clientId: string, funnelId: string, etapas: string[],
): Promise<ResultadoFunil> {
  const { rows: atuais } = await pool.query<{ id: string; label: string; position: number }>(
    `SELECT id, label, position FROM public.crm_stages
      WHERE funnel_id = $1 ORDER BY position`, [funnelId],
  );

  const plano = planejarFunil(atuais, etapas, await levantarUso(pool, clientId));
  if (!plano.remover.length && !plano.criar.length && !plano.reposicionar.length) {
    return { modo: plano.modo, criadas: 0, removidas: 0, reordenadas: 0, preservadas: plano.preservadas };
  }

  // ⚠️ Posições em DUAS fases. `position` não é unique hoje, mas mover uma
  // etapa para uma posição ocupada deixa o board com ordem ambígua enquanto o
  // lote não termina — e se a transação falhar no meio, ambígua para sempre.
  // O deslocamento para a faixa negativa garante que nenhuma posição final
  // colida com uma ainda não movida.
  await pool.query('BEGIN');
  try {
    if (plano.reposicionar.length) {
      await pool.query(
        `UPDATE public.crm_stages SET position = -1000 - position
          WHERE id = ANY($1::uuid[])`,
        [plano.reposicionar.map(r => r.id)],
      );
      for (const r of plano.reposicionar) {
        await pool.query(`UPDATE public.crm_stages SET position = $2 WHERE id = $1::uuid`,
          [r.id, r.position]);
      }
    }

    if (plano.remover.length) {
      await pool.query(`DELETE FROM public.crm_stages WHERE id = ANY($1::uuid[])`,
        [plano.remover]);
    }

    for (const c of plano.criar) {
      await pool.query(
        `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [funnelId, clientId, c.label, CORES_ETAPA[c.etapa] ?? '#94a3b8', c.position, c.etapa],
      );
    }

    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => null);
    throw err;
  }

  return {
    modo: plano.modo,
    criadas: plano.criar.length,
    removidas: plano.remover.length,
    reordenadas: plano.reposicionar.length,
    preservadas: plano.preservadas,
  };
}
