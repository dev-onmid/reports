import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const VALID_STATUSES = ['novo', 'em_atendimento', 'convertido', 'perdido'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const { id, contactId } = await params;
  const body = await req.json().catch(() => ({})) as { status?: string };

  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    return Response.json({ error: 'Status inválido' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const { rowCount } = await pool.query(
      `UPDATE public.crm_contacts
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND client_id = $3`,
      [body.status, contactId, id],
    );
    if (!rowCount) return Response.json({ error: 'Contato não encontrado' }, { status: 404 });
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const { id, contactId } = await params;
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, direction, text, created_at
       FROM public.crm_messages
       WHERE contact_id = $1 AND client_id = $2
       ORDER BY created_at ASC
       LIMIT 200`,
      [contactId, id],
    );
    return Response.json({ messages: rows });
  } finally {
    await pool.end();
  }
}
