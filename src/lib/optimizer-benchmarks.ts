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
