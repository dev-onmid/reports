import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import {
  ClickupError,
  createClickupTask,
  getClickupConnection,
  getListTasks,
  resolveClientList,
  type CreateTaskInput,
} from '@/lib/clickup';

/**
 * Porta genérica de entrada/saída de tarefas — é por aqui que o resto do sistema
 * (ou a Luna, um cron, um botão de tela) puxa e cria tarefa sem falar HTTP com o
 * ClickUp na mão. Aceita `clientId` (resolve a lista pelo vínculo) ou `listId`.
 */

async function resolveTarget(pool: ReturnType<typeof makeServerPool>, clientId: string | null, listId: string | null) {
  if (listId) {
    const conn = await getClickupConnection(pool);
    if (!conn) return { error: 'ClickUp não conectado', status: 400 as const };
    return { token: conn.api_token, listId };
  }
  if (!clientId) return { error: 'Informe clientId ou listId', status: 400 as const };
  const resolved = await resolveClientList(pool, clientId);
  if (!resolved) return { error: 'Cliente não vinculado a nenhuma lista do ClickUp', status: 404 as const };
  return { token: resolved.connection.api_token, listId: resolved.listId };
}

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const params = new URL(req.url).searchParams;
    const target = await resolveTarget(pool, params.get('clientId'), params.get('listId'));
    if ('error' in target) return Response.json({ error: target.error }, { status: target.status });

    const tasks = await getListTasks(target.token, target.listId, {
      includeClosed: params.get('includeClosed') === 'true',
      page: Number(params.get('page') ?? 0) || 0,
    });
    return Response.json({ list_id: target.listId, tasks });
  } catch (err) {
    const message = err instanceof ClickupError ? err.message : 'Falha ao buscar tarefas';
    console.error('[clickup tasks GET]', err);
    return Response.json({ error: message }, { status: 502 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    // Criar tarefa escreve no ClickUp da agência — mesma régua da config.
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json() as CreateTaskInput & { clientId?: string; listId?: string };
    if (!body.name?.trim()) return Response.json({ error: 'Nome da tarefa obrigatório' }, { status: 400 });

    const target = await resolveTarget(pool, body.clientId ?? null, body.listId ?? null);
    if ('error' in target) return Response.json({ error: target.error }, { status: target.status });

    const task = await createClickupTask(target.token, target.listId, {
      name: body.name.trim(),
      description: body.description,
      status: body.status,
      priority: body.priority ?? null,
      due_date: body.due_date ?? null,
      assignees: body.assignees,
      tags: body.tags,
    });
    return Response.json({ task }, { status: 201 });
  } catch (err) {
    const message = err instanceof ClickupError ? err.message : 'Falha ao criar a tarefa';
    console.error('[clickup tasks POST]', err);
    return Response.json({ error: message }, { status: 502 });
  } finally {
    await pool.end();
  }
}
