import { timingSafeEqual } from 'node:crypto';

/**
 * Credencial dos crons/workers (auditoria 2026-10-10).
 *
 * Família de segredos aceita (CRON_SECRET da Vercel era write-only, por isso os
 * workflows usam REPORTS_CRON_SECRET), comparação em tempo constante e FALHA
 * FECHADA: sem nenhum segredo configurado, ninguém passa — duas rotas deixavam
 * passar todo mundo nesse caso.
 */
export function cronAutorizado(req: Request): boolean {
  const validos = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (validos.length === 0) return false;
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let query = '';
  try { query = new URL(req.url).searchParams.get('secret') ?? ''; } catch { query = ''; }
  const igual = (a: string, b: string) => {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  return validos.some(s => (bearer && igual(bearer, s)) || (query && igual(query, s)));
}
