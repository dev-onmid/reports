import { ALL_UNIFIED_METRICS } from './metrics-registry';
import type { DashBlock, VizType, BlockSize } from '@/components/builder/types';

type BlockDef = {
  metricKeys: string[];
  vizType: VizType;
  size: BlockSize;
  meta?: number | null;
};

const DEFS: BlockDef[] = [
  // ── Meta Ads ────────────────────────────────────────────────────────────────
  { metricKeys: ['meta_leads'],                           vizType: 'area',     size: 2 },
  { metricKeys: ['meta_spend'],                           vizType: 'area',     size: 2 },
  { metricKeys: ['meta_leads'],                           vizType: 'box-meta', size: 1 },
  { metricKeys: ['meta_cpl'],                             vizType: 'box-meta', size: 1, meta: 30 },
  { metricKeys: ['meta_results'],                         vizType: 'box-meta', size: 1 },
  { metricKeys: ['meta_cost_per_result'],                 vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_spend'],                           vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_reach'],                           vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_impressions'],                     vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_clicks'],                          vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_ctr'],                             vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_cpc'],                             vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_cpm'],                             vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_frequency'],                       vizType: 'gauge',    size: 1 },
  { metricKeys: ['meta_messages'],                        vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_cost_per_message'],                vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_video_views'],                     vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_cpv'],                             vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_engagement'],                      vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_reactions'],                       vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_comments'],                        vizType: 'kpi',      size: 1 },
  { metricKeys: ['meta_shares'],                          vizType: 'kpi',      size: 1 },

  // ── Google Ads ───────────────────────────────────────────────────────────────
  { metricKeys: ['google_conversions'],                   vizType: 'area',     size: 2 },
  { metricKeys: ['google_spend'],                         vizType: 'area',     size: 2 },
  { metricKeys: ['google_conversions'],                   vizType: 'box-meta', size: 1 },
  { metricKeys: ['google_cost_per_conv'],                 vizType: 'kpi',      size: 1 },
  { metricKeys: ['google_roas'],                          vizType: 'gauge',    size: 1 },
  { metricKeys: ['google_conv_rate'],                     vizType: 'gauge',    size: 1 },
  { metricKeys: ['google_spend'],                         vizType: 'kpi',      size: 1 },
  { metricKeys: ['google_impressions'],                   vizType: 'kpi',      size: 1 },
  { metricKeys: ['google_clicks'],                        vizType: 'kpi',      size: 1 },
  { metricKeys: ['google_ctr'],                           vizType: 'kpi',      size: 1 },
  { metricKeys: ['google_cpc'],                           vizType: 'kpi',      size: 1 },
  { metricKeys: ['google_cpm'],                           vizType: 'kpi',      size: 1 },
  { metricKeys: ['google_video_views'],                   vizType: 'kpi',      size: 1 },
  { metricKeys: ['google_view_rate'],                     vizType: 'kpi',      size: 1 },

  // ── Facebook Insights ────────────────────────────────────────────────────────
  { metricKeys: ['fb_page_reach'],                        vizType: 'area',     size: 2 },
  { metricKeys: ['fb_post_engagement'],                   vizType: 'area',     size: 2 },
  { metricKeys: ['fb_page_followers'],                    vizType: 'kpi',      size: 1 },
  { metricKeys: ['fb_new_followers'],                     vizType: 'kpi',      size: 1 },
  { metricKeys: ['fb_page_reach'],                        vizType: 'kpi',      size: 1 },
  { metricKeys: ['fb_page_impressions'],                  vizType: 'kpi',      size: 1 },
  { metricKeys: ['fb_post_engagement'],                   vizType: 'kpi',      size: 1 },
  { metricKeys: ['fb_organic_reach'],                     vizType: 'kpi',      size: 1 },
  { metricKeys: ['fb_paid_reach'],                        vizType: 'kpi',      size: 1 },
  { metricKeys: ['fb_page_views'],                        vizType: 'kpi',      size: 1 },

  // ── Instagram Insights ───────────────────────────────────────────────────────
  { metricKeys: ['ig_reach'],                             vizType: 'area',     size: 2 },
  { metricKeys: ['ig_reel_plays'],                        vizType: 'area',     size: 2 },
  { metricKeys: ['ig_followers'],                         vizType: 'kpi',      size: 1 },
  { metricKeys: ['ig_new_followers'],                     vizType: 'kpi',      size: 1 },
  { metricKeys: ['ig_reach'],                             vizType: 'kpi',      size: 1 },
  { metricKeys: ['ig_impressions'],                       vizType: 'kpi',      size: 1 },
  { metricKeys: ['ig_engagement'],                        vizType: 'kpi',      size: 1 },
  { metricKeys: ['ig_profile_visits'],                    vizType: 'kpi',      size: 1 },
  { metricKeys: ['ig_website_clicks'],                    vizType: 'kpi',      size: 1 },
  { metricKeys: ['ig_reel_plays'],                        vizType: 'kpi',      size: 1 },
  { metricKeys: ['ig_story_reach'],                       vizType: 'kpi',      size: 1 },
  { metricKeys: ['ig_story_impressions'],                 vizType: 'kpi',      size: 1 },
  { metricKeys: ['ig_saves'],                             vizType: 'kpi',      size: 1 },

  // ── CRM / Resultados ─────────────────────────────────────────────────────────
  { metricKeys: ['crm_leads', 'crm_qualified', 'crm_appointments', 'crm_sales'], vizType: 'bar', size: 4 },
  { metricKeys: ['crm_leads'],                            vizType: 'box-meta', size: 1 },
  { metricKeys: ['crm_sales'],                            vizType: 'box-meta', size: 1 },
  { metricKeys: ['crm_conv_rate'],                        vizType: 'gauge',    size: 1 },
  { metricKeys: ['crm_roi'],                              vizType: 'gauge',    size: 1 },
  { metricKeys: ['crm_qualified'],                        vizType: 'kpi',      size: 1 },
  { metricKeys: ['crm_appointments'],                     vizType: 'kpi',      size: 1 },
  { metricKeys: ['crm_revenue'],                          vizType: 'kpi',      size: 1 },
  { metricKeys: ['crm_ticket'],                           vizType: 'kpi',      size: 1 },
  { metricKeys: ['crm_leads_mg'],                         vizType: 'kpi',      size: 1 },
  { metricKeys: ['crm_leads_ld'],                         vizType: 'kpi',      size: 1 },
  { metricKeys: ['crm_leads_other'],                      vizType: 'kpi',      size: 1 },
];

export function buildDefaultDashboard(): DashBlock[] {
  return DEFS.map((def, i) => ({
    id: `default_${i}`,
    metricKeys: def.metricKeys,
    vizType: def.vizType,
    size: def.size,
    level: 'conta' as const,
    comparativo: 'none' as const,
    meta: def.meta ?? null,
    position: i,
  }));
}
