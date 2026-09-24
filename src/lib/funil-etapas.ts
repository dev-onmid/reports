/**
 * Semântica do Funil de Performance — a fonte ÚNICA de "o que cada etapa significa".
 *
 * Antes desta lib, a tradução status→etapa vivia hardcoded em 4 lugares
 * inconsistentes (getStage do /api/crm/summary, sinaisDoStatus da importação,
 * lead-funnel-by-city e crm-attendance-audit), todos comparando contra os
 * rótulos PADRÃO do CRM. Cliente com etapas próprias ("Avaliação Agendada",
 * "Avaliação Realizada") caía fora e o funil aparecia zerado no meio.
 *
 * Agora cada `crm_stages` carrega `etapa_funil` (classificação explícita, com
 * auto-classificação por regex como default) e TODO consumidor conta pelo
 * mesmo `contarFunil`.
 *
 * Pura e client-safe: sem pg, sem fetch — o editor de funil (client component)
 * e as rotas importam daqui.
 */

export type EtapaFunil =
  | 'contato'
  | 'qualificado'
  | 'agendamento'
  | 'comparecimento'
  | 'fechamento'
  | 'perdido';

/** Ordem canônica da escada (perdido fica fora — é contagem paralela). */
export const ETAPAS_FUNIL: EtapaFunil[] = [
  'contato', 'qualificado', 'agendamento', 'comparecimento', 'fechamento',
];

export const ROTULOS_ETAPA: Record<EtapaFunil, string> = {
  contato: 'Contato',
  qualificado: 'Qualificado',
  agendamento: 'Agendamento',
  comparecimento: 'Comparecimento',
  fechamento: 'Fechamento',
  perdido: 'Perdido',
};

/**
 * Rótulos do DROPDOWN do editor de funil — mais largos que os do funil porque
 * o grau é UM só pra qualquer negócio: o posto 2 vale pra clínica (agendou),
 * vendas (mandou proposta) e franquia (marcou reunião); o posto 3 pra reunião
 * feita/comparecimento. O funil em si continua mostrando o NOME REAL da coluna
 * do cliente, então isso só ajuda o gestor a mapear a coluna no grau certo.
 */
export const ROTULOS_ETAPA_EDITOR: Record<EtapaFunil, string> = {
  contato: 'Contato / Entrada',
  qualificado: 'Qualificado',
  agendamento: 'Agendamento / Proposta',
  comparecimento: 'Comparecimento / Reunião',
  fechamento: 'Fechamento / Ganho',
  perdido: 'Perdido',
};

/**
 * Cor de cada degrau — é ELA que pinta as colunas do Kanban (decisão do
 * Matheus, 2026-09-12: "cada status com a cor de acordo com o funil").
 *
 * ⚠️ A cor não é mais escolhida coluna a coluna. `crm_stages.color` existe e
 * continua sendo gravada, mas deixou de mandar no board: as etapas criadas
 * pelo espelho do SULTS nasceram TODAS em `#94a3b8`, então o funil inteiro
 * ficava cinza e a cor não significava nada. Vindo do degrau, a leitura é
 * automática, igual em todos os clientes e impossível de sair do lugar.
 *
 * A escada esquenta da entrada até a venda; `perdido` é o único vermelho e
 * `fechamento` o único verde — o verde é o CTA da marca, então não se gasta
 * com outra coisa.
 */
export const CORES_ETAPA: Record<EtapaFunil, string> = {
  contato:        '#7dd3fc',
  qualificado:    '#0ea5e9',
  agendamento:    '#8b5cf6',
  comparecimento: '#f59e0b',
  fechamento:     '#10b981',
  perdido:        '#ef4444',
};

/** Cor da coluna a partir do degrau escolhido no editor — ou, se ninguém
 *  escolheu, do que o nome da etapa diz (mesma auto-classificação do funil). */
export function corDaEtapa(etapa: EtapaFunil | null | undefined, label?: string | null): string {
  return CORES_ETAPA[etapa ?? classificarEtapa(label)];
}

/**
 * Normaliza para comparação: sem acento, sem caixa, separadores unificados.
 * ⚠️ Range de diacríticos ESCAPADO (`̀-ͯ`) — a forma literal corrompe em
 * copy-paste/encoding (armadilha registrada no CLAUDE.md).
 */
export function normalizarEtiqueta(t: string | null | undefined): string {
  return String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s\-–—_/]+/g, ' ')
    .trim();
}

/**
 * Auto-classifica um rótulo de etapa (ou um status órfão) numa etapa semântica.
 *
 * Ordem de teste do FIM para o COMEÇO do funil — "Avaliação Realizada" contém
 * "realizad" e "avalia", e o que importa é o estágio mais avançado. `perdido`
 * testa antes de `qualificado` para "Desqualificado" não casar em "qualificad".
 *
 * "Não Retorna"/"Distante" → qualificado de propósito: o getStage antigo os
 * contava em 'Atendimento', e preservar isso evita que o funil de clientes
 * existentes encolha na virada.
 */
export function classificarEtapa(label: string | null | undefined): EtapaFunil {
  const s = normalizarEtiqueta(label);
  // ⚠️ `\bcontrato\b` com fronteira, NÃO `contrat`: "Negociação Contratual" é
  // etapa de negociação, e alargar o prefixo faria 12 negociações do CondoStore
  // entrarem como VENDA na dashboard. E `contratad` sozinho não pegava
  // "Contrato", que é justamente a etapa de fechamento do funil deles.
  // ⚠️ PERDA É TESTADA ANTES DO GANHO, de propósito: "Venda Perdida" e "Contrato
  // Perdido" contêm a palavra do ganho e entrariam como FATURAMENTO se a ordem
  // fosse a inversa — o pior erro possível nesta função.
  // "Distante" é perda (decisão do Matheus, 2026-09-24): mora longe, não vai
  // virar paciente — deixá-lo em qualificado inflava "Engajados".
  if (/sem interesse|desqualificad|desqualificac|perdid|\bperdas?\b|\bperca\b|\blost\b|descartad|distante/.test(s)) return 'perdido';
  // ⚠️ A regra nasceu só com PARTICÍPIO (fechad, vendid, contratad) e não
  // reconhecia o SUBSTANTIVO que o gestor usa como nome de coluna: "Fechamento",
  // "Vendas" e "Contratação" caíam todos em 'contato'. Medido em 14/09: os 503
  // leads ganhos da Londrigifts contavam como topo de funil no Radar e na
  // dashboard. Mesma família de defeito em agendamento e comparecimento abaixo.
  if (/efetivad|fechad|fechament|vendid|\bvendas?\b|comprou|contratad|contratac|\bcontrato\b|paciente|ganho|\bwon\b/.test(s)) return 'fechamento';
  // Ausência explícita ANTES de comparecimento: "No-Show" contém "show" mas é
  // o oposto — agendou e faltou.
  if (/no show|nao compareceu|com falta|faltou/.test(s)) return 'agendamento';
  if (/realizad|compareceu|comparecim|atendid[oa] na avaliacao|show/.test(s)) return 'comparecimento';
  // ⚠️ Posto 2 é o "compromisso criado" — o mesmo andar pra clínica (agendou),
  // franquia (marcou reunião) e vendas (mandou proposta/orçamento/entrou em
  // negociação). Antes proposta/orçamento/negociação caíam em QUALIFICADO (posto
  // 1), no mesmo degrau que "Qualificação" — numa board de vendas os dois
  // colapsavam num degrau só. Aqui viram um degrau próprio, depois de qualificado.
  if (/agendad|agendament|remarcad|remarcac|reagendad|marcad|proposta|orcament|orcado|cotacao|negocia/.test(s)) return 'agendamento';
  if (/em atendimento|qualificad|qualificac|nao retorna|engajad/.test(s)) return 'qualificado';
  return 'contato';
}

/** contato=0 … fechamento=4; perdido=-1 (fora da escada, só a contagem paralela). */
export function postoDaEtapa(etapa: EtapaFunil): number {
  switch (etapa) {
    case 'fechamento': return 4;
    case 'comparecimento': return 3;
    case 'agendamento': return 2;
    case 'qualificado': return 1;
    case 'perdido': return -1;
    default: return 0;
  }
}

export type LeadParaFunil = {
  status: string | null;
  funnelId: string | null;
  compareceu: boolean;
  fechou: boolean;
  agendou: boolean;
  dataAgendada: string | null;
  /**
   * Data do próprio lead (criação). Serve para descartar agendamento
   * IMPOSSÍVEL — ver `diaDoAgendamento`. Opcional: quem não passa mantém o
   * comportamento antigo.
   */
  dataLead?: string | null;
  receita: number;
  /**
   * De qual planilha o registro veio, para separar VENDA de LEAD (default
   * 'hibrido' = comportamento antigo, para todo lead do WhatsApp/CRM e para as
   * importações que não escolheram tipo):
   *  • 'lead'    → alimenta só o funil; o R$ dele NÃO é faturamento (a receita
   *               mora no relatório de Vendas). Evita o duplo-count.
   *  • 'venda'   → ledger de faturamento: entra SÓ como receita (já filtrada
   *               por data de fechamento na query); não é um contato do funil.
   *  • 'hibrido' → conta no funil E soma receita ao fechar (como sempre foi).
   */
  tipo?: 'lead' | 'venda' | 'hibrido';
};

export type EtapaDeStage = {
  funnelId: string;
  label: string;
  /** null = não configurado explicitamente → cai na auto-classificação do rótulo. */
  etapa: EtapaFunil | null;
  /** `crm_stages.situacao`: explícita, 'nenhuma', ou null/ausente = auto pelo rótulo. */
  situacao?: SituacaoStage | null;
};

/**
 * SITUAÇÃO da coluna — ortogonal ao grau (decisão do Matheus, 2026-09-24, a
 * partir da planilha antiga dele). O grau diz até onde o lead chegou; a
 * situação diz o que está acontecendo com ele ali:
 *  • 'tentativa' → ainda não conseguimos falar (Não Atende, Não Contactado,
 *                  Ligar Depois): chip "sem resposta" sob Leads;
 *  • 'parado'    → engajou e sumiu (Não Retorna): chip "pararam de responder"
 *                  sob Engajados.
 * Resgate e "Já teve agendamento" NÃO são situação: ficam no grau normal
 * (Entrada e Agendado), sem chip — decisão explícita dele.
 */
export type SituacaoEtapa = 'tentativa' | 'parado';

export function situacaoDaEtapa(label: string | null | undefined): SituacaoEtapa | null {
  const s = normalizarEtiqueta(label);
  if (!s) return null;
  if (/nao atend|nao contactad|nao contatad|ligar depois|nao respond|sem resposta|tentativa|caixa postal|nao retornou a ligacao/.test(s)) return 'tentativa';
  if (/nao retorna|parou de responder|sumiu|sem retorno/.test(s)) return 'parado';
  return null;
}

/**
 * O que o EDITOR grava em `crm_stages.situacao`: a situação explícita, ou
 * 'nenhuma' (o gestor olhou e disse que aquela coluna não é situação). NULL na
 * coluna = etapa anterior ao editor → auto-classificação pelo rótulo, igual ao
 * que `etapa_funil` NULL faz com o grau.
 */
export type SituacaoStage = SituacaoEtapa | 'nenhuma';
export const SITUACOES_STAGE: readonly SituacaoStage[] = ['nenhuma', 'tentativa', 'parado'];

/** Situação EFETIVA de uma coluna: explícita vence; 'nenhuma' cala a regex; null cai nela. */
export function situacaoEfetiva(situacao: SituacaoStage | null | undefined, label: string | null | undefined): SituacaoEtapa | null {
  if (situacao === 'nenhuma') return null;
  if (situacao === 'tentativa' || situacao === 'parado') return situacao;
  return situacaoDaEtapa(label);
}

/**
 * Dropdown COMPOSTO do editor de funil (fase 2 da planilha, 2026-09-24): uma
 * escolha só resolve grau E situação. A situação só existe nos dois graus em
 * que `contarFunil` a lê — tentativa no topo, parado em engajado — então as
 * opções são os 6 graus + "Contato · sem resposta" + "Qualificado · parou de
 * responder". Valor = 'grau' ou 'grau:situacao'.
 */
export type OpcaoEditor = { valor: string; etapa: EtapaFunil; situacao: SituacaoStage; rotulo: string };
export const OPCOES_EDITOR: OpcaoEditor[] = ([...ETAPAS_FUNIL, 'perdido'] as EtapaFunil[]).flatMap((etapa): OpcaoEditor[] => {
  const base: OpcaoEditor = { valor: etapa, etapa, situacao: 'nenhuma', rotulo: ROTULOS_ETAPA_EDITOR[etapa] };
  if (etapa === 'contato') return [base, { valor: 'contato:tentativa', etapa, situacao: 'tentativa', rotulo: `${ROTULOS_ETAPA_EDITOR[etapa]} · sem resposta` }];
  if (etapa === 'qualificado') return [base, { valor: 'qualificado:parado', etapa, situacao: 'parado', rotulo: `${ROTULOS_ETAPA_EDITOR[etapa]} · parou de responder` }];
  return [base];
});

/**
 * Valor do dropdown para uma coluna (explícito ou auto). Situação que não casa
 * com o grau (ex.: 'parado' numa coluna de contato) não tem opção — cai no grau
 * puro, e ao salvar vira 'nenhuma'.
 */
export function valorOpcaoEditor(etapa: EtapaFunil | null | undefined, situacao: SituacaoStage | null | undefined, label: string): string {
  const e = etapa ?? classificarEtapa(label);
  const s = situacaoEfetiva(situacao, label);
  if (e === 'contato' && s === 'tentativa') return 'contato:tentativa';
  if (e === 'qualificado' && s === 'parado') return 'qualificado:parado';
  return e;
}

export function opcaoDoValor(valor: string): { etapa: EtapaFunil; situacao: SituacaoStage } {
  const o = OPCOES_EDITOR.find(x => x.valor === valor);
  return o ? { etapa: o.etapa, situacao: o.situacao } : { etapa: 'contato', situacao: 'nenhuma' };
}

export type ContagemFunil = {
  contatos: number;
  qualificados: number;
  agendamentos: number;
  comparecimentos: number;
  fechamentos: number;
  /** Contagem PARALELA — perdido não é degrau; quem perdeu segue contando nas etapas que alcançou. */
  perdidos: number;
  receita: number;
  /**
   * Quebra da distância entre AGENDAMENTOS e COMPARECIMENTOS.
   *
   * ⚠️ O buraco entre os dois degraus junta duas coisas MUITO diferentes: quem
   * ainda vai vir (consulta marcada para depois de hoje) e quem furou. Sem
   * separar, o funil parecia dizer que 27 pessoas faltaram quando boa parte só
   * tem data futura.
   *
   * Os três somam exatamente `agendamentos - comparecimentos`.
   */
  aComparecer: number;
  faltaram: number;
  /** Agendou, não veio, e não há data para julgar. Não é falta nem promessa. */
  agendamentoSemData: number;
  /**
   * A data passou, mas o CRM nunca disse o que aconteceu — e o STATUS do lead
   * nem chegou a dizer que ele estava agendado (ex.: "Em Atendimento" com uma
   * data solta no campo).
   *
   * ⚠️ Isto NÃO é falta. Chamar de falta era o que fazia o funil contar 61
   * ausências onde o relatório da clínica registrava 30: os 31 excedentes eram
   * leads que só existem no nosso CRM, promovidos a "agendamento" pela mera
   * presença de uma data.
   */
  agendamentoSemDesfecho: number;
  /** Ainda no topo e numa coluna de TENTATIVA (não atende/ligar depois): chip "sem resposta" sob Leads. */
  semResposta: number;
  /** Engajou, não agendou, não perdeu e não parou: é quem está sendo trabalhado — chip "em atendimento" sob Engajados. */
  emAtendimento: number;
  /** Engajou e sumiu (Não Retorna): chip "pararam de responder" sob Engajados. */
  pararamResponder: number;
};

export const FUNIL_VAZIO: ContagemFunil = {
  contatos: 0, qualificados: 0, agendamentos: 0, comparecimentos: 0,
  fechamentos: 0, perdidos: 0, receita: 0,
  aComparecer: 0, faltaram: 0, agendamentoSemData: 0, agendamentoSemDesfecho: 0,
  semResposta: 0, emAtendimento: 0, pararamResponder: 0,
};

/** Reconhece o rótulo de ausência — a mesma família que `classificarEtapa` já isola. */
const RE_FALTOU = /no show|nao compareceu|com falta|faltou/;

/**
 * Extrai 'YYYY-MM-DD' do que o banco devolveu.
 *
 * ⚠️ `data_agendada` é DATE: dependendo do driver chega como 'YYYY-MM-DD' ou
 * como texto de `Date` ("Wed Aug 20 2026 …"). Comparar as duas formas como
 * string daria resultado aleatório, então normaliza antes.
 */
export function diaISO(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Conta o funil CUMULATIVO: cada etapa conta quem CHEGOU nela, não quem está
 * nela agora. Quem fechou conta em todas — o funil é não-crescente por
 * construção e as taxas entre etapas fazem sentido.
 *
 * Posto do lead = max(posto do stage casado, overrides monotônicos dos
 * booleanos): fechou→4, compareceu→3, agendou/data_agendada→2. Os booleanos só
 * AVANÇAM (a importação grava com OR), então um export desatualizado nunca
 * regride a etapa.
 *
 * Casamento status→stage: primeiro pela chave `funnelId:label` (multi-funil
 * com rótulo repetido → o funil do lead vence), depois por label sozinho
 * (lead com funnel_id NULL / legado). Status órfão → classifica o TEXTO cru —
 * é o que cobre o vocabulário de planilha sem stage cadastrado.
 */
/** Índice status→etapa de um cliente, pré-construído para não refazer por lead. */
export type MapaEtapas = {
  porFunil: Map<string, EtapaFunil>;
  porLabel: Map<string, EtapaFunil>;
  /** Situação efetiva da coluna, pelas mesmas chaves — só para colunas cadastradas. */
  situacaoPorFunil: Map<string, SituacaoEtapa | null>;
  situacaoPorLabel: Map<string, SituacaoEtapa | null>;
};

export function construirMapaEtapas(stages: EtapaDeStage[]): MapaEtapas {
  const porFunil = new Map<string, EtapaFunil>();
  const porLabel = new Map<string, EtapaFunil>();
  const situacaoPorFunil = new Map<string, SituacaoEtapa | null>();
  const situacaoPorLabel = new Map<string, SituacaoEtapa | null>();
  for (const s of stages) {
    const etapa = s.etapa ?? classificarEtapa(s.label);
    const situacao = situacaoEfetiva(s.situacao, s.label);
    const label = normalizarEtiqueta(s.label);
    if (!label) continue;
    porFunil.set(`${s.funnelId}:${label}`, etapa);
    situacaoPorFunil.set(`${s.funnelId}:${label}`, situacao);
    // Primeiro funil vence no fallback — determinístico pela ordem de entrada.
    if (!porLabel.has(label)) { porLabel.set(label, etapa); situacaoPorLabel.set(label, situacao); }
  }
  return { porFunil, porLabel, situacaoPorFunil, situacaoPorLabel };
}

/**
 * Situação do lead: a da COLUNA dele quando ela está cadastrada (explícita ou
 * 'nenhuma' calam a regex), senão a regex sobre o status cru — o mesmo
 * casamento funil→rótulo→texto que `etapaDoLead` faz para o grau.
 */
export function situacaoDoLead(lead: Pick<LeadParaFunil, 'status' | 'funnelId'>, mapa: MapaEtapas): SituacaoEtapa | null {
  const label = normalizarEtiqueta(lead.status);
  if (!label) return null;
  if (lead.funnelId) {
    const k = `${lead.funnelId}:${label}`;
    if (mapa.situacaoPorFunil.has(k)) return mapa.situacaoPorFunil.get(k) ?? null;
  }
  if (mapa.situacaoPorLabel.has(label)) return mapa.situacaoPorLabel.get(label) ?? null;
  return situacaoDaEtapa(lead.status);
}

export type PostoDoLead = {
  /** Etapa que o STATUS do lead representa (antes dos overrides dos booleanos). */
  etapaStatus: EtapaFunil;
  /** Degrau mais avançado que o lead alcançou (0..4). */
  posto: number;
  /** Contagem paralela: desqualificado segue contando nas etapas que alcançou. */
  perdido: boolean;
  /** Dia do agendamento já validado ('YYYY-MM-DD'), ou null. */
  diaAgenda: string | null;
  /**
   * O lead só chegou a "agendamento" por causa da DATA — nem o status nem o
   * booleano `agendou` dizem que houve marcação. Muda o julgamento de quem não
   * veio: sem confirmação de que estava marcado, data vencida é lacuna de
   * registro, não falta.
   */
  agendaSoPelaData: boolean;
};

/**
 * Dia do agendamento, descartando o que é impossível.
 *
 * ⚠️ Consulta marcada ANTES de o lead existir não é agendamento — é o mês
 * digitado errado. Medido em produção (2026-08-23): 59 leads no sistema, 27 só
 * na Sorrifácil ingleses, todos com a data caindo no mês ANTERIOR ao do
 * cadastro (lead de 04/08 com agenda em 17/07). Contá-los inflava
 * AGENDAMENTOS e, como a data já passou, mandava todos direto pro balde de
 * falta.
 */
export function diaDoAgendamento(lead: LeadParaFunil): string | null {
  const dia = diaISO(lead.dataAgendada);
  if (dia === null) return null;
  const doLead = diaISO(lead.dataLead ?? null);
  if (doLead !== null && dia < doLead) return null;
  return dia;
}

/**
 * Classifica UM lead — extraído de `contarFunil` para que a listagem por etapa
 * (modal do funil) e a contagem do card usem exatamente a mesma régua. Se estas
 * duas lógicas divergirem, o modal mostra um total diferente do número clicado.
 */
export function etapaDoLead(lead: LeadParaFunil, mapa: MapaEtapas): PostoDoLead {
  const label = normalizarEtiqueta(lead.status);
  const etapaStatus = (lead.funnelId ? mapa.porFunil.get(`${lead.funnelId}:${label}`) : undefined)
    ?? mapa.porLabel.get(label)
    ?? classificarEtapa(lead.status);

  const postoStatus = postoDaEtapa(etapaStatus); // perdido → -1: não sobe degrau por si só
  const diaAgenda = diaDoAgendamento(lead);
  let posto = postoStatus;
  if (lead.fechou) posto = Math.max(posto, 4);
  else if (lead.compareceu) posto = Math.max(posto, 3);
  else if (lead.agendou || diaAgenda !== null) posto = Math.max(posto, 2);
  const agendaSoPelaData = posto === 2 && !lead.agendou && postoStatus < 2;
  // (else if de propósito: fechou já implica os anteriores pela cumulatividade)

  // Piso em 0: TODO lead é um contato (contarFunil incrementa `contatos` sem
  // condição). Sem o piso, um perdido que nunca avançou ficaria em -1 e sumiria
  // da listagem de "Contatos", divergindo do número do card.
  // Não muda contagem alguma: -1 e 0 falham igual nos testes `posto >= 1`.
  return {
    etapaStatus, posto: Math.max(0, posto), perdido: etapaStatus === 'perdido',
    diaAgenda, agendaSoPelaData,
  };
}

/**
 * @param hoje Referência para separar "ainda vai vir" de "faltou", em
 *   'YYYY-MM-DD'. Parâmetro em vez de `new Date()` interno para a função
 *   continuar pura e testável — a data de hoje é entrada, não ambiente.
 */
export function contarFunil(
  leads: LeadParaFunil[], stages: EtapaDeStage[], hoje?: string,
): ContagemFunil {
  const mapa = construirMapaEtapas(stages);
  const ref = hoje ?? diaISO(new Date().toISOString()) ?? '';

  const c: ContagemFunil = { ...FUNIL_VAZIO };
  for (const lead of leads) {
    // Registro de VENDA (ledger de faturamento): entra SÓ como receita — já
    // veio filtrado por data de fechamento na query. Não é um contato do funil,
    // então não incrementa contatos/etapas nem infla o topo.
    if (lead.tipo === 'venda') {
      c.receita += Number(lead.receita) || 0;
      continue;
    }

    c.contatos++;

    const { posto, perdido, diaAgenda, agendaSoPelaData } = etapaDoLead(lead, mapa);
    if (perdido) c.perdidos++;

    // Situação (linhas cinza da planilha): só faz sentido em quem NÃO avançou
    // nem perdeu — no topo (tentativa) ou em engajado (parado / em atendimento).
    const situacao = perdido ? null : situacaoDoLead(lead, mapa);
    if (!perdido && posto === 0 && situacao === 'tentativa') c.semResposta++;
    if (!perdido && posto === 1) {
      if (situacao === 'parado') c.pararamResponder++;
      else c.emAtendimento++;
    }

    if (posto >= 1) c.qualificados++;
    if (posto >= 2) c.agendamentos++;
    if (posto >= 3) c.comparecimentos++;
    // Agendou e ainda NÃO veio: separa promessa de falta.
    if (posto === 2) {
      // Falta explícita no status vence a data: "No-Show" marcado é falta mesmo
      // que a data ainda não tenha chegado (remarcação não confirmada).
      if (RE_FALTOU.test(normalizarEtiqueta(lead.status))) c.faltaram++;
      else if (diaAgenda === null) c.agendamentoSemData++;
      else if (diaAgenda >= ref) c.aComparecer++;
      // Data vencida em lead que ninguém marcou como agendado: o CRM não
      // registrou o desfecho. Afirmar "faltou" seria inventar o dado.
      else if (agendaSoPelaData) c.agendamentoSemDesfecho++;
      else c.faltaram++;
    }
    if (posto >= 4) {
      c.fechamentos++;
      // 'lead' alimenta só o funil: o R$ FECHADO dele não vira faturamento
      // (a receita é contada pelo relatório de Vendas, senão dobraria). 'hibrido'
      // (default de tudo que já existe) soma a receita, como sempre.
      if (lead.tipo !== 'lead') c.receita += Number(lead.receita) || 0;
    }
  }
  return c;
}

/**
 * O lead entra na listagem daquela etapa?
 *
 * `alcancou` (cumulativo) é o conjunto que o CARD conta — clicar em
 * "Agendamentos: 19" e ver 19 linhas. `atual` é o subconjunto que ainda está
 * parado ali (posto exatamente igual ao degrau), que é a lista de trabalho.
 *
 * `contato` no modo `atual` = quem não passou de contato. `perdido` ignora a
 * escada nos dois modos: é contagem paralela, não degrau.
 */
export function leadNaEtapa(
  p: PostoDoLead, etapa: EtapaFunil, modo: 'alcancou' | 'atual',
): boolean {
  if (etapa === 'perdido') return p.perdido;
  const alvo = postoDaEtapa(etapa);
  return modo === 'atual' ? p.posto === alvo : p.posto >= alvo;
}

export function somarFunis(funis: ContagemFunil[]): ContagemFunil {
  const total: ContagemFunil = { ...FUNIL_VAZIO };
  for (const f of funis) {
    total.contatos += f.contatos;
    total.qualificados += f.qualificados;
    total.agendamentos += f.agendamentos;
    total.comparecimentos += f.comparecimentos;
    total.fechamentos += f.fechamentos;
    total.perdidos += f.perdidos;
    total.receita += f.receita;
    total.aComparecer += f.aComparecer;
    total.faltaram += f.faltaram;
    total.agendamentoSemData += f.agendamentoSemData;
    total.agendamentoSemDesfecho += f.agendamentoSemDesfecho;
    total.semResposta += f.semResposta;
    total.emAtendimento += f.emAtendimento;
    total.pararamResponder += f.pararamResponder;
  }
  return total;
}

// ------------------------------------------------------------- Topo do funil

export type FonteTopoFunil = 'auto' | 'crm' | 'anuncios';

export function normalizarFonteTopo(v: unknown): FonteTopoFunil {
  return v === 'crm' || v === 'anuncios' ? v : 'auto';
}

/**
 * Resolve o que conta como "Contatos" no topo do funil de um cliente.
 *
 * Decisão do Matheus: configurável por cliente, default 'auto' = CRM quando
 * existe lead lá (planilha/WhatsApp/webhook), senão os números de anúncio —
 * SEMPRE com a fonte devolvida junto, pra UI rotular ("estimado por anúncios").
 * Conversão de Google não é lead; misturá-las em silêncio era o problema.
 */
export function resolverTopoFunil(
  fonte: FonteTopoFunil, crmLeads: number, adsLeads: number,
): { topo: number; fonte: 'crm' | 'anuncios' } {
  if (fonte === 'crm') return { topo: crmLeads, fonte: 'crm' };
  if (fonte === 'anuncios') return { topo: adsLeads, fonte: 'anuncios' };
  return crmLeads > 0
    ? { topo: crmLeads, fonte: 'crm' }
    : { topo: adsLeads, fonte: 'anuncios' };
}

/** Rótulo agregado da fonte quando vários clientes estão somados na mesma tela. */
export function rotuloFonteTopo(fontes: ('crm' | 'anuncios')[]): string {
  const unicas = new Set(fontes);
  if (unicas.size === 0) return '';
  if (unicas.size > 1) return 'fontes mistas (CRM + anúncios)';
  return unicas.has('crm') ? 'fonte: CRM' : 'estimado por anúncios';
}

/**
 * Etapas padrão do CRM com a classificação explícita — fonte única dos DOIS
 * seeds que antes viviam duplicados (funnels/route.ts e crm-conversation-sync).
 */
// "Comprou" saiu do seed (2026-08-11, decisão do Matheus): dois ganhos viravam
// duas colunas competindo — "Fechado" fica porque é o rótulo que o sistema
// grava (importação/webhook). Funis existentes são fundidos pelo saneamento
// (crm-saneamento.ts); o regex de classificarEtapa segue reconhecendo
// "Comprou" em dado legado.
export const ETAPAS_PADRAO: { label: string; color: string; position: number; etapa: EtapaFunil }[] = [
  { label: 'Em Atendimento', color: '#0ea5e9', position: 0, etapa: 'qualificado' },
  // ⚠️ Engajado é o 2º DEGRAU (posto 1), não o topo — decisão do Matheus em
  // 2026-09-24, revertendo a de 4df6ebb: na dashboard o topo é sempre "Leads"
  // (todo mundo que entrou) e logo abaixo vem "Engajados" (quem respondeu ou
  // interagiu). Com Engajado em `contato`, a coluna virava o RÓTULO do topo
  // no funil real ("351 ENGAJADO") e o degrau de engajamento não existia.
  { label: 'Engajado',       color: '#22d3ee', position: 1, etapa: 'qualificado' },
  { label: 'Agendado',       color: '#3b82f6', position: 2, etapa: 'agendamento' },
  { label: 'Reagendado',     color: '#7dd3fc', position: 3, etapa: 'agendamento' },
  { label: 'Fechado',        color: '#10b981', position: 4, etapa: 'fechamento' },
  { label: 'Paciente',       color: '#a1a1aa', position: 5, etapa: 'fechamento' },
  { label: 'Não Retorna',    color: '#71717a', position: 6, etapa: 'qualificado' },
  { label: 'Distante',       color: '#f97316', position: 7, etapa: 'perdido' },
  { label: 'Sem Interesse',  color: '#ef4444', position: 8, etapa: 'perdido' },
  { label: 'Desqualificado', color: '#dc2626', position: 9, etapa: 'perdido' },
];

// ------------------------------------------- Funil pelas etapas reais do Kanban
//
// Pedido do Matheus (2026-09-14): o Funil de Performance tem que mostrar os
// NOMES e a QUANTIDADE de etapas do Kanban do PRÓPRIO cliente, não os 5 degraus
// semânticos genéricos. Cor e nº de quadrantes seguem o CRM.
//
// ⚠️ Isso NÃO substitui `contarFunil` (semântico): a versão por etapa real só
// faz sentido com UM cliente selecionado — Kanbans de clientes diferentes têm
// etapas diferentes e não se somam. Com vários clientes a dashboard continua no
// funil semântico. As DUAS contagens convivem, calculadas da mesma régua de
// posto para nunca divergirem entre si.

/** Etapa real do Kanban, com posição e a etapa semântica (explícita ou nula). */
export type StageKanban = {
  funnelId: string;
  label: string;
  position: number;
  /** etapa_funil explícita; null cai na auto-classificação pelo rótulo. */
  etapa: EtapaFunil | null;
};

/** Um degrau do funil real, já com cor do degrau e contagem cumulativa. */
export type DegrauKanban = {
  label: string;
  /** Cor do DEGRAU (corDaEtapa) — a mesma que pinta a coluna no Kanban. */
  color: string;
  etapa: EtapaFunil;
  /** Posição na escada (0..N-1) — não é a `position` crua do banco. */
  index: number;
  /** Quem CHEGOU nesta etapa (cumulativo, igual ao card semântico). */
  alcancaram: number;
  /** Quem está PARADO exatamente aqui. */
  atuais: number;
};

/**
 * Escada do funil real de um cliente: as etapas não-perdido do funil dominante,
 * na ordem, mais os índices auxiliares que `indiceStageDoLead` usa.
 */
export type LadderKanban = {
  /** Funil escolhido (o com mais leads). '' quando o cliente não tem etapas. */
  funnelId: string;
  /** UM degrau por ETAPA presente (colunas irmãs colapsadas), em ordem de funil. Vazio → sem funil real. */
  degraus: Array<{ label: string; color: string; etapa: EtapaFunil; index: number }>;
  /** Semântica por rótulo do funil escolhido (inclui os perdido, p/ detecção). */
  mapa: MapaEtapas;
  /** normalizado(label) → index do degrau da sua ETAPA (toda coluna da etapa aponta pro mesmo). */
  idxPorLabel: Map<string, number>;
  /** Etapa semântica → index do seu (único) degrau colapsado (bump dos booleanos e do órfão). */
  idxPorEtapa: Map<EtapaFunil, number>;
};

/**
 * Escolhe o funil que representa o cliente: o que concentra MAIS leads. Cliente
 * com um funil só (o caso comum) cai nele direto; quem tem vários (ex.: um
 * espelho de importação antigo ao lado do principal) fica com o que a operação
 * de fato usa. Empate → mais etapas → primeiro na ordem de chegada.
 *
 * Sem `funnel_id` em lead nenhum (base legada), decide pelo funil com mais
 * etapas não-perdido — é o que tem cara de Kanban de verdade.
 */
function escolherFunilDominante(stages: StageKanban[], leads: LeadParaFunil[]): string {
  const porFunil = new Map<string, StageKanban[]>();
  for (const s of stages) {
    if (!porFunil.has(s.funnelId)) porFunil.set(s.funnelId, []);
    porFunil.get(s.funnelId)!.push(s);
  }
  if (porFunil.size === 0) return '';
  if (porFunil.size === 1) return [...porFunil.keys()][0];

  const leadsPorFunil = new Map<string, number>();
  for (const l of leads) {
    // Registro de venda (ledger) não é lead do funil — não pode inclinar a
    // escolha do funil dominante (senão summary e drill-down escolheriam funis
    // diferentes: um enxerga as vendas, o outro não).
    if (l.tipo === 'venda' || !l.funnelId) continue;
    leadsPorFunil.set(l.funnelId, (leadsPorFunil.get(l.funnelId) ?? 0) + 1);
  }
  const degrausDe = (fid: string) =>
    (porFunil.get(fid) ?? []).filter(s => (s.etapa ?? classificarEtapa(s.label)) !== 'perdido').length;

  let escolhido = '';
  let melhor = -1;
  // Ordem de chegada como desempate final — determinístico.
  for (const fid of porFunil.keys()) {
    const leadsF = leadsPorFunil.get(fid) ?? 0;
    // Peso: leads dominam; nº de degraus só desempata (cabe em <1000 etapas).
    const score = leadsF * 1000 + degrausDe(fid);
    if (score > melhor) { melhor = score; escolhido = fid; }
  }
  return escolhido;
}

/** Monta a escada (degraus não-perdido) do funil dominante do cliente. */
export function construirLadder(stages: StageKanban[], leads: LeadParaFunil[]): LadderKanban {
  const funnelId = escolherFunilDominante(stages, leads);
  const doFunil = stages.filter(s => s.funnelId === funnelId);
  const mapa = construirMapaEtapas(
    doFunil.map(s => ({ funnelId: s.funnelId, label: s.label, etapa: s.etapa })),
  );

  // Ordena por PROFUNDIDADE de funil (posto da etapa), com a posição no board
  // como desempate DENTRO do mesmo degrau semântico. A posição crua do Kanban
  // não é ordem de funil: em board real (CondoStore/SULTS) o "Contrato"
  // (fechamento) fica na 3ª coluna e a cadência de entrada "Abordagem D1..D7"
  // (contato) fica no fim — ordenar por posição jogaria o ganho pro meio da
  // escada e a entrada pro rodapé. Pelo posto, a escada sai na ordem certa e o
  // funil fica MONOTÔNICO (cada lead ocupa um degrau bem definido).
  const etapaDe = (s: StageKanban): EtapaFunil => s.etapa ?? classificarEtapa(s.label);
  const ordenadas = [...doFunil].sort((a, b) => {
    const pa = postoDaEtapa(etapaDe(a));
    const pb = postoDaEtapa(etapaDe(b));
    return pa !== pb ? pa - pb : a.position - b.position;
  });
  // COLAPSA por etapa (posto): um degrau por ETAPA presente, não um por coluna.
  // Colunas irmãs do mesmo degrau — as "Abordagem D1..D7" (todas contato), ou
  // "Lead Frio/Morno/Quente" (todas comparecimento) — são a MESMA fase do funil:
  // "tentar contato" é lead de entrada, não sete etapas. Mostrá-las como N
  // degraus infla a escada sem informar. Cada etapa vira UM degrau, rotulado pela
  // 1ª coluna daquela etapa (a porta de entrada da fase, pela ordem já aplicada),
  // e TODA coluna da etapa aponta pra esse degrau (idxPorLabel), então lead que
  // está em "Abordagem D3" cai no degrau de contato.
  const degraus: LadderKanban['degraus'] = [];
  const idxPorLabel = new Map<string, number>();
  const idxPorEtapa = new Map<EtapaFunil, number>();
  for (const s of ordenadas) {
    const etapa = etapaDe(s);
    if (etapa === 'perdido') continue; // perdido é contagem paralela, não degrau
    let index = idxPorEtapa.get(etapa);
    if (index === undefined) {
      index = degraus.length;
      degraus.push({ label: s.label, color: corDaEtapa(etapa, s.label), etapa, index });
      idxPorEtapa.set(etapa, index);
    }
    const chave = normalizarEtiqueta(s.label);
    if (chave && !idxPorLabel.has(chave)) idxPorLabel.set(chave, index);
  }
  return { funnelId, degraus, mapa, idxPorLabel, idxPorEtapa };
}

/** Maior índice do ladder cuja etapa não passa do posto de `alvo`. -1 se nenhum. */
function maiorIndiceAteOPosto(ladder: LadderKanban, alvo: EtapaFunil): number {
  const p = postoDaEtapa(alvo);
  let best = -1;
  for (const d of ladder.degraus) if (postoDaEtapa(d.etapa) <= p) best = Math.max(best, d.index);
  return best;
}

/**
 * Índice (0..N-1) do degrau real que o lead ALCANÇOU, na escada do cliente.
 *
 * Mesma régua de `etapaDoLead`, só que projetada nas etapas reais:
 *  1. status casa um degrau pelo rótulo → é ele;
 *  2. status órfão/planilha → classifica e cai no degrau daquela etapa (ou no
 *     degrau imediatamente abaixo, se o funil não tiver essa etapa);
 *  3. os booleanos (fechou/compareceu/agendou) só AVANÇAM, projetados no degrau
 *     da etapa correspondente — export desatualizado nunca regride.
 *
 * `perdido` é paralelo (igual ao semântico): quem perdeu segue contando nas
 * etapas que alcançou.
 */
export function indiceStageDoLead(lead: LeadParaFunil, ladder: LadderKanban): { idx: number; perdido: boolean } {
  if (ladder.degraus.length === 0) return { idx: 0, perdido: false };
  // Degrau que representa uma etapa semântica: o MAIOR índice com aquela etapa,
  // ou — se o funil não tiver essa etapa — o maior degrau até aquele posto.
  const indiceDe = (e: EtapaFunil): number => {
    const exato = ladder.idxPorEtapa.get(e);
    return exato !== undefined ? exato : maiorIndiceAteOPosto(ladder, e);
  };

  const label = normalizarEtiqueta(lead.status);
  let idxBase: number;
  let perdido = false;
  if (ladder.idxPorLabel.has(label)) {
    idxBase = ladder.idxPorLabel.get(label)!; // degrau exato (nunca perdido)
  } else {
    const etapaC = ladder.mapa.porLabel.get(label) ?? classificarEtapa(lead.status);
    if (etapaC === 'perdido') { perdido = true; idxBase = -1; }
    else idxBase = indiceDe(etapaC);
  }

  let idx = idxBase;
  if (lead.fechou) idx = Math.max(idx, indiceDe('fechamento'));
  else if (lead.compareceu) idx = Math.max(idx, indiceDe('comparecimento'));
  else if (lead.agendou || diaDoAgendamento(lead) !== null) idx = Math.max(idx, indiceDe('agendamento'));

  return { idx: Math.max(0, idx), perdido };
}

export type FunilPorStage = {
  /** Degraus em ordem de funil (posto do Kanban), com cumulativo e ocupação. */
  degraus: DegrauKanban[];
  /** Contagem paralela dos perdidos (igual ao semântico). */
  perdidos: number;
};

/** Piso de reconhecimento p/ o funil real valer; abaixo dele, cai no semântico. */
export const PISO_STATUS_RECONHECIDO = 0.5;

/**
 * Fração de leads (não-venda) cujo status casa EXATAMENTE um degrau real do
 * Kanban. É o que separa um cliente cujo CRM é de fato TOCADO pelo Kanban
 * (SULTS/nativo — o status do lead é o nome da coluna, fração ~1) de um cliente
 * de planilha (clínicas), cujos status importados ("Não Contactado", "Avaliação
 * Realizada", vazio) não batem com as colunas-semente e teriam de ser empurrados
 * pro degrau mais próximo — mislabelando o funil inteiro. Medido em produção:
 * CondoStore/Londrigifts ~1, Sorrifácil ingleses ~0,15.
 */
export function fracaoStatusReconhecido(ladder: LadderKanban, leads: LeadParaFunil[]): number {
  let total = 0;
  let casaram = 0;
  for (const l of leads) {
    if (l.tipo === 'venda') continue; // ledger não é lead do funil
    total++;
    if (ladder.idxPorLabel.has(normalizarEtiqueta(l.status))) casaram++;
  }
  return total === 0 ? 0 : casaram / total;
}

/**
 * Conta o funil pelas ETAPAS REAIS do Kanban do cliente (cumulativo).
 *
 * `degraus` vazio = cliente sem etapas cadastradas → o chamador cai no funil
 * semântico. Registro de VENDA (ledger) não é contato do funil, igual ao
 * `contarFunil`. A receita NÃO é recalculada aqui: continua vindo do funil
 * semântico, então os dois nunca divergem no faturamento.
 */
export function contarFunilPorStage(stages: StageKanban[], leads: LeadParaFunil[]): FunilPorStage {
  const ladder = construirLadder(stages, leads);
  const degraus: DegrauKanban[] = ladder.degraus.map(d => ({ ...d, alcancaram: 0, atuais: 0 }));
  if (degraus.length === 0) return { degraus: [], perdidos: 0 };

  // ⚠️ O funil REAL só vale quando o Kanban de fato representa os leads. Cliente
  // de planilha tem status que não casam as colunas-semente; forçar o funil real
  // ali empilharia os leads no degrau mais próximo e o rótulo mentiria. Abaixo do
  // piso, devolve vazio → o chamador (summary) cai no funil semântico, que
  // normaliza esses status importados. SULTS/nativo passa folgado (~1).
  if (fracaoStatusReconhecido(ladder, leads) < PISO_STATUS_RECONHECIDO) {
    return { degraus: [], perdidos: 0 };
  }

  let perdidos = 0;
  for (const lead of leads) {
    if (lead.tipo === 'venda') continue;
    const { idx, perdido } = indiceStageDoLead(lead, ladder);
    if (perdido) perdidos++;
    for (let k = 0; k <= idx && k < degraus.length; k++) degraus[k].alcancaram++;
    if (idx < degraus.length) degraus[idx].atuais++;
  }
  return { degraus, perdidos };
}
