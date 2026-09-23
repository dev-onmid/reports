/**
 * Recorte por REGIÃO na dashboard (pedido do Matheus, 2026-09-23): medir o que
 * a campanha de uma região trouxe × os leads que chegaram daquela região.
 *
 * Dois lados, duas fontes — e é isso que dá a leitura:
 *  - LEAD: região vem do DDD do telefone / cidade do formulário
 *    (crm_leads.regiao_uf / regiao_cidade) — "de onde a pessoa é".
 *  - CAMPANHA: não existe região na campanha; existe a CONVENÇÃO DE NOME que a
 *    agência já usa ([CWB], [JOINVILLE], MARINGÁ, [NACIONAL]). `regiaoDaCampanha`
 *    lê o nome. Campanha sem região no nome NÃO é descartada: vira "sem região"
 *    e a tela a mostra à parte — sumir em silêncio seria pior que o dado torto.
 *
 * Pura e client-safe: a dashboard usa para filtrar campanhas; as rotas usam
 * `filtroRegiaoSql` para o WHERE. Chave de recorte: "uf:PR" | "cidade:Curitiba".
 */

export type Recorte = { tipo: 'uf' | 'cidade'; valor: string };

export const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

/** Sem acento, maiúsculo, espaços colapsados — chave de comparação de nomes. */
export function normalizarNome(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function parseRecorte(s: string | null | undefined): Recorte | null {
  if (!s) return null;
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const tipo = s.slice(0, i);
  const valor = s.slice(i + 1).trim();
  if (!valor) return null;
  if (tipo === 'uf') return UFS.has(valor.toUpperCase()) ? { tipo: 'uf', valor: valor.toUpperCase() } : null;
  if (tipo === 'cidade') return { tipo: 'cidade', valor };
  return null;
}

export function recorteKey(r: Recorte): string {
  return `${r.tipo}:${r.valor}`;
}

/**
 * Fragmento de WHERE + parâmetro para filtrar crm_leads pela região do lead.
 * `idx` é o índice do PRÓXIMO placeholder livre ($n). Sem recorte → vazio.
 * ⚠️ Cidade compara sem acento e sem caixa: "Sao Paulo" (IP) e "São Paulo"
 * (formulário) são a mesma cidade.
 */
export function filtroRegiaoSql(recorte: Recorte | null, idx: number, alias = ''): { sql: string; params: unknown[] } {
  if (!recorte) return { sql: '', params: [] };
  const col = (c: string) => (alias ? `${alias}.${c}` : c);
  if (recorte.tipo === 'uf') return { sql: ` AND UPPER(${col('regiao_uf')}) = $${idx}`, params: [recorte.valor] };
  return {
    sql: ` AND TRANSLATE(UPPER(${col('regiao_cidade')}), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') = $${idx}`,
    params: [normalizarNome(recorte.valor)],
  };
}

// ── Campanha → região pelo nome ───────────────────────────────────────────────

type Cidade = { nome: string; uf: string; aliases?: string[] };

/**
 * Cidades reconhecidas no nome de campanha. Nome completo sempre vale; alias
 * só o que a agência usa de fato (CWB, BC, POA…). Siglas ambíguas ficam de
 * fora de propósito: "RP" pode ser Ribeirão Preto ou "remarketing pago";
 * "SP"/"RJ" como sigla são tratados como UF, não como cidade.
 * Ordem: nomes mais longos primeiro, senão "SAO JOSE" engole "SAO JOSE DOS CAMPOS".
 */
const CIDADES: Cidade[] = [
  { nome: 'São José dos Campos', uf: 'SP', aliases: ['SJC'] },
  { nome: 'São José dos Pinhais', uf: 'PR', aliases: ['SJP'] },
  { nome: 'Balneário Camboriú', uf: 'SC', aliases: ['BC', 'BALNEARIO'] },
  { nome: 'Presidente Prudente', uf: 'SP' },
  { nome: 'Cornélio Procópio', uf: 'PR' },
  { nome: 'Foz do Iguaçu', uf: 'PR', aliases: ['FOZ'] },
  { nome: 'Ribeirão Preto', uf: 'SP', aliases: ['RIBEIRAO'] },
  { nome: 'Belo Horizonte', uf: 'MG', aliases: ['BH'] },
  { nome: 'Rio de Janeiro', uf: 'RJ' },
  { nome: 'Porto Alegre', uf: 'RS', aliases: ['POA'] },
  { nome: 'Caxias do Sul', uf: 'RS' },
  { nome: 'Campo Grande', uf: 'MS' },
  { nome: 'Ponta Grossa', uf: 'PR' },
  { nome: 'Porto Velho', uf: 'RO' },
  { nome: 'João Pessoa', uf: 'PB' },
  { nome: 'Florianópolis', uf: 'SC', aliases: ['FLORIPA', 'FLN'] },
  { nome: 'São Paulo', uf: 'SP' },
  { nome: 'Guarulhos', uf: 'SP' },
  { nome: 'Uberlândia', uf: 'MG' },
  { nome: 'Curitiba', uf: 'PR', aliases: ['CWB', 'CTBA'] },
  { nome: 'Londrina', uf: 'PR' },
  { nome: 'Maringá', uf: 'PR' },
  { nome: 'Cascavel', uf: 'PR' },
  { nome: 'Apucarana', uf: 'PR' },
  { nome: 'Arapongas', uf: 'PR' },
  { nome: 'Cambé', uf: 'PR' },
  { nome: 'Ibiporã', uf: 'PR' },
  { nome: 'Rolândia', uf: 'PR' },
  { nome: 'Joinville', uf: 'SC' },
  { nome: 'Blumenau', uf: 'SC' },
  { nome: 'Itajaí', uf: 'SC' },
  { nome: 'Itapema', uf: 'SC' },
  { nome: 'Ingleses', uf: 'SC' },
  { nome: 'Campinas', uf: 'SP' },
  { nome: 'Sorocaba', uf: 'SP' },
  { nome: 'Santos', uf: 'SP' },
  { nome: 'Taubaté', uf: 'SP' },
  { nome: 'Bauru', uf: 'SP' },
  { nome: 'Botucatu', uf: 'SP' },
  { nome: 'Goiânia', uf: 'GO' },
  { nome: 'Brasília', uf: 'DF', aliases: ['BSB'] },
  { nome: 'Salvador', uf: 'BA' },
  { nome: 'Recife', uf: 'PE' },
  { nome: 'Fortaleza', uf: 'CE' },
  { nome: 'Manaus', uf: 'AM' },
  { nome: 'Belém', uf: 'PA' },
  { nome: 'Cuiabá', uf: 'MT' },
  { nome: 'Vitória', uf: 'ES' },
  { nome: 'Natal', uf: 'RN' },
  { nome: 'Maceió', uf: 'AL' },
  { nome: 'Aracaju', uf: 'SE' },
  { nome: 'Teresina', uf: 'PI' },
  { nome: 'São Luís', uf: 'MA' },
  { nome: 'Lucas do Rio Verde', uf: 'MT' },
  { nome: 'Confresa', uf: 'MT' },
];

const CIDADE_POR_NOME = new Map(CIDADES.map(c => [normalizarNome(c.nome), c]));

/** UF de uma cidade conhecida (para o recorte por UF casar campanha de cidade). */
export function ufDaCidade(cidade: string): string | null {
  return CIDADE_POR_NOME.get(normalizarNome(cidade))?.uf ?? null;
}

export type RegiaoCampanha =
  | { tipo: 'cidade'; cidade: string; uf: string }
  | { tipo: 'uf'; uf: string }
  | { tipo: 'nacional' };

const RE_NACIONAL = /\b(NACIONAL|BRASIL|BR)\b/;

/**
 * Lê a região do NOME da campanha. `null` = nada reconhecível no nome.
 * Só bate em token inteiro (fronteira de palavra), então "BC" não pega
 * "ABCD" e "FOZ" não pega "FOZINHO".
 */
export function regiaoDaCampanha(nome: string): RegiaoCampanha | null {
  const n = normalizarNome(nome);
  if (!n) return null;
  for (const c of CIDADES) {
    const termos = [normalizarNome(c.nome), ...(c.aliases ?? [])];
    for (const t of termos) {
      if (new RegExp(`(^|[^A-Z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`).test(n)) {
        return { tipo: 'cidade', cidade: c.nome, uf: c.uf };
      }
    }
  }
  // UF só quando é um token ISOLADO entre colchetes: "[SP]". Solto no texto
  // duas letras batem em qualquer coisa ("ON", "AR", "RK").
  const uf = n.match(/\[\s*([A-Z]{2})\s*\]/g)?.map(m => m.replace(/[[\]\s]/g, '')).find(u => UFS.has(u));
  if (uf) return { tipo: 'uf', uf };
  if (RE_NACIONAL.test(n)) return { tipo: 'nacional' };
  return null;
}

/** Rótulo curto da região da campanha ("Curitiba/PR", "SP", "Nacional", "Sem região"). */
export function rotuloRegiaoCampanha(r: RegiaoCampanha | null): string {
  if (!r) return 'Sem região';
  if (r.tipo === 'nacional') return 'Nacional';
  if (r.tipo === 'uf') return r.uf;
  return `${r.cidade}/${r.uf}`;
}

/**
 * A campanha pertence ao recorte?
 *  - recorte por CIDADE: só campanha daquela cidade;
 *  - recorte por UF: campanha da UF ou de qualquer cidade dela.
 * Nacional e "sem região" NUNCA casam — são mostradas à parte pela tela.
 */
export function campanhaCasaRecorte(nome: string, recorte: Recorte): boolean {
  const r = regiaoDaCampanha(nome);
  if (!r || r.tipo === 'nacional') return false;
  if (recorte.tipo === 'cidade') return r.tipo === 'cidade' && normalizarNome(r.cidade) === normalizarNome(recorte.valor);
  return r.uf === recorte.valor;
}

// ── Opções de recorte a partir dos leads ─────────────────────────────────────

export type ContagemRegioes = { total: number; uf: Record<string, number>; cidade: Record<string, number> };

export type OpcaoRecorte = { key: string; rotulo: string; leads: number };

/** Cobertura mínima de UF nos leads para a linha de recorte aparecer. */
export const COBERTURA_MINIMA = 0.5;
/** Leads mínimos para uma região virar chip (1 lead não é recorte, é ruído). */
export const LEADS_MINIMOS_OPCAO = 3;

/**
 * Chips que a dashboard oferece: UFs e cidades com volume. Vazio quando o
 * cliente não tem região suficiente (cobertura < 50%) — a linha nem aparece.
 * Soma contagens de vários clientes selecionados.
 */
export function opcoesDeRecorte(contagens: ContagemRegioes[], maxCidades = 8): OpcaoRecorte[] {
  const total = contagens.reduce((s, c) => s + c.total, 0);
  if (total === 0) return [];
  const uf: Record<string, number> = {};
  const cidade: Record<string, number> = {};
  for (const c of contagens) {
    for (const [k, v] of Object.entries(c.uf)) uf[k] = (uf[k] ?? 0) + v;
    for (const [k, v] of Object.entries(c.cidade)) cidade[k] = (cidade[k] ?? 0) + v;
  }
  const comUf = Object.values(uf).reduce((s, v) => s + v, 0);
  if (comUf / total < COBERTURA_MINIMA) return [];
  const ufs = Object.entries(uf).filter(([, n]) => n >= LEADS_MINIMOS_OPCAO).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ key: `uf:${k}`, rotulo: k, leads: n }));
  const cidades = Object.entries(cidade).filter(([, n]) => n >= LEADS_MINIMOS_OPCAO).sort((a, b) => b[1] - a[1]).slice(0, maxCidades)
    .map(([k, n]) => ({ key: `cidade:${k}`, rotulo: k, leads: n }));
  return [...ufs, ...cidades];
}

// ── Tabela "Desempenho por região" ───────────────────────────────────────────

export type CampanhaParaRegiao = { name: string; platform: string; spend: number; leads: number };
export type FunilRegiao = { regiao: string; uf: string | null; leads: number; agendamentos: number; comparecimentos: number; fechamentos: number; receita: number };

export type LinhaTabelaRegiao = {
  key: string;
  rotulo: string;
  tipo: 'cidade' | 'uf' | 'nacional';
  investimento: number;
  campanhas: number;
  /** Leads/conversões reportados pela plataforma para as campanhas da região. */
  leadsPlataforma: number;
  /** Funil do CRM da região (null na linha nacional — não há como atribuir). */
  crm: FunilRegiao | null;
};

/**
 * Uma linha por região: campanhas com a região no NOME + funil do CRM dos
 * leads com DDD/cidade da região. Regras:
 *  - cidade e UF são linhas SEPARADAS (Curitiba e PR podem coexistir se há
 *    campanha dos dois tipos) — a tela avisa que UF contém as cidades;
 *  - região só com leads (sem campanha) entra se tiver ≥ LEADS_MINIMOS_OPCAO —
 *    é demanda que chegou sem mídia regional, informação e não ruído;
 *  - campanha nacional/sem região vira UMA linha no fim, com investimento e
 *    leads da plataforma, sem CRM (não dá para atribuir região) — nunca some.
 * Vazio quando não há região em lugar nenhum (a tabela nem aparece).
 */
export function montarTabelaRegioes(campanhas: CampanhaParaRegiao[], cidades: FunilRegiao[], ufs: FunilRegiao[]): LinhaTabelaRegiao[] {
  const porKey = new Map<string, LinhaTabelaRegiao>();
  const cidadePorNome = new Map(cidades.map(c => [normalizarNome(c.regiao), c]));
  const ufPorSigla = new Map(ufs.map(u => [u.regiao.toUpperCase(), u]));
  let nacional: LinhaTabelaRegiao | null = null;

  for (const c of campanhas) {
    const r = regiaoDaCampanha(c.name);
    if (!r || r.tipo === 'nacional') {
      nacional ??= { key: 'nacional', rotulo: 'Nacional / sem região no nome', tipo: 'nacional', investimento: 0, campanhas: 0, leadsPlataforma: 0, crm: null };
      nacional.investimento += c.spend; nacional.campanhas++; nacional.leadsPlataforma += c.leads;
      continue;
    }
    const key = r.tipo === 'cidade' ? `cidade:${normalizarNome(r.cidade)}` : `uf:${r.uf}`;
    const linha = porKey.get(key) ?? {
      key,
      rotulo: r.tipo === 'cidade' ? `${r.cidade}/${r.uf}` : r.uf,
      tipo: r.tipo,
      investimento: 0, campanhas: 0, leadsPlataforma: 0,
      crm: r.tipo === 'cidade' ? (cidadePorNome.get(normalizarNome(r.cidade)) ?? null) : (ufPorSigla.get(r.uf) ?? null),
    };
    linha.investimento += c.spend; linha.campanhas++; linha.leadsPlataforma += c.leads;
    porKey.set(key, linha);
  }

  // Cidades com leads mas sem campanha regional.
  for (const c of cidades) {
    const key = `cidade:${normalizarNome(c.regiao)}`;
    if (porKey.has(key) || c.leads < LEADS_MINIMOS_OPCAO) continue;
    porKey.set(key, { key, rotulo: c.uf ? `${c.regiao}/${c.uf}` : c.regiao, tipo: 'cidade', investimento: 0, campanhas: 0, leadsPlataforma: 0, crm: c });
  }

  const linhas = [...porKey.values()].sort((a, b) => (b.investimento - a.investimento) || ((b.crm?.leads ?? 0) - (a.crm?.leads ?? 0)));
  if (linhas.length === 0) return [];
  return nacional ? [...linhas, nacional] : linhas;
}
