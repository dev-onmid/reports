import type { Pool } from 'pg';
import { classificarEtapa, postoDaEtapa, type EtapaFunil } from '@/lib/funil-etapas';
import { COLUNA_ENGAJADO, devoMoverParaEngajado, estaEngajado } from '@/lib/lead-qualificacao';

/**
 * Motor do "Engajado" — ver o porquê de cada regra em `lead-qualificacao.ts`.
 *
 * Roda no caminho do WhatsApp, a cada mensagem recebida. ⚠️ Tudo aqui é best-effort:
 * nenhuma falha pode derrubar a gravação da mensagem, que é o dado de verdade.
 */

/** Coluna de config por cliente + a coluna Engajado nos funis que ainda não a têm. */
export async function garantirEstruturaEngajado(pool: Pool, clientId: string): Promise<void> {
  await pool.query(
    `ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS min_msgs_engajado INTEGER`,
  ).catch(() => null);

  // ⚠️ A coluna entra logo depois da ENTRADA (posição 1) e empurra as outras. Só é criada
  // se ainda não existir — reabrir o board não pode gerar coluna duplicada (foi o que
  // encheu o Kanban da Londrigifts de etapas-espelho em 08/2026).
  const { rows: funis } = await pool.query<{ id: string }>(
    `SELECT id FROM public.crm_funnels WHERE client_id = $1`, [clientId],
  ).catch(() => ({ rows: [] }));

  for (const f of funis) {
    const { rows: existe } = await pool.query(
      `SELECT 1 FROM public.crm_stages WHERE funnel_id = $1 AND lower(trim(label)) = lower($2) LIMIT 1`,
      [f.id, COLUNA_ENGAJADO],
    ).catch(() => ({ rows: [] }));
    if (existe.length) continue;

    await pool.query(`UPDATE public.crm_stages SET position = position + 1 WHERE funnel_id = $1 AND position >= 1`, [f.id]).catch(() => null);
    await pool.query(
      // grau `contato`: engajar é aprofundar o topo do funil, não qualificar — quem
      // qualifica é o humano no botão. Ver a nota do grau genérico em funil-etapas.ts.
      `INSERT INTO public.crm_stages (funnel_id, label, color, position, etapa_funil)
       VALUES ($1, $2, '#22d3ee', 1, 'contato')`,
      [f.id, COLUNA_ENGAJADO],
    ).catch(() => null);
  }
}

type LeadEngajamento = {
  id: string;
  status: string | null;
  funnel_id: string | null;
  engajado: boolean | null;
};

/**
 * Avalia e aplica o engajamento de um lead. Devolve `true` se ACABOU de engajar
 * (a transição), que é o momento — e só ele — de avisar o Meta.
 */
export async function avaliarEngajamento(
  pool: Pool, clientId: string, leadId: string,
): Promise<{ virou: boolean; movido: boolean }> {
  const nada = { virou: false, movido: false };

  const { rows: [lead] } = await pool.query<LeadEngajamento>(
    `SELECT id, status, funnel_id, engajado FROM public.crm_leads WHERE id = $1::uuid AND client_id = $2`,
    [leadId, clientId],
  ).catch(() => ({ rows: [] as LeadEngajamento[] }));
  if (!lead) return nada;
  if (lead.engajado) return nada; // já engajado: nada a fazer, e o Meta já foi avisado

  const { rows: [cfg] } = await pool.query<{ min_msgs_engajado: number | null }>(
    `SELECT min_msgs_engajado FROM public.clients WHERE id = $1`, [clientId],
  ).catch(() => ({ rows: [] as Array<{ min_msgs_engajado: number | null }> }));

  const { rows: [c] } = await pool.query<{ recebidas: number }>(
    `SELECT COUNT(*)::int AS recebidas FROM public.crm_messages WHERE lead_id = $1::uuid AND direction = 'in'`,
    [leadId],
  ).catch(() => ({ rows: [{ recebidas: 0 }] }));

  if (!estaEngajado(Number(c?.recebidas ?? 0), cfg?.min_msgs_engajado)) return nada;

  await pool.query(
    `UPDATE public.crm_leads SET engajado = true, engajado_em = COALESCE(engajado_em, NOW()), updated_at = NOW()
      WHERE id = $1::uuid AND engajado = false`,
    [leadId],
  ).catch(() => null);

  // Mover é opcional e protegido: o sinal já está gravado no lead acima.
  let movido = false;
  if (lead.funnel_id) {
    const { rows: stages } = await pool.query<{ label: string; etapa_funil: EtapaFunil | null }>(
      `SELECT label, etapa_funil FROM public.crm_stages WHERE funnel_id = $1`, [lead.funnel_id],
    ).catch(() => ({ rows: [] as Array<{ label: string; etapa_funil: EtapaFunil | null }> }));

    const alvo = stages.find(s => s.label.trim().toLowerCase() === COLUNA_ENGAJADO.toLowerCase());
    if (alvo) {
      const grauDe = (s?: { label: string; etapa_funil: EtapaFunil | null }) =>
        postoDaEtapa(s?.etapa_funil ?? classificarEtapa(s?.label ?? ''));
      const atual = stages.find(s => s.label.trim().toLowerCase() === (lead.status ?? '').trim().toLowerCase());

      if (devoMoverParaEngajado({
        engajado: true,
        postoAtual: grauDe(atual),
        postoEngajado: grauDe(alvo),
        jaEstaNaColuna: (lead.status ?? '').trim().toLowerCase() === COLUNA_ENGAJADO.toLowerCase(),
      })) {
        await pool.query(
          `UPDATE public.crm_leads SET status = $1, updated_at = NOW() WHERE id = $2::uuid`,
          [alvo.label, leadId],
        ).catch(() => null);
        movido = true;
      }
    }
  }
  return { virou: true, movido };
}
