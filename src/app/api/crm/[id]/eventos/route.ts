import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmEventos } from '@/lib/crm-eventos';

/**
 * Linha do tempo do lead: o que pessoas fizeram (crm_lead_eventos) somado ao
 * que a IA moveu (crm_status_historico). As duas fontes ficam separadas no
 * banco porque têm donos diferentes; a tela só precisa delas juntas e em ordem.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureCrmEventos(pool);
    const { rows: pessoas } = await pool.query(
      `SELECT tipo, campo, de, para, autor_nome, created_at
         FROM public.crm_lead_eventos WHERE lead_id = $1::uuid
        ORDER BY created_at DESC LIMIT 200`,
      [id],
    );
    const { rows: ia } = await pool.query(
      `SELECT 'etapa' AS tipo, 'status' AS campo, status_anterior AS de, status_novo AS para,
              'IA' AS autor_nome, created_at, motivo
         FROM public.crm_status_historico WHERE lead_id::text = $1
        ORDER BY created_at DESC LIMIT 100`,
      [id],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const tudo = [...pessoas, ...ia]
      .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime())
      .slice(0, 200);
    return Response.json({ eventos: tudo });
  } catch (err) {
    console.error('[crm eventos]', err);
    return Response.json({ eventos: [] });
  } finally {
    await pool.end();
  }
}
