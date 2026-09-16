import { classificarEtapa, corDaEtapa, type EtapaFunil } from '@/lib/funil-etapas';

/**
 * Leads invisíveis no Kanban — medido em 16/09/2026: **10.148 leads em 10 clientes**
 * tinham `status` sem coluna correspondente, e o board agrupa POR RÓTULO. Na prática o
 * gestor da Sorrifácil ingleses abria o CRM e não via 2.787 leads que estavam no banco.
 *
 * Vem das planilhas das clínicas, cujos status ("Não Contactado", "Avaliação Realizada")
 * nunca existiram como coluna. Continua acontecendo a cada importação.
 *
 * Decisão do Matheus: criar as colunas que faltam, e excluir as que ficarem vazias e
 * parecidas com as novas.
 *
 * ⚠️ Com uma distinção que os números obrigaram a fazer: 553 dos 10.148 NÃO são status
 * novo, são a MESMA coisa escrita diferente — "Sem  Interesse" (dois espaços) quando já
 * existe a coluna "Sem Interesse". Criar coluna para esses fabricaria uma duplicata com
 * o erro de digitação no nome, para logo em seguida ter de apagá-la. Nesses casos o
 * certo é o inverso: corrigir o status do LEAD para o rótulo exato da coluna que existe.
 */

export type ColunaExistente = { id: string; label: string; leads: number };

/**
 * ⚠️⚠️ Status que na verdade é CANAL, não etapa — decisão do Matheus em 16/09/2026:
 * "não é para criar coluna de WhatsApp e Chatwoot; isso vira uma origem adicional".
 *
 * E a medição deu razão a ele de um jeito que nem esperávamos: os 385 leads com esses
 * status JÁ TÊM o canal completo no campo certo — 131 com status "WhatsApp" estão com
 * canal "Facebook - WhatsApp", 54 com status "Chatwoot" têm "Chatwoot - WhatsApp". O
 * status era duplicata da origem, vinda da importação. Não há informação a salvar: o
 * lead só precisa ir para uma etapa de verdade para voltar a aparecer no board.
 *
 * ⚠️ O sistema JÁ é multicanal: o formato "Facebook - WhatsApp" existe em 13.448 leads
 * e significa exatamente "tem os dois". Por isso o canal nunca é SOBRESCRITO aqui —
 * quando falta, o status é ACRESCENTADO ao que já houver, nunca no lugar.
 */
const CANAIS_CONHECIDOS = [
  'whatsapp', 'chatwoot', 'instagram', 'facebook', 'google', 'site', 'landing page',
  'indicacao', 'tv', 'email', 'telefone', 'fachada', 'meta', 'tiktok', 'datalytics',
];

export function ehCanalNaoEtapa(status: string): boolean {
  const k = normalizarRotulo(status);
  return CANAIS_CONHECIDOS.includes(k);
}

/** Acrescenta um canal ao que o lead já tem, no formato "A - B" que o sistema usa. */
export function acrescentarCanal(canalAtual: string | null | undefined, novo: string): string {
  const atual = String(canalAtual ?? '').trim();
  if (!atual) return novo.trim();
  const partes = atual.split(/\s+-\s+/).map(p => p.trim()).filter(Boolean);
  if (partes.some(p => normalizarRotulo(p) === normalizarRotulo(novo))) return atual; // já está lá
  return [...partes, novo.trim()].join(' - ');
}

export type PlanoStatusOrfao = {
  /** Status que é a mesma coisa que uma coluna existente, escrito diferente. */
  corrigirGrafia: { statusAtual: string; paraRotulo: string; leads: number }[];
  /** Status sem coluna nenhuma parecida: vira coluna. */
  criarColunas: { label: string; etapa: EtapaFunil; cor: string; leads: number }[];
  /** ⚠️ Colunas VAZIAS que viraram irmãs de uma nova — o pedido do Matheus. */
  excluirVazias: { id: string; label: string; porCausaDe: string }[];
  /** Status que é canal: o lead vai para a entrada e o canal é preservado/acrescentado. */
  viraEntrada: { statusAtual: string; leads: number }[];
};

/** Acento, caixa e pontuação fora do caminho — "Sem  Interesse" casa com "Sem Interesse". */
export function normalizarRotulo(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function planejarStatusOrfaos(
  statusOrfaos: { status: string; leads: number }[],
  colunas: ColunaExistente[],
): PlanoStatusOrfao {
  const plano: PlanoStatusOrfao = { corrigirGrafia: [], criarColunas: [], excluirVazias: [], viraEntrada: [] };
  const porNorm = new Map(colunas.map(c => [normalizarRotulo(c.label), c]));

  // agrupa os órfãos pelo rótulo normalizado: "Sem  Interesse" e "sem interesse" são um só
  const agrupados = new Map<string, { status: string; leads: number }>();
  for (const o of statusOrfaos) {
    const k = normalizarRotulo(o.status);
    if (!k) continue;
    const atual = agrupados.get(k);
    // mantém a grafia do mais numeroso — é a que o cliente mais usa
    if (!atual || o.leads > atual.leads) agrupados.set(k, { status: o.status, leads: (atual?.leads ?? 0) + o.leads });
    else atual.leads += o.leads;
  }

  for (const [k, o] of agrupados) {
    // canal nunca vira coluna: o board é de ETAPAS, e um lead pode ter vários canais
    if (ehCanalNaoEtapa(o.status)) {
      plano.viraEntrada.push({ statusAtual: o.status, leads: o.leads });
      continue;
    }
    const existente = porNorm.get(k);
    if (existente) {
      plano.corrigirGrafia.push({ statusAtual: o.status, paraRotulo: existente.label, leads: o.leads });
      continue;
    }
    // ⚠️ O grau sai de `classificarEtapa` (a mesma régua do Funil de Performance), não de
    // um chute: "Avaliação Realizada" vira comparecimento, "Não Contactado" vira contato.
    const etapa = classificarEtapa(o.status);
    plano.criarColunas.push({ label: o.status.trim(), etapa, cor: corDaEtapa(etapa, o.status), leads: o.leads });
  }

  // ⚠️ Só entra aqui coluna VAZIA (zero leads) e irmã de uma que vai ser criada. Coluna
  // com lead NUNCA é excluída — apagá-la faria os leads dela sumirem, que é exatamente
  // o problema que esta rotina existe para resolver.
  const novosNorm = new Set(plano.criarColunas.map(c => normalizarRotulo(c.label)));
  for (const c of colunas) {
    if (c.leads > 0) continue;
    const k = normalizarRotulo(c.label);
    if (novosNorm.has(k)) plano.excluirVazias.push({ id: c.id, label: c.label, porCausaDe: c.label });
  }
  return plano;
}
