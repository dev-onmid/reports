import type { OptimizerPeriodKey } from '@/lib/optimizer';

export const OPTIMIZER_TIME_ZONE = 'America/Sao_Paulo';

const OPTIMIZER_PERIOD_DAYS: Record<OptimizerPeriodKey, number> = {
  yesterday: 1,
  last_3d: 3,
  last_7d: 7,
  last_21d: 21,
  last_30d: 30,
  last_90d: 90,
};

function ymdFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function todayInOptimizerTimeZone(referenceDate = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: OPTIMIZER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(referenceDate);

  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return ymdFromParts(year, month, day);
}

export function addDaysToIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return ymdFromParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function optimizerDateDaysAgo(daysAgo: number, referenceDate = new Date()): string {
  return addDaysToIsoDate(todayInOptimizerTimeZone(referenceDate), -daysAgo);
}

export function optimizerDateRangeForDays(days: number, referenceDate = new Date()): { dateFrom: string; dateTo: string } {
  const safeDays = Math.max(1, Math.floor(days));
  return {
    dateFrom: optimizerDateDaysAgo(safeDays, referenceDate),
    dateTo: optimizerDateDaysAgo(1, referenceDate),
  };
}

export function optimizerDateRangeForPeriod(period: OptimizerPeriodKey, referenceDate = new Date()): { dateFrom: string; dateTo: string } {
  const days = OPTIMIZER_PERIOD_DAYS[period] ?? 7;
  return optimizerDateRangeForDays(days, referenceDate);
}
