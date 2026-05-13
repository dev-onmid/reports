// ─── Raw data types (kept for backwards compat) ───────────────────────────────

export type MonthlyData = {
  month: string;
  year: number;
  investment: number;
  impressions: number;
  clicks: number;
  leads: number;
  meetingsScheduled: number;
  meetingsDone: number;
  wins: number;
  revenue: number;
};

export type OverallMetrics = {
  investment: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
  meetingsScheduled: number;
  meetingsDone: number;
  wins: number;
  revenue: number;
  roi: number;
};

export type PlatformMetrics = {
  name: string;
  investment: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
};

export type AiNarrative = {
  overallHighlight: string;
  funnelBottleneck: string;
  monthlyInsight: string;
  visibilityConversionInsight: string;
  metaInsight: string;
  googleInsight: string;
  recommendations: string[];
};

// ─── Manifest slide types (new) ───────────────────────────────────────────────

export type MetricCard = {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
};

export type BarData = {
  label: string;
  value: number;
};

export type FunnelStage = {
  label: string;
  value: number;
  rate?: string;
};

export type SlideSpec =
  | { type: 'cover'; clientName: string; period: string; headline: string; tagline?: string }
  | { type: 'kpis'; title: string; subtitle?: string; metrics: MetricCard[]; insight?: string }
  | { type: 'bar-chart'; title: string; subtitle?: string; data: BarData[]; valuePrefix?: string; valueSuffix?: string; insight?: string }
  | { type: 'funnel'; title: string; stages: FunnelStage[]; insight?: string }
  | { type: 'channels'; title: string; channels: Array<{ name: string; color?: string; metrics: MetricCard[]; insight?: string }> }
  | { type: 'insight'; headline: string; body: string; supporting?: MetricCard[] }
  | { type: 'recommendations'; title: string; items: Array<{ title: string; description: string }> };

export type ReportManifest = {
  slides: SlideSpec[];
  theme: string;
  primaryLogo?: string;
  clientLogo?: string;
};

// ─── Stored report ─────────────────────────────────────────────────────────────

export type ReportData = {
  id: string;
  clientId: string;
  clientName: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  sources: string[];
  monthly: MonthlyData[];
  overall: OverallMetrics;
  meta: PlatformMetrics;
  google: PlatformMetrics;
  ai?: AiNarrative;
  createdAt: string;
  manifest?: ReportManifest;
};
