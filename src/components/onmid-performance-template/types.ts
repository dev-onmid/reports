// ── Primitives ────────────────────────────────────────────────────────────────

export type MonthPoint = {
  label: string;   // "Jun/25", "Jul/25", etc.
  value: number;
};

// ── Page types ────────────────────────────────────────────────────────────────

export type CoverPage = {
  type: 'cover';
  title: string;
  titleHighlight: string;
  subtitle: string;
  clientName: string;
  period: string;
  sources: string;
  objective: string;
  summaryMetrics?: { label: string; value: string; accent: 'green' | 'blue' | 'dark' }[];
};

export type ExecutiveSummaryPage = {
  type: 'executive_summary';
  mainStatement: string;
  cards: { number: string; title: string; description: string }[];
  readout: string;
};

export type GrowthChartPage = {
  type: 'growth_chart';
  title: string;
  titleHighlight: string;
  subtitle: string;
  chartData: MonthPoint[];
  movingAvgData?: MonthPoint[];
  insight: {
    prevLabel: string;
    prevValue: number;
    currLabel: string;
    currValue: number;
    growthPct: string;
    comment: string;
  };
};

export type NewCustomersPage = {
  type: 'new_customers';
  chartData: MonthPoint[];
  ranking: { position: number; label: string; value: number }[];
};

export type ExplanationCardsPage = {
  type: 'explanation_cards';
  title: string;
  titleHighlight: string;
  cards: { number: number; title: string; description: string; highlight?: string }[];
};

export type ComparisonTablePage = {
  type: 'comparison_table';
  month1: string;
  month2: string;
  rows: {
    icon: string;
    label: string;
    value1: string;
    value2: string;
    variation: string;
    positive: boolean;
  }[];
  readout: string;
  insight: string;
};

export type CostPerCustomerPage = {
  type: 'cost_per_customer';
  clientName?: string;
  barData: MonthPoint[];
  lineData: MonthPoint[];
  tableRows: {
    period: string;
    investment: string;
    newCustomers: number;
    costPerCustomer: string;
    costNum: number;
  }[];
  ranking: { position: number; label: string; value: string }[];
};

export type ReachImpressionsPage = {
  type: 'reach_impressions';
  context: string;
  clientName: string;
  impressionsData: MonthPoint[];
  reachData: MonthPoint[];
  highlightLabel: string;
  highlightValue: number;
  highlightDesc: string;
};

export type MetricHighlightPage = {
  type: 'metric_highlight';
  title: string;
  titleHighlight: string;
  subtitle: string;
  metrics: { label: string; value: string }[];
  insight: string;
};

// ── New page types (checklist items 16–21) ────────────────────────────────────

export type DiagnosisPage = {
  type: 'diagnosis';
  mainStatement: string;
  items: {
    icon: string;
    title: string;
    description: string;
    accent: 'positive' | 'negative' | 'opportunity' | 'neutral';
  }[];
};

export type InsightsPage = {
  type: 'insights_page';
  insights: {
    number: number;
    title: string;
    body: string;
    evidence?: string;
  }[];
};

export type RecommendationsPage = {
  type: 'recommendations';
  groups: {
    category: string;
    icon: string;
    items: string[];
  }[];
  highlight: string;
};

export type ActionPlanPage = {
  type: 'action_plan';
  month: string;
  mainFocus: string;
  actions: {
    priority: number;
    what: string;
    metric: string;
    urgency: 'alta' | 'média' | 'baixa';
  }[];
};

export type ConclusionPage = {
  type: 'conclusion';
  summary: string;
  mainLearning: string;
  biggestOpportunity: string;
  nextFocus: string;
};

// ── Union ─────────────────────────────────────────────────────────────────────

export type ReportPage =
  | CoverPage
  | ExecutiveSummaryPage
  | GrowthChartPage
  | NewCustomersPage
  | ExplanationCardsPage
  | ComparisonTablePage
  | CostPerCustomerPage
  | ReachImpressionsPage
  | MetricHighlightPage
  | DiagnosisPage
  | InsightsPage
  | RecommendationsPage
  | ActionPlanPage
  | ConclusionPage;

// ── Root ──────────────────────────────────────────────────────────────────────

export type OmniReportData = {
  clientName: string;
  period: string;
  templateSlug: 'onmid-clean-performance';
  pages: ReportPage[];
};
