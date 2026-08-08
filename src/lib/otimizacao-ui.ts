// Helpers client-safe do Histórico de Otimizações (padrão optimizer-ui.ts:
// nenhum import de servidor — a página, o modal e os testes compartilham daqui).

export type CanalOtimizacao = 'meta' | 'google' | 'outro';

export const CANAIS_OTIMIZACAO: { id: CanalOtimizacao; label: string }[] = [
  { id: 'meta',   label: 'Meta Ads' },
  { id: 'google', label: 'Google Ads' },
  { id: 'outro',  label: 'Outro' },
];

export function canalLabel(canal: string, detalhe?: string | null): string {
  if (canal === 'meta') return 'Meta Ads';
  if (canal === 'google') return 'Google Ads';
  return detalhe?.trim() || 'Outro canal';
}

// Catálogo dos tipos de ação (chips do modal de registro). A `descricao` carrega
// o detalhe e a justificativa; os chips existem pra escanear o histórico sem ler
// tudo — e pra outro gestor achar rápido "quando mexeram em público/orçamento".
export const ACOES_OTIMIZACAO: { id: string; label: string }[] = [
  { id: 'publico',          label: 'Público/segmentação' },
  { id: 'criativos_novos',  label: 'Novos criativos' },
  { id: 'criativo_pausado', label: 'Criativo pausado' },
  { id: 'orcamento',        label: 'Orçamento' },
  { id: 'lance',            label: 'Lance/estratégia' },
  { id: 'objetivo',         label: 'Objetivo alterado' },
  { id: 'campanha_nova',    label: 'Campanha nova' },
  { id: 'campanha_pausada', label: 'Campanha pausada' },
  { id: 'copy',             label: 'Copy/texto' },
  { id: 'keywords',         label: 'Palavras-chave' },
  { id: 'analise',          label: 'Só análise (sem mudança)' },
  { id: 'outro',            label: 'Outro' },
];

export function acaoLabel(id: string): string {
  return ACOES_OTIMIZACAO.find((a) => a.id === id)?.label ?? id;
}

/** Régua aplicada quando o cliente não tem programação própria cadastrada. */
export const FREQ_PADRAO_DIAS = 7;

export type EstadoOtimizacao = 'atrasado' | 'sem_registro' | 'vence_hoje' | 'em_dia';

export type StatusOtimizacao = {
  estado: EstadoOtimizacao;
  /** Dias de calendário desde o último registro (null = nunca registrou). */
  diasDesde: number | null;
  /** Dias além do prazo combinado (0 quando não está atrasado). */
  diasAtraso: number;
};

/**
 * Dias de CALENDÁRIO entre `iso` e agora (relógio do browser — o time opera em
 * BRT). Calendário, não 24h corridas: otimizou ontem à noite = "há 1 dia".
 */
export function diasDesde(iso: string | null | undefined, agora: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return null;
  const a = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.max(0, Math.round((a - b) / 86400000));
}

export function statusOtimizacao(
  lastAt: string | null | undefined,
  freqDias: number,
  agora: Date = new Date(),
): StatusOtimizacao {
  const freq = Math.max(1, Math.floor(freqDias) || FREQ_PADRAO_DIAS);
  const dias = diasDesde(lastAt, agora);
  if (dias === null) return { estado: 'sem_registro', diasDesde: null, diasAtraso: 0 };
  if (dias > freq) return { estado: 'atrasado', diasDesde: dias, diasAtraso: dias - freq };
  if (dias === freq) return { estado: 'vence_hoje', diasDesde: dias, diasAtraso: 0 };
  return { estado: 'em_dia', diasDesde: dias, diasAtraso: 0 };
}

/**
 * Pior estado ganha — ordena a lista e pinta a linha do cliente. "Nunca
 * registrado" fica acima de "vence hoje" de propósito: conta sem histórico
 * nenhum é justamente a que outro gestor não consegue assumir.
 */
export const PESO_ESTADO: Record<EstadoOtimizacao, number> = {
  atrasado: 3,
  sem_registro: 2,
  vence_hoje: 1,
  em_dia: 0,
};

export function piorEstado(estados: EstadoOtimizacao[]): EstadoOtimizacao {
  let pior: EstadoOtimizacao = 'em_dia';
  for (const e of estados) if (PESO_ESTADO[e] > PESO_ESTADO[pior]) pior = e;
  return pior;
}
