/**
 * Tipografia do dashboard de geração de leads — fonte única de verdade.
 * Cada papel de texto tem exatamente um estilo; cores semânticas (verde/vermelho/
 * âmbar, cores de marca) são aplicadas à parte, por quem usa.
 */
export const T = {
  /** Título de seção da página: "Mídia paga", "Landing page", "Social", "Comercial". */
  secao: 'text-base font-black uppercase tracking-[0.08em] text-[#f4f7f8]',
  /** Título de todo painel/card. */
  cardTitulo: 'text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]',
  /** Linha curta de descrição sob/ao lado do título do card. */
  cardSub: 'text-xs text-[#9aa4aa]',
  /** Rótulo de sub-bloco dentro de um painel ("VISÃO GERAL", "TOP PALAVRAS-CHAVE"). */
  subBloco: 'text-[11px] font-black uppercase tracking-[0.1em] text-[#6cff2f]',
  /** Rótulo de card de KPI. */
  kpiRotulo: 'text-[11px] font-black uppercase tracking-[0.06em] text-[#dce4e8]',
  /** Número principal de todo card de KPI. */
  kpiValor: 'font-heading text-[28px] leading-none whitespace-nowrap text-[#f4f7f8]',
  /** Números secundários dentro de um card grande. */
  kpiValorSec: 'font-heading text-2xl leading-none text-[#f4f7f8]',
  /** Números em faixas compactas e listas. */
  miniValor: 'font-heading text-lg leading-none text-[#f4f7f8]',
  /** Rótulos em faixas compactas. */
  miniRotulo: 'text-[10px] font-black uppercase tracking-[0.06em] text-[#9aa4aa]',
  /** Texto de variação (cor semântica aplicada à parte). */
  delta: 'text-xs font-bold',
  /** O "vs 1–22/ago" ao lado de uma variação. */
  comparacao: 'text-xs font-medium text-[#a7b0b6]',
  /** Legenda sob um número ("Realizado", "Meta do mês"). */
  valorRotulo: 'text-xs font-medium text-[#a7b0b6]',
  /** Linhas auxiliares sob números, notas de rodapé. */
  nota: 'text-[11px] text-[#7c868c]',
  /** Cabeçalho de toda tabela. */
  tabelaCab: 'text-[10px] font-black uppercase tracking-[0.08em] text-[#9aa4aa]',
  /** Células do corpo de tabela (numéricas mantêm tabular-nums). */
  tabelaCel: 'text-xs',
  /** Rótulo de linha em listas de barras/legendas de rosca. */
  listaRotulo: 'text-xs font-semibold text-[#dce4e8]',
  /** Caixa do ícone em cards de KPI (cores ficam por seção). */
  iconeCaixa: 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
  icone: 'h-4 w-4',
} as const
