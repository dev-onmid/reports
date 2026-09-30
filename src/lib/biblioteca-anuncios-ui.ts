// Biblioteca de Anúncios — tipos e helpers PUROS (client-safe, sem pg).
//
// Compartilhados entre a rota (/api/biblioteca-anuncios), a lib de coleta e o
// componente da galeria. Aqui mora a regra que decide se um criativo cita uma
// cidade diferente da que a campanha mira — o caso real que motivou a tela
// (CondoStore, 30/09/2026: vídeo "Atenção Curitiba" rodando em Joinville).

export type StatusAnuncio = 'ativo' | 'pausado' | 'problema' | 'revisao' | 'arquivado';
export type TipoAnuncio = 'video' | 'imagem' | 'carrossel' | 'outro';
export type NivelAlerta = 'cidade' | 'cidade_fraco';

export type AnuncioRow = {
  client_id: string;
  client_name: string;
  account_id: string;
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversas: number;
  status: StatusAnuncio;
  created_time: string | null;
  preview_url: string | null;
  thumb_url: string | null;
  tipo: TipoAnuncio;
  duracao_seg: number | null;
  titulo: string;
  corpo: string;
  /** Cidades/regiões que a campanha mira (geo do conjunto + nome da campanha/conjunto). */
  cidades_alvo: string[];
  /** Cidades citadas no texto do criativo (legenda, título, nome do anúncio). */
  cidades_citadas: string[];
  alerta: NivelAlerta | null;
};

export type ContaResumo = {
  client_id: string;
  client_name: string;
  account_id: string;
  fetched_at: string | null;
  erro: string | null;
  anuncios: number;
};

export type BibliotecaResposta = {
  ok: boolean;
  days: number;
  anuncios: AnuncioRow[];
  contas: ContaResumo[];
  /** Contas ainda sem coleta nesta rodada — a tela chama de novo até zerar. */
  pendentes: number;
  total_contas: number;
};

// Cidades que aparecem com frequência nas contas da carteira. A lista é o
// PONTO DE PARTIDA: o coletor soma a ela toda cidade que apareça na segmentação
// geográfica da própria conta, então cidade nova entra sozinha.
export const CIDADES_BASE: string[] = [
  'Curitiba', 'São José dos Pinhais', 'Londrina', 'Maringá', 'Cascavel', 'Ponta Grossa',
  'Foz do Iguaçu', 'Cambé', 'Apucarana', 'Arapongas', 'Campo Mourão', 'Umuarama', 'Toledo',
  'Guarapuava', 'Paranaguá', 'Rolândia', 'Ibiporã',
  'Joinville', 'Florianópolis', 'Blumenau', 'Itapema', 'Balneário Camboriú', 'São José',
  'Palhoça', 'Chapecó', 'Criciúma', 'Itajaí', 'Brusque', 'Biguaçu',
  'Porto Alegre', 'Caxias do Sul', 'Canoas', 'Novo Hamburgo', 'São Leopoldo', 'Gramado', 'Canela',
  'Pelotas', 'Santa Maria',
  'São Paulo', 'Campinas', 'Ribeirão Preto', 'Bauru', 'Sorocaba', 'São José do Rio Preto',
  'Taubaté', 'Santo André', 'Guarulhos', 'Atibaia', 'Botucatu', 'Presidente Prudente', 'Marília',
  'Piracicaba', 'Jundiaí', 'São Bernardo do Campo', 'Osasco', 'Santos',
  'Rio de Janeiro', 'Niterói', 'Belo Horizonte', 'Uberlândia', 'Goiânia', 'Brasília',
  'Campo Grande', 'Cuiabá', 'Lucas do Rio Verde', 'Confresa', 'Salvador', 'Recife', 'Fortaleza',
  'Manaus', 'Belém', 'Porto Velho', 'Vitória',
];

// Cidades cujo nome também é palavra comum. No TEXTO LIVRE do anúncio não
// contam como cidade ("vitória de Mauro Ribeiro" não é Vitória/ES, "canela" é
// tempero, "bauru" é sanduíche) — medido em produção: era o único falso
// positivo forte da carteira. Como ALVO continuam valendo, porque o alvo vem
// da segmentação geográfica (nome vindo da Meta) ou do nome da campanha.
export const CIDADES_AMBIGUAS: ReadonlySet<string> = new Set([
  'vitoria', 'santos', 'belem', 'salvador', 'canela', 'gramado', 'toledo', 'cascavel',
  'marilia', 'canoas', 'bauru', 'campo grande', 'santa maria', 'santo andre', 'sao jose',
  'palmas', 'natal', 'boa vista', 'americana', 'sorocaba',
]);

export function normalizarTexto(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Corta texto por CARACTERE (code point), nunca por unidade UTF-16: legenda
 * de anúncio é cheia de emoji, e `slice` no meio de um emoji deixa um surrogate
 * órfão que o Postgres recusa em JSON ("Unicode low surrogate must follow a
 * high surrogate"). Também remove surrogates órfãos que já vieram assim.
 */
export function cortarTexto(s: string, max: number): string {
  const limpo = (s ?? '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  const chars = Array.from(limpo);
  return chars.length > max ? chars.slice(0, max).join('') : limpo;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cidades do catálogo citadas no texto. Casa por palavra inteira, sem acento e
 * sem caixa, e resolve o nome MAIS LONGO primeiro: "São José do Rio Preto" no
 * texto não pode virar também "São José". Nomes com menos de 4 letras ficam
 * fora (falso positivo garantido). `textoLivre`: é legenda/título de anúncio,
 * então nomes ambíguos (CIDADES_AMBIGUAS) não contam. `ignorar`: trechos
 * apagados antes da busca — o NOME DO CLIENTE, porque marca com nome de cidade
 * ("Atibaia Imóveis", que fica em Apucarana) não é o anúncio citando a cidade.
 */
export function cidadesCitadas(
  texto: string,
  catalogo: readonly string[] = CIDADES_BASE,
  opts: { textoLivre?: boolean; ignorar?: readonly string[] } = {},
): string[] {
  let t = ' ' + normalizarTexto(texto).replace(/\s+/g, ' ') + ' ';
  for (const frase of opts.ignorar ?? []) {
    const n = normalizarTexto(frase).replace(/\s+/g, ' ').trim();
    if (n.length >= 4) t = t.split(n).join(' ');
  }
  const ordenado = [...new Set(catalogo.filter(c => c && c.trim().length >= 4))]
    .filter(c => !opts.textoLivre || !CIDADES_AMBIGUAS.has(normalizarTexto(c).replace(/\s+/g, ' ')))
    .sort((a, b) => b.length - a.length);
  const achadas: string[] = [];
  for (const cidade of ordenado) {
    const n = normalizarTexto(cidade).replace(/\s+/g, ' ');
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(n)}(?=$|[^a-z0-9])`, 'g');
    if (re.test(t)) {
      achadas.push(cidade);
      t = t.replace(re, '$1 ');
    }
  }
  return achadas;
}

/**
 * Decide o alerta de um anúncio:
 * - 'cidade': a campanha mira cidades definidas e o criativo cita OUTRA — é o
 *   vídeo de Curitiba rodando em Joinville.
 * - 'cidade_fraco': a campanha não mira cidade nenhuma (nacional/estado) e o
 *   criativo cita uma cidade específica. Pode ser de propósito; vale conferir.
 * Região/estado no alvo (ex.: "Paraná") não conta como cidade definida.
 * `alvoIndefinido`: o conjunto mira um pin de raio cuja cidade a Meta não
 * devolveu — sem saber o alvo, não há o que comparar e o alerta fica mudo.
 */
export function alertaDeCidade(
  cidadesAlvo: readonly string[],
  cidadesCitadasNoCriativo: readonly string[],
  catalogo: readonly string[] = CIDADES_BASE,
  opts: { alvoIndefinido?: boolean } = {},
): NivelAlerta | null {
  if (cidadesCitadasNoCriativo.length === 0) return null;
  const catalogoNorm = new Set(catalogo.map(normalizarTexto));
  const alvoCidades = cidadesAlvo.map(normalizarTexto).filter(c => catalogoNorm.has(c));
  const foraDoAlvo = cidadesCitadasNoCriativo.map(normalizarTexto).filter(c => !alvoCidades.includes(c));
  if (foraDoAlvo.length === 0) return null;
  if (alvoCidades.length > 0) return 'cidade';
  return opts.alvoIndefinido ? null : 'cidade_fraco';
}

export function statusDaMeta(effective: string | null | undefined): StatusAnuncio {
  const s = (effective ?? '').toUpperCase();
  if (s === 'ACTIVE') return 'ativo';
  if (s === 'PENDING_REVIEW' || s === 'IN_PROCESS') return 'revisao';
  if (s === 'DISAPPROVED' || s === 'WITH_ISSUES') return 'problema';
  if (s === 'ARCHIVED' || s === 'DELETED') return 'arquivado';
  return 'pausado';
}

export const ROTULO_STATUS: Record<StatusAnuncio, string> = {
  ativo: 'Ativo',
  pausado: 'Pausado',
  problema: 'Com problema',
  revisao: 'Em revisão',
  arquivado: 'Arquivado',
};

export const ROTULO_TIPO: Record<TipoAnuncio, string> = {
  video: 'Vídeo',
  imagem: 'Imagem',
  carrossel: 'Carrossel',
  outro: 'Outro',
};

export function fmtBRL(v: number): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtDataBR(iso: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export type OrdemBiblioteca = 'gasto' | 'leads' | 'recentes';

export type FiltrosBiblioteca = {
  busca: string;
  clientId: string;
  cidade: string;
  status: StatusAnuncio | '';
  tipo: TipoAnuncio | '';
  soAlerta: boolean;
  ordem: OrdemBiblioteca;
};

export function filtrarEOrdenar(rows: readonly AnuncioRow[], f: FiltrosBiblioteca): AnuncioRow[] {
  const q = normalizarTexto(f.busca.trim());
  const cid = normalizarTexto(f.cidade);
  const out = rows.filter(r => {
    if (f.clientId && r.client_id !== f.clientId) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.tipo && r.tipo !== f.tipo) return false;
    if (f.soAlerta && !r.alerta) return false;
    if (cid && !r.cidades_alvo.some(c => normalizarTexto(c) === cid)) return false;
    if (q) {
      const alvo = normalizarTexto([r.ad_name, r.campaign_name, r.adset_name, r.client_name, ...r.cidades_alvo, ...r.cidades_citadas].join(' '));
      if (!alvo.includes(q)) return false;
    }
    return true;
  });
  out.sort((a, b) => {
    if (f.ordem === 'leads') return (b.leads - a.leads) || (b.spend - a.spend);
    if (f.ordem === 'recentes') return (b.created_time ?? '').localeCompare(a.created_time ?? '') || (b.spend - a.spend);
    return (b.spend - a.spend) || (b.leads - a.leads);
  });
  return out;
}

export function resumoBiblioteca(rows: readonly AnuncioRow[]) {
  let gasto = 0, leads = 0, videos = 0, imagens = 0, alertas = 0;
  for (const r of rows) {
    gasto += r.spend; leads += r.leads;
    if (r.tipo === 'video') videos++; else imagens++;
    if (r.alerta === 'cidade') alertas++;
  }
  return { anuncios: rows.length, gasto, leads, videos, imagens, alertas };
}
