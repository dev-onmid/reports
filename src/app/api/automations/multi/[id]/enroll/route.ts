import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json() as {
    name?: string;
    email?: string;
    whatsapp?: string;
    instagramId?: string;
    context?: Record<string, unknown>;
  };
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.mc_automation_contacts
         (automation_id, name, email, whatsapp, instagram_id, context_json, current_node_id, next_send_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'trigger', NOW())
       RETURNING id`,
      [
        id,
        body.name ?? null,
        body.email ?? null,
        body.whatsapp ?? null,
        body.instagramId ?? null,
        JSON.stringify(body.context ?? {}),
      ],
    );
    return Response.json({ ok: true, contactId: rows[0].id });
  } finally {
    await pool.end();
  }
}
