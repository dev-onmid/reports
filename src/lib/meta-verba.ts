// Verba por dia de campanha/conjunto da Meta, para a coluna "Verba/dia".
//
// A Meta tem dois tipos de orçamento, e a tela tratava os dois como diário:
//  • daily_budget — o diário de verdade.
//  • lifetime_budget — o TOTAL até a data de término (caso PicoLocos, out/2026:
//    "R$ 4.695,97/dia" era o orçamento vitalício da campanha inteira). O ritmo
//    diário dele é o que sobra ÷ os dias até o fim.
// Valores da Graph API vêm em centavos (string). Pura — testável sem rede.

export type OrcamentoMeta = {
  daily_budget?: string | number | null;
  lifetime_budget?: string | number | null;
  budget_remaining?: string | number | null;
  /** Campanha usa stop_time; conjunto usa end_time. */
  stop_time?: string | null;
  end_time?: string | null;
};

export type VerbaMeta = {
  /** Verba por dia (diária, ou ritmo estimado do orçamento total). */
  porDia?: number;
  /** Orçamento total (vitalício), quando é esse o tipo. */
  total?: number;
  /** Fim do orçamento total (ISO), quando houver. */
  fim?: string;
};

const DIA_MS = 86_400_000;

export function verbaMeta(o: OrcamentoMeta, agora: Date = new Date()): VerbaMeta {
  const diario = Number(o.daily_budget) || 0;
  if (diario > 0) return { porDia: diario / 100 };
  const total = Number(o.lifetime_budget) || 0;
  if (total <= 0) return {};
  const fim = o.stop_time || o.end_time || undefined;
  const restante = o.budget_remaining != null && o.budget_remaining !== '' ? Number(o.budget_remaining) : NaN;
  if (!fim || !Number.isFinite(restante)) return { total: total / 100, fim };
  const faltaMs = new Date(fim).getTime() - agora.getTime();
  // Orçamento já vencido não tem ritmo: só o total (senão "sobra ÷ 1 dia").
  if (!(faltaMs > 0)) return { total: total / 100, fim };
  const dias = Math.max(1, Math.ceil(faltaMs / DIA_MS));
  return { porDia: restante / 100 / dias, total: total / 100, fim };
}

/** Soma a verba dos conjuntos ATIVOS de uma campanha sem orçamento próprio (ABO). */
export function somarVerbas(lista: VerbaMeta[]): VerbaMeta {
  let porDia = 0;
  let total = 0;
  for (const v of lista) {
    porDia += v.porDia ?? 0;
    total += v.total ?? 0;
  }
  return { ...(porDia > 0 ? { porDia } : {}), ...(total > 0 ? { total } : {}) };
}
