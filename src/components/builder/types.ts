import type { UnifiedMetric } from '@/lib/metrics-registry';

// ── Core types ─────────────────────────────────────────────────────────────────

export type VizType =
  | 'kpi' | 'box-meta' | 'bar' | 'line' | 'area'
  | 'barra-horizontal' | 'pizza' | 'donut' | 'gauge' | 'tabela';

export type Level       = 'conta' | 'campanha' | 'conjunto';
export type Comparativo = 'mes-anterior' | 'mesmo-periodo' | 'none';
export type BlockSize   = 1 | 2 | 3 | 4; // colunas no grid de 4

export type DashBlock = {
  id:          string;
  metricKeys:  string[];
  vizType:     VizType;
  size:        BlockSize;
  level:       Level;
  comparativo: Comparativo;
  meta:        number | null;
  position:    number;
  customTitle?: string;
};

// ── Labels ─────────────────────────────────────────────────────────────────────

export const VIZ_LABELS: Record<VizType, string> = {
  kpi:               'Número',
  'box-meta':        'Progresso',
  bar:               'Barras',
  line:              'Linha',
  area:              'Área',
  'barra-horizontal':'Barras H',
  pizza:             'Pizza',
  donut:             'Donut',
  gauge:             'Gauge',
  tabela:            'Tabela',
};

export const LEVEL_LABELS: Record<Level, string> = {
  conta:    'Conta',
  campanha: 'Campanha',
  conjunto: 'Conjunto',
};

export const COMP_LABELS: Record<Comparativo, string> = {
  'mes-anterior':   'Mês anterior',
  'mesmo-periodo':  'Mesmo período a.a.',
  none:             'Sem comparativo',
};

// ── Default viz por métrica ────────────────────────────────────────────────────

const VIZ_DEFAULTS: Partial<Record<string, VizType>> = {
  meta_frequency:    'gauge',
  meta_ctr:          'kpi',
  meta_cpl:          'box-meta',
  meta_leads:        'box-meta',
  meta_results:      'box-meta',
  google_ctr:        'kpi',
  google_conv_rate:  'gauge',
  google_roas:       'gauge',
  google_cost_per_conv: 'kpi',
  crm_conv_rate:     'gauge',
  crm_roi:           'gauge',
  crm_leads:         'box-meta',
  crm_sales:         'box-meta',
};

export function getDefaultViz(metric: UnifiedMetric): VizType {
  return VIZ_DEFAULTS[metric.key] ?? 'kpi';
}

// ── Compatibilidade nível × tipo de viz ───────────────────────────────────────

const LEVEL_VIZ: Record<Level, VizType[]> = {
  conta:    ['kpi','box-meta','bar','line','area','barra-horizontal','pizza','donut','gauge','tabela'],
  campanha: ['kpi','box-meta','bar','line','barra-horizontal','tabela'],
  conjunto: ['kpi','box-meta','barra-horizontal','tabela'],
};

function metricCompatViz(m: UnifiedMetric): VizType[] {
  if (m.mockIsRate)     return ['kpi','box-meta','gauge','line'];
  if (m.hasTimeSeries)  return ['kpi','box-meta','bar','line','area','barra-horizontal'];
  return ['kpi','box-meta'];
}

export function getCompatViz(metrics: UnifiedMetric[], level: Level): VizType[] {
  const levelAllowed = new Set(LEVEL_VIZ[level]);
  if (metrics.length > 1 && level === 'conta') {
    levelAllowed.add('pizza');
    levelAllowed.add('donut');
  }
  if (metrics.length === 0) return Array.from(levelAllowed);
  const metricSets = metrics.map(m => new Set(metricCompatViz(m)));
  const compat = Array.from(levelAllowed).filter(v => metricSets.every(s => s.has(v as VizType)));
  return compat.length > 0 ? compat as VizType[] : ['kpi', 'box-meta'];
}

// ── Tamanho padrão ao dropar da biblioteca ────────────────────────────────────

export function getDefaultSize(metric: UnifiedMetric, viz: VizType): BlockSize {
  if (viz === 'tabela' || viz === 'pizza' || viz === 'donut') return 3;
  if (metric.mockIsRate || viz === 'kpi' || viz === 'gauge')  return 1;
  return 2;
}
