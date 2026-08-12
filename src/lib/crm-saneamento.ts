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
 * A decisão (o que migrar/excluir) é PURA e testável; a execução é SQL.
 * Chamado no GET de /api/crm/funnels (auto-cura ao abrir o board) e pela
 * varredura /api/crm/sanear-kanban (todos os clientes de uma vez).
 */

import type { Pool } from 'pg';
import { normalizarEtiqueta } from '@/lib/funil-etapas';

export type StageParaSanear = { id: string; label: string; position: number };

export type PlanoSaneamento = {
  /** UPDATE crm_leads SET status=para WHERE funnel_id AND status=de. */
  migrarLeads: { de: string; para: string }[];
  /** DELETE crm_stages desses ids (depois das migrações). */
  deletarStages: string[];
  /** Rótulo de ganho que sobreviveu (pra realinhar gatilhos por status). */
  ganhoFinal: string | null;
  /** Rótulos de ganho absorvidos (gatilhos apontando pra cá são realinhados). */
  ganhosAbsorvidos: string[];
};

export function planejarSaneamento(stages: StageParaSanear[]): PlanoSaneamento {
  const plano: PlanoSaneamento = { migrarLeads: [], deletarStages: [], ganhoFinal: null, ganhosAbsorvidos: [] };
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
};

export async function sanearFunisDoCliente(pool: Pool, clientId: string): Promise<ResultadoSaneamento> {
  const r: ResultadoSaneamento = { funisVistos: 0, leadsMigrados: 0, stagesRemovidos: 0, gatilhosRealinhados: 0 };

  const { rows: funis } = await pool.query<{ id: string }>(
    `SELECT id FROM public.crm_funnels WHERE client_id = $1`,
    [clientId],
  );

  for (const funil of funis) {
    r.funisVistos++;
    const { rows: stages } = await pool.query<StageParaSanear>(
      `SELECT id, label, position FROM public.crm_stages WHERE funnel_id = $1`,
      [funil.id],
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

  return r;
}
