/**
 * Recorrência em horário de Brasília — extraído de `luna-tools.ts` em 16/09/2026, quando
 * os lembretes passaram a precisar da MESMA conta que o agendador da Luna já fazia.
 *
 * ⚠️ Extraído, não copiado: duas implementações de "quando é a próxima vez" divergem na
 * primeira correção, e aí o lembrete tocaria numa hora e a tarefa agendada em outra.
 *
 * ⚠️ Toda hora aqui é lida como BRT e devolvida em UTC. O servidor roda em UTC, e o
 * usuário digita "09:00" pensando em Brasília — misturar os dois é como um lembrete
 * de segunda de manhã acaba tocando domingo à noite.
 */
const BRT_OFFSET_MS = 3 * 3600_000;

function parseHoraBrt(hora: string | null | undefined): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora ?? '').trim());
  if (!m) return { h: 9, m: 0 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

// Próxima execução em UTC a partir da recorrência (horários interpretados em BRT).
export function computeNextRun(
  tipo: string,
  opts: { run_at?: string | null; hora?: string | null; dia_semana?: number | null; dia_mes?: number | null },
  fromMs = Date.now(),
): Date | null {
  if (tipo === 'once') {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(String(opts.run_at ?? '').trim());
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + BRT_OFFSET_MS);
  }
  const { h, m } = parseHoraBrt(opts.hora);
  // "Agora" no relógio de Brasília, tratado como UTC pra fazer conta de calendário.
  const nowBrt = new Date(fromMs - BRT_OFFSET_MS);
  const candidate = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo, d, h, m) + BRT_OFFSET_MS);
  if (tipo === 'daily') {
    let c = candidate(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate());
    if (c.getTime() <= fromMs) c = new Date(c.getTime() + 86400_000);
    return c;
  }
  if (tipo === 'weekly') {
    const target = Math.max(0, Math.min(6, Number(opts.dia_semana ?? 1)));
    const c = candidate(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate());
    let delta = (target - nowBrt.getUTCDay() + 7) % 7;
    if (delta === 0 && c.getTime() <= fromMs) delta = 7;
    return new Date(candidate(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate() + delta).getTime());
  }
  if (tipo === 'monthly') {
    const day = Math.max(1, Math.min(28, Number(opts.dia_mes ?? 1)));
    let c = candidate(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), day);
    if (c.getTime() <= fromMs) c = candidate(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth() + 1, day);
    return c;
  }
  return null;
}
