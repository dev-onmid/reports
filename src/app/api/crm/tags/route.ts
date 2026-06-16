import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmDisparoSchema } from '@/lib/crm-disparo';

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureCrmDisparoSchema(pool);
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.color, t.created_at,
              COUNT(a.lead_id)::int AS lead_count
         FROM public.crm_lead_tags t
         LEFT JOIN public.crm_lead_tag_assignments a ON a.tag_id = t.id
        WHERE t.client_id = $1
        GROUP BY t.id
        ORDER BY t.name ASC`,
      [clientId],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { clientId: string; name: string; color?: string };
  const { clientId, name, color } = body;
  if (!clientId || !name?.trim()) {
    return Response.json({ error: 'clientId e name são obrigatórios.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureCrmDisparoSchema(pool);
    const { rows: [tag] } = await pool.query(
      `INSERT INTO public.crm_lead_tags (client_id, name, color)
       VALUES ($1, $2, $3)
       ON CONFLICT (client_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, color, created_at`,
      [clientId, name.trim(), color || '#0ea5e9'],
    );
    return Response.json(tag, { status: 201 });
  } finally {
    await pool.end();
  }
}
