import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import {
  ClickupError,
  ensureClickupSchema,
  getClickupConnection,
  getClickupTeams,
  getClickupUser,
  maskToken,
} from '@/lib/clickup';

/**
 * Conexão com o ClickUp (token pessoal da API). Integração da agência inteira,
 * não de um parceiro — por isso escrita e leitura exigem `unrestricted`, mesmo
 * padrão das rotas de config do alerta de saldo.
 */

type ConfigBody = { api_token?: string; name?: string; workspace_id?: string; workspace_name?: string };

/** Nunca devolve `api_token` cru ao browser. */
function publicShape(conn: Awaited<ReturnType<typeof getClickupConnection>>) {
  if (!conn) return null;
  return {
    id: conn.id,
    name: conn.name,
    token_masked: maskToken(conn.api_token),
    workspace_id: conn.workspace_id,
    workspace_name: conn.workspace_name,
    user_name: conn.user_name,
    user_email: conn.user_email,
    active: conn.active,
    updated_at: conn.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureClickupSchema(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const conn = await getClickupConnection(pool);
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM public.clickup_client_links',
    );
    return Response.json({ connection: publicShape(conn), linked_clients: Number(count) });
  } catch (err) {
    console.error('[clickup config GET]', err);
    return Response.json({ connection: null, linked_clients: 0 });
  } finally {
    await pool.end();
  }
}

/** Testa um token SEM salvar — usado pelo botão "Testar conexão". */
export async function PUT(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureClickupSchema(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json() as ConfigBody;
    // Sem token no corpo, testa o que já está salvo.
    const token = body.api_token?.trim() || (await getClickupConnection(pool))?.api_token;
    if (!token) return Response.json({ error: 'Nenhum token informado ou salvo' }, { status: 400 });

    const [user, teams] = await Promise.all([getClickupUser(token), getClickupTeams(token)]);
    return Response.json({ ok: true, user, teams });
  } catch (err) {
    const message = err instanceof ClickupError ? err.message : 'Falha ao testar a conexão';
    return Response.json({ ok: false, error: message }, { status: 200 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureClickupSchema(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId || !scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json() as ConfigBody;
    const token = body.api_token?.trim();
    if (!token) return Response.json({ error: 'Token obrigatório' }, { status: 400 });

    // Só salva token que comprovadamente funciona — evita "conectado" mentiroso.
    const [user, teams] = await Promise.all([getClickupUser(token), getClickupTeams(token)]);
    const chosen = teams.find((t) => t.id === body.workspace_id) ?? teams[0] ?? null;

    // Reaproveita a linha existente (em vez de criar outra) pra os vínculos
    // cliente↔lista, que apontam pro connection_id, sobreviverem à troca de token.
    const existing = await getClickupConnection(pool);
    const values = [
      body.name?.trim() || 'ClickUp',
      token,
      chosen?.id ?? null,
      chosen?.name ?? null,
      user.username ?? null,
      user.email ?? null,
    ];

    const { rows: [saved] } = existing
      ? await pool.query(
          `UPDATE public.clickup_connections
              SET name = $1, api_token = $2, workspace_id = $3, workspace_name = $4,
                  user_name = $5, user_email = $6, active = true, updated_at = NOW()
            WHERE id = $7
        RETURNING *`,
          [...values, existing.id],
        )
      : await pool.query(
          `INSERT INTO public.clickup_connections
             (owner_id, name, api_token, workspace_id, workspace_name, user_name, user_email)
           VALUES ($7, $1, $2, $3, $4, $5, $6)
        RETURNING *`,
          [...values, scope.userId],
        );

    return Response.json({ connection: publicShape(saved), teams }, { status: existing ? 200 : 201 });
  } catch (err) {
    const message = err instanceof ClickupError ? err.message : 'Falha ao salvar a conexão';
    console.error('[clickup config POST]', err);
    return Response.json({ error: message }, { status: err instanceof ClickupError ? 400 : 500 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureClickupSchema(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    const conn = await getClickupConnection(pool, id);
    if (!conn) return Response.json({ ok: true });

    // Os vínculos vão junto: sem token, apontar cliente pra lista não significa nada.
    await pool.query('DELETE FROM public.clickup_client_links WHERE connection_id = $1', [conn.id]);
    await pool.query('DELETE FROM public.clickup_connections WHERE id = $1', [conn.id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
