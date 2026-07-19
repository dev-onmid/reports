import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getOrCreatePortalToken, revokePortalTokens, ensurePortalSchema } from '@/lib/crm-portal';

// Gestão do link do portal do cliente (interno, usado pelo CRM workspace).
// POST = gera (ou retorna o existente); DELETE = revoga todos os links.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;
  const pool = makeServerPool();
  try {
    const token = await getOrCreatePortalToken(pool, clientId);
    return Response.json({ token, path: `/portal/${token}` });
  } catch (err) {
    console.error('[portal token POST]', err);
    return Response.json({ error: 'Erro ao gerar link' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;
  const pool = makeServerPool();
  try {
    await ensurePortalSchema(pool);
    const { rows: [row] } = await pool.query<{ token: string; created_at: string; last_access_at: string | null }>(
      `SELECT token, created_at, last_access_at FROM public.crm_portal_tokens
        WHERE client_id = $1 AND enabled = TRUE
        ORDER BY created_at DESC LIMIT 1`,
      [clientId],
    );
    if (!row) return Response.json({ token: null });
    return Response.json({ token: row.token, path: `/portal/${row.token}`, createdAt: row.created_at, lastAccessAt: row.last_access_at });
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;
  const pool = makeServerPool();
  try {
    await revokePortalTokens(pool, clientId);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
