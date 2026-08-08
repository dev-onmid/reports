// Sorteador de comentários (Instagram/Facebook) — lógica PURA e client-safe.
// Regras espelham o padrão do mercado (AppSorteos, Comment Picker, Easypromos,
// Sorteio.com): duplicados, nº mínimo de @menções, palavra obrigatória,
// bloqueio de perfis, período, chances extras por comentário, ganhadores +
// suplentes. Sem imports de servidor — a UI e os testes usam direto.
//
// ⚠️ "Seguir o perfil" NÃO é verificável por API (nenhuma ferramenta do mercado
// consegue — a Graph API não expõe a lista de seguidores). A conferência de
// follow é manual, depois do sorteio; a UI avisa isso.

export type RedeSorteio = 'instagram' | 'facebook';

export type ComentarioSorteio = {
  id: string;
  /** @handle no Instagram; nome do perfil no Facebook. */
  username: string;
  /** Id do perfil quando a API fornece (FB from.id) — chave de dedupe preferida. */
  userId?: string;
  texto: string;
  /** ISO — usado no filtro de período. */
  timestamp?: string;
  likeCount?: number;
  isReply?: boolean;
  /** Menções já extraídas pela API (FB message_tags). Quando presente, vence a extração por @ do texto. */
  mencoes?: string[];
};

export type RegrasSorteio = {
  numGanhadores: number;
  numSuplentes: number;
  /** true = 1 chance por perfil (padrão de mercado); false = cada comentário válido é 1 chance. */
  umaChancePorPerfil: boolean;
  /** Teto de chances por perfil quando umaChancePorPerfil=false. null = sem teto. */
  maxChancesPorPerfil: number | null;
  /** 0 = não exige menção. */
  minMencoes: number;
  /** Menções repetidas no mesmo comentário contam 1 vez só. */
  mencoesUnicas: boolean;
  /** Basta conter QUALQUER uma (OR), sem diferenciar caixa/acento. [] = não exige. */
  palavrasObrigatorias: string[];
  /** Perfis excluídos (sem @, caixa-insensitive) — ex.: a própria conta do cliente. */
  bloquearPerfis: string[];
  incluirRespostas: boolean;
  /** Comentários fora de [de, ate] ficam de fora. ISO date/datetime; null = sem corte. */
  de?: string | null;
  ate?: string | null;
};

export const REGRAS_PADRAO: RegrasSorteio = {
  numGanhadores: 1,
  numSuplentes: 2,
  umaChancePorPerfil: true,
  maxChancesPorPerfil: null,
  minMencoes: 0,
  mencoesUnicas: true,
  palavrasObrigatorias: [],
  bloquearPerfis: [],
  incluirRespostas: false,
  de: null,
  ate: null,
};

export type MotivoExclusao =
  | 'resposta'
  | 'fora_do_periodo'
  | 'perfil_bloqueado'
  | 'sem_mencoes'
  | 'sem_palavra'
  | 'duplicado'
  | 'acima_do_teto';

export const MOTIVO_LABEL: Record<MotivoExclusao, string> = {
  resposta: 'Respostas a comentários',
  fora_do_periodo: 'Fora do período',
  perfil_bloqueado: 'Perfis bloqueados',
  sem_mencoes: 'Menções insuficientes',
  sem_palavra: 'Sem a palavra obrigatória',
  duplicado: 'Comentários repetidos do mesmo perfil',
  acima_do_teto: 'Acima do teto de chances',
};

export type Participante = {
  /** Chave de dedupe (userId quando existe, senão username normalizado). */
  chave: string;
  username: string;
  chances: number;
  comentarios: ComentarioSorteio[];
};

export type ResultadoFiltro = {
  participantes: Participante[];
  totalChances: number;
  totalComentarios: number;
  excluidos: Partial<Record<MotivoExclusao, number>>;
};

export type Ganhador = {
  posicao: number;
  username: string;
  chances: number;
  comentario: ComentarioSorteio;
  suplente: boolean;
};

/** NFD sem diacríticos, minúsculas, espaços colapsados. (range escapado — ver lição no CLAUDE.md) */
export function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Username de Instagram: letras/números/ponto/underscore, até 30 chars, não
// termina em ponto. O "@" colado em pontuação ("@amigo!") para no primeiro
// char inválido sozinho.
export function extractMencoes(texto: string): string[] {
  const out: string[] = [];
  const re = /@([a-z0-9._]{1,30})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const handle = m[1].replace(/\.+$/, '');
    if (handle) out.push(handle.toLowerCase());
  }
  return out;
}

function mencoesDoComentario(c: ComentarioSorteio, unicas: boolean): string[] {
  const brutas = c.mencoes && c.mencoes.length > 0
    ? c.mencoes.map((x) => normalizarTexto(x)).filter(Boolean)
    : extractMencoes(c.texto);
  return unicas ? [...new Set(brutas)] : brutas;
}

export function chaveDoPerfil(c: ComentarioSorteio): string {
  return c.userId ? `id:${c.userId}` : `u:${normalizarTexto(c.username)}`;
}

function dentroDoPeriodo(c: ComentarioSorteio, de?: string | null, ate?: string | null): boolean {
  if (!de && !ate) return true;
  if (!c.timestamp) return true; // sem data não dá pra cortar — fica dentro
  const t = Date.parse(c.timestamp);
  if (Number.isNaN(t)) return true;
  if (de) {
    const d = Date.parse(de.length === 10 ? `${de}T00:00:00` : de);
    if (!Number.isNaN(d) && t < d) return false;
  }
  if (ate) {
    const a = Date.parse(ate.length === 10 ? `${ate}T23:59:59` : ate);
    if (!Number.isNaN(a) && t > a) return false;
  }
  return true;
}

export function aplicarRegras(comentarios: ComentarioSorteio[], regras: RegrasSorteio): ResultadoFiltro {
  const excluidos: Partial<Record<MotivoExclusao, number>> = {};
  const conta = (m: MotivoExclusao) => { excluidos[m] = (excluidos[m] ?? 0) + 1; };

  const bloqueados = new Set(
    regras.bloquearPerfis.map((p) => normalizarTexto(p.replace(/^@/, ''))).filter(Boolean),
  );
  const palavras = regras.palavrasObrigatorias.map((p) => normalizarTexto(p)).filter(Boolean);

  const validos: ComentarioSorteio[] = [];
  for (const c of comentarios) {
    if (!regras.incluirRespostas && c.isReply) { conta('resposta'); continue; }
    if (!dentroDoPeriodo(c, regras.de, regras.ate)) { conta('fora_do_periodo'); continue; }
    if (bloqueados.has(normalizarTexto(c.username))) { conta('perfil_bloqueado'); continue; }
    if (palavras.length > 0) {
      const t = normalizarTexto(c.texto);
      if (!palavras.some((p) => t.includes(p))) { conta('sem_palavra'); continue; }
    }
    if (regras.minMencoes > 0) {
      if (mencoesDoComentario(c, regras.mencoesUnicas).length < regras.minMencoes) {
        conta('sem_mencoes'); continue;
      }
    }
    validos.push(c);
  }

  // Agrupa por perfil e resolve duplicados/teto de chances.
  const porPerfil = new Map<string, Participante>();
  for (const c of validos) {
    const chave = chaveDoPerfil(c);
    const p = porPerfil.get(chave);
    if (!p) {
      porPerfil.set(chave, { chave, username: c.username, chances: 1, comentarios: [c] });
      continue;
    }
    p.comentarios.push(c);
    if (regras.umaChancePorPerfil) { conta('duplicado'); continue; }
    if (regras.maxChancesPorPerfil !== null && p.chances >= regras.maxChancesPorPerfil) {
      conta('acima_do_teto'); continue;
    }
    p.chances += 1;
  }

  const participantes = [...porPerfil.values()];
  return {
    participantes,
    totalChances: participantes.reduce((s, p) => s + p.chances, 0),
    totalComentarios: comentarios.length,
    excluidos,
  };
}

/** Aleatório [0,1) — crypto quando disponível (browser/node), senão Math.random. */
export function defaultRng(): number {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  if (g.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    g.crypto.getRandomValues(buf);
    return buf[0] / 2 ** 32;
  }
  return Math.random();
}

// Sorteio ponderado SEM reposição de perfil: cada perfil ganha no máximo uma
// vez (nem ganhador+suplente ao mesmo tempo). O comentário exibido é sorteado
// entre os comentários válidos do perfil.
export function sortear(
  filtro: ResultadoFiltro,
  regras: RegrasSorteio,
  rng: () => number = defaultRng,
): { ganhadores: Ganhador[]; suplentes: Ganhador[] } {
  const pool = filtro.participantes.map((p) => ({ ...p }));
  const pick = (): Participante | null => {
    const total = pool.reduce((s, p) => s + p.chances, 0);
    if (total <= 0 || pool.length === 0) return null;
    let alvo = rng() * total;
    for (let i = 0; i < pool.length; i++) {
      alvo -= pool[i].chances;
      if (alvo < 0) return pool.splice(i, 1)[0];
    }
    return pool.splice(pool.length - 1, 1)[0];
  };

  const monta = (lista: Ganhador[], quantos: number, suplente: boolean) => {
    for (let i = 0; i < quantos; i++) {
      const p = pick();
      if (!p) return;
      const comentario = p.comentarios[Math.floor(rng() * p.comentarios.length)] ?? p.comentarios[0];
      lista.push({ posicao: lista.length + 1, username: p.username, chances: p.chances, comentario, suplente });
    }
  };

  const ganhadores: Ganhador[] = [];
  const suplentes: Ganhador[] = [];
  monta(ganhadores, Math.max(1, regras.numGanhadores), false);
  monta(suplentes, Math.max(0, regras.numSuplentes), true);
  return { ganhadores, suplentes };
}
