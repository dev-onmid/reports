function validDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

// Returns the Meta API date_preset value, or 'custom:from:to' for custom ranges
export function resolveMetaPeriod(period: string, dateFrom = '', dateTo = ''): string {
  if (period === 'custom' && validDate(dateFrom) && validDate(dateTo)) {
    return `custom:${dateFrom}:${dateTo}`;
  }
  const map: Record<string, string> = {
    yesterday: 'yesterday',
    last_7d: 'last_7_days',
    last_14d: 'last_14_days',
    last_30d: 'last_30_days',
    last_month: 'last_month',
    this_month: 'this_month',
  };
  return map[period] ?? 'last_30_days';
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

// Sets either time_range (custom) or date_preset on a URL object
export function applyMetaDateToUrl(url: URL, metaPeriod: string): void {
  if (metaPeriod.startsWith('custom:')) {
    const [, from, to] = metaPeriod.split(':');
    url.searchParams.set('time_range', JSON.stringify({ since: from, until: to }));
  } else {
    url.searchParams.set('date_preset', metaPeriod);
  }
}
