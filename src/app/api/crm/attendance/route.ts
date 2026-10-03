import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmMessagesSchema, ensureDefaultFunnel } from '@/lib/crm-conversation-sync';
import { classificarEtapa } from '@/lib/funil-etapas';

/**
 * Uma conversa só pode estar em UM estado — a soma tem de fechar com o total de
 * leads, senão o donut mente. A ordem abaixo é a prioridade:
 *
 * 1. encerrado        — a etapa do funil já diz ganho ou perdido (vence tudo:
 *                       lead fechado não é "pendência de atendimento")
 * 2. sem_conversa     — nenhum lead ↔ loja trocou mensagem
 * 3. sem_resposta     — a ÚLTIMA mensagem é do cliente (a bola está conosco)
 * 4. aguardando_retorno — a última é nossa e já passou de PARADO_HORAS
 * 5. em_atendimento   — a última é nossa e a conversa ainda está viva
 */
const PARADO_HORAS = 48;

function toDateParam(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function monthRange(month: string | null) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return { from: null, to: null };
  const [year, monthIndex] = month.split('-').map(Number);
  const from = `${month}-01`;
  const end = new Date(Date.UTC(year, monthIndex, 0));
  const to = end.toISOString().slice(0, 10);
  return { from, to };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const range = monthRange(searchParams.get('month'));
  const from = toDateParam(searchParams.get('from')) ?? range.from;
  const to = toDateParam(searchParams.get('to')) ?? range.to;

  const pool = makeServerPool();
  try {
    await ensureDefaultFunnel(pool, clientId);
    await ensureCrmMessagesSchema(pool);

    // Janela anterior de MESMA duração — é o que torna os selos de variação
    // reais. Sem from/to (período "todos") não existe anterior: a tela então
    // esconde o selo em vez de inventar um número.
    let prevFrom: string | null = null, prevTo: string | null = null;
    if (from && to) {
      const d1 = new Date(`${from}T00:00:00Z`), d2 = new Date(`${to}T00:00:00Z`);
      const dias = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
      const pTo = new Date(d1.getTime() - 86400000);
      const pFrom = new Date(pTo.getTime() - (dias - 1) * 86400000);
      prevFrom = pFrom.toISOString().slice(0, 10);
      prevTo = pTo.toISOString().slice(0, 10);
    }

    const params = [clientId, from, to];
    const leadWhere = `
      l.client_id = $1
      AND ($2::date IS NULL OR l.data >= $2::date)
      AND ($3::date IS NULL OR l.data <= $3::date)
      AND COALESCE(l.time_interno, false) = false
    `;

    type ResumoAtendimento = {
      total_leads: number;
      active_conversations: number;
      inbound_messages: number;
      outbound_messages: number;
      avg_response_seconds: number | null;
      avg_first_response_seconds: number | null;
      unanswered_chats: number;
      max_waiting_seconds: number | null;
      under_5: number;
      under_15: number;
      under_60: number;
      over_60: number;
    };
    const SQL_RESUMO = `WITH target_leads AS (
         SELECT l.id, l.nome, l.numero, l.canal, l.status, l.temperatura, l.data, l.created_at
           FROM public.crm_leads l
          WHERE ${leadWhere}
       ),
       msg AS (
         SELECT m.lead_id, m.direction, m.created_at
           FROM public.crm_messages m
           JOIN target_leads l ON l.id = m.lead_id
          WHERE m.created_at IS NOT NULL
       ),
       inbound_pairs AS (
         SELECT i.lead_id,
                i.created_at AS inbound_at,
                (
                  SELECT MIN(o.created_at)
                    FROM msg o
                   WHERE o.lead_id = i.lead_id
                     AND o.direction = 'out'
                     AND o.created_at > i.created_at
                ) AS response_at
           FROM msg i
          WHERE i.direction = 'in'
       ),
       response_pairs AS (
         SELECT lead_id,
                EXTRACT(EPOCH FROM (response_at - inbound_at))::float AS response_seconds
           FROM inbound_pairs
          WHERE response_at IS NOT NULL
       ),
       first_inbound AS (
         SELECT DISTINCT ON (lead_id) lead_id, inbound_at
           FROM inbound_pairs
          ORDER BY lead_id, inbound_at ASC
       ),
       first_response AS (
         SELECT f.lead_id,
                EXTRACT(EPOCH FROM (MIN(m.created_at) - f.inbound_at))::float AS response_seconds
           FROM first_inbound f
           JOIN msg m ON m.lead_id = f.lead_id
                    AND m.direction = 'out'
                    AND m.created_at > f.inbound_at
          GROUP BY f.lead_id, f.inbound_at
       ),
       last_msg AS (
         SELECT DISTINCT ON (lead_id) lead_id, direction, created_at
           FROM msg
          ORDER BY lead_id, created_at DESC
       )
       SELECT
         (SELECT COUNT(*)::int FROM target_leads) AS total_leads,
         (SELECT COUNT(DISTINCT lead_id)::int FROM msg) AS active_conversations,
         (SELECT COUNT(*)::int FROM msg WHERE direction = 'in') AS inbound_messages,
         (SELECT COUNT(*)::int FROM msg WHERE direction = 'out') AS outbound_messages,
         (SELECT AVG(response_seconds) FROM response_pairs) AS avg_response_seconds,
         (SELECT AVG(response_seconds) FROM first_response) AS avg_first_response_seconds,
         (SELECT COUNT(*)::int FROM last_msg WHERE direction = 'in') AS unanswered_chats,
         (SELECT MAX(EXTRACT(EPOCH FROM (NOW() - created_at)))::float FROM last_msg WHERE direction = 'in') AS max_waiting_seconds,
         (SELECT COUNT(*)::int FROM response_pairs WHERE response_seconds <= 300) AS under_5,
         (SELECT COUNT(*)::int FROM response_pairs WHERE response_seconds > 300 AND response_seconds <= 900) AS under_15,
         (SELECT COUNT(*)::int FROM response_pairs WHERE response_seconds > 900 AND response_seconds <= 3600) AS under_60,
         (SELECT COUNT(*)::int FROM response_pairs WHERE response_seconds > 3600) AS over_60`;
    const carregarResumo = async (f: string | null, t: string | null) =>
      (await pool.query<ResumoAtendimento>(SQL_RESUMO, [clientId, f, t])).rows[0] ?? null;

    const summary = await carregarResumo(from, to);
    const previous = prevFrom && prevTo ? await carregarResumo(prevFrom, prevTo) : null;

    const { rows: sources } = await pool.query<{
      canal: string | null;
      total: number;
    }>(
      `SELECT COALESCE(NULLIF(l.canal, ''), 'Sem canal') AS canal, COUNT(*)::int AS total
         FROM public.crm_leads l
        WHERE ${leadWhere}
        GROUP BY COALESCE(NULLIF(l.canal, ''), 'Sem canal')
        ORDER BY total DESC
        LIMIT 8`,
      params,
    );

    const { rows: waiting } = await pool.query<{
      id: string;
      nome: string | null;
      numero: string | null;
      status: string | null;
      temperatura: string | null;
      canal: string | null;
      last_message_at: string;
      waiting_seconds: number;
    }>(
      `WITH target_leads AS (
         SELECT l.id, l.nome, l.numero, l.canal, l.status, l.temperatura
           FROM public.crm_leads l
          WHERE ${leadWhere}
       ),
       last_msg AS (
         SELECT DISTINCT ON (m.lead_id)
                m.lead_id, m.direction, m.created_at
           FROM public.crm_messages m
           JOIN target_leads l ON l.id = m.lead_id
          WHERE m.created_at IS NOT NULL
          ORDER BY m.lead_id, m.created_at DESC
       )
       SELECT l.id, l.nome, l.numero, l.status, l.temperatura, l.canal,
              lm.created_at AS last_message_at,
              EXTRACT(EPOCH FROM (NOW() - lm.created_at))::float AS waiting_seconds
         FROM target_leads l
         JOIN last_msg lm ON lm.lead_id = l.id
        WHERE lm.direction = 'in'
        ORDER BY lm.created_at ASC
        LIMIT 10`,
      params,
    );

    // ── estado de cada conversa (classificação REAL, sem fator inventado) ────
    const { rows: estados } = await pool.query<{ status: string | null; bucket: string; total: number }>(
      `WITH target_leads AS (
         SELECT l.id, l.status FROM public.crm_leads l WHERE ${leadWhere}
       ),
       last_msg AS (
         SELECT DISTINCT ON (m.lead_id) m.lead_id, m.direction, m.created_at
           FROM public.crm_messages m
           JOIN target_leads t ON t.id = m.lead_id
          WHERE m.created_at IS NOT NULL
          ORDER BY m.lead_id, m.created_at DESC
       )
       SELECT t.status,
              CASE
                WHEN lm.lead_id IS NULL THEN 'sem_conversa'
                WHEN lm.direction = 'in' THEN 'sem_resposta'
                WHEN lm.created_at < NOW() - INTERVAL '${PARADO_HORAS} hours' THEN 'aguardando_retorno'
                ELSE 'em_atendimento'
              END AS bucket,
              COUNT(*)::int AS total
         FROM target_leads t
         LEFT JOIN last_msg lm ON lm.lead_id = t.id
        GROUP BY 1, 2`,
      params,
    );

    const classification = { encerrado: 0, sem_conversa: 0, sem_resposta: 0, aguardando_retorno: 0, em_atendimento: 0 };
    for (const row of estados) {
      // A etapa vence o padrão de mensagem: ganho/perdido é desfecho, não pendência.
      const etapa = classificarEtapa(row.status ?? '');
      const chave = etapa === 'fechamento' || etapa === 'perdido'
        ? 'encerrado'
        : (row.bucket as keyof typeof classification);
      classification[chave] += row.total;
    }

    // ── série diária REAL dos últimos 7 dias (BRT) ───────────────────────────
    const { rows: daily } = await pool.query<{
      dia: string; avg_response_seconds: number | null; respostas: number; sem_resposta: number;
    }>(
      `WITH target_leads AS (
         SELECT l.id FROM public.crm_leads l WHERE ${leadWhere}
       ),
       msg AS (
         SELECT m.lead_id, m.direction, m.created_at
           FROM public.crm_messages m JOIN target_leads t ON t.id = m.lead_id
          WHERE m.created_at IS NOT NULL
       ),
       pares AS (
         SELECT i.created_at AS inbound_at,
                (SELECT MIN(o.created_at) FROM msg o
                  WHERE o.lead_id = i.lead_id AND o.direction = 'out' AND o.created_at > i.created_at) AS response_at
           FROM msg i WHERE i.direction = 'in'
       ),
       last_msg AS (
         SELECT DISTINCT ON (lead_id) lead_id, direction, created_at FROM msg
          ORDER BY lead_id, created_at DESC
       ),
       dias AS (
         SELECT generate_series(
                  (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '6 days',
                  (NOW() AT TIME ZONE 'America/Sao_Paulo')::date,
                  INTERVAL '1 day')::date AS dia
       )
       SELECT d.dia::text AS dia,
              (SELECT AVG(EXTRACT(EPOCH FROM (p.response_at - p.inbound_at)))::float FROM pares p
                WHERE p.response_at IS NOT NULL
                  AND (p.response_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dia) AS avg_response_seconds,
              (SELECT COUNT(*)::int FROM pares p
                WHERE p.response_at IS NOT NULL
                  AND (p.response_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dia) AS respostas,
              (SELECT COUNT(*)::int FROM last_msg lm
                WHERE lm.direction = 'in'
                  AND (lm.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dia) AS sem_resposta
         FROM dias d ORDER BY d.dia`,
      params,
    );

    // ── retomada REAL: mensagem nossa após ≥48h de silêncio, e se deu resposta ─
    const { rows: [retomada] } = await pool.query<{ enviadas: number; responderam: number }>(
      `WITH target_leads AS (
         SELECT l.id FROM public.crm_leads l WHERE ${leadWhere}
       ),
       msg AS (
         SELECT m.lead_id, m.direction, m.created_at,
                LAG(m.created_at) OVER (PARTITION BY m.lead_id ORDER BY m.created_at, m.id) AS anterior
           FROM public.crm_messages m JOIN target_leads t ON t.id = m.lead_id
          WHERE m.created_at IS NOT NULL
       ),
       reativacoes AS (
         SELECT lead_id, created_at FROM msg
          WHERE direction = 'out' AND anterior IS NOT NULL
            AND created_at - anterior >= INTERVAL '${PARADO_HORAS} hours'
       )
       SELECT COUNT(*)::int AS enviadas,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM msg r
                 WHERE r.lead_id = reativacoes.lead_id AND r.direction = 'in'
                   AND r.created_at > reativacoes.created_at
              ))::int AS responderam
         FROM reativacoes`,
      params,
    );

    return Response.json({
      previous,
      previousPeriod: prevFrom && prevTo ? { from: prevFrom, to: prevTo } : null,
      classification,
      daily,
      retomada: retomada ?? { enviadas: 0, responderam: 0 },
      summary: summary ?? {
        total_leads: 0,
        active_conversations: 0,
        inbound_messages: 0,
        outbound_messages: 0,
        avg_response_seconds: null,
        avg_first_response_seconds: null,
        unanswered_chats: 0,
        max_waiting_seconds: null,
        under_5: 0,
        under_15: 0,
        under_60: 0,
        over_60: 0,
      },
      sources,
      waiting,
      period: { from, to },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[crm attendance]', msg);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    await pool.end();
  }
}
