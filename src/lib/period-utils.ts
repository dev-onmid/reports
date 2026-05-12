function validDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function fmt(d: Date): string {
  return d.toISOString().split('T')[0];
}

// Resolves any period to an explicit { since, until } date range.
// Using time_range with explicit dates is more reliable than date_preset
// because the Meta Insights API handles preset names inconsistently across
// account types and API versions.
function resolveMetaDateRange(period: string, dateFrom = '', dateTo = ''): { since: string; until: string } {
  if (period === 'custom' && validDate(dateFrom) && validDate(dateTo)) {
    return { since: dateFrom, until: dateTo };
  }

  const now = new Date();
  const todayStr = fmt(now);

  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return fmt(d);
  };

  switch (period) {
    case 'yesterday':
      return { since: daysAgo(1), until: daysAgo(1) };
    case 'last_7d':
      return { since: daysAgo(7), until: daysAgo(1) };
    case 'last_14d':
      return { since: daysAgo(14), until: daysAgo(1) };
    case 'last_30d':
      return { since: daysAgo(30), until: daysAgo(1) };
    case 'this_month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { since: fmt(from), until: todayStr };
    }
    case 'last_month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { since: fmt(from), until: fmt(to) };
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
