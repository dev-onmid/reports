/**
 * Régua de origem ("como nos conheceu") e dedupe para importação de planilha.
 *
 * Puro: sem banco, sem fetch. É a parte que decide o que entra no CRM e no
 * Dashboard, então precisa ser testável isoladamente.
 */

/**
 * Origens que ENTRAM no sistema.
 *
 * Allowlist: qualquer valor fora daqui — panfleto, indicação, fachada, rádio,
 * "já era cliente" — não vira lead. São canais que a agência não opera, e
 * misturá-los infla o resultado da mídia.
 *
 * ⚠️ O corte acontece na GRAVAÇÃO, não na leitura. A planilha de CRM escreve em
 * `public.crm_leads`, lida por 54 arquivos e 85 consultas — filtrar em todas
 * seria inviável, e uma esquecida faria o CRM mostrar um total e o Dashboard
 * outro. Inconsistência silenciosa entre telas é pior que o dado não existir.
 * Para recuperar uma linha descartada, reimporta-se a planilha.
 */
export const ORIGENS_INTEGRAVEIS = [
  'Whatsapp',
  'Chatwoot - Whatsapp',
  'Facebook',
  'Facebook - Whatsapp',
  'Google',
  'Google meu Negócio',
  'Instagram',
  'Instagram - Whatsapp',
  'Site',
] as const;

/**
 * Normaliza para comparação: sem acento, sem caixa, separadores unificados.
 *
 * ⚠️ O range de diacríticos vai ESCAPADO (`̀-ͯ`). Digitá-lo como caractere
 * literal corrompe em copy-paste e encoding — armadilha já registrada no
 * CLAUDE.md a respeito de `normalizeClientName`.
 */
export function normalizarOrigem(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // "Google - Whatsapp", "Google – Whatsapp" e "Google Whatsapp" viram o mesmo.
    .replace(/[\s\-–—_/]+/g, ' ')
    .trim();
}

const SET_INTEGRAVEIS = new Set(ORIGENS_INTEGRAVEIS.map(normalizarOrigem));

/**
 * Compara por igualdade EXATA depois de normalizar — nunca por substring.
 * "Site do concorrente" não é "Site"; "Facebook Ads Agência" não é "Facebook".
 * Casar por prefixo deixaria entrar exatamente o que a lista existe pra barrar.
 */
export function origemIntegravel(v: unknown): boolean {
  const n = normalizarOrigem(v);
  if (!n) return false; // sem origem declarada não é atribuível a canal nenhum
  return SET_INTEGRAVEIS.has(n);
}

export type ResumoOrigens = {
  aceitas: number;
  descartadas: number;
  /** As origens descartadas, da mais frequente pra menos. */
  origens: { origem: string; linhas: number }[];
};

/** Conta o que entrou e o que ficou de fora, para o relatório da importação. */
export function resumirOrigens(valores: unknown[]): ResumoOrigens {
  const fora = new Map<string, number>();
  let aceitas = 0;

  for (const v of valores) {
    if (origemIntegravel(v)) { aceitas++; continue; }
    const k = String(v ?? '').trim() || '(sem origem)';
    fora.set(k, (fora.get(k) ?? 0) + 1);
  }

  return {
    aceitas,
    descartadas: valores.length - aceitas,
    origens: [...fora.entries()]
      .map(([origem, linhas]) => ({ origem, linhas }))
      .sort((a, b) => b.linhas - a.linhas),
  };
}

export type ResultadoDedup<T> = {
  unicas: T[];
  duplicadas: number;
  exemplos: { chave: string; vezes: number }[];
};

/**
 * Remove duplicatas dentro do lote, preservando a ÚLTIMA ocorrência.
 *
 * Última, e não primeira: importando vários arquivos de meses diferentes, a
 * mesma linha aparece atualizada no export mais recente. Ficar com a primeira
 * congelaria o negócio no estado antigo — que é justamente o que a coluna
 * "Última atualização" existe pra resolver.
 *
 * A contagem é devolvida de propósito: silenciar o descarte faria o usuário
 * achar que perdeu linhas na importação.
 */
export function dedupLote<T>(linhas: T[], chaveDe: (l: T) => string): ResultadoDedup<T> {
  const porChave = new Map<string, T>();
  const vezes = new Map<string, number>();

  for (const l of linhas) {
    const k = chaveDe(l);
    porChave.set(k, l); // sobrescreve: fica a última
    vezes.set(k, (vezes.get(k) ?? 0) + 1);
  }

  const exemplos = [...vezes.entries()]
    .filter(([, v]) => v > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([chave, v]) => ({ chave, vezes: v }));

  return { unicas: [...porChave.values()], duplicadas: linhas.length - porChave.size, exemplos };
}

// ---------------------------------------------------------------- Identidade

/**
 * IDs "de mentira" que exports de CRM usam para dizer "ainda não tem".
 *
 * ⚠️ Numa planilha real de clínica, `NUMERO ORCAMENTO` vinha `-` em 1.556 de
 * 1.853 linhas. Tratá-lo como identificador fundiria 1.556 leads distintos num
 * só — perda silenciosa e irreversível. Qualquer coluna de ID precisa passar
 * por aqui antes de virar chave.
 */
const ID_PLACEHOLDER = new Set(['', '-', '--', '0', 'n/a', 'na', 'null', 'nulo', 'sem', 'sem numero', 'sem número']);

export function idExterno(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s || ID_PLACEHOLDER.has(s.toLowerCase())) return null;
  return s;
}

/** Só dígitos, sem DDI 55, para casar telefone entre planilha e CRM. */
export function chaveTelefone(v: unknown): string | null {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d.length >= 10 ? d : null;
}

/**
 * Campos que a PLANILHA manda — o que muda ao longo da vida do lead.
 *
 * O resto (nome, telefone, canal, campanha, criativo, origem) é identidade e
 * atribuição: pertence a quem viu o lead CHEGAR, não a quem exportou depois.
 * Um lead que entrou pelo WhatsApp com `ctwa_clid` sabe de qual anúncio veio;
 * a planilha do CRM da clínica não sabe, e sobrescrever com o "canal" dela
 * apagaria a única informação que liga a venda ao criativo.
 */
export const CAMPOS_DE_STATUS = [
  'status', 'status_raw', 'status_category', 'stage', 'fechou',
  'revenue', 'valor_rs', 'orcamento', 'pagamento',
  'data_agendada', 'updated_at_external', 'observacao',
] as const;

// ---------------------------------------------------------------- Etapas

/**
 * Traduz o status da planilha para os SINAIS que o funil já lê.
 *
 * O `getStage` de /api/crm/summary usa uma lista fixa de palavras
 * ('Agendado', 'Em Atendimento'…) mais dois booleanos (`compareceu`, `fechou`).
 * A clínica escreve outro vocabulário — "Avaliação Agendada", "Avaliação
 * Realizada" — e por isso Agendamentos e Comparecimentos apareciam ZERADOS no
 * funil mesmo com o CRM mostrando tudo certo.
 *
 * A tradução acontece AQUI, na importação, e não no `getStage`: aquela lista é
 * compartilhada por todos os clientes do CRM, e ampliá-la para caber esta
 * clínica mudaria o funil de todo mundo. Aqui o efeito fica contido na planilha.
 *
 * ⚠️ Só preenche os booleanos. O TEXTO do status continua o da planilha — é o
 * que o CRM exibe, e o usuário confirmou que ali está correto.
 */
export type SinaisDeEtapa = {
  /** Chegou a comparecer na avaliação. */
  compareceu: boolean;
  /** Virou venda. */
  fechou: boolean;
  /** Chegou a ter avaliação marcada — inclusive quem depois faltou. */
  agendou: boolean;
};

/**
 * Dedupe por TELEFONE dentro do lote de importação.
 *
 * ⚠️ A produção tem uma unique (client_id, numero) criada FORA do repo
 * (`crm_leads_client_numero_unique` — vista em erro real de 2026-08-11): o
 * mesmo lead aparecendo em dois exports importados juntos virava dois INSERTs
 * do mesmo número e derrubava o lote inteiro.
 *
 * Fica a linha MAIS AVANÇADA no funil (fechou > compareceu > agendou — a
 * régua do "só avança"); empate → a última do lote. Booleans e valor se
 * ACUMULAM entre as duplicatas: nenhuma linha pode fazer o lead regredir.
 * Linha sem telefone deduplicável fica de fora do dedupe (numero NULL não
 * conflita no banco).
 */
export function dedupPorTelefone<T extends {
  phone: string | null; closed: boolean; revenue: number;
  compareceu?: boolean; agendou?: boolean;
}>(rows: T[]): T[] {
  const posto = (r: T) => (r.closed ? 3 : r.compareceu ? 2 : r.agendou ? 1 : 0);
  const porChave = new Map<string, T>();
  const semChave: T[] = [];
  for (const r of rows) {
    const k = chaveTelefone(r.phone) ?? (r.phone?.trim() || null);
    if (!k) { semChave.push(r); continue; }
    const ant = porChave.get(k);
    if (!ant) { porChave.set(k, r); continue; }
    const vence = posto(r) >= posto(ant) ? r : ant;
    const perde = vence === r ? ant : r;
    porChave.set(k, {
      ...vence,
      compareceu: (vence.compareceu ?? false) || (perde.compareceu ?? false),
      agendou: (vence.agendou ?? false) || (perde.agendou ?? false),
      closed: vence.closed || perde.closed,
      revenue: vence.revenue || perde.revenue,
    });
  }
  return [...porChave.values(), ...semChave];
}

/**
 * Coluna de "fechou?" da planilha do cliente → booleano.
 *
 * Pedido do Matheus (2026-09-28), olhando o CRM em planilha da Odonto First:
 * *"existem planilhas em que o lead tem uma certa qualificação de venda, então
 * tem que contar com isso"*. Lá a venda mora em três colunas — `Orçam.` (o que
 * foi proposto), `Fechou?` (✅/❌) e `Valor R$` (o que virou faturamento).
 *
 * ⚠️ Antes disso, a importação deduzia o fechamento de `revenue > 0`. Na planilha
 * medida isso acerta por coincidência (9 fechadas, 9 com valor, nenhuma sem), mas
 * quebra no primeiro ✅ lançado antes do valor — a venda existiria na planilha do
 * cliente e não na dashboard.
 *
 * ⚠️ Vazio devolve `null`, não `false`: "a coluna não diz nada" é diferente de
 * "não fechou", e quem chama precisa poder cair no sinal seguinte (status,
 * receita) em vez de ter um `false` apagando o que já se sabia.
 */
export function parseFechou(v: unknown): boolean | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  // Emoji primeiro: é o vocabulário real dessas planilhas (✅/❌), e o ❌ tem de
  // ser lido ANTES de qualquer heurística de texto — ele é um "não" explícito.
  if (/[✅✔☑🟢]/u.test(s)) return true;
  if (/[❌✖✗🔴]/u.test(s)) return false;
  const t = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/^(sim|s|yes|y|true|1|x|fechou|fechado|ganho|vendido)$/.test(t)) return true;
  if (/^(nao|n|no|false|0|-|perdido|perdeu)$/.test(t)) return false;
  return null;
}

/**
 * A coluna serve mesmo como "sim/não"?
 *
 * ⚠️ Existe para impedir um estrago grande e silencioso: se o de-para apontar a
 * coluna de fechamento para uma coluna de VALOR ("R$ FECHADO" é o nome real na
 * planilha da Sorrifácil), `parseFechou` não reconhece "R$ 1.200,00" e devolve
 * null — e como a coluna declarada manda, TODA venda viraria "não fechou". O
 * faturamento da dashboard iria a zero sem nenhum erro aparecer.
 *
 * A régua é a própria amostra: pelo menos metade das células preenchidas tem de
 * ser vocabulário de sim/não (✅/❌/Sim/Não/x). Coluna vazia não reprova — não
 * há o que julgar, e recusá-la impediria de marcar a coluna certa numa planilha
 * que ainda não foi preenchida.
 */
export function colunaEhBooleana(valores: unknown[]): boolean {
  const preenchidos = valores.filter(v => String(v ?? '').trim() !== '');
  if (preenchidos.length === 0) return true;
  const reconhecidos = preenchidos.filter(v => parseFechou(v) !== null).length;
  return reconhecidos / preenchidos.length >= 0.5;
}

/**
 * Decide se a linha da planilha representa uma venda FECHADA.
 *
 * ⚠️⚠️ A coluna de fechamento ("Fechou?", "Ganhou?") é a AUTORIDADE quando
 * existe — acima do tipo de planilha e acima de qualquer sinal derivado. Ela é
 * a qualificação de venda que o próprio cliente mantém à mão, e célula em
 * branco ali É a resposta "não fechou": medido na Odonto First (setembro/2026),
 * 117 de 140 linhas em branco, todas em "Desqualificado"/"Em Atendimento"/"Sem
 * Interesse", contra 11 ✅. Deduzir fechamento por status ou por existir valor
 * numa planilha que DECLARA o fechamento seria contradizer o cliente — foi
 * assim que 104 leads da Odonto First entraram todos como fechados.
 *
 * Sem a coluna nada muda: o ledger de Vendas fecha toda linha (cada linha É uma
 * venda concluída) e a planilha de Leads segue nos sinais de sempre.
 */
export function decidirFechou(o: {
  /** Valor CRU da célula de fechamento. Só é lido quando `temColuna`. */
  celula?: unknown;
  /** A coluna de fechamento foi mapeada nesta importação? */
  temColuna: boolean;
  tipo: 'lead' | 'venda' | 'hibrido';
  /** `sinaisDoStatus(...).fechou` — o status já diz que fechou. */
  sinaisFechou: boolean;
  /** Existe coluna de status mapeada? Sem ela, o valor vira o sinal. */
  temStatus: boolean;
  /** `isWonStatus(status)` da coluna de status. */
  statusGanho: boolean;
  /** Valor BRUTO da linha (antes de o tipo Leads zerar a receita). */
  revenueBruto: number;
}): boolean {
  if (o.temColuna) return parseFechou(o.celula) ?? false;
  if (o.tipo === 'venda') return true;
  return o.sinaisFechou || (o.temStatus ? o.statusGanho : o.revenueBruto > 0);
}

/**
 * Numera as repetições de uma mesma chave, na ORDEM do arquivo.
 *
 * Existe para o ledger de faturamento, onde duas linhas podem ser idênticas em
 * tudo que a chave sintética enxerga (mesmo paciente, mesma data, mesmo valor,
 * mesmo tratamento) e ainda assim serem lançamentos DIFERENTES — entrada e
 * parcela do mesmo orçamento. Caso real: Sorrifácil ingleses, 19/08/2026,
 * R$ 3.114,50 lançados duas vezes (uma como entrada, outra a prazo).
 *
 * A primeira ocorrência recebe 0, e quem usa a numeração mantém a chave
 * histórica nesse caso — mudar a chave de todas as linhas faria a próxima
 * importação inserir o ledger inteiro de novo.
 */
export function indexarOcorrencias<T>(linhas: T[], chaveDe: (l: T) => string): { linha: T; ocorrencia: number }[] {
  const vistas = new Map<string, number>();
  return linhas.map(linha => {
    const k = chaveDe(linha);
    const ocorrencia = vistas.get(k) ?? 0;
    vistas.set(k, ocorrencia + 1);
    return { linha, ocorrencia };
  });
}

export function sinaisDoStatus(status: unknown): SinaisDeEtapa {
  const s = normalizarOrigem(status); // reaproveita: sem acento, sem caixa

  // "Efetivada" é a venda concluída; "Realizada" é só o comparecimento.
  const fechou = /efetivad|fechad|vendid|comprou|contratad|paciente/.test(s);
  // Compareceu inclui quem fechou: não dá pra efetivar sem ter comparecido.
  const compareceu = fechou || /realizad|compareceu|atendid[oa] na avaliacao/.test(s);
  // Agendou inclui quem faltou — o agendamento aconteceu, a presença não.
  const agendou = compareceu || /agendad|remarcad|reagendad|com falta|faltou|nao compareceu/.test(s);

  return { compareceu, fechou, agendou };
}

/**
 * Uma data só é aceita se existir de verdade no calendário.
 *
 * ⚠️⚠️ Sem isto, uma ÚNICA célula digitada errada derruba a importação inteira
 * daquela aba. Caso real (Romanza, JUN2026, linha 218): `23/0/2026` virava a
 * string `2026-00-23`, o Postgres respondia *"date/time field value out of
 * range"* e os **1.000 leads do mês** não entravam. Recusar a célula e deixar a
 * linha entrar sem data é muito melhor do que perder o mês.
 */
export function dataValida(ano: number, mes: number, dia: number): boolean {
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2200) return false;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  // Pega 31/02 e afins: o Date "transborda" para março e os componentes mudam.
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

export function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date && Number.isFinite(val.getTime())) return val.toISOString().split('T')[0];
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  }
  const s = String(val).trim();

  // ⚠️⚠️ ISO PRIMEIRO. O padrão dd/mm/aaaa abaixo casa DENTRO de uma data ISO:
  // em "2026-06-23" ele pega "26-06-23" e devolve 26/06/2023 — dia trocado com
  // o ano e três anos de diferença, em silêncio. Enquanto o ISO era testado por
  // último, esse ramo nunca era alcançado.
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/);
  if (iso) {
    const [, y, m, d] = iso;
    if (!dataValida(Number(y), Number(m), Number(d))) return null;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // `(?<!\d)` e `(?!\d)` impedem o mesmo erro ao contrário: casar um pedaço de
  // número maior ("120/06/20261") e inventar uma data que a célula não tem.
  const parts = s.match(/(?<!\d)(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?!\d)/);
  if (parts) {
    const [, d, m, y] = parts;
    const year = y.length === 2 ? `20${y}` : y;
    if (!dataValida(Number(year), Number(m), Number(d))) return null;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}
