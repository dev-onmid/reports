'use client';

import { Slide01Cover, SLIDE_W, SLIDE_H } from '@/components/delivery-template/slides';
import type { DeliveryReportData } from '@/components/delivery-template/types';

const mockData: DeliveryReportData = {
  clientName: 'PicoLocos',
  clientLogoUrl: 'https://i.pravatar.cc/150?img=12',
  templateSlug: 'onmid-delivery',
  cover: {
    subtitle: 'Análise de faturamento, pedidos, tráfego, base de clientes, produtos e oportunidades para junho',
    periodLabel: '01/05/2026 a 31/05/2026',
    prevPeriodLabel: '01/04/2026 a 30/04/2026',
    objective: 'Apresentar uma leitura clara dos resultados de maio, entender o que compôs o faturamento, quais públicos e produtos tiveram maior força, como a base de clientes está distribuída e quais oportunidades podem ser aproveitadas em junho para aumentar recorrência, reativar clientes e otimizar campanhas.',
  },
  monthlyOverview: {
    current: { monthLabel: 'Maio', year: '2026', revenue: 120000, orders: 1456, avgTicket: 82 },
    previous: { monthLabel: 'Abril', year: '2026', revenue: 100000, orders: 1200, avgTicket: 80 },
    mainInsight: '',
  },
  weeklyBehavior: { ordersByDay: [], deliveriesByDay: [], strategicReading: '', opportunities: [] },
  geoRegions: { regions: [], strengthenInsight: '', growInsight: '', remarketingInsight: '' },
  customerBase: { active: 0, inactive: 0, potential: 0, ordersInBase: 0, singleOrderCount: 0, multiOrderCount: 0, baseInsight: '', segmentInsight: '' },
  inactives: { ranges: [], potentialCount: 0, approachSuggestions: [], entryProducts: [], cta: '' },
  topProducts: { ranking: [], combos: [], insight: '' },
  paidTraffic: null,
  actionSummary: { creatives: [], revenueForces: [], revenueForceDetails: [], assetsForNextMonth: [], actionPlan: [], priorities: [], conclusion: '', nextMonth: '' },
  campaignActionPlan: null,
};

export default function DevCoverPreview() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#EEF1F5', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{ width: SLIDE_W, height: SLIDE_H, boxShadow: '0 16px 42px rgba(15,23,42,0.16)', borderRadius: 8, overflow: 'hidden' }}>
        <Slide01Cover data={mockData} current={1} total={9} />
      </div>
    </div>
  );
}
