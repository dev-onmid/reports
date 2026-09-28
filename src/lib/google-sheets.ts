/**
 * Ler uma planilha do Google Sheets como se fosse um arquivo importado.
 *
 * Pedido do Matheus (2026-09-28): "1 vez por dia pegar as infos do Google Sheets
 * como se fosse importar uma planilha", configurável dentro do cliente.
 *
 * ⚠️ SEM OAuth, de propósito. O endpoint de export do Google responde a qualquer
 * um que tenha o link quando a planilha está como "qualquer pessoa com o link
 * pode ver" — que é como as planilhas dos clientes já são compartilhadas hoje.
 * Exigir OAuth obrigaria a reconectar a conta Google com um escopo novo e a
 * planilha a estar na conta certa; o link resolve sem nada disso. Testado contra
 * a planilha real da Odonto First antes de escrever isto.
 *
 * ⚠️ Baixamos XLSX, não CSV. O CSV exige o `gid` da aba — e a planilha do cliente
 * tem UMA ABA POR MÊS (21 delas na Odonto First), com gid novo a cada mês. O
 * XLSX traz a pasta inteira e deixa a escolha da aba para `resolverAbaDoMes`,
 * que acompanha a virada do mês sozinha.
 */

/** ID da planilha a partir da URL que o gestor cola. Null se não for um link de Sheets. */
export function extrairSheetId(url: unknown): string | null {
  const m = String(url ?? '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  return m ? m[1] : null;
}

/** URL de export da pasta inteira em XLSX. */
export function urlExportXlsx(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
}

/** Nome de aba comparável: maiúsculo, sem acento, sem espaço/hífen/underscore. */
export function normalizarNomeAba(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const MESES = [
  'JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
] as const;

export type AbaResolvida = {
  aba: string | null;
  /** Como casou — vai para a tela, para o gestor saber por que aquela aba foi lida. */
  motivo: 'mes_e_ano' | 'mes_e_ano_curto' | 'so_mes' | 'nao_encontrada';
};

/**
 * A aba do mês de referência, entre as que a planilha tem.
 *
 * Os nomes reais da Odonto First: `SETEMBRO 2026`, `AGOSTO 2026`, `JUNHO 26`,
 * `MAI26`, `JAN26`, `OUT`, `SET`… — mês por extenso ou abreviado em 3 letras,
 * com ano de 4, de 2 ou sem ano nenhum.
 *
 * ⚠️ Casa por PREFIXO, nunca por "contém". `contains` faria a aba `PRODUTOS`
 * casar com OUT(ubro) e `FUNIL ATUAL` virar candidata — a rotina importaria uma
 * aba de resumo como se fosse base de leads.
 *
 * ⚠️ Ano diferente NÃO casa: em outubro/2026, a aba `OUT25` fica de fora.
 *
 * ⚠️⚠️ Aba SEM ano só vale quando a planilha inteira não usa ano. Medido na
 * Odonto First: ela tem `SETEMBRO 2026` e também uma `OUT` antiga (207 linhas,
 * de outubro do ano anterior). Sem esta trava, em outubro/2026 a rotina casaria
 * `OUT` e importaria a base do ano passado como se fosse do mês corrente — em
 * silêncio, todo dia. Se a planilha já adota ano em alguma aba de mês, o nome
 * sem ano é de outra época e fica de fora; a rotina devolve `nao_encontrada` e o
 * chamador avisa que a aba do mês ainda não nasceu.
 */
export function resolverAbaDoMes(abas: string[], ref: Date): AbaResolvida {
  const mes = MESES[ref.getMonth()];
  const abrev = mes.slice(0, 3);
  const ano4 = String(ref.getFullYear());
  const ano2 = ano4.slice(2);

  // A planilha adota ano nos nomes de mês? Basta UMA aba de mês com ano.
  const usaAno = abas.some(a => {
    const n = normalizarNomeAba(a);
    for (const m of MESES) {
      const resto = n.startsWith(m) ? n.slice(m.length)
        : n.startsWith(m.slice(0, 3)) ? n.slice(3)
        : null;
      if (resto && /^\d{2}(\d{2})?$/.test(resto)) return true;
    }
    return false;
  });

  let melhor: { aba: string; pontos: number; motivo: AbaResolvida['motivo'] } | null = null;

  for (const aba of abas) {
    const n = normalizarNomeAba(aba);
    const resto = n.startsWith(mes) ? n.slice(mes.length)
      : n.startsWith(abrev) ? n.slice(abrev.length)
      : null;
    if (resto === null) continue;

    let pontos = 0;
    let motivo: AbaResolvida['motivo'] = 'so_mes';
    if (resto === ano4) { pontos = 3; motivo = 'mes_e_ano'; }
    else if (resto === ano2) { pontos = 2; motivo = 'mes_e_ano_curto'; }
    else if (resto === '') {
      if (usaAno) continue; // aba sem ano numa planilha que usa ano é de outra época
      pontos = 1; motivo = 'so_mes';
    }
    else continue; // sobrou texto que não é o ano certo (outro ano, ou outra coisa)

    if (!melhor || pontos > melhor.pontos) melhor = { aba, pontos, motivo };
  }

  return melhor ? { aba: melhor.aba, motivo: melhor.motivo } : { aba: null, motivo: 'nao_encontrada' };
}


/** Teto de abas por rodada — ver `escolherAbas`. */
export const MAX_ABAS_POR_RODADA = 12;

export type EscolhaAbas = {
  /** As abas que vão para a importação, na ordem em que a planilha as lista. */
  abas: string[];
  /** Abas pedidas que não existem mais na planilha (renomeadas/apagadas). */
  sumidas: string[];
  /** Abas cortadas pelo teto. */
  cortadas: string[];
  /** A aba do mês, quando `seguirMes` — separada porque a tela a mostra. */
  abaDoMes: string | null;
  motivoAbaDoMes: AbaResolvida['motivo'];
};

/**
 * Quais abas a rotina importa nesta rodada.
 *
 * Pedido do Matheus (2026-09-28): *"está puxando só o mês atual, quero poder
 * escolher as abas"*. São duas coisas somadas, não uma escolha entre elas:
 *
 * - `seguirMes` (padrão) acompanha a virada do mês sozinho — é o que mantém a
 *   rotina útil sem ninguém mexer nela todo dia 1º.
 * - `fixas` são abas escolhidas à mão, para trazer histórico ou uma aba com nome
 *   fora do padrão de mês.
 *
 * ⚠️ O resultado é a UNIÃO das duas, não uma OU outra. Marcar abas de histórico
 * e perder o mês corrente em silêncio seria o pior desfecho: a tela do cliente
 * pararia no passado e ninguém notaria até o mês seguinte.
 *
 * ⚠️ Aba pedida que não existe mais NÃO é erro: a clínica renomeou ou apagou.
 * Volta em `sumidas` para a tela avisar, e o resto importa.
 *
 * ⚠️ Teto de `MAX_ABAS_POR_RODADA`: a rotina roda dentro do orçamento do cron e
 * cada aba é um arquivo a mais no mesmo POST. Quem marcar as 21 abas de uma
 * planilha inteira leva as primeiras e é avisado do corte, em vez de a rodada
 * estourar o tempo e não importar NADA.
 */
export function escolherAbas(
  todas: string[],
  cfg: { fixas?: string[] | null; seguirMes?: boolean },
  hoje = new Date(),
): EscolhaAbas {
  const { aba: abaDoMes, motivo } = resolverAbaDoMes(todas, hoje);
  const seguirMes = cfg.seguirMes !== false;
  const pedidas = cfg.fixas ?? [];

  // Casa pelo nome normalizado: a clínica muda "SETEMBRO 2026" para
  // "Setembro 2026" e a escolha do gestor não pode se perder por causa disso.
  const porNome = new Map(todas.map(a => [normalizarNomeAba(a), a]));
  const sumidas: string[] = [];
  const escolhidas = new Set<string>();
  if (seguirMes && abaDoMes) escolhidas.add(abaDoMes);
  for (const p of pedidas) {
    const real = porNome.get(normalizarNomeAba(p));
    if (real) escolhidas.add(real);
    else sumidas.push(p);
  }

  // Ordem da planilha, não a da escolha: a importação concatena as linhas, e ler
  // na ordem em que a pasta as apresenta é o que o gestor espera ver.
  const naOrdem = todas.filter(a => escolhidas.has(a));
  return {
    abas: naOrdem.slice(0, MAX_ABAS_POR_RODADA),
    cortadas: naOrdem.slice(MAX_ABAS_POR_RODADA),
    sumidas,
    abaDoMes,
    motivoAbaDoMes: motivo,
  };
}

/**
 * As abas cujo cabeçalho comporta o de-para já salvo.
 *
 * ⚠️ Existe porque a rota de importação RECUSA a planilha inteira (HTTP 400,
 * "Coluna X não encontrada") quando uma coluna mapeada não existe no arquivo.
 * Numa planilha com uma aba por mês, basta um mês antigo com layout diferente —
 * ou uma aba de resumo marcada por engano — para derrubar a rodada inteira e
 * não importar mês nenhum. Aqui a aba incompatível é separada COM o nome das
 * colunas que faltam, e a tela diz qual é o problema.
 */
export function abasCompativeis(
  cabecalhoPorAba: Record<string, string[]>,
  abas: string[],
  mapeamento: Record<string, string | null> | null,
): { ok: string[]; incompativeis: { aba: string; faltam: string[] }[] } {
  const exigidas = Object.entries(mapeamento ?? {})
    .filter(([campo, col]) => col && campo !== 'clinic')
    .map(([, col]) => String(col));
  const ok: string[] = [];
  const incompativeis: { aba: string; faltam: string[] }[] = [];
  for (const aba of abas) {
    const headers = cabecalhoPorAba[aba] ?? [];
    const faltam = exigidas.filter(c => !headers.includes(c));
    if (faltam.length) incompativeis.push({ aba, faltam });
    else ok.push(aba);
  }
  return { ok, incompativeis };
}
