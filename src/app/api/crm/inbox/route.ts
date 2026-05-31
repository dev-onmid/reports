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
         -- Só mostra o nome salvo se o contato já enviou mensagem de entrada.
         -- Considera todos os leads com o mesmo número (webhook vs CRM manual).
         CASE WHEN EXISTS (
           SELECT 1 FROM public.crm_messages ix
           WHERE ix.lead_id IN (
             SELECT id FROM public.crm_leads l2
             WHERE l2.client_id = l.client_id AND l2.numero = l.numero AND l2.numero IS NOT NULL
             UNION SELECT l.id
           )
           AND ix.direction = 'in'
         ) THEN l.nome ELSE NULL END AS nome,
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
         -- Busca última mensagem de qualquer lead com o mesmo número do cliente
         SELECT text, direction, created_at
         FROM public.crm_messages
         WHERE lead_id IN (
           SELECT id FROM public.crm_leads l2
           WHERE l2.client_id = l.client_id
             AND l2.numero    = l.numero
             AND l2.numero IS NOT NULL
           UNION SELECT l.id
         )
         ORDER BY created_at DESC
         LIMIT 1
       ) m ON true
       LEFT JOIN public.crm_messages m2
         ON m2.lead_id IN (
           SELECT id FROM public.crm_leads l3
           WHERE l3.client_id = l.client_id AND l3.numero = l.numero AND l3.numero IS NOT NULL
           UNION SELECT l.id
         )
         AND m2.direction = 'in'
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
