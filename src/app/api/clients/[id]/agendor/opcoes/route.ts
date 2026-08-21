import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { garantirConexaoAgendor, listarOpcoesAgendor } from '@/lib/agendor-server';

/**
 * Funis e origens de lead da conta Agendor do cliente — alimenta os seletores
 * de filtro do card. Separado do GET de config de propósito: consulta a API
 * do Agendor ao vivo, e o card não pode pagar essa latência a cada abertura.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pool = makeServerPool();
  try {
    const conn = await garantirConexaoAgendor(pool, id);
    if (!conn.api_token) {
      return Response.json({ error: 'Conecte o token do Agendor primeiro.' }, { status: 400 });
    }
    return Response.json(await listarOpcoesAgendor(conn.api_token));
  } catch (err) {
    console.error('[agendor opcoes]', err);
    return Response.json({ funis: [], origens: [] });
  } finally {
    await pool.end();
  }
}
