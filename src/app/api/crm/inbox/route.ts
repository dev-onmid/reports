import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT
         l.id,
         l.nome,
         l.numero,
         l.canal,
         l.origin,
         l.status,
         l.fechou,
         l.valor_rs,
         l.created_at,
         l.updated_at,
         m.text        AS last_message,
         m.direction   AS last_direction,
         m.created_at  AS last_message_at,
         COUNT(m2.id)  AS unread_count
       FROM public.crm_leads l
       LEFT JOIN LATERAL (
         SELECT text, direction, created_at
         FROM public.crm_messages
         WHERE lead_id = l.id
         ORDER BY created_at DESC
         LIMIT 1
       ) m ON true
       LEFT JOIN public.crm_messages m2
         ON m2.lead_id = l.id AND m2.direction = 'in'
            AND m2.created_at > COALESCE(l.updated_at, l.created_at - interval '1 day')
       WHERE l.client_id = $1
         AND (l.numero IS NULL OR l.numero ~ '^[0-9+]{7,15}$')
       GROUP BY l.id, m.text, m.direction, m.created_at
       ORDER BY COALESCE(m.created_at, l.created_at) DESC
       LIMIT 200`,
      [clientId],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
