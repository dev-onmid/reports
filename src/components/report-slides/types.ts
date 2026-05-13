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
  ai: AiNarrative;
  createdAt: string;
};
