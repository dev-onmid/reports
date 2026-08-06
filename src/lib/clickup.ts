import type { makeServerPool } from '@/lib/server-db';

type Pool = ReturnType<typeof makeServerPool>;

const API_BASE = 'https://api.clickup.com/api/v2';

/**
 * Vercel Hobby mata a rota em 10s. Toda chamada ao ClickUp aborta antes disso pra
 * a rota conseguir devolver um erro legível em vez de morrer sem corpo.
 */
const DEFAULT_TIMEOUT_MS = 8_000;

// ─── Schema ───────────────────────────────────────────────────────────────────

let schemaEnsured = false;

/**
 * Padrão do projeto: DDL inline memoizada por processo (não há runner de .sql).
 * `clickup_connections` guarda o token pessoal da API (mesma decisão de
 * `leadlovers_connections.auth_key` e das tabelas de token Meta/Google: texto
 * puro no banco, nunca devolvido ao browser — ver `maskToken`).
 */
export async function ensureClickupSchema(pool: Pool) {
  if (schemaEnsured) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS public.clickup_connections (
       id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       owner_id       TEXT NOT NULL,
       name           TEXT NOT NULL,
       api_token      TEXT NOT NULL,
       workspace_id   TEXT,
       workspace_name TEXT,
       user_name      TEXT,
       user_email     TEXT,
       active         BOOLEAN NOT NULL DEFAULT true,
       created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    // Um cliente do ONMID aponta pra UMA lista do ClickUp (client_id é a PK):
    // é esse vínculo que qualquer envio futuro usa pra saber o destino.
    `CREATE TABLE IF NOT EXISTS public.clickup_client_links (
       client_id     TEXT PRIMARY KEY,
       connection_id UUID NOT NULL,
       list_id       TEXT NOT NULL,
       list_name     TEXT,
       folder_name   TEXT,
       space_name    TEXT,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS clickup_client_links_conn_idx ON public.clickup_client_links (connection_id)`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch((err) => console.error('[clickup schema]', err?.message ?? err));
  }
  schemaEnsured = true;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ClickupConnection = {
  id: string;
  owner_id: string;
  name: string;
  api_token: string;
  workspace_id: string | null;
  workspace_name: string | null;
  user_name: string | null;
  user_email: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ClickupUser = { id: number; username: string; email: string };
export type ClickupTeam = { id: string; name: string };
/** Membro do workspace — é o `id` que vai no `assignees` de uma tarefa. */
export type ClickupMember = { id: number; username: string; email: string };
export type ClickupSpace = { id: string; name: string };
export type ClickupList = { id: string; name: string; task_count?: number | null };
export type ClickupFolder = { id: string; name: string; lists?: ClickupList[] };

export type ClickupTask = {
  id: string;
  name: string;
  url: string;
  /** `type` vem do ClickUp ('open'|'closed'|'done'|'custom') — é o jeito
   * confiável de saber se a tarefa terminou, sem adivinhar pelo rótulo. */
  status?: { status: string; color: string; type?: string } | null;
  date_created?: string | null;
  due_date?: string | null;
  assignees?: { id: number; username: string }[];
  /** Descrição carrega a assinatura das tarefas criadas por reunião
   * (`🔗 meetingId: …`, ver `processarReuniao`) — a API devolve os dois campos. */
  description?: string | null;
  text_content?: string | null;
};

/** Espelha a hierarquia que a tela usa pra montar o seletor de lista. */
export type ClickupHierarchy = {
  team: ClickupTeam;
  spaces: {
    id: string;
    name: string;
    folders: { id: string; name: string; lists: ClickupList[] }[];
    lists: ClickupList[];
  }[];
};

export class ClickupError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ClickupError';
    this.status = status;
  }
}

/** O token nunca chega ao browser inteiro — só o suficiente pra reconhecer qual é. */
export function maskToken(token: string | null | undefined): string {
  if (!token) return '';
  if (token.length <= 12) return '••••••••';
  return `${token.slice(0, 7)}${'•'.repeat(10)}${token.slice(-4)}`;
}

// ─── Cliente HTTP ─────────────────────────────────────────────────────────────

/**
 * O token pessoal do ClickUp vai CRU no header Authorization (sem "Bearer") —
 * diferente de OAuth. Erro da API vem em `{ err }`, que é o que a tela mostra.
 */
export async function clickupFetch<T>(
  token: string,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        ...(headers as Record<string, string> | undefined),
      },
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // 5xx do ClickUp às vezes volta HTML — segue com data null e cai no throw abaixo.
    }
    if (!res.ok) {
      const body = data as { err?: string; error?: string } | null;
      const detail = body?.err ?? body?.error ?? (text ? text.slice(0, 180) : '');
      const label = res.status === 401
        ? 'Token inválido ou sem permissão (401)'
        : `Erro ${res.status} no ClickUp`;
      throw new ClickupError(detail ? `${label}: ${detail}` : label, res.status);
    }
    return data as T;
  } catch (err) {
    if (err instanceof ClickupError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ClickupError('O ClickUp demorou demais para responder', 504);
    }
    throw new ClickupError(err instanceof Error ? err.message : 'Falha de rede ao falar com o ClickUp', 502);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Leitura ──────────────────────────────────────────────────────────────────

export async function getClickupUser(token: string) {
  const { user } = await clickupFetch<{ user: ClickupUser }>(token, '/user');
  return user;
}

export async function getClickupTeams(token: string) {
  const { teams } = await clickupFetch<{ teams: ClickupTeam[] }>(token, '/team');
  return teams ?? [];
}

/**
 * Membros do workspace. O `/team` já traz `members` embutido, então isso é uma
 * chamada só — não existe endpoint dedicado de membros na API v2.
 *
 * Quem chama usa isto pra casar `users.email` do ONMID com o ID numérico do
 * ClickUp, que é o único identificador aceito em `assignees`.
 */
export async function getClickupMembers(token: string, teamId?: string): Promise<ClickupMember[]> {
  type TeamWithMembers = ClickupTeam & { members?: { user?: Partial<ClickupMember> }[] };
  const { teams } = await clickupFetch<{ teams: TeamWithMembers[] }>(token, '/team');
  const target = teamId ? (teams ?? []).find((t) => String(t.id) === String(teamId)) : (teams ?? [])[0];
  const seen = new Set<number>();
  return (target?.members ?? []).flatMap(({ user }) => {
    if (!user?.id || seen.has(user.id)) return [];
    seen.add(user.id);
    return [{ id: user.id, username: user.username ?? '', email: (user.email ?? '').trim().toLowerCase() }];
  });
}

export async function getClickupSpaces(token: string, teamId: string) {
  const { spaces } = await clickupFetch<{ spaces: ClickupSpace[] }>(token, `/team/${teamId}/space?archived=false`);
  return spaces ?? [];
}

export async function getClickupFolders(token: string, spaceId: string) {
  const { folders } = await clickupFetch<{ folders: ClickupFolder[] }>(token, `/space/${spaceId}/folder?archived=false`);
  return folders ?? [];
}

/** Listas soltas no espaço (fora de qualquer pasta). */
export async function getClickupFolderlessLists(token: string, spaceId: string) {
  const { lists } = await clickupFetch<{ lists: ClickupList[] }>(token, `/space/${spaceId}/list?archived=false`);
  return lists ?? [];
}

/**
 * Árvore completa do workspace. As listas já vêm embutidas na resposta de
 * `/folder`, então são 1 + 2×(nº de espaços) chamadas — os espaços em paralelo
 * pra caber no orçamento da rota.
 */
export async function fetchClickupHierarchy(token: string, teamId: string, teamName = ''): Promise<ClickupHierarchy> {
  const spaces = await getClickupSpaces(token, teamId);
  const built = await Promise.all(
    spaces.map(async (space) => {
      const [folders, lists] = await Promise.all([
        getClickupFolders(token, space.id).catch(() => [] as ClickupFolder[]),
        getClickupFolderlessLists(token, space.id).catch(() => [] as ClickupList[]),
      ]);
      return {
        id: space.id,
        name: space.name,
        folders: folders.map((f) => ({ id: f.id, name: f.name, lists: f.lists ?? [] })),
        lists,
      };
    }),
  );
  return { team: { id: teamId, name: teamName }, spaces: built };
}

export async function getListTasks(
  token: string,
  listId: string,
  opts?: { includeClosed?: boolean; page?: number; subtasks?: boolean },
) {
  const qs = new URLSearchParams({
    archived: 'false',
    include_closed: String(opts?.includeClosed ?? false),
    page: String(opts?.page ?? 0),
  });
  if (opts?.subtasks) qs.set('subtasks', 'true');
  const { tasks } = await clickupFetch<{ tasks: ClickupTask[] }>(token, `/list/${listId}/task?${qs}`);
  return tasks ?? [];
}

// ─── Escrita ──────────────────────────────────────────────────────────────────

export type CreateTaskInput = {
  name: string;
  description?: string;
  /** Precisa ser um status que exista na lista de destino, senão o ClickUp recusa. */
  status?: string;
  /** 1 urgente · 2 alta · 3 normal · 4 baixa */
  priority?: 1 | 2 | 3 | 4 | null;
  /** epoch em ms */
  due_date?: number | null;
  assignees?: number[];
  tags?: string[];
};

export async function createClickupTask(token: string, listId: string, input: CreateTaskInput) {
  return clickupFetch<ClickupTask>(token, `/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateClickupTask(
  token: string,
  taskId: string,
  input: Partial<Pick<CreateTaskInput, 'name' | 'description' | 'status' | 'priority' | 'due_date'>>,
) {
  return clickupFetch<ClickupTask>(token, `/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function createClickupComment(token: string, taskId: string, text: string) {
  return clickupFetch<{ id: string }>(token, `/task/${taskId}/comment`, {
    method: 'POST',
    body: JSON.stringify({ comment_text: text, notify_all: false }),
  });
}

// ─── Resolução no banco ───────────────────────────────────────────────────────

/** Conexão ativa (a mais recente). O app é single-workspace na prática. */
export async function getClickupConnection(pool: Pool, connectionId?: string | null): Promise<ClickupConnection | null> {
  await ensureClickupSchema(pool);
  const { rows } = connectionId
    ? await pool.query<ClickupConnection>('SELECT * FROM public.clickup_connections WHERE id = $1', [connectionId])
    : await pool.query<ClickupConnection>(
        'SELECT * FROM public.clickup_connections WHERE active ORDER BY updated_at DESC LIMIT 1',
      );
  return rows[0] ?? null;
}

export type ResolvedClientList = {
  connection: ClickupConnection;
  listId: string;
  listName: string | null;
};

/**
 * Ponto de entrada de qualquer automação futura ("abrir task do cliente X"):
 * cliente do ONMID → lista do ClickUp. Devolve null quando o cliente não foi
 * vinculado, pra quem chama poder pular em silêncio em vez de estourar.
 */
export async function resolveClientList(pool: Pool, clientId: string): Promise<ResolvedClientList | null> {
  await ensureClickupSchema(pool);
  const { rows: [link] } = await pool.query<{ connection_id: string; list_id: string; list_name: string | null }>(
    'SELECT connection_id, list_id, list_name FROM public.clickup_client_links WHERE client_id = $1',
    [clientId],
  );
  if (!link) return null;
  const connection = await getClickupConnection(pool, link.connection_id);
  if (!connection) return null;
  return { connection, listId: link.list_id, listName: link.list_name };
}

/**
 * Atalho de uso futuro: cria a tarefa direto na lista do cliente.
 * Devolve null (sem lançar) quando o cliente não tem vínculo — assim um cron
 * pode chamar isso pra carteira inteira sem se preocupar com quem está fora.
 */
export async function createTaskForClient(pool: Pool, clientId: string, input: CreateTaskInput) {
  const resolved = await resolveClientList(pool, clientId);
  if (!resolved) return null;
  return createClickupTask(resolved.connection.api_token, resolved.listId, input);
}
