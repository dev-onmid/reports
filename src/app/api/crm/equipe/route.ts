import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

/**
 * Quem pode ser responsável por um lead deste cliente: os usuários do próprio
 * cliente (team='cliente' com o cliente na lista) e os nomes que já aparecem
 * como responsável (vindos do SULTS/Agendor ou digitados antes). Só NOMES —
 * e-mail e papel não saem daqui, porque esta rota é aberta ao usuário de cliente.
 */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });
  const pool = makeServerPool();
  try {
    const { rows: usuarios } = await pool.query(
      `SELECT name FROM public.users
        WHERE status = 'Ativo' AND team = 'cliente' AND $1 = ANY(client_ids)
        ORDER BY name`,
      [clientId],
    ).catch(() => ({ rows: [] as { name: string }[] }));
    const { rows: usados } = await pool.query(
      `SELECT responsavel AS name, COUNT(*)::int n FROM public.crm_leads
        WHERE client_id = $1 AND NULLIF(TRIM(responsavel), '') IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
      [clientId],
    ).catch(() => ({ rows: [] as { name: string }[] }));
    const nomes = [...new Set([...usuarios, ...usados].map(r => String(r.name).trim()).filter(Boolean))];
    return Response.json({ nomes });
  } finally {
    await pool.end();
  }
}
