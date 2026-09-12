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
  /** 'adotado' = o funil vira o do CRM externo; 'anexado' = só completa o que falta. */
  modo: 'adotado' | 'anexado';
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
 */
export function planejarFunil(
  atuais: EtapaAtual[],
  externas: string[],
  uso: Map<string, UsoEtapa>,
): PlanoFunil {
  const limpas = externas.map(e => e.trim()).filter(Boolean);
  const vazio: PlanoFunil = { remover: [], criar: [], reposicionar: [], modo: 'anexado' };
  if (!limpas.length) return vazio;

  const porRotulo = new Map(atuais.map(a => [normalizarRotulo(a.label), a]));
  const externasNorm = limpas.map(normalizarRotulo);
  const conjuntoExterno = new Set(externasNorm);

  // O funil é "nosso" enquanto toda etapa for ou padrão intocada, ou uma das
  // etapas do CRM externo. Uma etapa criada por gestor (ou padrão já em uso)
  // tira a integração do volante.
  const gerenciado = atuais.every(
    a => conjuntoExterno.has(normalizarRotulo(a.label)) || descartavel(a, uso),
  );

  if (!gerenciado) {
    // Só completa o que falta, no fim, preservando a ordem do externo entre si.
    const base = atuais.reduce((m, a) => Math.max(m, a.position), -1);
    const criar = limpas
      .filter((_, i) => !porRotulo.has(externasNorm[i]))
      .map((label, i) => ({
        label, position: base + 1 + i, etapa: classificarEtapa(label),
      }));
    return { ...vazio, criar };
  }

  const criar: PlanoFunil['criar'] = [];
  const reposicionar: PlanoFunil['reposicionar'] = [];
  limpas.forEach((label, i) => {
    const atual = porRotulo.get(externasNorm[i]);
    if (!atual) {
      criar.push({ label, position: i, etapa: classificarEtapa(label) });
    } else if (atual.position !== i) {
      reposicionar.push({ id: atual.id, position: i });
    }
  });

  const remover = atuais
    .filter(a => !conjuntoExterno.has(normalizarRotulo(a.label)) && descartavel(a, uso))
    .map(a => a.id);

  return { remover, criar, reposicionar, modo: 'adotado' };
}

export { COR as CORES_ETAPA };
