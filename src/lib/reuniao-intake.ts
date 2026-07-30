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

// ─── Identificação determinística (substitui a IA do Cenário 1) ─────────────

export type Identificacao = {
  cliente_corrigido: string;
  /** 0–100. As regras determinísticas ficam todas ≥ 90; abstenção fica ≤ 84. */
  confianca: number;
  motivo: string;
  alternativas: string[];
};

const tokensDe = (s: string) => normalizeClientName(s).split(' ').filter(Boolean);
const mesmoConjunto = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');
const contem = (fora: string[], dentro: string[]) => {
  const set = new Set(fora);
  return dentro.every((t) => set.has(t));
};

/**
 * Casa o nome lido da agenda com a lista de clientes por REGRAS DE TEXTO, na
 * ordem: igual → mesmas palavras em outra ordem → cliente contido no título →
 * título contido no cliente (apelido). Qualquer empate é ambiguidade e vira
 * abstenção.
 *
 * Isto substitui o módulo de IA do Make que fazia a mesma coisa: a IA acertava
 * o casamento mas de vez em quando mudava o FORMATO da resposta (confiança
 * "95%" em vez de 95), e o cenário morria num beco sem saída silencioso.
 * Regra de texto não tem dia ruim, e dá pra rodar a bateria de títulos reais
 * num teste antes de encostar em produção.
 */
export function identificarCliente(nomes: string[], nomeReuniao: string): Identificacao {
  const abster = (motivo: string, alternativas: string[] = [], confianca = 0): Identificacao =>
    ({ cliente_corrigido: 'NAO IDENTIFICADO', confianca: Math.min(confianca, 84), motivo, alternativas });

  const alvoNorm = normalizeClientName(nomeReuniao);
  const alvo = tokensDe(nomeReuniao);
  if (!alvo.length) return abster('nome da reunião vazio');

  // 1. Igualzinho (já sem acento/caixa/pontuação).
  const exatos = nomes.filter((n) => normalizeClientName(n) === alvoNorm);
  if (exatos.length === 1) return { cliente_corrigido: exatos[0], confianca: 100, motivo: 'nome idêntico ao cadastro', alternativas: [] };
  if (exatos.length > 1) return abster('dois clientes cadastrados com o mesmo nome', exatos.slice(0, 3));

  // 2. Mesmas palavras em outra ordem ("Presidente Prudente Sorrifácil").
  const reordenados = nomes.filter((n) => mesmoConjunto(tokensDe(n), alvo));
  if (reordenados.length === 1) return { cliente_corrigido: reordenados[0], confianca: 98, motivo: 'mesmas palavras em outra ordem', alternativas: [] };
  if (reordenados.length > 1) return abster('mais de um cliente com essas palavras', reordenados.slice(0, 3));

  // 3. Título traz o nome do cliente + palavras extras ("Londrina 02
  //    Sorrifácil" ⊃ "Sorrifácil Londrina"). Vence o cliente MAIS específico;
  //    empate na especificidade é ambiguidade.
  const contidos = nomes.filter((n) => contem(alvo, tokensDe(n)));
  if (contidos.length) {
    const max = Math.max(...contidos.map((n) => tokensDe(n).length));
    const melhores = contidos.filter((n) => tokensDe(n).length === max);
    if (melhores.length === 1) return { cliente_corrigido: melhores[0], confianca: 92, motivo: 'nome do cliente contido no título', alternativas: [] };
    return abster('título serve para mais de um cliente', melhores.slice(0, 3));
  }

  // 4. Apelido: o título é um pedaço do nome do cliente ("Istambul" ⊂
  //    "Istambul Gastrobar"). Só vale com candidato ÚNICO — "Sorrifácil"
  //    sozinho casa com dez clientes e tem que ir pra triagem.
  const apelidos = nomes.filter((n) => contem(tokensDe(n), alvo));
  if (apelidos.length === 1) return { cliente_corrigido: apelidos[0], confianca: 90, motivo: 'título é apelido do cliente', alternativas: [] };
  if (apelidos.length > 1) return abster('apelido serve para mais de um cliente', apelidos.slice(0, 3));

  // 5. Nada casou: sugestões por similaridade, só pra ajudar o humano.
  const sugestoes = nomes
    .map((n) => ({ n, score: similarity(alvoNorm, normalizeClientName(n)) }))
    .filter((s) => s.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return abster(
    sugestoes.length ? 'nenhuma regra casou; veja os parecidos' : 'nenhum cliente parecido',
    sugestoes.map((s) => s.n),
    Math.round((sugestoes[0]?.score ?? 0) * 84),
  );
}

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
  /**
   * Resolve tudo (cliente, lista, responsáveis) e devolve o que ACONTECERIA,
   * sem escrever nada no ClickUp. Serve para conferir a configuração sem
   * encher a workspace de tarefa de teste.
   */
  dry_run?: boolean;
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
      dry_run?: true;
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
  // A reunião aconteceu, então o trabalho existe — mas cliente inativo costuma
  // ser cadastro desatualizado, e ninguém descobriria isso sozinho.
  if (match.status && match.status !== 'Ativo') {
    avisos.push(`cliente está marcado como "${match.status}" no reports — confira se voltou a ser ativo`);
  }
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
      // Sem prazo definido na reunião, a tarefa vence HOJE (regra da agência):
      // tarefa sem data some das visões de planejamento do ClickUp.
      due_date: Date.now() + (typeof acao.prazo_dias === 'number' ? acao.prazo_dias : 0) * DIA_MS,
      assignees: responsaveis.map((r) => r.clickup_id),
    };

    if (input.dry_run) {
      tarefas.push({ titulo: payload.name, setor, task_id: '(simulado)', url: '', assignees: responsaveis });
      continue;
    }

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
    ...(input.dry_run ? { dry_run: true as const } : {}),
  };
}
