import type { DashBlock } from './types';

export type Template = {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  tags: string[];
  color: string;
  blocks: Omit<DashBlock, 'id'>[];
};

function makeBlocks(defs: Omit<DashBlock, 'id'>[]): Omit<DashBlock, 'id'>[] {
  return defs.map((b, i) => ({ ...b, position: i }));
}

export const TEMPLATES: Template[] = [
  // ── Branding ────────────────────────────────────────────────────────────────
  {
    id: 'branding-meta-fb-ig',
    name: 'Branding',
    subtitle: 'Meta · Facebook · Instagram',
    description: 'Alcance, impressões, engajamento e crescimento de seguidores nas três plataformas.',
    tags: ['Meta Ads', 'Facebook', 'Instagram'],
    color: '#E1306C',
    blocks: makeBlocks([
      { metricKeys: ['meta_reach'],        vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_impressions'],  vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_frequency'],    vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_engagement'],   vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_reach'],        vizType: 'area',     size: 2, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['ig_reach', 'fb_page_reach'], vizType: 'line', size: 2, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['ig_followers'],      vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['ig_new_followers'],  vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['fb_page_followers'], vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['fb_new_followers'],  vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['ig_engagement', 'fb_post_engagement'], vizType: 'bar', size: 2, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['ig_reel_plays', 'ig_story_reach'],     vizType: 'bar', size: 2, level: 'conta', comparativo: 'none', meta: null },
    ]),
  },

  // ── Leads Meta ──────────────────────────────────────────────────────────────
  {
    id: 'leads-meta',
    name: 'Leads',
    subtitle: 'Meta',
    description: 'Geração de leads via Meta Ads: volume, custo e eficiência das campanhas.',
    tags: ['Meta Ads'],
    color: '#0668E1',
    blocks: makeBlocks([
      { metricKeys: ['meta_leads'],       vizType: 'box-meta', size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_cpl'],         vizType: 'box-meta', size: 1, level: 'conta', comparativo: 'none', meta: 30 },
      { metricKeys: ['meta_spend'],       vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_results'],     vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_leads'],       vizType: 'area',     size: 4, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_reach'],       vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_impressions'], vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_ctr'],         vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_cpc'],         vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
    ]),
  },

  // ── Leads Meta + Google ─────────────────────────────────────────────────────
  {
    id: 'leads-meta-google',
    name: 'Leads',
    subtitle: 'Meta + Google',
    description: 'Leads e conversões comparados entre Meta Ads e Google Ads em uma visão unificada.',
    tags: ['Meta Ads', 'Google Ads'],
    color: '#7B2CFF',
    blocks: makeBlocks([
      { metricKeys: ['meta_leads'],          vizType: 'box-meta', size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_cpl'],            vizType: 'box-meta', size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['google_conversions'],  vizType: 'box-meta', size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['google_cost_per_conv'],vizType: 'box-meta', size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_leads', 'google_conversions'], vizType: 'bar', size: 4, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_spend'],          vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['google_spend'],        vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_spend', 'google_spend'], vizType: 'pizza', size: 2, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_ctr'],            vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['google_ctr'],          vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
    ]),
  },

  // ── Conversão / Venda Online Meta ────────────────────────────────────────────
  {
    id: 'conversao-meta',
    name: 'Conversão / Venda Online',
    subtitle: 'Meta',
    description: 'Resultados, mensagens iniciadas e custo por conversão focados em vendas pelo Meta.',
    tags: ['Meta Ads'],
    color: '#10B981',
    blocks: makeBlocks([
      { metricKeys: ['meta_results'],          vizType: 'box-meta', size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_cost_per_result'],  vizType: 'box-meta', size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_messages'],         vizType: 'box-meta', size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_cost_per_message'], vizType: 'box-meta', size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_results', 'meta_messages'], vizType: 'line', size: 4, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_spend'],            vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_reach'],            vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_ctr'],              vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
      { metricKeys: ['meta_cpc'],              vizType: 'kpi',      size: 1, level: 'conta', comparativo: 'none', meta: null },
    ]),
  },
];
