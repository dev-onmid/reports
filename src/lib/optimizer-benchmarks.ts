import type { Pool } from 'pg';
import type { OptimizerNiche } from '@/lib/optimizer';

// ─── Benchmarks de custo por nicho ──────────────────────────────────────────
// Régua de REFERÊNCIA de mercado (custo-alvo por lead / conversa iniciada, em R$) usada como
// FALLBACK quando o cliente ainda não tem meta cadastrada no planejamento. Quando há meta do
// cliente, ela SEMPRE tem prioridade — o benchmark nunca sobrepõe uma meta real.
//
// ⚠️ Os números abaixo são DEFAULTS SENSATOS pra começar, não verdade absoluta. São o ponto
// que a agência refina com a experiência dela. Mantidos aqui num só lugar de propósito: quando
// virar config editável pela tela (por nicho), esta tabela é a fonte inicial. `cpl_ideal` é o
// custo-alvo bom; `cpl_maximo` é o teto tolerável antes de virar problema.
//
// Valem principalmente pra objetivos de LEAD / CONVERSA (formulário, WhatsApp). Tráfego (CPC) e
// vendas (CPA/ROAS) o cérebro julga de forma relativa; o benchmark de lead é a régua central.

export type NicheBenchmark = { cpl_ideal: number; cpl_maximo: number };

export const NICHE_BENCHMARKS: Record<OptimizerNiche, NicheBenchmark> = {
  odontologia: { cpl_ideal: 25, cpl_maximo: 45 },
  estetica: { cpl_ideal: 20, cpl_maximo: 40 },
  gastronomia: { cpl_ideal: 8, cpl_maximo: 18 },
  advocacia: { cpl_ideal: 40, cpl_maximo: 80 },
  contabilidade: { cpl_ideal: 35, cpl_maximo: 70 },
  ecommerce: { cpl_ideal: 15, cpl_maximo: 35 },
  industria: { cpl_ideal: 50, cpl_maximo: 120 },
  agencia: { cpl_ideal: 40, cpl_maximo: 90 },
  outro: { cpl_ideal: 25, cpl_maximo: 50 },
};

export function benchmarkParaNicho(nicho: OptimizerNiche): NicheBenchmark {
  return NICHE_BENCHMARKS[nicho] ?? NICHE_BENCHMARKS.outro;
}

// ─── Override editável via banco ─────────────────────────────────────────────
// A agência pode afinar os benchmarks pela tela (rota /api/otimizador/benchmarks). Os valores do
// banco sobrescrevem os defaults do arquivo; nicho sem override cai no default. Se a tabela não
// existir ou a query falhar, tudo cai nos defaults — nunca quebra a análise.

export async function ensureNicheBenchmarksTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.optimizer_niche_benchmarks (
      nicho       TEXT PRIMARY KEY,
      cpl_ideal   NUMERIC NOT NULL,
      cpl_maximo  NUMERIC NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by  TEXT
    );
  `).catch(() => {});
}

// Benchmarks efetivos: defaults do arquivo com os overrides do banco por cima.
export async function loadNicheBenchmarks(pool: Pool): Promise<Record<OptimizerNiche, NicheBenchmark>> {
  const merged: Record<OptimizerNiche, NicheBenchmark> = { ...NICHE_BENCHMARKS };
  try {
    await ensureNicheBenchmarksTable(pool);
    const { rows } = await pool.query<{ nicho: string; cpl_ideal: string; cpl_maximo: string }>(
      `SELECT nicho, cpl_ideal, cpl_maximo FROM public.optimizer_niche_benchmarks`,
    );
    for (const r of rows) {
      const ideal = Number(r.cpl_ideal);
      const maximo = Number(r.cpl_maximo);
      if (r.nicho in merged && Number.isFinite(ideal) && Number.isFinite(maximo)) {
        merged[r.nicho as OptimizerNiche] = { cpl_ideal: ideal, cpl_maximo: maximo };
      }
    }
  } catch {
    // fallback silencioso nos defaults
  }
  return merged;
}
