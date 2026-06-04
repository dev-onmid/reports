// ── Primitives ────────────────────────────────────────────────────────────────

export type MonthPoint = {
  label: string;   // "Jun/25", "Jul/25", etc.
  value: number;
};

// ── Page types ────────────────────────────────────────────────────────────────

export type CoverPage = {
  type: 'cover';
  title: string;           // "Relatório de\nPerformance"
  titleHighlight: string;  // word/segment in green (e.g. "Performance")
  subtitle: string;        // "Performance de Base, Aquisição e Tráfego Pago"
  clientName: string;
  period: string;          // "Junho/2025 a Abril/2026"
  sources: string;         // "Base de Clientes + Relatórios Meta Ads"
  objective: string;       // 1-2 sentences
  summaryMetrics?: { label: string; value: string; accent: 'green' | 'blue' | 'dark' }[];
};

export type ExecutiveSummaryPage = {
  type: 'executive_summary';
  mainStatement: string;           // large hero text
  cards: {
    number: string;                // "01", "02", "03"
    title: string;
    description: string;
  }[];
  readout: string;                 // bottom insight paragraph
};

export type GrowthChartPage = {
  type: 'growth_chart';
  title: string;
  titleHighlight: string;
  subtitle: string;
  chartData: MonthPoint[];
  movingAvgData?: MonthPoint[];   // optional 3-month moving average
  insight: {
    prevLabel: string;
    prevValue: number;
    currLabel: string;
    currValue: number;
    growthPct: string;            // "+115%"
    comment: string;              // short interpretation
  };
};

export type NewCustomersPage = {
  type: 'new_customers';
  chartData: MonthPoint[];
  ranking: {
    position: number;
    label: string;
    value: number;
  }[];
};

export type ExplanationCardsPage = {
  type: 'explanation_cards';
  title: string;
  titleHighlight: string;
  cards: {
    number: number;
    title: string;
    description: string;
    highlight?: string;           // short phrase in green
  }[];
};

export type ComparisonTablePage = {
  type: 'comparison_table';
  month1: string;                 // "Março"
  month2: string;                 // "Abril"
  rows: {
    icon: string;                 // emoji key
    label: string;
    value1: string;
    value2: string;
    variation: string;            // "+115%"
    positive: boolean;
  }[];
  readout: string;                // "Leitura principal" paragraph
  insight: string;                // bottom highlighted phrase
};

export type CostPerCustomerPage = {
  type: 'cost_per_customer';
  clientName?: string;
  barData: MonthPoint[];          // cost-per-customer by month
  lineData: MonthPoint[];         // new customers by month (line chart)
  tableRows: {
    period: string;
    investment: string;
    newCustomers: number;
    costPerCustomer: string;
    costNum: number;              // for color coding
  }[];
  ranking: {
    position: number;
    label: string;
    value: string;
  }[];
};

export type ReachImpressionsPage = {
  type: 'reach_impressions';
  context: string;                // 2-3 sentence paragraph
  clientName: string;
  impressionsData: MonthPoint[];
  reachData: MonthPoint[];
  highlightLabel: string;         // "Abril foi o mês mais forte em alcance."
  highlightValue: number;
  highlightDesc: string;          // supporting sentence
};

export type MetricHighlightPage = {
  type: 'metric_highlight';
  title: string;
  titleHighlight: string;
  subtitle: string;
  metrics: { label: string; value: string }[];
  insight: string;
};

export type ReportPage =
  | CoverPage
  | ExecutiveSummaryPage
  | GrowthChartPage
  | NewCustomersPage
  | ExplanationCardsPage
  | ComparisonTablePage
  | CostPerCustomerPage
  | ReachImpressionsPage
  | MetricHighlightPage;

// ── Root ──────────────────────────────────────────────────────────────────────

export type OmniReportData = {
  clientName: string;
  period: string;
  templateSlug: 'onmid-clean-performance';
  pages: ReportPage[];
};
