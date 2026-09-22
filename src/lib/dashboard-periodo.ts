/**
 * Janelas de data da Dashboard — o ESPELHO client-side de `period-utils.ts`.
 *
 * ⚠️ A tela montava as datas por conta própria e divergia do servidor:
 * "Este mês" ia até o FIM do mês (dias futuros) e "7 dias" terminava HOJE,
 * enquanto o servidor (fuso America/Sao_Paulo) usa dia 1..hoje e últimos N dias
 * terminando ONTEM. O período anterior também era "mesma duração imediatamente
 * antes" até no mês corrente — comparava 22 dias de setembro com o agosto
 * INTEIRO, e todo delta saía enviesado para baixo.
 *
 * Tudo aqui trabalha com strings ISO `YYYY-MM-DD` (sem Date local no meio),
 * então não há deslocamento de fuso. Puro e client-safe.
 */
import { addDaysToIsoDate, todayInOptimizerTimeZone } from '@/lib/optimizer-period-range';

export type PeriodoDashboard =
  | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'last_month' | 'custom';

export type Faixa = { from: string; to: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Hoje no fuso do servidor (America/Sao_Paulo). */
export function hojeSP(ref = new Date()): string {
  return todayInOptimizerTimeZone(ref);
}

function partes(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** Dias do mês da data ISO. */
export function diasNoMes(iso: string): number {
  const { y, m } = partes(iso);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Quantidade de dias da faixa, inclusive nas duas pontas. */
export function diasNaFaixa(f: Faixa): number {
  const a = Date.parse(`${f.from}T00:00:00Z`);
  const b = Date.parse(`${f.to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

function inicioDoMes(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

function fimDoMes(iso: string): string {
  return `${iso.slice(0, 8)}${String(diasNoMes(iso)).padStart(2, '0')}`;
}

/** Faixa do período, com a MESMA semântica de `resolveMetaDateRange` no servidor. */
export function faixaAtual(period: PeriodoDashboard, customFrom?: string, customTo?: string, ref = new Date()): Faixa {
  const hoje = hojeSP(ref);
  const diasAtras = (n: number) => addDaysToIsoDate(hoje, -n);
  switch (period) {
    case 'yesterday': return { from: diasAtras(1), to: diasAtras(1) };
    case 'last_7d': return { from: diasAtras(7), to: diasAtras(1) };
    case 'last_14d': return { from: diasAtras(14), to: diasAtras(1) };
    case 'last_30d': return { from: diasAtras(30), to: diasAtras(1) };
    case 'this_month': return { from: inicioDoMes(hoje), to: hoje };
    case 'last_month': {
      const fimAnterior = addDaysToIsoDate(inicioDoMes(hoje), -1);
      return { from: inicioDoMes(fimAnterior), to: fimAnterior };
    }
    case 'custom': {
      const f = customFrom && ISO.test(customFrom) ? customFrom : hoje;
      const t = customTo && ISO.test(customTo) ? customTo : hoje;
      // Datas invertidas viram um intervalo válido em vez de um período vazio.
      return f <= t ? { from: f, to: t } : { from: t, to: f };
    }
    default: return { from: diasAtras(30), to: diasAtras(1) };
  }
}

/**
 * Período de comparação.
 *  - this_month → mesmo trecho do mês anterior (1..min(dia de hoje, dias do mês anterior));
 *  - last_month → o mês antes dele, inteiro;
 *  - last_Nd / custom / yesterday → mesma duração imediatamente antes do início, sem sobreposição.
 */
export function faixaAnterior(period: PeriodoDashboard, atual: Faixa): Faixa {
  if (period === 'this_month') {
    const fimMesAnterior = addDaysToIsoDate(inicioDoMes(atual.from), -1);
    const dia = Math.min(partes(atual.to).d, diasNoMes(fimMesAnterior));
    return { from: inicioDoMes(fimMesAnterior), to: `${fimMesAnterior.slice(0, 8)}${String(dia).padStart(2, '0')}` };
  }
  if (period === 'last_month') {
    const fim = addDaysToIsoDate(inicioDoMes(atual.from), -1);
    return { from: inicioDoMes(fim), to: fimDoMes(fim) };
  }
  const n = Math.max(1, diasNaFaixa(atual));
  const to = addDaysToIsoDate(atual.from, -1);
  return { from: addDaysToIsoDate(to, -(n - 1)), to };
}

function ddmm(iso: string): string {
  const { m, d } = partes(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** Texto curto do comparativo, ex.: "vs 1–22/ago", "vs julho", "vs 7 dias anteriores". */
export function rotuloComparacao(period: PeriodoDashboard, anterior: Faixa): string {
  const a = partes(anterior.from);
  const b = partes(anterior.to);
  switch (period) {
    case 'this_month':
      return `vs ${a.d}–${b.d}/${MESES[b.m - 1]}`;
    case 'last_month':
      return `vs ${MESES_LONGOS[a.m - 1]}`;
    case 'yesterday':
      return 'vs dia anterior';
    case 'last_7d':
    case 'last_14d':
    case 'last_30d':
      return `vs ${diasNaFaixa(anterior)} dias anteriores`;
    default:
      return `vs ${ddmm(anterior.from)}–${ddmm(anterior.to)}`;
  }
}

/**
 * Fração da meta MENSAL que vale para a janela.
 *  - this_month → pró-rata até hoje (dia de hoje ÷ dias do mês);
 *  - last_month → a meta inteira;
 *  - demais → dias da janela ÷ dias do mês (antes o 7 dias era comparado com o
 *    mês INTEIRO e toda barra saía vermelha).
 */
export function fracaoMetaMensal(period: PeriodoDashboard, faixa: Faixa): number {
  if (period === 'last_month') return 1;
  if (period === 'this_month') return partes(faixa.to).d / diasNoMes(faixa.to);
  return diasNaFaixa(faixa) / diasNoMes(faixa.to);
}

/** Meta parcial do período (arredondada, como a pró-rata antiga). */
export function metaParcialDoPeriodo(metaMensal: number, period: PeriodoDashboard, faixa: Faixa): number {
  if (!(metaMensal > 0)) return 0;
  return Math.round(metaMensal * fracaoMetaMensal(period, faixa));
}

/** Rótulo da meta parcial conforme o período. */
export function rotuloMetaParcial(period: PeriodoDashboard): string {
  if (period === 'this_month') return 'Esperado até hoje';
  if (period === 'last_month') return 'Meta do mês';
  return 'Esperado no período';
}

/** Lista das datas ISO da faixa, em ordem. */
export function datasDaFaixa(f: Faixa): string[] {
  const n = diasNaFaixa(f);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDaysToIsoDate(f.from, i));
  return out;
}

/** Último dia do mês da data ISO. */
export function fimDoMesIso(iso: string): string {
  return fimDoMes(iso);
}
