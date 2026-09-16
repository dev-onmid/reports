import type { makeServerPool } from '@/lib/server-db';
import { computeNextRun } from '@/lib/recorrencia';
import { memoizarSchema } from '@/lib/schema-memo';

type Pool = ReturnType<typeof makeServerPool>;

/**
 * Lembretes da equipe — pedido do Matheus em 16/09/2026: criar de qualquer lugar do
 * sistema, com data e hora, repetição, e um alarme que REALMENTE chama atenção.
 *
 * ⚠️ O lembrete não é uma caixa nova: quando chega a hora ele vira uma linha em
 * `notificacoes`, a mesma caixa que o sino do header já lê. Uma segunda caixa de avisos
 * competindo com a primeira é o caminho mais curto para a equipe ignorar as duas.
 *
 * ⚠️ A recorrência usa `computeNextRun` (o mesmo do agendador da Luna), não uma conta
 * própria — ver src/lib/recorrencia.ts.
 */

export type RecorrenciaLembrete = 'once' | 'daily' | 'weekly' | 'monthly';
export const RECORRENCIAS: RecorrenciaLembrete[] = ['once', 'daily', 'weekly', 'monthly'];

export const ROTULO_RECORRENCIA: Record<RecorrenciaLembrete, string> = {
  once: 'Uma vez',
  daily: 'Todo dia',
  weekly: 'Toda semana',
  monthly: 'Todo mês',
};

export type Lembrete = {
  id: string;
  user_id: string;        // quem RECEBE
  criado_por: string;     // quem criou (pode ser outra pessoa)
  titulo: string;
  descricao: string | null;
  recorrencia: RecorrenciaLembrete;
  run_at: string | null;
  hora: string | null;
  dia_semana: number | null;
  dia_mes: number | null;
  proximo_disparo: string | null;
  ativo: boolean;
  ultimo_disparo: string | null;
};

export const ensureLembretesSchema = memoizarSchema(async (pool: Pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.lembretes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      criado_por TEXT NOT NULL,
      titulo TEXT NOT NULL,
      descricao TEXT,
      recorrencia TEXT NOT NULL DEFAULT 'once',
      run_at TIMESTAMPTZ,
      hora TEXT,
      dia_semana INTEGER,
      dia_mes INTEGER,
      proximo_disparo TIMESTAMPTZ,
      ativo BOOLEAN NOT NULL DEFAULT true,
      ultimo_disparo TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // o cron varre por aqui: só o que está vencido e ativo
  await pool.query(
    `CREATE INDEX IF NOT EXISTS lembretes_disparo_idx ON public.lembretes (proximo_disparo) WHERE ativo`,
  ).catch(() => null);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS lembretes_user_idx ON public.lembretes (user_id, ativo)`,
  ).catch(() => null);
});

/**
 * Valida e normaliza o que veio da tela. Devolve `erro` legível em vez de lançar —
 * a tela mostra a frase direto.
 */
export function normalizarLembrete(bruto: {
  titulo?: unknown; descricao?: unknown; recorrencia?: unknown;
  run_at?: unknown; hora?: unknown; dia_semana?: unknown; dia_mes?: unknown;
}): { ok: true; valor: Omit<Lembrete, 'id' | 'user_id' | 'criado_por' | 'proximo_disparo' | 'ativo' | 'ultimo_disparo'> }
  | { ok: false; erro: string } {
  const titulo = String(bruto.titulo ?? '').trim();
  if (!titulo) return { ok: false, erro: 'Escreva do que é o lembrete.' };
  if (titulo.length > 200) return { ok: false, erro: 'O título passou de 200 caracteres.' };

  const recorrencia = String(bruto.recorrencia ?? 'once') as RecorrenciaLembrete;
  if (!RECORRENCIAS.includes(recorrencia)) return { ok: false, erro: 'Repetição inválida.' };

  const descricao = bruto.descricao == null ? null : String(bruto.descricao).trim().slice(0, 2000) || null;

  if (recorrencia === 'once') {
    const run_at = String(bruto.run_at ?? '').trim();
    // aceita "2026-09-20T14:30" (o que o <input type=datetime-local> manda)
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(run_at)) {
      return { ok: false, erro: 'Escolha a data e a hora.' };
    }
    return { ok: true, valor: { titulo, descricao, recorrencia, run_at, hora: null, dia_semana: null, dia_mes: null } };
  }

  const hora = String(bruto.hora ?? '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(hora)) return { ok: false, erro: 'Escolha a hora.' };

  // ⚠️ dia_mes é limitado a 28 pelo próprio computeNextRun: dia 31 pularia fevereiro
  // inteiro e o lembrete simplesmente não tocaria naquele mês.
  const dia_semana = recorrencia === 'weekly' ? Math.max(0, Math.min(6, Number(bruto.dia_semana ?? 1))) : null;
  const dia_mes = recorrencia === 'monthly' ? Math.max(1, Math.min(28, Number(bruto.dia_mes ?? 1))) : null;
  return { ok: true, valor: { titulo, descricao, recorrencia, run_at: null, hora, dia_semana, dia_mes } };
}

/** Quando este lembrete toca a próxima vez (UTC), ou null se não tocar mais. */
export function proximoDisparo(l: Pick<Lembrete, 'recorrencia' | 'run_at' | 'hora' | 'dia_semana' | 'dia_mes'>, agoraMs = Date.now()): Date | null {
  return computeNextRun(l.recorrencia, {
    run_at: l.run_at, hora: l.hora, dia_semana: l.dia_semana, dia_mes: l.dia_mes,
  }, agoraMs);
}

/**
 * ⚠️ Lembrete de uma vez, cuja hora já passou, NÃO é reagendado — ele se encerra
 * (`ativo = false`) depois de tocar. Sem isso, "me lembra amanhã às 9h" viraria um
 * alarme diário para sempre, e a pessoa aprenderia a ignorar o alarme.
 */
export function proximoDepoisDeDisparar(l: Pick<Lembrete, 'recorrencia' | 'run_at' | 'hora' | 'dia_semana' | 'dia_mes'>, agoraMs = Date.now()): Date | null {
  if (l.recorrencia === 'once') return null;
  return proximoDisparo(l, agoraMs);
}
