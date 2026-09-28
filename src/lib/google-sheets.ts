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
