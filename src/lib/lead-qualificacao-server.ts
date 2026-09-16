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
export async function garantirEstruturaEngajado(
  pool: Pool, clientId: string,
): Promise<{ criou: number; erros: string[] }> {
  await pool.query(
    `ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS min_msgs_engajado INTEGER`,
  ).catch(() => null);

  const { rows: funis } = await pool.query<{ id: string }>(
    `SELECT id FROM public.crm_funnels WHERE client_id = $1`, [clientId],
  ).catch(() => ({ rows: [] }));

  let criou = 0;
  const erros: string[] = [];

  for (const f of funis) {
    // ⚠️⚠️ Reconstrói as posições do funil INTEIRO em vez de "empurrar" as de baixo.
    // A 1ª versão fazia `position = position + 1` e depois o INSERT — quando o INSERT
    // falhava (faltava `client_id`, que é NOT NULL), o empurrão já tinha acontecido e o
    // board ficava com buraco e duas colunas na mesma posição. Renumerar do zero a
    // partir da ordem atual é idempotente: rodar de novo não estraga nada.
    const { rows: stages } = await pool.query<{ id: string; label: string; position: number }>(
      `SELECT id, label, position FROM public.crm_stages
        WHERE funnel_id = $1 ORDER BY position ASC, created_at ASC`, [f.id],
    ).catch(() => ({ rows: [] }));
    if (!stages.length) continue;

    const jaTem = stages.some(s => s.label.trim().toLowerCase() === COLUNA_ENGAJADO.toLowerCase());

    if (!jaTem) {
      try {
        // ⚠️ `client_id` é NOT NULL em crm_stages — foi exatamente o que faltou na 1ª
        // tentativa e o `.catch(() => null)` escondeu, fazendo a rota reportar sucesso.
        await pool.query(
          `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil)
           VALUES ($1, $2, $3, '#22d3ee', $4, 'contato')`,
          [f.id, clientId, COLUNA_ENGAJADO, stages.length + 1],
        );
        criou++;
      } catch (e) {
        erros.push(`${f.id}: ${(e as Error)?.message ?? 'falha'}`);
        continue;
      }
    }

    // ordem final: a 1ª coluna continua sendo a entrada, Engajado logo depois, o resto
    // preservando a ordem que já tinha.
    const { rows: todas } = await pool.query<{ id: string; label: string; position: number }>(
      `SELECT id, label, position FROM public.crm_stages
        WHERE funnel_id = $1 ORDER BY position ASC, created_at ASC`, [f.id],
    ).catch(() => ({ rows: [] }));

    const eng = todas.filter(s => s.label.trim().toLowerCase() === COLUNA_ENGAJADO.toLowerCase());
    const resto = todas.filter(s => s.label.trim().toLowerCase() !== COLUNA_ENGAJADO.toLowerCase());
    const ordem = resto.length ? [resto[0], ...eng, ...resto.slice(1)] : eng;

    for (let i = 0; i < ordem.length; i++) {
      if (ordem[i].position === i) continue;
      await pool.query(`UPDATE public.crm_stages SET position = $2 WHERE id = $1`, [ordem[i].id, i])
        .catch(e => erros.push(`${ordem[i].label}: ${(e as Error)?.message}`));
    }
  }
  return { criou, erros };
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
