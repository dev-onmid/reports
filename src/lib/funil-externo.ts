/**
 * Funil do CRM quando quem manda é um CRM EXTERNO (SULTS, Agendor, Datalytics,
 * planilha).
 *
 * ⚠️ O problema que isto resolve: `ensureDefaultFunnel` semeia 9 etapas de
 * CLÍNICA ('Paciente', 'Não Retorna', 'Distante', 'Reagendado'…) e a ingestão
 * externa só sabia ANEXAR as etapas reais depois delas, uma a uma, na ordem em
 * que os negócios aparecem na varredura. O resultado para um cliente de
 * expansão de franquia é 9 colunas fantasma seguidas das etapas de verdade
 * embaralhadas — "Perca" antes de "Abordagem D1".
 *
 * A régua aqui: quando o funil ainda é do sistema (só etapas padrão intocadas,
 * mais as que a própria integração criou), ele é ADOTADO — vira exatamente o
 * funil do CRM externo, na ordem de lá. Quando alguém já mexeu, as etapas que
 * faltam são anexadas e nada é removido nem reordenado.
 *
 * Pura e client-safe: sem pg, sem fetch.
 */

import { classificarEtapa, ETAPAS_PADRAO, type EtapaFunil } from '@/lib/funil-etapas';

export type EtapaAtual = { id: string; label: string; position: number };

/** Quantos leads e quantos gatilhos (conversão/follow-up) apontam para o rótulo. */
export type UsoEtapa = { leads: number; gatilhos: number };

export type PlanoFunil = {
  /** ids de etapas a remover — só etapas padrão intocadas que o externo não tem. */
  remover: string[];
  criar: { label: string; position: number; etapa: EtapaFunil }[];
  reposicionar: { id: string; position: number }[];
  /** 'adotado' = só as etapas do externo; 'mesclado' = sobrou etapa em uso, preservada no fim. */
  modo: 'adotado' | 'mesclado';
  /**
   * Etapas mantidas apesar de não existirem no CRM externo, COM O MOTIVO.
   *
   * ⚠️ O motivo não é enfeite: "ficou uma coluna que eu não quero" é
   * indistinguível de bug sem ele. Com lead/gatilho na mensagem, quem
   * configurou sabe se move o lead, apaga o gatilho, ou se é etapa própria.
   */
  preservadas: { label: string; leads: number; gatilhos: number }[];
};

export function normalizarRotulo(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const PADRAO = new Set(ETAPAS_PADRAO.map(e => normalizarRotulo(e.label)));

/** Cor por significado da etapa — o board fica legível sem ninguém escolher. */
const COR: Record<EtapaFunil, string> = {
  contato: '#94a3b8',
  qualificado: '#0ea5e9',
  agendamento: '#3b82f6',
  comparecimento: '#8b5cf6',
  fechamento: '#10b981',
  perdido: '#ef4444',
};

/**
 * Etapa padrão que ninguém usou: sem lead e sem gatilho apontando para ela.
 *
 * ⚠️ O gatilho conta tanto quanto o lead. `client_conversion_eventos_custom` e
 * `crm_followup_regras` apontam para a etapa pelo RÓTULO (`status_gatilho`);
 * apagar uma etapa referenciada deixaria a automação mirando um alvo que não
 * existe mais, e em silêncio.
 */
function descartavel(e: EtapaAtual, uso: Map<string, UsoEtapa>): boolean {
  const k = normalizarRotulo(e.label);
  if (!PADRAO.has(k)) return false;
  const u = uso.get(k);
  return (u?.leads ?? 0) === 0 && (u?.gatilhos ?? 0) === 0;
}

/**
 * Decide o que fazer com o funil diante das etapas do CRM externo.
 *
 * `externas` vem NA ORDEM do funil de lá — é ela que o board passa a refletir.
 *
 * ⚠️ A decisão é POR ETAPA, não tudo-ou-nada. A primeira versão exigia que o
 * funil inteiro estivesse intocado para ser adotado, e bastava UM lead numa
 * etapa padrão para o cliente ficar com as 9 colunas de clínica mais as do CRM
 * externo embaralhadas atrás — exatamente o que a adoção existe para evitar.
 * Agora: etapa padrão sem uso sai, etapa em uso fica (empurrada para o fim), e
 * as do externo assumem as primeiras posições na ordem de lá.
 */
export function planejarFunil(
  atuais: EtapaAtual[],
  externas: string[],
  uso: Map<string, UsoEtapa>,
): PlanoFunil {
  const limpas = externas.map(e => e.trim()).filter(Boolean);
  if (!limpas.length) {
    return { remover: [], criar: [], reposicionar: [], modo: 'mesclado', preservadas: [] };
  }

  const porRotulo = new Map(atuais.map(a => [normalizarRotulo(a.label), a]));
  const externasNorm = limpas.map(normalizarRotulo);
  const conjuntoExterno = new Set(externasNorm);

  const criar: PlanoFunil['criar'] = [];
  const reposicionar: PlanoFunil['reposicionar'] = [];

  // 1. As etapas do externo ocupam o começo, na ordem de lá.
  limpas.forEach((label, i) => {
    const atual = porRotulo.get(externasNorm[i]);
    if (!atual) criar.push({ label, position: i, etapa: classificarEtapa(label) });
    else if (atual.position !== i) reposicionar.push({ id: atual.id, position: i });
  });

  // 2. O que não é do externo: sai se for padrão sem uso, fica se tiver lead ou
  //    gatilho. Quem fica vai para depois das do externo, mantendo a ordem
  //    relativa — mexer nela além do necessário seria mexer no trabalho alheio.
  const forasteiras = atuais
    .filter(a => !conjuntoExterno.has(normalizarRotulo(a.label)))
    .sort((a, b) => a.position - b.position);

  const remover: string[] = [];
  const preservadas: PlanoFunil['preservadas'] = [];
  let proxima = limpas.length;
  for (const a of forasteiras) {
    if (descartavel(a, uso)) { remover.push(a.id); continue; }
    const u = uso.get(normalizarRotulo(a.label));
    preservadas.push({ label: a.label, leads: u?.leads ?? 0, gatilhos: u?.gatilhos ?? 0 });
    if (a.position !== proxima) reposicionar.push({ id: a.id, position: proxima });
    proxima++;
  }

  return {
    remover, criar, reposicionar,
    modo: preservadas.length ? 'mesclado' : 'adotado',
    preservadas,
  };
}

export { COR as CORES_ETAPA };
