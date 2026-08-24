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
  if (/efetivad|fechad|vendid|comprou|contratad|paciente|ganho|\bwon\b/.test(s)) return 'fechamento';
  // Ausência explícita ANTES de comparecimento: "No-Show" contém "show" mas é
  // o oposto — agendou e faltou.
  if (/no show|nao compareceu|com falta|faltou/.test(s)) return 'agendamento';
  if (/realizad|compareceu|atendid[oa] na avaliacao|show/.test(s)) return 'comparecimento';
  if (/agendad|remarcad|reagendad|marcad/.test(s)) return 'agendamento';
  if (/sem interesse|desqualificad|perdid|\bperca\b|\blost\b|descartad/.test(s)) return 'perdido';
  if (/em atendimento|qualificad|negocia|proposta|orcament|nao retorna|distante/.test(s)) return 'qualificado';
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
};

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
};

export const FUNIL_VAZIO: ContagemFunil = {
  contatos: 0, qualificados: 0, agendamentos: 0, comparecimentos: 0,
  fechamentos: 0, perdidos: 0, receita: 0,
  aComparecer: 0, faltaram: 0, agendamentoSemData: 0, agendamentoSemDesfecho: 0,
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
};

export function construirMapaEtapas(stages: EtapaDeStage[]): MapaEtapas {
  const porFunil = new Map<string, EtapaFunil>();
  const porLabel = new Map<string, EtapaFunil>();
  for (const s of stages) {
    const etapa = s.etapa ?? classificarEtapa(s.label);
    const label = normalizarEtiqueta(s.label);
    if (!label) continue;
    porFunil.set(`${s.funnelId}:${label}`, etapa);
    // Primeiro funil vence no fallback — determinístico pela ordem de entrada.
    if (!porLabel.has(label)) porLabel.set(label, etapa);
  }
  return { porFunil, porLabel };
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
  { label: 'Agendado',       color: '#3b82f6', position: 1, etapa: 'agendamento' },
  { label: 'Reagendado',     color: '#7dd3fc', position: 2, etapa: 'agendamento' },
  { label: 'Fechado',        color: '#10b981', position: 3, etapa: 'fechamento' },
  { label: 'Paciente',       color: '#a1a1aa', position: 4, etapa: 'fechamento' },
  { label: 'Não Retorna',    color: '#71717a', position: 5, etapa: 'qualificado' },
  { label: 'Distante',       color: '#f97316', position: 6, etapa: 'qualificado' },
  { label: 'Sem Interesse',  color: '#ef4444', position: 7, etapa: 'perdido' },
  { label: 'Desqualificado', color: '#dc2626', position: 8, etapa: 'perdido' },
];
