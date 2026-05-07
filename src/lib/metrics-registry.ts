// ─── Types ────────────────────────────────────────────────────────────────────

export type MetricSource = 'meta_ads' | 'google_ads' | 'facebook' | 'instagram' | 'crm';
export type MetricFormat = 'currency' | 'number' | 'percent' | 'times';

export type UnifiedMetric = {
  key: string;
  source: MetricSource;
  group: string;
  label: string;
  shortLabel: string;
  description: string;
  format: MetricFormat;
  color: string;
  mockDailyBase: number;
  mockIsRate: boolean;       // rates (CTR, ROI…) don't scale with time
  hasTimeSeries: boolean;    // false for computed metrics like ROI, CPL
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const ALL_UNIFIED_METRICS: UnifiedMetric[] = [
  // ── Meta Ads ──────────────────────────────────────────────────────────────
  { key: 'meta_spend',            source: 'meta_ads',  group: 'Meta Ads',           label: 'Investimento Meta',           shortLabel: 'Investimento',      description: 'Valor total investido nas contas Meta.',                     format: 'currency', color: '#F59E0B', mockDailyBase: 185,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_reach',            source: 'meta_ads',  group: 'Meta Ads',           label: 'Alcance Meta',                shortLabel: 'Alcance',           description: 'Pessoas únicas que viram ao menos um anúncio.',              format: 'number',  color: '#55F52F', mockDailyBase: 4200,   mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_impressions',      source: 'meta_ads',  group: 'Meta Ads',           label: 'Impressões Meta',             shortLabel: 'Impressões',        description: 'Total de vezes que anúncios foram exibidos.',                format: 'number',  color: '#8B5CF6', mockDailyBase: 7800,   mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_clicks',           source: 'meta_ads',  group: 'Meta Ads',           label: 'Cliques no link (Meta)',      shortLabel: 'Cliques',           description: 'Cliques que levam para fora do Facebook/Instagram.',         format: 'number',  color: '#38BDF8', mockDailyBase: 210,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_ctr',              source: 'meta_ads',  group: 'Meta Ads',           label: 'CTR Meta (%)',               shortLabel: 'CTR',               description: 'Taxa de cliques sobre impressões.',                          format: 'percent', color: '#EC4899', mockDailyBase: 2.68,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'meta_cpc',              source: 'meta_ads',  group: 'Meta Ads',           label: 'CPC Meta',                   shortLabel: 'CPC',               description: 'Custo médio por clique.',                                    format: 'currency',color: '#EF4444', mockDailyBase: 0.88,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'meta_cpm',              source: 'meta_ads',  group: 'Meta Ads',           label: 'CPM Meta',                   shortLabel: 'CPM',               description: 'Custo por mil impressões.',                                  format: 'currency',color: '#FB923C', mockDailyBase: 23.5,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'meta_frequency',        source: 'meta_ads',  group: 'Meta Ads',           label: 'Frequência Meta',            shortLabel: 'Frequência',        description: 'Média de vezes que cada pessoa viu o anúncio.',              format: 'number',  color: '#A3E635', mockDailyBase: 1.8,    mockIsRate: true,  hasTimeSeries: false },
  { key: 'meta_leads',            source: 'meta_ads',  group: 'Meta Ads',           label: 'Leads Meta',                 shortLabel: 'Leads',             description: 'Leads gerados via formulário ou pixel.',                     format: 'number',  color: '#55F52F', mockDailyBase: 12,     mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_cpl',              source: 'meta_ads',  group: 'Meta Ads',           label: 'CPL Meta',                   shortLabel: 'CPL',               description: 'Custo por lead (investimento / leads).',                     format: 'currency',color: '#EF4444', mockDailyBase: 15.4,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'meta_results',          source: 'meta_ads',  group: 'Meta Ads',           label: 'Resultados Meta',            shortLabel: 'Resultados',        description: 'Principal resultado da campanha (objetivo definido).',        format: 'number',  color: '#10B981', mockDailyBase: 14,     mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_cost_per_result',  source: 'meta_ads',  group: 'Meta Ads',           label: 'Custo por resultado (Meta)', shortLabel: 'Custo/Result.',     description: 'Investimento dividido pelo número de resultados.',            format: 'currency',color: '#F97316', mockDailyBase: 13.2,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'meta_messages',         source: 'meta_ads',  group: 'Meta Ads',           label: 'Mensagens iniciadas',        shortLabel: 'Mensagens',         description: 'Conversas iniciadas no WhatsApp/Messenger via anúncio.',     format: 'number',  color: '#0EA5E9', mockDailyBase: 18,     mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_cost_per_message', source: 'meta_ads',  group: 'Meta Ads',           label: 'Custo por mensagem',         shortLabel: 'Custo/Msg',         description: 'Custo por conversa iniciada.',                               format: 'currency',color: '#7DD3FC', mockDailyBase: 10.3,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'meta_video_views',      source: 'meta_ads',  group: 'Meta Ads',           label: 'Reproduções de vídeo',       shortLabel: 'Vídeos',            description: 'Reproduções de vídeo por 3 segundos ou mais.',               format: 'number',  color: '#C084FC', mockDailyBase: 520,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_cpv',              source: 'meta_ads',  group: 'Meta Ads',           label: 'Custo por visualização',     shortLabel: 'CPV',               description: 'Custo por reprodução de vídeo.',                             format: 'currency',color: '#A855F7', mockDailyBase: 0.36,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'meta_engagement',       source: 'meta_ads',  group: 'Meta Ads',           label: 'Engajamento total',          shortLabel: 'Engajamento',       description: 'Soma de curtidas, comentários, compartilhamentos e cliques.', format: 'number',  color: '#F472B6', mockDailyBase: 340,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_reactions',        source: 'meta_ads',  group: 'Meta Ads',           label: 'Reações aos posts',          shortLabel: 'Reações',           description: 'Curtidas, amores, haha, uau, triste, grr.',                  format: 'number',  color: '#FB7185', mockDailyBase: 95,     mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_comments',         source: 'meta_ads',  group: 'Meta Ads',           label: 'Comentários (Meta)',         shortLabel: 'Comentários',       description: 'Total de comentários nos anúncios.',                         format: 'number',  color: '#FCA5A5', mockDailyBase: 22,     mockIsRate: false, hasTimeSeries: true  },
  { key: 'meta_shares',           source: 'meta_ads',  group: 'Meta Ads',           label: 'Compartilhamentos',          shortLabel: 'Shares',            description: 'Total de compartilhamentos dos anúncios.',                   format: 'number',  color: '#FDBA74', mockDailyBase: 11,     mockIsRate: false, hasTimeSeries: true  },

  // ── Google Ads ────────────────────────────────────────────────────────────
  { key: 'google_spend',          source: 'google_ads',group: 'Google Ads',         label: 'Investimento Google',        shortLabel: 'Investimento',      description: 'Valor total investido nas contas Google Ads.',               format: 'currency',color: '#7B2CFF', mockDailyBase: 160,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'google_impressions',    source: 'google_ads',group: 'Google Ads',         label: 'Impressões Google',          shortLabel: 'Impressões',        description: 'Total de impressões no Google Ads.',                         format: 'number',  color: '#4285F4', mockDailyBase: 5200,   mockIsRate: false, hasTimeSeries: true  },
  { key: 'google_clicks',         source: 'google_ads',group: 'Google Ads',         label: 'Cliques Google',             shortLabel: 'Cliques',           description: 'Total de cliques nas campanhas Google.',                     format: 'number',  color: '#34A853', mockDailyBase: 280,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'google_ctr',            source: 'google_ads',group: 'Google Ads',         label: 'CTR Google (%)',             shortLabel: 'CTR',               description: 'Taxa de cliques sobre impressões no Google.',                format: 'percent', color: '#FBBC05', mockDailyBase: 5.38,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'google_cpc',            source: 'google_ads',group: 'Google Ads',         label: 'CPC Google',                 shortLabel: 'CPC',               description: 'Custo médio por clique no Google Ads.',                      format: 'currency',color: '#EA4335', mockDailyBase: 0.57,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'google_cpm',            source: 'google_ads',group: 'Google Ads',         label: 'CPM Google',                 shortLabel: 'CPM',               description: 'Custo por mil impressões no Google.',                        format: 'currency',color: '#9333EA', mockDailyBase: 30.8,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'google_conversions',    source: 'google_ads',group: 'Google Ads',         label: 'Conversões Google',          shortLabel: 'Conversões',        description: 'Ações de conversão registradas no Google Ads.',              format: 'number',  color: '#34A853', mockDailyBase: 9,      mockIsRate: false, hasTimeSeries: true  },
  { key: 'google_conv_rate',      source: 'google_ads',group: 'Google Ads',         label: 'Taxa de conversão Google',   shortLabel: 'Conv. %',           description: 'Percentual de cliques que geraram conversão.',               format: 'percent', color: '#22C55E', mockDailyBase: 3.2,    mockIsRate: true,  hasTimeSeries: false },
  { key: 'google_cost_per_conv',  source: 'google_ads',group: 'Google Ads',         label: 'Custo por conversão',        shortLabel: 'CPA',               description: 'Investimento dividido por conversões.',                      format: 'currency',color: '#16A34A', mockDailyBase: 17.8,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'google_roas',           source: 'google_ads',group: 'Google Ads',         label: 'ROAS Google',                shortLabel: 'ROAS',              description: 'Retorno sobre o investimento em anúncios.',                  format: 'times',   color: '#FCD34D', mockDailyBase: 3.4,    mockIsRate: true,  hasTimeSeries: false },
  { key: 'google_video_views',    source: 'google_ads',group: 'Google Ads',         label: 'Visualizações de vídeo',     shortLabel: 'Vídeos',            description: 'Views em campanhas de vídeo no YouTube/Display.',            format: 'number',  color: '#E879F9', mockDailyBase: 380,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'google_view_rate',      source: 'google_ads',group: 'Google Ads',         label: 'Taxa de visualização',       shortLabel: 'View Rate',         description: 'Percentual de impressões de vídeo que viraram view.',        format: 'percent', color: '#D946EF', mockDailyBase: 32.5,   mockIsRate: true,  hasTimeSeries: false },

  // ── Facebook Insights ────────────────────────────────────────────────────
  { key: 'fb_page_reach',         source: 'facebook',  group: 'Facebook Insights',  label: 'Alcance da página',          shortLabel: 'Alcance',           description: 'Pessoas que viram qualquer conteúdo da página.',             format: 'number',  color: '#1877F2', mockDailyBase: 2100,   mockIsRate: false, hasTimeSeries: true  },
  { key: 'fb_page_impressions',   source: 'facebook',  group: 'Facebook Insights',  label: 'Impressões da página',       shortLabel: 'Impressões',        description: 'Vezes que qualquer conteúdo da página foi exibido.',         format: 'number',  color: '#3B82F6', mockDailyBase: 3400,   mockIsRate: false, hasTimeSeries: true  },
  { key: 'fb_post_engagement',    source: 'facebook',  group: 'Facebook Insights',  label: 'Engajamento com posts',      shortLabel: 'Engajamento',       description: 'Curtidas, comentários e shares em posts orgânicos.',         format: 'number',  color: '#2563EB', mockDailyBase: 180,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'fb_page_followers',     source: 'facebook',  group: 'Facebook Insights',  label: 'Seguidores da página',       shortLabel: 'Seguidores',        description: 'Total acumulado de seguidores/curtidas na página.',           format: 'number',  color: '#1D4ED8', mockDailyBase: 12400,  mockIsRate: true,  hasTimeSeries: false },
  { key: 'fb_new_followers',      source: 'facebook',  group: 'Facebook Insights',  label: 'Novos seguidores (FB)',      shortLabel: 'Novos Seg.',        description: 'Seguidores ganhos no período.',                               format: 'number',  color: '#60A5FA', mockDailyBase: 18,     mockIsRate: false, hasTimeSeries: true  },
  { key: 'fb_organic_reach',      source: 'facebook',  group: 'Facebook Insights',  label: 'Alcance orgânico',           shortLabel: 'Orgânico',          description: 'Alcance de posts sem impulsionamento.',                      format: 'number',  color: '#93C5FD', mockDailyBase: 820,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'fb_paid_reach',         source: 'facebook',  group: 'Facebook Insights',  label: 'Alcance pago (FB)',          shortLabel: 'Pago',              description: 'Alcance gerado por posts impulsionados.',                    format: 'number',  color: '#BFDBFE', mockDailyBase: 1280,   mockIsRate: false, hasTimeSeries: true  },
  { key: 'fb_page_views',         source: 'facebook',  group: 'Facebook Insights',  label: 'Visitas à página (FB)',      shortLabel: 'Visitas',           description: 'Visualizações do perfil da página no Facebook.',             format: 'number',  color: '#DBEAFE', mockDailyBase: 310,    mockIsRate: false, hasTimeSeries: true  },

  // ── Instagram Insights ───────────────────────────────────────────────────
  { key: 'ig_reach',              source: 'instagram', group: 'Instagram Insights', label: 'Alcance Instagram',          shortLabel: 'Alcance',           description: 'Contas únicas que viram qualquer conteúdo.',                 format: 'number',  color: '#E1306C', mockDailyBase: 1800,   mockIsRate: false, hasTimeSeries: true  },
  { key: 'ig_impressions',        source: 'instagram', group: 'Instagram Insights', label: 'Impressões Instagram',       shortLabel: 'Impressões',        description: 'Total de vezes que conteúdos foram exibidos.',               format: 'number',  color: '#C13584', mockDailyBase: 3200,   mockIsRate: false, hasTimeSeries: true  },
  { key: 'ig_engagement',         source: 'instagram', group: 'Instagram Insights', label: 'Engajamento Instagram',      shortLabel: 'Engajamento',       description: 'Curtidas, comentários, saves e shares.',                     format: 'number',  color: '#833AB4', mockDailyBase: 220,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'ig_followers',          source: 'instagram', group: 'Instagram Insights', label: 'Seguidores Instagram',       shortLabel: 'Seguidores',        description: 'Total acumulado de seguidores no perfil.',                   format: 'number',  color: '#405DE6', mockDailyBase: 8700,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'ig_new_followers',      source: 'instagram', group: 'Instagram Insights', label: 'Novos seguidores (IG)',      shortLabel: 'Novos Seg.',        description: 'Seguidores conquistados no período.',                        format: 'number',  color: '#5851DB', mockDailyBase: 24,     mockIsRate: false, hasTimeSeries: true  },
  { key: 'ig_profile_visits',     source: 'instagram', group: 'Instagram Insights', label: 'Visitas ao perfil',          shortLabel: 'Visitas',           description: 'Acessos ao perfil do Instagram.',                            format: 'number',  color: '#833AB4', mockDailyBase: 190,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'ig_website_clicks',     source: 'instagram', group: 'Instagram Insights', label: 'Cliques no link da bio',     shortLabel: 'Link Bio',          description: 'Cliques no site/link da bio do perfil.',                     format: 'number',  color: '#E1306C', mockDailyBase: 45,     mockIsRate: false, hasTimeSeries: true  },
  { key: 'ig_reel_plays',         source: 'instagram', group: 'Instagram Insights', label: 'Plays de Reels',             shortLabel: 'Reels',             description: 'Reproduções de Reels no período.',                           format: 'number',  color: '#F77737', mockDailyBase: 1400,   mockIsRate: false, hasTimeSeries: true  },
  { key: 'ig_story_reach',        source: 'instagram', group: 'Instagram Insights', label: 'Alcance dos Stories',        shortLabel: 'Stories Alcance',   description: 'Contas únicas que viram pelo menos um Story.',               format: 'number',  color: '#FCAF45', mockDailyBase: 620,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'ig_story_impressions',  source: 'instagram', group: 'Instagram Insights', label: 'Impressões dos Stories',     shortLabel: 'Stories Impr.',     description: 'Exibições totais dos Stories.',                              format: 'number',  color: '#FFDC80', mockDailyBase: 850,    mockIsRate: false, hasTimeSeries: true  },
  { key: 'ig_saves',              source: 'instagram', group: 'Instagram Insights', label: 'Salvamentos',                shortLabel: 'Saves',             description: 'Posts salvos pelos usuários.',                               format: 'number',  color: '#C13584', mockDailyBase: 38,     mockIsRate: false, hasTimeSeries: true  },

  // ── CRM / Resultados ─────────────────────────────────────────────────────
  { key: 'crm_leads',             source: 'crm',       group: 'CRM',                label: 'Leads capturados',           shortLabel: 'Leads',             description: 'Total de leads recebidos no CRM.',                           format: 'number',  color: '#55F52F', mockDailyBase: 15,     mockIsRate: false, hasTimeSeries: true  },
  { key: 'crm_qualified',         source: 'crm',       group: 'CRM',                label: 'Leads qualificados',         shortLabel: 'Qualificados',      description: 'Leads avaliados como potenciais compradores.',               format: 'number',  color: '#7B2CFF', mockDailyBase: 9,      mockIsRate: false, hasTimeSeries: true  },
  { key: 'crm_appointments',      source: 'crm',       group: 'CRM',                label: 'Agendamentos',               shortLabel: 'Agendamentos',      description: 'Visitas ou consultas agendadas.',                            format: 'number',  color: '#3B82F6', mockDailyBase: 6,      mockIsRate: false, hasTimeSeries: true  },
  { key: 'crm_sales',             source: 'crm',       group: 'CRM',                label: 'Vendas / Matrículas',        shortLabel: 'Vendas',            description: 'Conversões efetivadas (vendas ou matrículas).',              format: 'number',  color: '#10B981', mockDailyBase: 2,      mockIsRate: false, hasTimeSeries: true  },
  { key: 'crm_revenue',           source: 'crm',       group: 'CRM',                label: 'Receita',                    shortLabel: 'Receita',           description: 'Faturamento gerado no período.',                             format: 'currency',color: '#22D3EE', mockDailyBase: 4200,   mockIsRate: false, hasTimeSeries: true  },
  { key: 'crm_conv_rate',         source: 'crm',       group: 'CRM',                label: 'Taxa de conversão',          shortLabel: 'Conv. %',           description: 'Percentual de leads qualificados que viraram vendas.',       format: 'percent', color: '#F97316', mockDailyBase: 22,     mockIsRate: true,  hasTimeSeries: false },
  { key: 'crm_roi',               source: 'crm',       group: 'CRM',                label: 'ROI',                        shortLabel: 'ROI',               description: 'Retorno sobre o investimento total em mídia.',               format: 'times',   color: '#FCD34D', mockDailyBase: 3.1,    mockIsRate: true,  hasTimeSeries: false },
  { key: 'crm_ticket',            source: 'crm',       group: 'CRM',                label: 'Ticket médio',               shortLabel: 'Ticket',            description: 'Valor médio por venda.',                                     format: 'currency',color: '#A78BFA', mockDailyBase: 2100,   mockIsRate: true,  hasTimeSeries: false },
  { key: 'crm_leads_mg',          source: 'crm',       group: 'CRM — Cidades',      label: 'Leads — Maringá',            shortLabel: 'Maringá',           description: 'Leads originados de Maringá.',                               format: 'number',  color: '#F472B6', mockDailyBase: 7,      mockIsRate: false, hasTimeSeries: true  },
  { key: 'crm_leads_ld',          source: 'crm',       group: 'CRM — Cidades',      label: 'Leads — Londrina',           shortLabel: 'Londrina',          description: 'Leads originados de Londrina.',                              format: 'number',  color: '#FB923C', mockDailyBase: 5,      mockIsRate: false, hasTimeSeries: true  },
  { key: 'crm_leads_other',       source: 'crm',       group: 'CRM — Cidades',      label: 'Leads — Outras cidades',     shortLabel: 'Outras',            description: 'Leads de outras regiões.',                                   format: 'number',  color: '#A3E635', mockDailyBase: 3,      mockIsRate: false, hasTimeSeries: true  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export const METRIC_BY_KEY: Record<string, UnifiedMetric> =
  Object.fromEntries(ALL_UNIFIED_METRICS.map((m) => [m.key, m]));

export const METRIC_GROUPS: string[] = Array.from(
  new Set(ALL_UNIFIED_METRICS.map((m) => m.group))
);

export const SOURCE_LABELS: Record<MetricSource, string> = {
  meta_ads:  'Meta Ads',
  google_ads:'Google Ads',
  facebook:  'Facebook Insights',
  instagram: 'Instagram Insights',
  crm:       'CRM / Resultados',
};

export const SOURCE_COLORS: Record<MetricSource, string> = {
  meta_ads:  '#0668E1',
  google_ads:'#7B2CFF',
  facebook:  '#1877F2',
  instagram: '#E1306C',
  crm:       '#10B981',
};

// ─── Format helper ────────────────────────────────────────────────────────────

export function formatMetricValue(value: number, format: MetricFormat, currency = 'BRL'): string {
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
    case 'percent':
      return value.toFixed(2) + '%';
    case 'times':
      return value.toFixed(1) + 'x';
    default:
      return value >= 1000
        ? new Intl.NumberFormat('pt-BR').format(Math.round(value))
        : String(Math.round(value));
  }
}

// ─── Mock data generation ─────────────────────────────────────────────────────

const PERIOD_LABELS = {
  '7d':  ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
  '30d': ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'],
  '90d': ['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12','S13'],
} as const;

const PERIOD_DAYS = { '7d': 1, '30d': 7, '90d': 7 } as const;

function pseudoRand(metricKey: string, pointIndex: number): number {
  const seed = metricKey.split('').reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1), 0);
  const v = Math.sin(seed * 9301 + pointIndex * 49297 + 233720) * 10000;
  return v - Math.floor(v);
}

export type MockPoint = { label: string; [key: string]: number | string };

export function generateMockSeries(period: keyof typeof PERIOD_LABELS): MockPoint[] {
  const labels = PERIOD_LABELS[period];
  const daysPerPoint = PERIOD_DAYS[period];

  return labels.map((label, i) => {
    const point: MockPoint = { label };
    for (const m of ALL_UNIFIED_METRICS) {
      if (!m.hasTimeSeries) {
        point[m.key] = m.mockIsRate ? m.mockDailyBase * (0.92 + pseudoRand(m.key, i) * 0.16) : 0;
      } else {
        const rand = 0.7 + pseudoRand(m.key, i) * 0.6;
        const raw = m.mockDailyBase * daysPerPoint * rand;
        point[m.key] = m.format === 'currency' ? Math.round(raw * 100) / 100 : Math.round(raw);
      }
    }
    return point;
  });
}

export function computeMockKpi(metric: UnifiedMetric, data: MockPoint[]): number {
  const n = (p: MockPoint, key: string) => Number(p[key] ?? 0);
  const sum = (key: string) => data.reduce((s, p) => s + n(p, key), 0);

  if (metric.key === 'meta_cpl') {
    const spend = sum('meta_spend'); const leads = sum('meta_leads');
    return leads > 0 ? spend / leads : 0;
  }
  if (metric.key === 'meta_cost_per_result') {
    const spend = sum('meta_spend'); const results = sum('meta_results');
    return results > 0 ? spend / results : 0;
  }
  if (metric.key === 'meta_cost_per_message') {
    const spend = sum('meta_spend'); const msgs = sum('meta_messages');
    return msgs > 0 ? spend / msgs : 0;
  }
  if (metric.key === 'meta_cpv') {
    const spend = sum('meta_spend'); const views = sum('meta_video_views');
    return views > 0 ? spend / views : 0;
  }
  if (metric.key === 'google_cost_per_conv') {
    const spend = sum('google_spend'); const conv = sum('google_conversions');
    return conv > 0 ? spend / conv : 0;
  }
  if (metric.key === 'google_roas') {
    const spend = sum('google_spend'); const rev = sum('crm_revenue');
    return spend > 0 ? rev / spend : 0;
  }
  if (metric.key === 'crm_roi') {
    const spend = sum('meta_spend') + sum('google_spend'); const rev = sum('crm_revenue');
    return spend > 0 ? rev / spend : 0;
  }
  if (metric.key === 'crm_conv_rate') {
    const qual = sum('crm_qualified'); const sales = sum('crm_sales');
    return qual > 0 ? (sales / qual) * 100 : 0;
  }
  if (metric.key === 'crm_ticket') {
    const rev = sum('crm_revenue'); const sales = sum('crm_sales');
    return sales > 0 ? rev / sales : 0;
  }
  if (metric.key === 'google_conv_rate') {
    const clicks = sum('google_clicks'); const conv = sum('google_conversions');
    return clicks > 0 ? (conv / clicks) * 100 : 0;
  }

  // Rates: use last point value (represents a snapshot)
  if (metric.mockIsRate) {
    return data.length > 0 ? n(data[data.length - 1], metric.key) || metric.mockDailyBase : metric.mockDailyBase;
  }

  // Accumulable metrics: sum all points
  return sum(metric.key);
}
