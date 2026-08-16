// Blocos do dashboard de Delivery, refatorados de `docs/dashboard-delivery-v4.jsx`.
//
// Os oito componentes pedidos saem daqui. Importe sempre por este barrel:
//   import { KpiCard, Heatmap } from '@/components/dashboard';

export { KpiCard, Mini, Tile, Chapter } from './cards';
export type { KpiCardProps, MiniProps, TileProps, ChapterProps } from './cards';

export { Gauge, Ring, Funnel, Heatmap } from './charts';

export { Card, InnerCard, Label, IconTile, Delta, Spark, BlocoVazio, fmt, SEM_DADO, CLASSE_SUPERFICIE } from './primitives';
export type { Superficie } from './primitives';
