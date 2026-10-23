/**
 * Janela do COMPARATIVO ("vs período anterior") — régua única para os painéis.
 *
 * 1. Se quem chamou escolheu a janela (`compararDe`/`compararAte`), é ela.
 * 2. Senão, a automática (`autoPreviousPeriod`: mês cheio → mês anterior cheio;
 *    senão a mesma duração logo antes)…
 * 3. …cortada nos MESMOS DIAS DECORRIDOS quando o período ainda está em curso.
 *    "Este mês" vai até 31/10, mas em 23/10 só houve 23 dias de venda: comparar
 *    com setembro INTEIRO dava "+7,6%" a uma receita que, no mesmo número de
 *    dias, crescia muito mais (caso PicoLocos, 2026-10-23).
 *
 * Pura. Datas `YYYY-MM-DD` tratadas em UTC só para aritmética de dias.
 */

const DIA = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const valida = (d: string | null | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(ms(d));

export type Janela = { from: string; to: string };

export function janelaComparativo(
  de: string,
  ate: string,
  automatica: Janela,
  hoje: string,
  escolhida?: { de?: string | null; ate?: string | null },
): Janela & { escolhida: boolean; cortada: boolean } {
  if (valida(escolhida?.de) && valida(escolhida?.ate) && escolhida!.de! <= escolhida!.ate!) {
    return { from: escolhida!.de!, to: escolhida!.ate!, escolhida: true, cortada: false };
  }
  if (de <= hoje && hoje < ate) {
    const decorridos = Math.round((ms(hoje) - ms(de)) / DIA);
    const fim = Math.min(ms(automatica.from) + decorridos * DIA, ms(automatica.to));
    return { from: automatica.from, to: iso(fim), escolhida: false, cortada: true };
  }
  return { ...automatica, escolhida: false, cortada: false };
}
