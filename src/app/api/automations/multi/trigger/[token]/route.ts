import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT t.automation_id FROM public.mc_automation_tokens t
       JOIN public.mc_automations a ON a.id = t.automation_id
       WHERE t.token = $1 AND a.status = 'active'`,
      [token],
    );
    if (rows.length === 0) return Response.json({ error: 'Invalid token' }, { status: 404 });
    const automationId = rows[0].automation_id as string;

    const contact = {
      name: (body.name ?? body.nome ?? null) as string | null,
      email: (body.email ?? null) as string | null,
      whatsapp: (body.whatsapp ?? body.phone ?? body.numero ?? null) as string | null,
      instagramId: (body.instagram_id ?? null) as string | null,
    };

    await pool.query(
      `INSERT INTO public.mc_automation_contacts
         (automation_id, name, email, whatsapp, instagram_id, context_json, current_node_id, next_send_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'trigger', NOW())`,
      [
        automationId,
        contact.name,
        contact.email,
        contact.whatsapp,
        contact.instagramId,
        JSON.stringify(body),
      ],
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
