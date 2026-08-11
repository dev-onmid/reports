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

