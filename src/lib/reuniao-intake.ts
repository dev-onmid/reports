import type { makeServerPool } from '@/lib/server-db';
import {
  ClickupError,
  createClickupTask,
  ensureClickupSchema,
  resolveClientList,
  type CreateTaskInput,
} from '@/lib/clickup';

type Pool = ReturnType<typeof makeServerPool>;

/**
 * Entrada das reuniões do TLDV (via Make) → tarefas no ClickUp.
 *
 * A regra que justifica este arquivo existir: **nunca adivinhar o cliente.**
 * A automação anterior mandava a IA escolher um cliente sem permitir abstenção
 * e usava "Onmid" como destino de sobra; reunião de cliente não cadastrado
 * (ex.: Outlet Jeans) virava tarefa na lista da Onmid e ninguém percebia,
 * porque o destino era um cliente válido. Aqui o casamento é EXATO sobre o
 * nome normalizado — sem similaridade, sem fallback. Não bateu, ninguém
 * escreve nada no ClickUp e quem chamou recebe as sugestões pra perguntar a um
 * humano.
 */

// ─── Nome do cliente ─────────────────────────────────────────────────────────

/**
 * Forma canônica pra comparar nomes: sem acento, sem pontuação, caixa baixa,
 * espaços colapsados. Absorve "Outlet Jeans " / "outlet jeans" / "Outlet-Jeans"
 * — e nada além disso.
 */
export function normalizeClientName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Dice sobre bigramas — usado SÓ pra sugerir a um humano, nunca pra decidir. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a), gb = grams(b);
  let hits = 0;
  for (const [g, n] of ga) hits += Math.min(n, gb.get(g) ?? 0);
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

export type ClienteRow = { id: string; name: string; gestor_id: string | null; status: string | null };

/**
 * Cliente pelo nome. Devolve `match` só em casamento exato do nome normalizado;
 * `sugestoes` é material pro alerta humano e nunca é aplicado sozinho.
 */
export async function resolveClientByName(pool: Pool, nome: string) {
  const alvo = normalizeClientName(nome);
  const { rows } = await pool.query<ClienteRow>(
    'SELECT id, name, gestor_id, status FROM public.clients',
  );

  const exatos = rows.filter((c) => normalizeClientName(c.name) === alvo);
  // Dois clientes com o mesmo nome normalizado: ambíguo, trata como não achado.
  const match = exatos.length === 1 ? exatos[0] : null;

  const sugestoes = match
    ? []
    : rows
        .map((c) => ({ nome: c.name, score: similarity(alvo, normalizeClientName(c.name)) }))
        .filter((s) => s.score >= 0.45)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((s) => s.nome);

  return { match, sugestoes, ambiguo: exatos.length > 1 };
}

// ─── Responsáveis ────────────────────────────────────────────────────────────

export type Setor = 'trafego' | 'social';
export type Responsavel = { nome: string; clickup_id: number };

type UserRow = { id: string; name: string; clickup_id: string | null; status: string | null };

/**
 * Quem recebe a tarefa, conforme a regra combinada com a agência:
 *
 * - **tráfego** → o gestor da conta (`clients.gestor_id`), uma pessoa só;
 * - **social**  → todo o setor (`users.setor = 'social'`), porque o social não
 *   tem dono por conta.
 *
 * Usuário sem `clickup_id` é ignorado e reportado em `faltando` — atribuir a
 * tarefa a ninguém é melhor do que atribuir à pessoa errada, mas quem chamou
 * precisa saber que faltou.
 */
export async function resolveResponsaveis(pool: Pool, cliente: ClienteRow, setor: Setor) {
  const faltando: string[] = [];

  const usar = (rows: UserRow[]): Responsavel[] =>
    rows.flatMap((u) => {
      const id = Number(u.clickup_id);
      if (!u.clickup_id || !Number.isFinite(id)) {
        faltando.push(u.name);
        return [];
      }
      return [{ nome: u.name, clickup_id: id }];
    });

  if (setor === 'trafego') {
    if (!cliente.gestor_id) return { responsaveis: [], faltando, motivo: 'cliente sem gestor definido' };
    const { rows } = await pool.query<UserRow>(
      `SELECT id, name, clickup_id, status FROM public.users WHERE id = $1`,
      [cliente.gestor_id],
    );
    if (!rows.length) return { responsaveis: [], faltando, motivo: 'gestor da conta não existe mais' };
    return { responsaveis: usar(rows), faltando, motivo: null as string | null };
  }

  const { rows } = await pool.query<UserRow>(
    `SELECT id, name, clickup_id, status FROM public.users
      WHERE setor = 'social' AND COALESCE(status, 'Ativo') = 'Ativo'
      ORDER BY name ASC`,
  );
  if (!rows.length) return { responsaveis: [], faltando, motivo: 'nenhum usuário marcado como setor social' };
  return { responsaveis: usar(rows), faltando, motivo: null as string | null };
}

// ─── Orquestração ────────────────────────────────────────────────────────────

export type AcaoInput = {
  titulo: string;
  descricao?: string;
  setor?: string;
  prioridade?: number | null;
  prazo_dias?: number | null;
  /** Precisa existir na lista de destino, senão o ClickUp recusa a tarefa. */
  status?: string;
};

export type ReuniaoInput = {
  cliente: string;
  meeting_id?: string;
  doc_url?: string;
  acoes: AcaoInput[];
  /** Alerta global da reunião — vira a tarefa "NOVA INFORMAÇÃO" para o social. */
  alertas?: string | null;
};

export type ReuniaoResult =
  | { ok: false; erro: 'cliente_nao_encontrado'; nome_recebido: string; sugestoes: string[]; ambiguo: boolean }
  | { ok: false; erro: 'cliente_sem_lista'; cliente: string }
  | {
      ok: true;
      cliente: { id: string; nome: string };
      lista: { id: string; nome: string | null };
      tarefas: { titulo: string; setor: Setor; task_id: string; url: string; assignees: Responsavel[] }[];
      avisos: string[];
    };

const DIA_MS = 24 * 60 * 60 * 1000;

function setorDe(raw: unknown): Setor {
  // Absorve "Tráfego"/"TRAFEGO"/"trafego"; qualquer outra coisa cai em social,
  // que é o destino de setor inteiro e portanto o erro menos custoso.
  return normalizeClientName(String(raw ?? '')).startsWith('trafego') ? 'trafego' : 'social';
}

/**
 * Ponto único de entrada da automação de reunião. Resolve cliente → lista →
 * responsáveis e cria as tarefas. Falha FECHADO: cliente não resolvido ou sem
 * lista vinculada não escreve nada.
 */
export async function processarReuniao(pool: Pool, input: ReuniaoInput): Promise<ReuniaoResult> {
  await ensureClickupSchema(pool);
  // Quem normalmente cria estas colunas são as rotas de usuários/vínculo — mas
  // esta rota não pode depender de alguém ter aberto aquelas telas antes do
  // primeiro webhook chegar. Sem isto, o primeiro uso em produção quebrava com
  // "column setor does not exist".
  await pool.query('ALTER TABLE public.users ADD COLUMN IF NOT EXISTS setor TEXT').catch(() => {});
  await pool.query('ALTER TABLE public.users ADD COLUMN IF NOT EXISTS clickup_id TEXT').catch(() => {});

  const { match, sugestoes, ambiguo } = await resolveClientByName(pool, input.cliente);
  if (!match) {
    return { ok: false, erro: 'cliente_nao_encontrado', nome_recebido: input.cliente, sugestoes, ambiguo };
  }

  const lista = await resolveClientList(pool, match.id);
  if (!lista) return { ok: false, erro: 'cliente_sem_lista', cliente: match.name };

  const avisos: string[] = [];
  const tarefas: Extract<ReuniaoResult, { ok: true }>['tarefas'] = [];
  const rodape = [
    input.doc_url ? `\n\n---\n📄 Resumo da reunião: ${input.doc_url}` : '',
    input.meeting_id ? `\n🔗 meetingId: ${input.meeting_id}` : '',
  ].join('');

  // Cache por setor: uma reunião gera várias ações e o rateio não muda no meio.
  const porSetor = new Map<Setor, Awaited<ReturnType<typeof resolveResponsaveis>>>();

  // O alerta global vira a primeira "ação", destinada ao social — substitui o
  // módulo do Make que criava essa tarefa com os três assignees chumbados.
  const acoes: AcaoInput[] = input.alertas
    ? [{
        titulo: 'NOVA INFORMAÇÃO',
        descricao: `⚠️ Atualização sobre o cliente\n\n${input.alertas}`,
        setor: 'social',
        prioridade: 2,
        status: 'BRIEFING',
      }, ...input.acoes]
    : input.acoes;

  for (const acao of acoes) {
    if (!acao?.titulo?.trim()) continue;
    const setor = setorDe(acao.setor);

    if (!porSetor.has(setor)) {
      const r = await resolveResponsaveis(pool, match, setor);
      porSetor.set(setor, r);
      if (r.motivo) avisos.push(`${setor}: ${r.motivo} — tarefa criada sem responsável`);
      for (const nome of r.faltando) avisos.push(`${nome} não tem ClickUp ID cadastrado e ficou de fora`);
    }
    const { responsaveis } = porSetor.get(setor)!;

    const payload: CreateTaskInput = {
      // O prefixo [Cliente] sobrevive à notificação do ClickUp, onde o nome da
      // lista não aparece — mesma convenção que o Make usava.
      name: `[${match.name}] ${acao.titulo.trim()}`,
      description: `${acao.descricao?.trim() ?? ''}${rodape}`.trim() || undefined,
      status: acao.status?.trim() || undefined,
      priority: (acao.prioridade ?? null) as CreateTaskInput['priority'],
      due_date: typeof acao.prazo_dias === 'number' ? Date.now() + acao.prazo_dias * DIA_MS : null,
      assignees: responsaveis.map((r) => r.clickup_id),
    };

    try {
      const task = await createClickupTask(lista.connection.api_token, lista.listId, payload);
      tarefas.push({ titulo: payload.name, setor, task_id: task.id, url: task.url, assignees: responsaveis });
    } catch (err) {
      // Uma ação que falha não pode derrubar as outras — a reunião inteira se
      // perderia por causa de um título recusado pelo ClickUp.
      const msg = err instanceof ClickupError ? err.message : 'falha ao criar tarefa';
      avisos.push(`"${payload.name}": ${msg}`);
    }
  }

  return {
    ok: true,
    cliente: { id: match.id, nome: match.name },
    lista: { id: lista.listId, nome: lista.listName },
    tarefas,
    avisos,
  };
}
