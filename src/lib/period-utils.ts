import {
  addDaysToIsoDate,
  optimizerDateDaysAgo,
  todayInOptimizerTimeZone,
} from '@/lib/optimizer-period-range';

function validDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

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
  if (period === 'last_3d' || period === 'last_21d' || period === 'last_90d') {
    const { since, until } = resolveMetaDateRange(period);
    return `segments.date BETWEEN '${since}' AND '${until}'`;
  }
  const map: Record<string, string> = {
    yesterday: 'YESTERDAY',
    last_7d: 'LAST_7_DAYS',
    last_14d: 'LAST_14_DAYS',
    last_30d: 'LAST_30_DAYS',
    last_month: 'LAST_MONTH',
    this_month: 'THIS_MONTH',
  };
  return `segments.date DURING ${map[period] ?? 'LAST_30_DAYS'}`;
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
