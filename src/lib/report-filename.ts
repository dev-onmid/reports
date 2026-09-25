// Nome do arquivo PDF do relatório: "Relatório _ Cliente _ Período.pdf".
// Puro e client-safe (usado na tela de Relatórios e no servidor pela Luna).

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

type PartesData = { ano: number; mes: number; dia: number };

// ⚠️ NUNCA usar `new Date(iso).getDate()` aqui: a coluna é DATE e chega como
// "2026-07-01T00:00:00.000Z"; no fuso do Brasil isso vira 30/06 e o relatório de
// Julho sairia nomeado como Junho. Lemos os componentes de CALENDÁRIO direto.
function partesData(valor: string | Date | null | undefined): PartesData | null {
  if (!valor) return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return { ano: valor.getUTCFullYear(), mes: valor.getUTCMonth() + 1, dia: valor.getUTCDate() };
  }
  const texto = String(valor).trim();
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const ano = Number(iso[1]), mes = Number(iso[2]), dia = Number(iso[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return { ano, mes, dia };
  }
  // Fallback: texto de Date ("Wed Jul 01 2026 00:00:00 GMT-0300").
  const ms = Date.parse(texto);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

const dd = (n: number) => String(n).padStart(2, '0');

/**
 * Rótulo legível do período para o nome do arquivo.
 * Mês cheio vira "Julho 2026"; o resto descreve o intervalo real.
 * Devolve '' quando as datas não são legíveis (o nome sai sem o período).
 */
export function rotuloPeriodoArquivo(from: string | Date | null | undefined, to: string | Date | null | undefined): string {
  const f = partesData(from);
  const t = partesData(to);
  if (!f || !t) return '';

  const inicioDeMes = f.dia === 1;
  const fimDeMes = t.dia === ultimoDiaDoMes(t.ano, t.mes);
  const mesesCheios = inicioDeMes && fimDeMes;

  // Ano inteiro ("Este ano")
  if (mesesCheios && f.ano === t.ano && f.mes === 1 && t.mes === 12) return `Ano ${f.ano}`;

  if (f.ano === t.ano && f.mes === t.mes) {
    if (mesesCheios) return `${MESES[f.mes - 1]} ${f.ano}`;
    return `${dd(f.dia)} a ${dd(t.dia)} de ${MESES[f.mes - 1]} ${f.ano}`;
  }

  if (f.ano === t.ano) {
    if (mesesCheios) return `${MESES[f.mes - 1]} a ${MESES[t.mes - 1]} ${f.ano}`;
    return `${dd(f.dia)} ${MESES_CURTOS[f.mes - 1]} a ${dd(t.dia)} ${MESES_CURTOS[t.mes - 1]} ${f.ano}`;
  }

  if (mesesCheios) return `${MESES[f.mes - 1]} ${f.ano} a ${MESES[t.mes - 1]} ${t.ano}`;
  return `${dd(f.dia)} ${MESES_CURTOS[f.mes - 1]} ${f.ano} a ${dd(t.dia)} ${MESES_CURTOS[t.mes - 1]} ${t.ano}`;
}

// Tira só o que o sistema de arquivos recusa (/ \ : * ? " < > | e controles).
// Acento e apóstrofo ficam — o nome é pra ser lido, não um slug.
export function limparParaNomeDeArquivo(texto: string, max = 80): string {
  const limpo = texto
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    // Windows recusa nome terminado em ponto ou espaço.
    .replace(/[. ]+$/, '');
  return limpo;
}

/**
 * "Relatório _ Cinfel _ Julho 2026.pdf"
 * Sem período legível, cai em "Relatório _ Cinfel.pdf".
 */
export function nomeArquivoRelatorio(
  clientName: string | null | undefined,
  from?: string | Date | null,
  to?: string | Date | null,
): string {
  const cliente = limparParaNomeDeArquivo(clientName || '') || 'Cliente';
  const periodo = limparParaNomeDeArquivo(rotuloPeriodoArquivo(from, to));
  return periodo ? `Relatório _ ${cliente} _ ${periodo}.pdf` : `Relatório _ ${cliente}.pdf`;
}
