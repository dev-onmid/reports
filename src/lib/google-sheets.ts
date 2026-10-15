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


/**
 * Ano e mês que o nome da aba representa, quando dá para saber.
 *
 * Reusa o mesmo vocabulário de `resolverAbaDoMes` (mês por extenso ou em 3
 * letras, ano de 4, de 2 ou ausente). Null quando o nome não é de mês —
 * "RESUMO", "TIKTOK", "FUNIL ATUAL" e afins.
 */
/**
 * Abreviações que não são prefixo do nome do mês e aparecem em planilha real.
 * ⚠️ Só entra aqui o que foi VISTO numa planilha de cliente — inventar
 * abreviação faz aba de outra coisa virar mês e ser importada como base.
 */
const APELIDOS_MES: Record<string, number> = { AGT: 7, SETEM: 8, OUTUB: 9 };

/**
 * Mês e ano de uma aba pelo nome. `ano: 0` = o nome tem o mês mas não o ano.
 *
 * ⚠️ Casa a parte de LETRAS como prefixo do nome do mês, com no mínimo 3 — é o
 * que faz `AGOS2026` e `SETE 26` serem datadas. A versão anterior exigia
 * exatamente 3 letras ou o nome inteiro, então `AGOS2026`, `AGOS25` e `AGT24`
 * voltavam nulas na planilha da Romanza e eram tratadas como aba sem data.
 */
export function periodoDaAba(nome: string): { ano: number; mes: number } | null {
  const n = normalizarNomeAba(nome);
  const m = n.match(/^([A-Z]+)(\d*)$/);
  if (!m) return null;
  const [, letras, digitos] = m;
  if (letras.length < 3) return null;

  let mes = MESES.findIndex(x => x.startsWith(letras));
  if (mes < 0 && letras in APELIDOS_MES) mes = APELIDOS_MES[letras];
  if (mes < 0) return null;

  if (/^\d{4}$/.test(digitos)) return { ano: Number(digitos), mes };
  if (/^\d{2}$/.test(digitos)) return { ano: 2000 + Number(digitos), mes };
  if (digitos === '') return { ano: 0, mes };  // sem ano: não dá para datar
  return null;  // "JUL242" e afins: número que não é ano
}

/**
 * Assinatura do conteúdo de uma aba, para saber se ela mudou desde a última
 * importação.
 *
 * ⚠️ Hash do CONTEÚDO, não do número de linhas: o gestor corrige um telefone
 * numa linha existente e o total não muda — a aba pareceria idêntica e a
 * correção nunca chegaria ao CRM.
 */
export function assinaturaDaAba(conteudo: string): string {
  // FNV-1a: curto, sem dependência, e aqui só precisa detectar diferença.
  let h = 0x811c9dc5;
  for (let i = 0; i < conteudo.length; i++) {
    h ^= conteudo.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${conteudo.length.toString(36)}-${h.toString(36)}`;
}

/**
 * Teto de abas por rodada — ver `escolherAbas`.
 *
 * ⚠️ 12 era palpite, nunca medido, e cortava histórico que cabia folgado.
 * Cronometrado na Romanza em 07/10/2026: **12 abas e 10.996 linhas em 9,5 s**,
 * ~0,8 s por aba, contra um `maxDuration` de 300 s. 36 abas (três anos de
 * histórico mensal) ficam em ~30 s, ou seja 10% do orçamento. A defesa contra
 * planilha fora da curva não é este número e sim a parada por tempo dentro de
 * `sincronizarSheets` — teto baixo só garantia que o histórico nunca entrasse.
 */
export const MAX_ABAS_POR_RODADA = 36;

export type EscolhaAbas = {
  /** As abas que vão para a importação, na ordem em que a planilha as lista. */
  abas: string[];
  /** Abas pedidas que não existem mais na planilha (renomeadas/apagadas). */
  sumidas: string[];
  /** Abas cortadas pelo teto que AINDA faltam importar (ou mudaram). */
  cortadas: string[];
  /** Cortadas que já estão no banco e não mudaram — não é pendência. */
  jaEstavam: string[];
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
  cfg: {
    fixas?: string[] | null;
    seguirMes?: boolean;
    /** `aba -> assinatura do conteúdo` na última importação bem-sucedida. */
    jaImportadas?: Record<string, string> | null;
    /** Assinatura ATUAL de cada aba, para saber o que mudou. */
    assinaturas?: Record<string, string> | null;
  },
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

  // ⚠️⚠️ ORDEM CRONOLÓGICA CRESCENTE, não a da planilha (que lista o mês mais
  // novo primeiro). A importação concatena as abas num lote só e o upsert casa a
  // MESMA pessoa entre elas — então a última linha a escrever é a que fica.
  // Medido com dado real: importando SETEMBRO e depois AGOSTO, um paciente que
  // fechou em setembro (R$ 19.423,70) aparecia em agosto ainda sem valor, e a
  // linha de agosto ZEROU a receita dele. Da mais antiga para a mais nova, a
  // versão mais recente do lead é a última — que é o que a régua de recência
  // pede em todo o resto do sistema.
  // Aba sem nome de mês ("RESUMO", "TIKTOK") não dá para datar e vai primeiro:
  // se ela for de leads, perde para qualquer mês; normalmente nem passa na
  // checagem de cabeçalho.
  const naOrdem = todas.filter(a => escolhidas.has(a)).sort((x, y) => {
    const px = periodoDaAba(x), py = periodoDaAba(y);
    if (!px && !py) return todas.indexOf(x) - todas.indexOf(y);
    if (!px) return -1;
    if (!py) return 1;
    return px.ano - py.ano || px.mes - py.mes;
  });
  // ⚠️⚠️ O CORTE fica com as MAIS RECENTES — a ordem acima é crescente, então
  // `slice(0, MAX)` levava as mais ANTIGAS e jogava fora justamente o mês
  // corrente. Medido na Romanza (35 abas marcadas): entravam JAN24..JUL24 e
  // "OUT 2026" ficava de fora, ou seja, a rotina importava 2024 todo dia e a
  // tela do cliente parava no passado. A aba do mês é intocável, e aba que não
  // dá para datar só entra se sobrar vaga (ela não é base de mês).
  const posicao = new Map(naOrdem.map((a, i) => [a, i]));
  // Já importada E idêntica: só entra se sobrar vaga depois de todo o resto.
  const inalterada = (a: string): boolean => {
    const antes = cfg.jaImportadas?.[a];
    const agora = cfg.assinaturas?.[a];
    return !!antes && !!agora && antes === agora;
  };
  const recencia = (a: string): number => {
    if (seguirMes && abaDoMes && a === abaDoMes) return Number.MAX_SAFE_INTEGER;
    const p = periodoDaAba(a);
    // Entre abas que não dá para datar, vale a ordem da planilha: a primeira
    // tem o maior ranque, para o corte manter as de cima (o teste do teto com
    // "ABA 0".."ABA N" cobre exatamente isso).
    if (!p || p.ano === 0) return -1_000_000 - (posicao.get(a) ?? 0);
    return p.ano * 12 + p.mes;
  };
  // ⚠️ Aba já importada e idêntica é PULADA, não só despriorizada: reimportar
  // todo dia o mesmo histórico é trabalho à toa — tempo de rodada e escrita no
  // banco para reescrever o que já está lá. A do mês nunca é pulada (ela muda
  // todo dia), e a assinatura carrega o de-para (ver `sheets-sync`), então
  // ajustar as colunas faz tudo voltar a ser importado.
  const pendentes = naOrdem.filter(a => !(inalterada(a) && a !== abaDoMes));
  const mantidas = new Set(
    [...pendentes].sort((x, y) => recencia(y) - recencia(x)).slice(0, MAX_ABAS_POR_RODADA),
  );
  const fora = naOrdem.filter(a => !mantidas.has(a));
  return {
    // Importa na ordem cronológica crescente — ver o bloco acima sobre o upsert.
    abas: naOrdem.filter(a => mantidas.has(a)),
    // Separados porque dizem coisas diferentes ao gestor: uma é pendência, a
    // outra é trabalho concluído. Juntar faz a tela gritar todo dia sobre aba
    // que já está no banco.
    cortadas: fora.filter(a => !inalterada(a)),
    jaEstavam: fora.filter(a => inalterada(a)),
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
/**
 * O nome REAL da coluna no cabeçalho desta aba, dado o nome guardado no de-para.
 * `null` quando ela não existe mesmo.
 *
 * ⚠️⚠️ Casa ignorando CAIXA e ACENTO, mas devolve o nome como está NA ABA — a
 * rota de importação procura a coluna pelo texto exato, então devolver o nome do
 * de-para faria a aba passar na checagem e falhar na importação.
 *
 * Medido na Romanza: o de-para foi feito sobre OUT 2026 (`CANAL`,
 * `DATA DE CONTATO`, `OBSERVAÇÃO`) e os meses anteriores escrevem `Canal`,
 * `Data de Contato`, `Observação`. Só a caixa das letras reprovava 9 das 12 abas
 * escolhidas — quase um ano de histórico que a rotina recusava todo dia.
 */
export function colunaEquivalente(cabecalho: string[], alvo: string): string | null {
  const exata = cabecalho.find(h => h === alvo) ?? cabecalho.find(h => h.trim() === alvo.trim());
  if (exata !== undefined) return exata;
  const chave = normalizarNomeAba(alvo);
  if (!chave) return null;
  // Primeira ocorrência: cabeçalho com "Data" e "DATA" na mesma aba é raro, e
  // escolher a primeira é o mesmo critério que a importação usa ao procurar.
  return cabecalho.find(h => normalizarNomeAba(h) === chave) ?? null;
}

export function abasCompativeis(
  cabecalhoPorAba: Record<string, string[]>,
  abas: string[],
  mapeamento: Record<string, string | string[] | null> | null,
): { ok: string[]; incompativeis: { aba: string; faltam: string[] }[] } {
  // ⚠️ `contact` (a fileira de tentativas) fica FORA da exigência: ela varia de
  // mês para mês na mesma planilha — um mês tem 4 dias de tentativa, outro tem
  // 3 — e exigi-la reprovaria abas boas. A importação já ignora a que faltar.
  const exigidas = Object.entries(mapeamento ?? {})
    .filter(([campo, col]) => col && campo !== 'clinic' && campo !== 'contact')
    .map(([, col]) => String(col));
  const ok: string[] = [];
  const incompativeis: { aba: string; faltam: string[] }[] = [];
  for (const aba of abas) {
    const headers = cabecalhoPorAba[aba] ?? [];
    // A comparação (espaço sobrando, caixa, acento) mora em `colunaEquivalente`.
    const faltam = exigidas.filter(c => colunaEquivalente(headers, c) === null);
    if (faltam.length) incompativeis.push({ aba, faltam });
    else ok.push(aba);
  }
  return { ok, incompativeis };
}
