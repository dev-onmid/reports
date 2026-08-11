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
