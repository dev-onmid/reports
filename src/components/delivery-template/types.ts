export type DailyData = { day: string; value: number; highlight?: boolean };

export type RegionData = {
  rank: number;
  name: string;
  orders: number;
  revenue: number;
};

export type ProductData = {
  rank: number;
  name: string;
  orders: number;
};

export type ComboData = {
  title: string;
  description: string;
};

export type CampaignData = {
  name: string;
  description: string;
  metrics: Array<{ label: string; value: string }>;
  insight: string;
};

export type CampaignAction = {
  name: string;
  objective: string;
  audience: string;
  message: string;
  product: string;
};

export type CreativeData = {
  name: string;
  roas: number;
};

export type DeliveryReportData = {
  clientName: string;
  clientLogoUrl?: string | null;
  templateSlug: 'onmid-delivery';

  cover: {
    subtitle: string;
    periodLabel: string;
    prevPeriodLabel: string;
    objective: string;
  };

  monthlyOverview: {
    current: { monthLabel: string; year: string; revenue: number; orders: number; avgTicket: number };
    previous: { monthLabel: string; year: string; revenue: number; orders: number; avgTicket: number };
    mainInsight: string;
  };

  weeklyBehavior: {
    ordersByDay: DailyData[];
    deliveriesByDay: DailyData[];
    strategicReading: string;
    opportunities: string[];
  };

  geoRegions: {
    regions: RegionData[];
    strengthenInsight: string;
    growInsight: string;
    remarketingInsight: string;
  };

  customerBase: {
    active: number;
    inactive: number;
    potential: number;
    ordersInBase: number;
    singleOrderCount: number;
    multiOrderCount: number;
    baseInsight: string;
    segmentInsight: string;
  };

  inactives: {
    ranges: Array<{ label: string; count: number; priority: boolean }>;
    potentialCount: number;
    approachSuggestions: string[];
    entryProducts: string[];
    cta: string;
  };

  topProducts: {
    ranking: ProductData[];
    combos: ComboData[];
    insight: string;
  };

  paidTraffic: {
    investment: number;
    impressions: number;
    reach: number;
    clicks: number;
    campaignNames: string[];
    topCampaigns: CampaignData[];
    recommendation: string;
  } | null;

  actionSummary: {
    creatives: CreativeData[];
    revenueForces: string[];
    revenueForceDetails: string[];  // 4 parágrafos explicando cada força (para slide 11)
    assetsForNextMonth: string[];   // lista "O que ainda temos para aproveitar"
    actionPlan: string[];
    priorities: string[];
    conclusion: string;
    nextMonth: string;
  };

  campaignActionPlan: {
    campaigns: CampaignAction[];
    customerJourney: string[];
    guidelines: string[];
  } | null;
};
