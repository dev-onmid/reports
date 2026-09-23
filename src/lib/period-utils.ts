import {
  addDaysToIsoDate,
  optimizerDateDaysAgo,
  todayInOptimizerTimeZone,
} from '@/lib/optimizer-period-range';

function validDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

/** Dia 1 do mês que fica `n` meses ANTES do mês da data ISO (n=0 → o próprio mês). */
export function inicioDoMesMenos(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 - n;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * "Todo período" = janela de 36 meses. ⚠️ Não é "desde sempre" por limite da
 * API da Meta: insights só existem para os últimos 37 meses e uma time_range
 * mais antiga é recusada. 36 meses cobre toda a base de CRM que existe hoje
 * (o sistema começou a receber lead em 2025).
 */
export const MESES_TODO_PERIODO = 36;

// Resolves any period to an explicit { since, until } date range.
// Using time_range with explicit dates is more reliable than date_preset
// because the Meta Insights API handles preset names inconsistently across
// account types and API versions.
function resolveMetaDateRange(period: string, dateFrom = '', dateTo = ''): { since: string; until: string } {
  if (period === 'custom' && validDate(dateFrom) && validDate(dateTo)) {
    return { since: dateFrom, until: dateTo };
  }

  const todayStr = todayInOptimizerTimeZone();
  const daysAgo = (n: number) => optimizerDateDaysAgo(n);

  switch (period) {
    case 'yesterday':
      return { since: daysAgo(1), until: daysAgo(1) };
    case 'last_3d':
      return { since: daysAgo(3), until: daysAgo(1) };
    case 'last_7d':
      return { since: daysAgo(7), until: daysAgo(1) };
    case 'last_14d':
      return { since: daysAgo(14), until: daysAgo(1) };
    case 'last_21d':
      return { since: daysAgo(21), until: daysAgo(1) };
    case 'last_30d':
      return { since: daysAgo(30), until: daysAgo(1) };
    case 'last_90d':
      return { since: daysAgo(90), until: daysAgo(1) };
    case 'this_month': {
      return { since: `${todayStr.slice(0, 8)}01`, until: todayStr };
    }
    case 'last_month': {
      const currentMonthStart = `${todayStr.slice(0, 8)}01`;
      const previousMonthLastDay = addDaysToIsoDate(currentMonthStart, -1);
      const previousMonthStart = `${previousMonthLastDay.slice(0, 8)}01`;
      return { since: previousMonthStart, until: previousMonthLastDay };
    }
    // Janelas por MÊS-CALENDÁRIO terminando hoje (mesma semântica de this_month):
    // "últimos 3 meses" = mês atual + 2 anteriores inteiros, dia 1 → hoje.
    // Pedido do Matheus (2026-09-23): 3 meses, 6 meses, ano e todo período.
    case 'last_3m':
      return { since: inicioDoMesMenos(todayStr, 2), until: todayStr };
    case 'last_6m':
      return { since: inicioDoMesMenos(todayStr, 5), until: todayStr };
    case 'this_year':
      return { since: `${todayStr.slice(0, 4)}-01-01`, until: todayStr };
    case 'all_time':
      return { since: inicioDoMesMenos(todayStr, MESES_TODO_PERIODO - 1), until: todayStr };
    default:
      return { since: daysAgo(30), until: daysAgo(1) };
  }
}

// Returns a string used internally to carry the resolved date range through the stack.
// Format: 'range:YYYY-MM-DD:YYYY-MM-DD'
export function resolveMetaPeriod(period: string, dateFrom = '', dateTo = ''): string {
  const { since, until } = resolveMetaDateRange(period, dateFrom, dateTo);
  return `range:${since}:${until}`;
}

// Returns the full GAQL date filter expression
export function resolveGaqlPeriod(period: string, dateFrom = '', dateTo = ''): string {
  if (period === 'custom' && validDate(dateFrom) && validDate(dateTo)) {
    return `segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`;
  }
  const map: Record<string, string> = {
    yesterday: 'YESTERDAY',
    last_7d: 'LAST_7_DAYS',
    last_14d: 'LAST_14_DAYS',
    last_30d: 'LAST_30_DAYS',
    last_month: 'LAST_MONTH',
    this_month: 'THIS_MONTH',
  };
  if (map[period]) return `segments.date DURING ${map[period]}`;
  // Qualquer outro preset (3d/21d/90d/3m/6m/ano/todo período) vai com datas
  // explícitas, na MESMA janela do Meta e do CRM. ⚠️ Antes só três chaves
  // caíam aqui e o resto virava LAST_30_DAYS em silêncio — um preset novo
  // mostrava 30 dias de Google ao lado de 6 meses de Meta.
  const { since, until } = resolveMetaDateRange(period);
  return `segments.date BETWEEN '${since}' AND '${until}'`;
}

// Sets time_range with explicit dates on the URL — always uses explicit dates
// instead of date_preset to avoid Meta API inconsistencies across account types.
export function applyMetaDateToUrl(url: URL, metaPeriod: string): void {
  // Support both legacy 'custom:from:to' and new 'range:from:to' formats
  if (metaPeriod.startsWith('range:') || metaPeriod.startsWith('custom:')) {
    const [, from, to] = metaPeriod.split(':');
    url.searchParams.set('time_range', JSON.stringify({ since: from, until: to }));
  } else {
    // Fallback: treat as a date_preset for any unexpected value
    url.searchParams.set('date_preset', metaPeriod);
  }
}
