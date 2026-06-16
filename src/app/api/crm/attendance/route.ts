import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmMessagesSchema, ensureDefaultFunnel } from '@/lib/crm-conversation-sync';

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

    const params = [clientId, from, to];
    const leadWhere = `
      l.client_id = $1
      AND ($2::date IS NULL OR l.data >= $2::date)
      AND ($3::date IS NULL OR l.data <= $3::date)
      AND COALESCE(l.time_interno, false) = false
    `;

    const { rows: [summary] } = await pool.query<{
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
    }>(
      `WITH target_leads AS (
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
         (SELECT COUNT(*)::int FROM response_pairs WHERE response_seconds > 3600) AS over_60`,
      params,
    );

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

    return Response.json({
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
