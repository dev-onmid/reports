import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const origin = searchParams.get('origin') ?? '';
  const status = searchParams.get('status') ?? '';
  const search = searchParams.get('search') ?? '';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  const pool = makeServerPool();
  try {
    const conditions: string[] = ['c.client_id = $1'];
    const values: unknown[] = [id];
    let idx = 2;

    if (origin) { conditions.push(`c.origin = $${idx++}`); values.push(origin); }
    if (status) { conditions.push(`c.status = $${idx++}`); values.push(status); }
    if (search) {
      conditions.push(`(c.phone ILIKE $${idx} OR c.name ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }

    const where = conditions.join(' AND ');

    const [contacts, countRow, stats] = await Promise.all([
      pool.query(
        `SELECT c.id, c.phone, c.name, c.origin, c.utm_source, c.utm_medium, c.utm_campaign,
                c.status, c.created_at,
                COUNT(m.id)::int AS message_count,
                MAX(m.created_at) AS last_message_at
         FROM public.crm_contacts c
         LEFT JOIN public.crm_messages m ON m.contact_id = c.id
         WHERE ${where}
         GROUP BY c.id
         ORDER BY COALESCE(MAX(m.created_at), c.created_at) DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM public.crm_contacts c WHERE ${where}`,
        values,
      ),
      pool.query(
        `SELECT
           origin, COUNT(*)::int AS count
         FROM public.crm_contacts
         WHERE client_id = $1
         GROUP BY origin`,
        [id],
      ),
    ]);

    return Response.json({
      contacts: contacts.rows,
      total: countRow.rows[0]?.total ?? 0,
      page,
      origins: stats.rows,
    });
  } finally {
    await pool.end();
  }
}
