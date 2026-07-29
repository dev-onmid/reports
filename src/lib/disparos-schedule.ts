/**
 * Schedule checks shared by the disparos engines (worker cron + browser tick).
 *
 * - active_from/active_until are stored as "HH:MM" in UTC (the UI converts
 *   local → UTC on save), so the window check compares against UTC clock time.
 * - active_days is stored as comma-separated weekday numbers 0-6 (0 = domingo)
 *   meaning days in BRT — the day check converts the current instant to
 *   America/Sao_Paulo (fixed UTC-3, no DST) before reading the weekday.
 *   NULL/empty = every day (backward compatible).
 */

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

export function parseActiveDays(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  const days = String(raw)
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  if (days.length === 0 || days.length >= 7) return null;
  return [...new Set(days)].sort((a, b) => a - b);
}

export function serializeActiveDays(days: unknown): string | null {
  if (!Array.isArray(days)) return null;
  const clean = [...new Set(days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  if (clean.length === 0 || clean.length >= 7) return null;
  return clean.join(',');
}

export function isActiveDayNow(raw: string | null | undefined, now: Date = new Date()): boolean {
  const days = parseActiveDays(raw);
  if (!days) return true;
  const brtWeekday = new Date(now.getTime() - BRT_OFFSET_MS).getUTCDay();
  return days.includes(brtWeekday);
}

export function isWithinWindow(activeFrom: string, activeUntil: string, now: Date = new Date()): boolean {
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [fh, fm] = activeFrom.split(':').map(Number);
  const [uh, um] = activeUntil.split(':').map(Number);
  const fromMinutes = fh * 60 + fm;
  const untilMinutes = uh * 60 + um;
  if (fromMinutes <= untilMinutes) return nowMinutes >= fromMinutes && nowMinutes < untilMinutes;
  // overnight window (e.g. 22:00 - 06:00)
  return nowMinutes >= fromMinutes || nowMinutes < untilMinutes;
}
