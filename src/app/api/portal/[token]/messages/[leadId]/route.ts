import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolvePortalToken } from '@/lib/crm-portal';

// Conversa read-only do portal do cliente. O lead precisa pertencer ao
// client_id do token — sem isso, 404 (nunca vaza conversa de outro cliente).

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string; leadId: string }> },
) {
  const { token, leadId } = await params;
  const pool = makeServerPool();
  try {
    const ctx = await resolvePortalToken(pool, token);
    if (!ctx) return Response.json({ error: 'Link inválido ou revogado' }, { status: 404 });

    const { rows: [lead] } = await pool.query<{ id: string; nome: string | null }>(
      `SELECT id, nome FROM public.crm_leads
        WHERE id = $1::uuid AND client_id = $2 AND time_interno IS NOT TRUE`,
      [leadId, ctx.clientId],
    ).catch(() => ({ rows: [] as Array<{ id: string; nome: string | null }> }));
    if (!lead) return Response.json({ error: 'Lead não encontrado' }, { status: 404 });

    const { rows: messages } = await pool.query(
      `SELECT id, direction, text, COALESCE(tipo, 'texto') AS tipo, created_at
         FROM public.crm_messages
        WHERE lead_id = $1::uuid
        ORDER BY created_at ASC, id ASC
        LIMIT 500`,
      [leadId],
    );

    return Response.json({ lead: { id: lead.id, nome: lead.nome }, messages });
  } catch (err) {
    console.error('[portal messages GET]', err);
    return Response.json({ error: 'Erro ao carregar' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
