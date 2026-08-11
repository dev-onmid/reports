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
  receita: number;
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
};

export const FUNIL_VAZIO: ContagemFunil = {
  contatos: 0, qualificados: 0, agendamentos: 0, comparecimentos: 0,
  fechamentos: 0, perdidos: 0, receita: 0,
};

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
export function contarFunil(leads: LeadParaFunil[], stages: EtapaDeStage[]): ContagemFunil {
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

  const c: ContagemFunil = { ...FUNIL_VAZIO };
  for (const lead of leads) {
    c.contatos++;

    const label = normalizarEtiqueta(lead.status);
    const daEtapa = (lead.funnelId ? porFunil.get(`${lead.funnelId}:${label}`) : undefined)
      ?? porLabel.get(label)
      ?? classificarEtapa(lead.status);

    if (daEtapa === 'perdido') c.perdidos++;

    let posto = postoDaEtapa(daEtapa); // perdido → -1: não sobe degrau por si só
    if (lead.fechou) posto = Math.max(posto, 4);
    else if (lead.compareceu) posto = Math.max(posto, 3);
    else if (lead.agendou || lead.dataAgendada != null) posto = Math.max(posto, 2);
    // (else if de propósito: fechou já implica os anteriores pela cumulatividade abaixo)

    if (posto >= 1) c.qualificados++;
    if (posto >= 2) c.agendamentos++;
    if (posto >= 3) c.comparecimentos++;
    if (posto >= 4) {
      c.fechamentos++;
      c.receita += Number(lead.receita) || 0;
    }
  }
  return c;
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
export const ETAPAS_PADRAO: { label: string; color: string; position: number; etapa: EtapaFunil }[] = [
  { label: 'Em Atendimento', color: '#0ea5e9', position: 0, etapa: 'qualificado' },
  { label: 'Agendado',       color: '#3b82f6', position: 1, etapa: 'agendamento' },
  { label: 'Reagendado',     color: '#7dd3fc', position: 2, etapa: 'agendamento' },
  { label: 'Fechado',        color: '#10b981', position: 3, etapa: 'fechamento' },
  { label: 'Comprou',        color: '#34d399', position: 4, etapa: 'fechamento' },
  { label: 'Paciente',       color: '#a1a1aa', position: 5, etapa: 'fechamento' },
  { label: 'Não Retorna',    color: '#71717a', position: 6, etapa: 'qualificado' },
  { label: 'Distante',       color: '#f97316', position: 7, etapa: 'qualificado' },
  { label: 'Sem Interesse',  color: '#ef4444', position: 8, etapa: 'perdido' },
  { label: 'Desqualificado', color: '#dc2626', position: 9, etapa: 'perdido' },
];
