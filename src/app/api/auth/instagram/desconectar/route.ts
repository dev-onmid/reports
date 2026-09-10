import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureInstagramDirectSchema } from '@/lib/instagram-direct';

/**
 * Desvincula a conexão direta (Instagram Login) de um cliente.
 *
 * Remove só a NOSSA linha (o token morre com ela). A autorização do lado do
 * Instagram continua até a pessoa revogar em Configurações → Site e apps —
 * a tela diz isso para não parecer que "sumiu de todo lugar".
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { clientId } = await req.json().catch(() => ({})) as { clientId?: string };
  if (!clientId) return Response.json({ ok: false, error: 'clientId ausente' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureInstagramDirectSchema(pool);
    const { rowCount } = await pool.query(
      `DELETE FROM public.instagram_direct_connections WHERE client_id = $1`, [clientId],
    );
    return Response.json({ ok: true, removida: (rowCount ?? 0) > 0 });
  } catch (err) {
    console.error('[instagram desconectar]', err);
    return Response.json({ ok: false, error: 'erro' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
