import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import {
  ClickupError,
  fetchClickupHierarchy,
  getClickupConnection,
  getClickupTeams,
} from '@/lib/clickup';

/**
 * Árvore do workspace (espaços → pastas → listas) que alimenta o seletor de
 * lista da tela de vínculo. Leitura pura no ClickUp, nada é gravado.
 */
export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const conn = await getClickupConnection(pool);
    if (!conn) return Response.json({ error: 'ClickUp não conectado' }, { status: 400 });

    const teamId = new URL(req.url).searchParams.get('teamId') ?? conn.workspace_id;
    if (!teamId) {
      const teams = await getClickupTeams(conn.api_token);
      if (!teams.length) return Response.json({ error: 'Nenhum workspace encontrado no ClickUp' }, { status: 400 });
      const tree = await fetchClickupHierarchy(conn.api_token, teams[0].id, teams[0].name);
      return Response.json(tree);
    }

    const tree = await fetchClickupHierarchy(conn.api_token, teamId, conn.workspace_name ?? '');
    return Response.json(tree);
  } catch (err) {
    const message = err instanceof ClickupError ? err.message : 'Falha ao carregar o workspace';
    console.error('[clickup hierarchy]', err);
    return Response.json({ error: message }, { status: 502 });
  } finally {
    await pool.end();
  }
}
