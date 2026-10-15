import type { Pool } from 'pg';

/**
 * Leituras de atendimento que a aba precisava e não tinha:
 *
 * 1. EVOLUÇÃO MÊS A MÊS — fixa nos últimos 6 meses, independente do filtro de
 *    período. ⚠️ O mês é o da MENSAGEM, não o de criação do lead: o filtro da
 *    tela recorta por `crm_leads.data`, e "o atendimento de setembro" medido
 *    pelos leads criados em setembro deixaria de fora toda resposta dada em
 *    setembro a quem chegou antes. Atendimento acontece quando a mensagem anda.
 *
 * 2. TENTATIVAS DE CONTATO — quem a loja tentou alcançar e não respondeu.
 *    ⚠️ Tentativa = um DIA em que mandamos mensagem (BRT). Cinco mensagens e um
 *    áudio na mesma manhã são uma tentativa só; contar mensagem inflaria a
 *    média de quem escreve picado e puniria quem escreve tudo num bloco.
 *    Só contam as tentativas ANTES da resposta — depois dela é conversa.
 */

const TZ = `'America/Sao_Paulo'`;
const NAO_INTERNO = `COALESCE(l.time_interno, false) = false`;

// Mensagens do cliente com as janelas que todas as leituras usam.
// `prox_out`/`prox_in` = primeira mensagem de cada lado DEPOIS desta.
const BASE = `
  base AS (
    SELECT m.id, m.lead_id, m.direction, m.created_at
      FROM public.crm_messages m
      JOIN public.crm_leads l ON l.id = m.lead_id
     WHERE l.client_id = $1 AND ${NAO_INTERNO} AND m.created_at IS NOT NULL
  ),
  msg AS (
    SELECT b.*,
           LAG(b.direction)  OVER w AS dir_ant,
           LAG(b.created_at) OVER w AS em_ant,
           MIN(b.created_at) FILTER (WHERE b.direction = 'out') OVER (w ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS prox_out,
           MIN(b.created_at) FILTER (WHERE b.direction = 'in')  OVER (w ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS prox_in
      FROM base b
    WINDOW w AS (PARTITION BY b.lead_id ORDER BY b.created_at, b.id)
  )`;

// Por lead: primeira mensagem nossa, se ele já tinha escrito antes, se
// respondeu depois, e quantos dias tentamos até a resposta.
const TENTATIVAS = `
  primeira_saida AS (
    SELECT lead_id, MIN(created_at) AS primeira_out FROM base WHERE direction = 'out' GROUP BY lead_id
  ),
  por_lead AS (
    SELECT p.lead_id, p.primeira_out,
           EXISTS (SELECT 1 FROM base i WHERE i.lead_id = p.lead_id AND i.direction = 'in' AND i.created_at < p.primeira_out) AS escreveu_antes,
           (SELECT MIN(i.created_at) FROM base i WHERE i.lead_id = p.lead_id AND i.direction = 'in' AND i.created_at > p.primeira_out) AS respondeu_em
      FROM primeira_saida p
  ),
  tentativas AS (
    SELECT pl.*,
           (SELECT COUNT(DISTINCT (o.created_at AT TIME ZONE ${TZ})::date) FROM base o
             WHERE o.lead_id = pl.lead_id AND o.direction = 'out'
               AND (pl.respondeu_em IS NULL OR o.created_at < pl.respondeu_em))::int AS dias,
           (SELECT COUNT(*) FROM base o
             WHERE o.lead_id = pl.lead_id AND o.direction = 'out'
               AND (pl.respondeu_em IS NULL OR o.created_at < pl.respondeu_em))::int AS msgs
      FROM por_lead pl
  )`;

export type MesAtendimento = {
  mes: string;                       // YYYY-MM
  conversas: number;                 // leads com mensagem do cliente no mês
  turnos: number;                    // vezes que o cliente começou a falar
  respondidos: number;
  sem_resposta: number;
  mediana_resposta_seg: number | null;
  ate_5min: number;
  mais_1h: number;
  retomadas: number;                 // mensagem nossa após ≥48h de silêncio
  retomadas_responderam: number;
  tentados: number;                  // leads com 1ª mensagem nossa no mês
  sem_interacao: number;
  media_tentativas_sem_interacao: number | null;
};

export async function carregarEvolucaoMensal(pool: Pool, clientId: string, meses = 6): Promise<MesAtendimento[]> {
  const { rows } = await pool.query<MesAtendimento>(
    `WITH ${BASE}, ${TENTATIVAS},
     meses AS (
       SELECT to_char(d, 'YYYY-MM') AS mes
         FROM generate_series(
                date_trunc('month', NOW() AT TIME ZONE ${TZ}) - ($2::int - 1) * INTERVAL '1 month',
                date_trunc('month', NOW() AT TIME ZONE ${TZ}),
                INTERVAL '1 month') d
     ),
     m2 AS (
       SELECT to_char(created_at AT TIME ZONE ${TZ}, 'YYYY-MM') AS mes, lead_id, direction,
              (direction = 'in' AND (dir_ant IS NULL OR dir_ant = 'out')) AS turno,
              EXTRACT(EPOCH FROM (prox_out - created_at))::float AS resp,
              (direction = 'out' AND em_ant IS NOT NULL AND created_at - em_ant >= INTERVAL '48 hours') AS retomada,
              prox_in
         FROM msg
     ),
     agg AS (
       SELECT mes,
              COUNT(DISTINCT lead_id) FILTER (WHERE direction = 'in')::int AS conversas,
              COUNT(*) FILTER (WHERE turno)::int AS turnos,
              COUNT(*) FILTER (WHERE turno AND resp IS NOT NULL)::int AS respondidos,
              COUNT(*) FILTER (WHERE turno AND resp IS NULL)::int AS sem_resposta,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY resp) FILTER (WHERE turno AND resp IS NOT NULL) AS mediana_resposta_seg,
              COUNT(*) FILTER (WHERE turno AND resp <= 300)::int AS ate_5min,
              COUNT(*) FILTER (WHERE turno AND resp > 3600)::int AS mais_1h,
              COUNT(*) FILTER (WHERE retomada)::int AS retomadas,
              COUNT(*) FILTER (WHERE retomada AND prox_in IS NOT NULL)::int AS retomadas_responderam
         FROM m2 GROUP BY mes
     ),
     tent AS (
       SELECT to_char(primeira_out AT TIME ZONE ${TZ}, 'YYYY-MM') AS mes,
              COUNT(*)::int AS tentados,
              COUNT(*) FILTER (WHERE respondeu_em IS NULL)::int AS sem_interacao,
              AVG(dias) FILTER (WHERE respondeu_em IS NULL)::float AS media_tentativas_sem_interacao
         FROM tentativas GROUP BY 1
     )
     SELECT ms.mes,
            COALESCE(a.conversas, 0) AS conversas, COALESCE(a.turnos, 0) AS turnos,
            COALESCE(a.respondidos, 0) AS respondidos, COALESCE(a.sem_resposta, 0) AS sem_resposta,
            a.mediana_resposta_seg, COALESCE(a.ate_5min, 0) AS ate_5min, COALESCE(a.mais_1h, 0) AS mais_1h,
            COALESCE(a.retomadas, 0) AS retomadas, COALESCE(a.retomadas_responderam, 0) AS retomadas_responderam,
            COALESCE(t.tentados, 0) AS tentados, COALESCE(t.sem_interacao, 0) AS sem_interacao,
            t.media_tentativas_sem_interacao
       FROM meses ms
       LEFT JOIN agg a ON a.mes = ms.mes
       LEFT JOIN tent t ON t.mes = ms.mes
      ORDER BY ms.mes`,
    [clientId, meses],
  );
  return rows;
}

export type TentativasContato = {
  tentados: number;
  responderam: number;
  sem_interacao: number;
  /** Nunca mandaram mensagem nenhuma — contato ativo nosso (lista, planilha, prospecção). */
  nunca_escreveram: number;
  /** Mandaram a 1ª mensagem (geralmente a do anúncio) e sumiram depois da nossa resposta. */
  sumiram_apos_primeira: number;
  media_tentativas_sem_interacao: number | null;
  media_mensagens_sem_interacao: number | null;
  media_tentativas_ate_responder: number | null;
  /** Distribuição de quem NÃO respondeu por nº de tentativas. */
  dist: { t1: number; t2: number; t3: number; t4mais: number };
};

/** Leads cuja 1ª tentativa nossa caiu no período (BRT). Sem período = tudo. */
export async function carregarTentativas(pool: Pool, clientId: string, from: string | null, to: string | null): Promise<TentativasContato> {
  const { rows: [r] } = await pool.query(
    `WITH ${BASE}, ${TENTATIVAS}
     SELECT COUNT(*)::int AS tentados,
            COUNT(*) FILTER (WHERE respondeu_em IS NOT NULL)::int AS responderam,
            COUNT(*) FILTER (WHERE respondeu_em IS NULL)::int AS sem_interacao,
            COUNT(*) FILTER (WHERE respondeu_em IS NULL AND NOT escreveu_antes)::int AS nunca_escreveram,
            COUNT(*) FILTER (WHERE respondeu_em IS NULL AND escreveu_antes)::int AS sumiram_apos_primeira,
            AVG(dias) FILTER (WHERE respondeu_em IS NULL)::float AS media_tentativas_sem_interacao,
            AVG(msgs) FILTER (WHERE respondeu_em IS NULL)::float AS media_mensagens_sem_interacao,
            AVG(dias) FILTER (WHERE respondeu_em IS NOT NULL)::float AS media_tentativas_ate_responder,
            COUNT(*) FILTER (WHERE respondeu_em IS NULL AND dias = 1)::int AS t1,
            COUNT(*) FILTER (WHERE respondeu_em IS NULL AND dias = 2)::int AS t2,
            COUNT(*) FILTER (WHERE respondeu_em IS NULL AND dias = 3)::int AS t3,
            COUNT(*) FILTER (WHERE respondeu_em IS NULL AND dias >= 4)::int AS t4mais
       FROM tentativas
      WHERE ($2::date IS NULL OR primeira_out >= ($2::date)::timestamp AT TIME ZONE ${TZ})
        AND ($3::date IS NULL OR primeira_out <  ($3::date + 1)::timestamp AT TIME ZONE ${TZ})`,
    [clientId, from, to],
  );
  return {
    tentados: r.tentados, responderam: r.responderam, sem_interacao: r.sem_interacao,
    nunca_escreveram: r.nunca_escreveram, sumiram_apos_primeira: r.sumiram_apos_primeira,
    media_tentativas_sem_interacao: r.media_tentativas_sem_interacao,
    media_mensagens_sem_interacao: r.media_mensagens_sem_interacao,
    media_tentativas_ate_responder: r.media_tentativas_ate_responder,
    dist: { t1: r.t1, t2: r.t2, t3: r.t3, t4mais: r.t4mais },
  };
}
