/**
 * Saneamento dos Kanbans do CRM — pedido do Matheus (2026-08-11): "deixa
 * apenas 1 ganho entre Fechado e Comprou" em TODOS os clientes.
 *
 * Regras:
 *  1. **Um ganho só**: funil com "Fechado" E "Comprou" → os leads de Comprou
 *     migram pra Fechado e a coluna Comprou é excluída. Fechado é o escolhido
 *     porque é o rótulo que o PRÓPRIO SISTEMA grava (importação de planilha e
 *     webhook usam 'Fechado' como status de venda) — manter Comprou deixaria
 *     os fechamentos futuros caindo numa coluna e os antigos em outra.
 *     Nenhuma contagem se perde: `fechou`/`valor_rs` ficam intactos e ambos os
 *     rótulos já classificam como 'fechamento' no Funil de Performance.
 *     Funil que só tem UM dos dois não é tocado.
 *  2. **Sem colunas gêmeas**: duas etapas com o MESMO rótulo (sem acento/caixa)
 *     no mesmo funil — o Kanban agrupa por rótulo, então uma delas fica
 *     eternamente vazia. Fica a de menor posição; leads de variação de grafia
 *     migram pro rótulo que fica.
 *
 *   3. Etapa criada por ESPELHO (cor `COR_ESPELHO`) que ficou sem nenhum lead —
 *     resíduo de importação, não coluna de trabalho. Etapa feita pelo gestor na
 *     tela nunca é removida, mesmo vazia.
 *
 * A decisão (o que migrar/excluir) é PURA e testável; a execução é SQL.
 * Chamado no GET de /api/crm/funnels (auto-cura ao abrir o board) e pela
 * varredura /api/crm/sanear-kanban (todos os clientes de uma vez).
 */

import type { Pool } from 'pg';
import { normalizarEtiqueta } from '@/lib/funil-etapas';

export type StageParaSanear = {
  id: string; label: string; position: number;
  /** Cor gravada. `COR_ESPELHO` identifica etapa criada por espelho, não pelo gestor. */
  color?: string | null;
  /** Quantos leads estão nesta etapa — 0 é pré-requisito para remover. */
  leads?: number;
};

/**
 * Cor fixa com que Agendor, Datalytics e SULTS criam etapa espelhada
 * (`espelharEtapa`). É a única assinatura confiável de "isto não foi o gestor
 * que criou" — etapa feita na tela nasce com a cor do degrau do funil.
 */
export const COR_ESPELHO = '#94a3b8';

export type PlanoSaneamento = {
  /** UPDATE crm_leads SET status=para WHERE funnel_id AND status=de. */
  migrarLeads: { de: string; para: string }[];
  /** DELETE crm_stages desses ids (depois das migrações). */
  deletarStages: string[];
  /** Rótulo de ganho que sobreviveu (pra realinhar gatilhos por status). */
  ganhoFinal: string | null;
  /** Rótulos de ganho absorvidos (gatilhos apontando pra cá são realinhados). */
  ganhosAbsorvidos: string[];
  /** Etapas de espelho removidas por estarem vazias — só para o relatório. */
  espelhosVazios: string[];
};

export function planejarSaneamento(stages: StageParaSanear[]): PlanoSaneamento {
  const plano: PlanoSaneamento = { migrarLeads: [], deletarStages: [], ganhoFinal: null, ganhosAbsorvidos: [], espelhosVazios: [] };
  const ordenados = [...stages].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));

  // 2. Gêmeas primeiro: normalizado igual → fica a primeira por posição.
  const porNorma = new Map<string, StageParaSanear>();
  const vivos: StageParaSanear[] = [];
  for (const s of ordenados) {
    const norma = normalizarEtiqueta(s.label);
    const dono = porNorma.get(norma);
    if (!dono) {
      porNorma.set(norma, s);
      vivos.push(s);
      continue;
    }
    plano.deletarStages.push(s.id);
    // Grafia diferente do mesmo rótulo ("Fechado " vs "Fechado"): os leads da
    // variação apontam pro texto exato dela — migram pro rótulo que fica.
    if (s.label !== dono.label) plano.migrarLeads.push({ de: s.label, para: dono.label });
  }

  // 3. Etapa de ESPELHO que ficou VAZIA: resíduo, não coluna de trabalho.
  //
  // ⚠️ Origem real (medida em 14/09): quando os leads do Agendor de um cliente
  // foram apagados na correção do filtro de origem (22/08), as etapas que o
  // espelho tinha criado FICARAM. A Londrigifts carregava 11 colunas mortas
  // ("Produção", "Despacho", "Carteira Bronze"…) de funis do Agendor que nem
  // são importados — board de 26 colunas para um funil de 6.
  //
  // ⚠️ As DUAS condições são obrigatórias e nenhuma basta sozinha:
  // • cor de espelho → etapa criada na tela pelo gestor NUNCA é removida, mesmo
  //   vazia (ele pode tê-la criado agora para usar amanhã);
  // • zero leads → etapa de espelho EM USO é a coluna real do cliente.
  for (const s of vivos) {
    if (s.color !== COR_ESPELHO) continue;
    // ⚠️ `undefined` é "não sei", não "vazio": chamador que não informa a
    // contagem não autoriza remoção. Com `?? 0` um caller desatento apagaria
    // colunas cheias — a ausência de dado nunca pode virar permissão.
    if (s.leads === undefined || s.leads > 0) continue;
    if (plano.deletarStages.includes(s.id)) continue;
    plano.deletarStages.push(s.id);
    plano.espelhosVazios.push(s.label);
  }

  // 1. Um ganho só: Comprou é absorvido por Fechado quando os dois existem.
  const fechado = vivos.find(s => normalizarEtiqueta(s.label) === 'fechado');
  const comprou = vivos.find(s => normalizarEtiqueta(s.label) === 'comprou');
  if (fechado) plano.ganhoFinal = fechado.label;
  if (fechado && comprou) {
    plano.migrarLeads.push({ de: comprou.label, para: fechado.label });
    plano.deletarStages.push(comprou.id);
    plano.ganhosAbsorvidos.push(comprou.label);
  }

  return plano;
}

export type ResultadoSaneamento = {
  funisVistos: number;
  leadsMigrados: number;
  stagesRemovidos: number;
  gatilhosRealinhados: number;
  /** Funis sem etapa E sem lead que foram apagados (duplicata de `ensureDefaultFunnel`). */
  funisVazios: number;
};

export async function sanearFunisDoCliente(pool: Pool, clientId: string): Promise<ResultadoSaneamento> {
  const r: ResultadoSaneamento = { funisVistos: 0, leadsMigrados: 0, stagesRemovidos: 0, gatilhosRealinhados: 0, funisVazios: 0 };

  const { rows: funis } = await pool.query<{ id: string }>(
    `SELECT id FROM public.crm_funnels WHERE client_id = $1`,
    [clientId],
  );

  for (const funil of funis) {
    r.funisVistos++;
    const { rows: stages } = await pool.query<StageParaSanear>(
      // A contagem de leads é por RÓTULO, não por funnel_id: `crm_leads.status`
      // é texto livre e o mesmo rótulo pode ser usado por lead de outro funil
      // do cliente. Contar só dentro do funil apagaria coluna em uso.
      `SELECT s.id, s.label, s.position, s.color,
              (SELECT COUNT(*) FROM public.crm_leads l
                WHERE l.client_id = $2 AND l.status = s.label)::int AS leads
         FROM public.crm_stages s WHERE s.funnel_id = $1`,
      [funil.id, clientId],
    );
    const plano = planejarSaneamento(stages);
    if (plano.migrarLeads.length === 0 && plano.deletarStages.length === 0) continue;

    for (const m of plano.migrarLeads) {
      const { rowCount } = await pool.query(
        `UPDATE public.crm_leads SET status = $1, updated_at = NOW()
          WHERE funnel_id = $2 AND status = $3`,
        [m.para, funil.id, m.de],
      );
      r.leadsMigrados += rowCount ?? 0;
    }
    if (plano.deletarStages.length > 0) {
      const { rowCount } = await pool.query(
        `DELETE FROM public.crm_stages WHERE id = ANY($1::uuid[])`,
        [plano.deletarStages],
      );
      r.stagesRemovidos += rowCount ?? 0;
    }

    // Gatilhos por status (conversões e follow-up) apontando pro rótulo
    // absorvido seguem o lead — senão viram gatilho morto. Best-effort: só
    // realinha se o destino ainda não tem gatilho igual (unique por status).
    for (const absorvido of plano.ganhosAbsorvidos) {
      if (!plano.ganhoFinal) continue;
      const { rowCount: conv } = await pool.query(
        `UPDATE public.client_conversion_eventos_custom c
            SET status_gatilho = $1
          WHERE c.client_id = $2 AND LOWER(c.status_gatilho) = LOWER($3)
            AND NOT EXISTS (
              SELECT 1 FROM public.client_conversion_eventos_custom d
               WHERE d.client_id = $2 AND LOWER(d.status_gatilho) = LOWER($1)
            )`,
        [plano.ganhoFinal, clientId, absorvido],
      ).catch(() => ({ rowCount: 0 }));
      const { rowCount: fup } = await pool.query(
        `UPDATE public.crm_followup_regras
            SET status_gatilho = $1
          WHERE client_id = $2 AND status_gatilho = $3`,
        [plano.ganhoFinal, clientId, absorvido],
      ).catch(() => ({ rowCount: 0 }));
      await pool.query(
        `UPDATE public.crm_followup_mensagens m
            SET status_destino = $1
           FROM public.crm_followup_regras rg
          WHERE m.regra_id = rg.id AND rg.client_id = $2 AND m.status_destino = $3`,
        [plano.ganhoFinal, clientId, absorvido],
      ).catch(() => {});
      r.gatilhosRealinhados += (conv ?? 0) + (fup ?? 0);
    }
  }

  // Funil DUPLICADO e vazio: `ensureDefaultFunnel` criou um segundo "Funil
  // Principal" numa corrida (5 clientes afetados em 14/09; a Dominos tinha 3).
  // ⚠️ Só sai o que não tem NEM lead NEM etapa própria além do seed — e nunca o
  // último funil do cliente. Apagar um funil com lead sumiria com ele do board.
  const { rows: vazios } = await pool.query<{ id: string }>(
    `SELECT f.id FROM public.crm_funnels f
      WHERE f.client_id = $1
        AND NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.funnel_id = f.id)
        AND (SELECT COUNT(*) FROM public.crm_funnels g WHERE g.client_id = $1) > 1
      ORDER BY f.created_at DESC
      OFFSET 0`,
    [clientId],
  ).catch(() => ({ rows: [] as Array<{ id: string }> }));

  // Mantém pelo menos um funil de pé, mesmo que todos estejam vazios.
  const { rows: [{ total }] } = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM public.crm_funnels WHERE client_id = $1`, [clientId],
  );
  const podeRemover = vazios.slice(0, Math.max(0, total - 1));
  for (const f of podeRemover) {
    await pool.query(`DELETE FROM public.crm_stages WHERE funnel_id = $1`, [f.id]).catch(() => {});
    const { rowCount } = await pool.query(`DELETE FROM public.crm_funnels WHERE id = $1`, [f.id])
      .catch(() => ({ rowCount: 0 }));
    r.funisVazios += rowCount ?? 0;
  }

  return r;
}
