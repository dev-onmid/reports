import { normalizarTelefoneBR } from '@/lib/cardapioweb-recorrencia';

/**
 * Parsers da planilha de importação retroativa do Anota AI.
 *
 * Vivem numa lib e não na rota porque são a parte que MAIS erra em silêncio:
 * data em formato brasileiro, valor com vírgula decimal, status escrito de
 * cinco jeitos diferentes. Aqui dá pra testar cada um; dentro do `route.ts`,
 * que importa banco e sessão, não daria.
 */

export type LinhaImportada = {
  order_id?: string;
  data?: string;
  telefone?: string;
  nome?: string;
  total?: number | string;
  status?: string;
  canal?: string;
  /** "Como nos conheceu" declarado pelo cliente — a origem atribuível. */
  como_conheceu?: string;
};

/** Aceita ISO, dd/mm/aaaa e dd/mm/aaaa hh:mm — formatos comuns de export BR. */
export function parseDataPlanilha(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  if (!s) return null;

  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,]+(\d{2}):(\d{2}))?/);
  if (br) {
    const [, d, m, a, hh = '12', mm = '00'] = br;
    // 12h como padrão quando a planilha não traz hora: joga o pedido no meio do
    // dia em BRT, evitando que ele caia no dia anterior ou seguinte por fuso.
    const iso = `${a}-${m}-${d}T${hh}:${mm}:00.000-03:00`;
    const dt = new Date(iso);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** "R$ 1.234,56" → 1234.56. Export brasileiro usa vírgula decimal. */
export function parseValorBR(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  // Com vírgula E ponto, o ponto é separador de milhar.
  const normalizado = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

/** Cancelado por qualquer grafia comum de export. */
export function statusDaPlanilha(v: unknown): string {
  const s = String(v ?? '').toLowerCase().trim();
  if (/cancel|negad|recusad|rejeit/.test(s)) return 'canceled';
  return 'closed';
}

/**
 * Chave estável do pedido importado.
 *
 * Sem `order_id` na planilha, deriva de telefone + data + valor. Não é
 * infalível, mas é determinística: reimportar o mesmo arquivo não duplica,
 * que é o comportamento que importa aqui.
 */
export function chaveImportacao(l: LinhaImportada, dataIso: string): string {
  const id = String(l.order_id ?? '').trim();
  if (id) return `imp:${id}`;
  const fone = normalizarTelefoneBR(l.telefone) ?? 'sem-fone';
  const valor = parseValorBR(l.total).toFixed(2);
  return `imp:${fone}:${dataIso.slice(0, 16)}:${valor}`;
}


// ---------------------------------------------------------------- Origem

/**
 * Origens ("como nos conheceu") que ENTRAM no sistema.
 *
 * É uma allowlist: qualquer valor fora daqui — panfleto, indicação, rádio,
 * "já era cliente" — fica de fora dos números. São canais que a agência não
 * opera, e misturá-los infla o resultado da mídia.
 *
 * ⚠️ O pedido continua sendo GRAVADO com a origem original; o corte acontece na
 * leitura. Importar planilha é trabalho manual, e descartar na entrada
 * significaria reimportar tudo caso esta lista mude — além de impedir dizer
 * quanto ficou de fora.
 */
export const ORIGENS_INTEGRAVEIS = [
  'Whatsapp',
  'Chatwoot - Whatsapp',
  'Facebook',
  'Facebook - Whatsapp',
  'Google',
  'Google meu Negócio',
  'Instagram',
  'Instagram - Whatsapp',
  'Site',
] as const;

/**
 * Normaliza para comparação: sem acento, sem caixa, separadores unificados.
 *
 * ⚠️ O range de diacríticos vai ESCAPADO (`̀-ͯ`). Digitá-lo como
 * caractere literal corrompe em copy-paste e encoding — armadilha já registrada
 * no CLAUDE.md a respeito de `normalizeClientName`.
 */
export function normalizarOrigem(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // "Google - Whatsapp", "Google – Whatsapp" e "Google Whatsapp" viram o mesmo.
    .replace(/[\s\-–—_]+/g, ' ')
    .trim();
}

const SET_INTEGRAVEIS = new Set(ORIGENS_INTEGRAVEIS.map(normalizarOrigem));

export function origemIntegravel(v: unknown): boolean {
  const n = normalizarOrigem(v);
  if (!n) return false; // sem origem declarada não é atribuível a canal nenhum
  return SET_INTEGRAVEIS.has(n);
}

// ---------------------------------------------------------------- Duplicados

export type ResultadoDedup<T> = {
  unicas: T[];
  /** Quantas linhas foram descartadas por já existirem no próprio lote. */
  duplicadas: number;
  /** As chaves mais repetidas, para o usuário conferir se o corte faz sentido. */
  exemplos: { chave: string; vezes: number }[];
};

/**
 * Remove duplicatas DENTRO do lote, preservando a primeira ocorrência.
 *
 * Importar vários arquivos de uma vez torna isso obrigatório: exports de meses
 * vizinhos costumam se sobrepor nas bordas, e sem dedupe o mesmo pedido entraria
 * duas vezes — dobrando receita e inventando recorrência para quem comprou uma
 * vez só.
 *
 * A contagem é devolvida de propósito: silenciar o descarte faria o usuário
 * achar que perdeu linhas na importação.
 */
export function dedupLote<T>(linhas: T[], chaveDe: (l: T) => string): ResultadoDedup<T> {
  const vistas = new Map<string, number>();
  const unicas: T[] = [];

  for (const l of linhas) {
    const k = chaveDe(l);
    const n = vistas.get(k) ?? 0;
    vistas.set(k, n + 1);
    if (n === 0) unicas.push(l);
  }

  const exemplos = [...vistas.entries()]
    .filter(([, v]) => v > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([chave, vezes]) => ({ chave, vezes }));

  return { unicas, duplicadas: linhas.length - unicas.length, exemplos };
}
