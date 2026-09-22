/**
 * Régua única de "CPL contra a meta" da Dashboard.
 *
 * ⚠️ Antes cada tabela tinha a sua: Resumo por Canal pintava status por VOLUME
 * absoluto (>100 leads = Excelente), palavras-chave por taxa de conversão
 * (>0 = Bom — uma keyword de CPL R$ 493,90 saía "BOM"). Agora todas comparam o
 * custo do lead com `planning.cplMeta`, com as mesmas faixas.
 *
 * Puro e client-safe.
 */

export type StatusCpl = 'na_meta' | 'atencao' | 'acima' | 'sem_meta' | 'sem_lead' | 'sem_lead_baixo' | 'sem_dado';

/** ≤ meta → na meta; ≤ 1,5× → atenção; > 1,5× → acima. */
export function statusCpl(cpl: number | null | undefined, meta: number | null | undefined): StatusCpl {
  if (!(meta && meta > 0)) return 'sem_meta';
  if (!(cpl && cpl > 0)) return 'sem_dado';
  if (cpl <= meta) return 'na_meta';
  if (cpl <= meta * 1.5) return 'atencao';
  return 'acima';
}

/**
 * Status de uma linha com gasto: sem lead nenhum, o "CPL" é infinito — vira
 * "Sem lead", vermelho se já gastou 2× a meta de CPL (dinheiro queimado),
 * cinza se o gasto ainda é pequeno demais para concluir.
 */
export function statusCplComGasto(
  gasto: number, leads: number, meta: number | null | undefined,
): StatusCpl {
  if (leads > 0) return statusCpl(gasto / leads, meta);
  if (!(gasto > 0)) return 'sem_dado';
  if (meta && meta > 0 && gasto >= meta * 2) return 'sem_lead';
  return 'sem_lead_baixo';
}

export const ROTULO_STATUS_CPL: Record<StatusCpl, string> = {
  na_meta: 'Na meta',
  atencao: 'Atenção',
  acima: 'Acima',
  sem_meta: 'Sem meta',
  sem_lead: 'Sem lead',
  sem_lead_baixo: 'Sem lead',
  sem_dado: '—',
};

/** Classes do selo (borda/fundo/texto). */
export const CLASSE_STATUS_CPL: Record<StatusCpl, string> = {
  na_meta: 'border-[#55f52f]/35 bg-[#55f52f]/14 text-[#8dff6a]',
  atencao: 'border-amber-400/30 bg-amber-400/12 text-amber-300',
  acima: 'border-[#e52020]/40 bg-[#e52020]/14 text-[#ff6b6b]',
  sem_meta: 'border-white/10 bg-white/[0.07] text-[#a7b0b6]',
  sem_lead: 'border-[#e52020]/40 bg-[#e52020]/14 text-[#ff6b6b]',
  sem_lead_baixo: 'border-white/10 bg-white/[0.07] text-[#a7b0b6]',
  sem_dado: 'border-white/10 bg-white/[0.04] text-[#7c868c]',
};

/** Só a cor do texto — para pintar a célula de CPL sem selo. */
export const TEXTO_STATUS_CPL: Record<StatusCpl, string> = {
  na_meta: 'text-[#8dff6a]',
  atencao: 'text-amber-300',
  acima: 'text-[#ff6b6b]',
  sem_meta: '',
  sem_lead: 'text-[#ff6b6b]',
  sem_lead_baixo: '',
  sem_dado: '',
};
