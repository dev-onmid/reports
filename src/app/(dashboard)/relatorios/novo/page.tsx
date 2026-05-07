"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useClients } from '@/lib/client-store';
import { loadIntegrations, loadCachedAdAccounts, readIntegrations, type CachedAdAccount } from '@/lib/integration-store';
import { useMetaAdsConnections } from '@/lib/meta-ads-store';
import { Sparkles, AlertTriangle, Users, RefreshCw, Check, BarChart3 } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type Period = 'last_7d' | 'last_30d' | 'last_month' | 'this_month' | 'custom';

const PERIOD_LABELS: Record<Period, string> = {
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
  last_month: 'Mês passado',
  this_month: 'Este mês',
  custom: 'Personalizado',
};

const META_DATE_PRESET: Record<Exclude<Period, 'custom'>, string> = {
  last_7d: 'last_7d',
  last_30d: 'last_30d',
  last_month: 'last_month',
  this_month: 'this_month',
};

const ACTION_LABELS: Record<string, string> = {
  post_engagement: 'Engajamento com a página',
  page_engagement: 'Engajamento com a página',
  video_view: 'Reprodução do vídeo (3s+)',
  link_click: 'Clique nos links',
  post_reaction: 'Reações às postagens',
  'onsite_conversion.total_messaging_connection': 'Total messaging connection',
  'onsite_conversion.messaging_conversation_started_7d': 'Conversas iniciadas por mensagem',
  lead: 'Leads',
  'offsite_conversion.fb_pixel_lead': 'Leads (Pixel)',
  landing_page_view: 'Visitas à página de destino',
  comment: 'Comentários',
  like: 'Curtidas na página',
  omni_view_content: 'Visualizações de conteúdo',
  'onsite_conversion.lead_grouped': 'Leads (agrupados)',
};

const IMPORTANT_ACTIONS = [
  'post_engagement',
  'page_engagement',
  'video_view',
  'link_click',
  'post_reaction',
  'onsite_conversion.total_messaging_connection',
  'onsite_conversion.messaging_conversation_started_7d',
  'lead',
  'offsite_conversion.fb_pixel_lead',
  'landing_page_view',
  'comment',
  'like',
];

type MetaAction = { action_type: string; value: string };

type ActionItem = { type: string; label: string; total: number; costPerAction: number };
type PlatformStats = { platform: string; reach: number; impressions: number; clicks: number; spend: number };
type DailyStats = { date: string; spend: number; impressions: number; reach: number; ctr: number };
type AgeStats = { age: string; impressions: number; reach: number };
type GenderStats = { gender: string; impressions: number; reach: number };
type CampaignRow = { id: string; name: string; spend: number; impressions: number; clicks: number; reach: number; cpm: number; cpc: number; resultLabel: string; resultValue: number; costPerResult: number };
type AdSetRow = CampaignRow;
type AdRow = CampaignRow;

type FullAccountReport = {
  accountId: string; accountName: string; currency: string; period: string; generatedAt: string;
  spend: number; reach: number; impressions: number; clicks: number;
  cpc: number; cpm: number; ctr: number; frequency: number;
  mainConversionLabel: string; mainConversionCount: number; mainConversionCost: number;
  actions: ActionItem[];
  dailyStats: DailyStats[];
  platforms: PlatformStats[];
  ageStats: AgeStats[];
  genderStats: GenderStats[];
  campaigns: CampaignRow[];
  adsets: AdSetRow[];
  ads: AdRow[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(value: number, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}
function fmtN(value: number) { return new Intl.NumberFormat('pt-BR').format(value); }
function fmtP(value: number) { return value.toFixed(2) + '%'; }

function periodParams(period: Period, dateFrom?: string, dateTo?: string) {
  if (period === 'custom' && dateFrom && dateTo)
    return `time_range[since]=${dateFrom}&time_range[until]=${dateTo}`;
  return `date_preset=${META_DATE_PRESET[period as Exclude<Period, 'custom'>] ?? 'last_30d'}`;
}

async function metaFetch(path: string, token: string) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://graph.facebook.com/v21.0/${path}${sep}access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

function getMainConversion(actions: MetaAction[], spend: number) {
  const priority = [
    'onsite_conversion.messaging_conversation_started_7d',
    'onsite_conversion.total_messaging_connection',
    'lead',
    'offsite_conversion.fb_pixel_lead',
    'landing_page_view',
    'link_click',
    'post_engagement',
    'page_engagement',
  ];
  for (const type of priority) {
    const a = actions.find(x => x.action_type === type);
    if (a) {
      const count = parseInt(a.value || '0', 10);
      if (count > 0) return { label: ACTION_LABELS[type] ?? type, count, cost: spend / count };
    }
  }
  return { label: '—', count: 0, cost: 0 };
}

function getResultFromObjective(objective: string, row: Record<string, unknown>, spend: number) {
  const actions = (row.actions as MetaAction[]) ?? [];
  const findAction = (...types: string[]) => {
    for (const t of types) {
      const a = actions.find(x => x.action_type === t);
      if (a) return parseInt(a.value || '0', 10);
    }
    return 0;
  };
  switch (objective) {
    case 'REACH': { const v = parseInt(row.reach as string || '0', 10); return { resultLabel: 'Alcance', resultValue: v, costPerResult: v > 0 ? spend / v : 0 }; }
    case 'MESSAGES': { const v = findAction('onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'); return { resultLabel: 'Conversas iniciadas', resultValue: v, costPerResult: v > 0 ? spend / v : 0 }; }
    case 'TRAFFIC':
    case 'LINK_CLICKS': { const v = findAction('landing_page_view', 'link_click') || parseInt(row.clicks as string || '0', 10); return { resultLabel: 'Visitas ao perfil', resultValue: v, costPerResult: v > 0 ? spend / v : 0 }; }
    case 'LEAD_GENERATION':
    case 'CONVERSIONS': { const v = findAction('lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'); return { resultLabel: 'Leads', resultValue: v, costPerResult: v > 0 ? spend / v : 0 }; }
    case 'VIDEO_VIEWS': { const v = findAction('video_view'); return { resultLabel: 'Visualizações de vídeo', resultValue: v, costPerResult: v > 0 ? spend / v : 0 }; }
    case 'POST_ENGAGEMENT':
    case 'PAGE_LIKES':
    case 'ENGAGEMENT': { const v = findAction('post_engagement', 'page_engagement'); return { resultLabel: 'Engajamento', resultValue: v, costPerResult: v > 0 ? spend / v : 0 }; }
    default: { const v = parseInt(row.impressions as string || '0', 10); return { resultLabel: 'Impressões', resultValue: v, costPerResult: v > 0 ? spend / v : 0 }; }
  }
}

const PLATFORM_LABELS: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', audience_network: 'Audience Network', messenger: 'Messenger' };
const GENDER_LABELS: Record<string, string> = { male: 'Masculino', female: 'Feminino', unknown: 'Desconhecido' };
const PLATFORM_COLORS: Record<string, string> = { Facebook: '#1877F2', Instagram: '#E1306C', 'Audience Network': '#f59e0b', Messenger: '#00B2FF' };
const GENDER_COLORS: Record<string, string> = { Masculino: '#3b82f6', Feminino: '#ec4899', Desconhecido: '#94a3b8' };

async function fetchFullReport(
  accountId: string, accountName: string, currency: string,
  token: string, period: Period, dateFrom?: string, dateTo?: string,
): Promise<FullAccountReport> {
  const pp = periodParams(period, dateFrom, dateTo);
  const base = `${accountId}/insights`;

  const [summary, daily, platformData, ageData, genderData, campaignData, adsetData, adData] = await Promise.all([
    metaFetch(`${base}?fields=spend,impressions,clicks,reach,actions,cpm,cpc,ctr,frequency&level=account&${pp}`, token),
    metaFetch(`${base}?fields=spend,impressions,reach,ctr&time_increment=1&${pp}`, token),
    metaFetch(`${base}?fields=impressions,reach,clicks,spend&breakdowns=publisher_platform&${pp}`, token),
    metaFetch(`${base}?fields=impressions,reach&breakdowns=age&${pp}`, token),
    metaFetch(`${base}?fields=impressions,reach&breakdowns=gender&${pp}`, token),
    metaFetch(`${base}?fields=campaign_id,campaign_name,objective,spend,impressions,clicks,reach,actions,cpm,cpc&level=campaign&${pp}`, token),
    metaFetch(`${base}?fields=adset_id,adset_name,spend,impressions,clicks,reach,actions,cpm,cpc&level=adset&limit=10&sort=spend_descending&${pp}`, token),
    metaFetch(`${base}?fields=ad_id,ad_name,spend,impressions,clicks,reach,actions,cpm,cpc&level=ad&limit=10&sort=impressions_descending&${pp}`, token),
  ]);

  const row = summary.data?.[0] ?? {};
  const spend = parseFloat(row.spend || '0');
  const actions = (row.actions as MetaAction[]) ?? [];
  const mainConv = getMainConversion(actions, spend);

  const dailyStats: DailyStats[] = (daily.data ?? []).map((d: Record<string, unknown>) => ({
    date: (d.date_start as string)?.slice(5) ?? '',
    spend: parseFloat(d.spend as string || '0'),
    impressions: parseInt(d.impressions as string || '0', 10),
    reach: parseInt(d.reach as string || '0', 10),
    ctr: parseFloat(d.ctr as string || '0'),
  }));

  const platforms: PlatformStats[] = (platformData.data ?? []).map((d: Record<string, unknown>) => ({
    platform: PLATFORM_LABELS[d.publisher_platform as string] ?? (d.publisher_platform as string),
    reach: parseInt(d.reach as string || '0', 10),
    impressions: parseInt(d.impressions as string || '0', 10),
    clicks: parseInt(d.clicks as string || '0', 10),
    spend: parseFloat(d.spend as string || '0'),
  }));

  // Merge age data by age group
  const ageMap: Record<string, AgeStats> = {};
  for (const d of (ageData.data ?? []) as Record<string, unknown>[]) {
    const age = d.age as string;
    if (!ageMap[age]) ageMap[age] = { age, impressions: 0, reach: 0 };
    ageMap[age].impressions += parseInt(d.impressions as string || '0', 10);
    ageMap[age].reach += parseInt(d.reach as string || '0', 10);
  }
  const ageStats = Object.values(ageMap).sort((a, b) => parseInt(a.age) - parseInt(b.age));

  // Merge gender data
  const genderMap: Record<string, GenderStats> = {};
  for (const d of (genderData.data ?? []) as Record<string, unknown>[]) {
    const gender = GENDER_LABELS[d.gender as string] ?? (d.gender as string);
    if (!genderMap[gender]) genderMap[gender] = { gender, impressions: 0, reach: 0 };
    genderMap[gender].impressions += parseInt(d.impressions as string || '0', 10);
    genderMap[gender].reach += parseInt(d.reach as string || '0', 10);
  }
  const genderStats = Object.values(genderMap);

  const mapRow = (d: Record<string, unknown>, nameKey: string, idKey: string, objective?: string): CampaignRow => {
    const s = parseFloat(d.spend as string || '0');
    const result = objective
      ? getResultFromObjective(objective, d, s)
      : (() => {
          const acts = (d.actions as MetaAction[]) ?? [];
          const best = acts.find(a => IMPORTANT_ACTIONS.includes(a.action_type));
          const v = best ? parseInt(best.value || '0', 10) : parseInt(d.clicks as string || '0', 10);
          const lbl = best ? (ACTION_LABELS[best.action_type] ?? best.action_type) : 'Cliques';
          return { resultLabel: lbl, resultValue: v, costPerResult: v > 0 ? s / v : 0 };
        })();
    return {
      id: d[idKey] as string,
      name: d[nameKey] as string,
      spend: s,
      impressions: parseInt(d.impressions as string || '0', 10),
      clicks: parseInt(d.clicks as string || '0', 10),
      reach: parseInt(d.reach as string || '0', 10),
      cpm: parseFloat(d.cpm as string || '0'),
      cpc: parseFloat(d.cpc as string || '0'),
      ...result,
    };
  };

  const campaigns = (campaignData.data ?? [])
    .map((d: Record<string, unknown>) => mapRow(d, 'campaign_name', 'campaign_id', d.objective as string))
    .sort((a: CampaignRow, b: CampaignRow) => b.spend - a.spend);

  const adsets = (adsetData.data ?? [])
    .map((d: Record<string, unknown>) => mapRow(d, 'adset_name', 'adset_id'))
    .sort((a: AdSetRow, b: AdSetRow) => b.spend - a.spend);

  const ads = (adData.data ?? [])
    .map((d: Record<string, unknown>) => mapRow(d, 'ad_name', 'ad_id'))
    .sort((a: AdRow, b: AdRow) => b.impressions - a.impressions);

  return {
    accountId, accountName, currency,
    period: period === 'custom' ? `${dateFrom} a ${dateTo}` : PERIOD_LABELS[period],
    generatedAt: new Date().toLocaleString('pt-BR'),
    spend,
    reach: parseInt(row.reach || '0', 10),
    impressions: parseInt(row.impressions || '0', 10),
    clicks: parseInt(row.clicks || '0', 10),
    cpc: parseFloat(row.cpc || '0'),
    cpm: parseFloat(row.cpm || '0'),
    ctr: parseFloat(row.ctr || '0'),
    frequency: parseFloat(row.frequency || '0'),
    mainConversionLabel: mainConv.label,
    mainConversionCount: mainConv.count,
    mainConversionCost: mainConv.cost,
    actions: actions.filter(a => IMPORTANT_ACTIONS.includes(a.action_type)).map(a => {
      const total = parseInt(a.value || '0', 10);
      return { type: a.action_type, label: ACTION_LABELS[a.action_type] ?? a.action_type, total, costPerAction: total > 0 ? spend / total : 0 };
    }).filter(a => a.total > 0),
    dailyStats, platforms, ageStats, genderStats, campaigns, adsets, ads,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-5 rounded-xl border border-border bg-card">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

type TableCol<T> = { header: string; render: (row: T) => React.ReactNode; align?: 'right' };
function DataTable<T extends { id: string }>({ rows, columns }: { rows: T[]; columns: TableCol<T>[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">Sem dados</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[700px]">
        <thead className="bg-muted text-muted-foreground text-xs uppercase">
          <tr>
            {columns.map((col, i) => (
              <th key={i} className={`px-4 py-3 ${col.align === 'right' ? 'text-right' : 'text-left'}`}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(row => (
            <tr key={row.id} className="hover:bg-muted/30">
              {columns.map((col, i) => (
                <td key={i} className={`px-4 py-3 ${col.align === 'right' ? 'text-right' : ''}`}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountReport({ report }: { report: FullAccountReport }) {
  const cur = report.currency;
  const fbStats = report.platforms.find(p => p.platform === 'Facebook');
  const igStats = report.platforms.find(p => p.platform === 'Instagram');

  const campaignCols: TableCol<CampaignRow>[] = [
    { header: 'Nome da Campanha', render: r => <span className="font-medium max-w-xs block truncate" title={r.name}>{r.name}</span> },
    { header: 'Resultados', render: r => <span>{fmtN(r.resultValue)}<br /><span className="text-xs text-muted-foreground">{r.resultLabel}</span></span> },
    { header: 'Custo por resultado', render: r => <span>{r.costPerResult > 0 ? fmt(r.costPerResult, cur) : '—'}<br /><span className="text-xs text-muted-foreground">{r.resultLabel}</span></span>, align: 'right' },
    { header: 'Investido', render: r => fmt(r.spend, cur), align: 'right' },
    { header: 'CPC', render: r => fmt(r.cpc, cur), align: 'right' },
    { header: 'CPM', render: r => fmt(r.cpm, cur), align: 'right' },
    { header: 'Alcance', render: r => fmtN(r.reach), align: 'right' },
    { header: 'Impressões', render: r => fmtN(r.impressions), align: 'right' },
  ];

  const adSetCols: TableCol<AdSetRow>[] = [
    { header: 'Conjunto de anúncio', render: r => <span className="font-medium max-w-xs block truncate" title={r.name}>{r.name}</span> },
    { header: 'Resultados', render: r => <span>{fmtN(r.resultValue)}<br /><span className="text-xs text-muted-foreground">{r.resultLabel}</span></span> },
    { header: 'Custo por resultado', render: r => <span>{r.costPerResult > 0 ? fmt(r.costPerResult, cur) : '—'}</span>, align: 'right' },
    { header: 'Investido', render: r => fmt(r.spend, cur), align: 'right' },
    { header: 'CPC', render: r => fmt(r.cpc, cur), align: 'right' },
    { header: 'CPM', render: r => fmt(r.cpm, cur), align: 'right' },
    { header: 'Alcance', render: r => fmtN(r.reach), align: 'right' },
    { header: 'Impressões', render: r => fmtN(r.impressions), align: 'right' },
    { header: 'Cliques', render: r => fmtN(r.clicks), align: 'right' },
  ];

  const adCols: TableCol<AdRow>[] = [
    { header: 'Anúncio', render: r => <span className="font-medium max-w-[200px] block truncate" title={r.name}>{r.name}</span> },
    { header: 'Resultados', render: r => <span>{fmtN(r.resultValue)}<br /><span className="text-xs text-muted-foreground">{r.resultLabel}</span></span> },
    { header: 'Custo por resultado', render: r => <span>{r.costPerResult > 0 ? fmt(r.costPerResult, cur) : '—'}</span>, align: 'right' },
    { header: 'Investido', render: r => fmt(r.spend, cur), align: 'right' },
    { header: 'CPC', render: r => fmt(r.cpc, cur), align: 'right' },
    { header: 'CPM', render: r => fmt(r.cpm, cur), align: 'right' },
    { header: 'Alcance', render: r => fmtN(r.reach), align: 'right' },
    { header: 'Impressões', render: r => fmtN(r.impressions), align: 'right' },
    { header: 'Cliques', render: r => fmtN(r.clicks), align: 'right' },
  ];

  return (
    <div className="space-y-8">
      {/* Account header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h3 className="text-xl font-bold">{report.accountName}</h3>
          <p className="text-sm text-muted-foreground">
            {report.period} · Gerado em {report.generatedAt}
          </p>
        </div>
        <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">{report.accountId}</span>
      </div>

      {/* KPI cards — row 1 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Valor investido" value={fmt(report.spend, cur)} />
        <KpiCard label="Alcance Total" value={fmtN(report.reach)} />
        <KpiCard label="CPC médio" value={fmt(report.cpc, cur)} />
        <KpiCard label="CPM médio" value={fmt(report.cpm, cur)} />
      </div>

      {/* KPI cards — row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Impressões Totais" value={fmtN(report.impressions)} />
        <KpiCard label="Total de Cliques" value={fmtN(report.clicks)} sub={`CTR ${fmtP(report.ctr)}`} />
        {report.mainConversionCount > 0 ? (
          <>
            <KpiCard label={report.mainConversionLabel} value={fmtN(report.mainConversionCount)} />
            <KpiCard label={`Custo por ${report.mainConversionLabel.toLowerCase()}`} value={fmt(report.mainConversionCost, cur)} />
          </>
        ) : (
          <>
            <KpiCard label="Frequência" value={report.frequency.toFixed(2)} />
            <KpiCard label="CTR" value={fmtP(report.ctr)} />
          </>
        )}
      </div>

      {/* Charts — Daily spend + CTR */}
      {report.dailyStats.length > 1 && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Valor investido por dia</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={report.dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${v}`} />
                  <Tooltip formatter={(v) => typeof v === 'number' ? fmt(v, cur) : ''} />
                  <Line type="monotone" dataKey="spend" stroke="#22c55e" strokeWidth={2} dot={false} name="Investido" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Impressões e Alcance por dia</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={report.dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
                  <Tooltip formatter={(v) => typeof v === 'number' ? fmtN(v) : ''} />
                  <Bar dataKey="impressions" fill="#22c55e" name="Impressões" />
                  <Bar dataKey="reach" fill="#86efac" name="Alcance" />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Actions table */}
      {report.actions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Conversões e ações por Tipo</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-right">Total de Conversões</th>
                  <th className="px-4 py-3 text-right">Custo por ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.actions.map(a => (
                  <tr key={a.type} className="hover:bg-muted/30">
                    <td className="px-4 py-3">{a.label}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmtN(a.total)}</td>
                    <td className="px-4 py-3 text-right">{fmt(a.costPerAction, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Age + Gender charts */}
      {(report.ageStats.length > 0 || report.genderStats.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          {report.ageStats.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Impressões e alcance por idade</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={report.ageStats} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
                    <YAxis type="category" dataKey="age" tick={{ fontSize: 10 }} width={36} />
                    <Tooltip formatter={(v) => typeof v === 'number' ? fmtN(v) : ''} />
                    <Bar dataKey="impressions" fill="#22c55e" name="Impressões" />
                    <Bar dataKey="reach" fill="#86efac" name="Alcance" />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {report.genderStats.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Impressões e alcance por gênero</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={report.genderStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="gender" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
                    <Tooltip formatter={(v) => typeof v === 'number' ? fmtN(v) : ''} />
                    <Bar dataKey="impressions" name="Impressões" radius={[4, 4, 0, 0]}>
                      {report.genderStats.map(g => (
                        <Cell key={g.gender} fill={GENDER_COLORS[g.gender] ?? '#94a3b8'} />
                      ))}
                    </Bar>
                    <Bar dataKey="reach" fill="#86efac" name="Alcance" radius={[4, 4, 0, 0]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Platform pie + stats */}
      {report.platforms.length > 0 && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Alcance por plataforma</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={report.platforms} dataKey="reach" nameKey="platform" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name ?? ''} ${percent != null ? (percent * 100).toFixed(0) : 0}%`} labelLine={false}>
                      {report.platforms.map(p => (
                        <Cell key={p.platform} fill={PLATFORM_COLORS[p.platform] ?? '#94a3b8'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => typeof v === 'number' ? fmtN(v) : ''} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-3 content-start">
              {report.platforms.map(p => (
                <Card key={p.platform}>
                  <CardContent className="pt-4 space-y-1.5">
                    <p className="text-xs font-semibold" style={{ color: PLATFORM_COLORS[p.platform] ?? '#94a3b8' }}>{p.platform}</p>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>Alcance <span className="float-right font-medium text-foreground">{fmtN(p.reach)}</span></p>
                      <p>Impressões <span className="float-right font-medium text-foreground">{fmtN(p.impressions)}</span></p>
                      <p>Cliques <span className="float-right font-medium text-foreground">{fmtN(p.clicks)}</span></p>
                      <p>Investido <span className="float-right font-medium text-foreground">{fmt(p.spend, cur)}</span></p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Campaigns table */}
      {report.campaigns.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold">Campanhas em destaque</h4>
          <DataTable rows={report.campaigns} columns={campaignCols} />
        </div>
      )}

      {/* Ad sets table */}
      {report.adsets.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold">Conjunto de anúncios em destaque</h4>
          <DataTable rows={report.adsets} columns={adSetCols} />
        </div>
      )}

      {/* Ads table */}
      {report.ads.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold">Anúncios em Destaque</h4>
          <DataTable rows={report.ads} columns={adCols} />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NovoRelatorioPage() {
  const { clients } = useClients();
  const { getConnection } = useMetaAdsConnections();

  const [source, setSource] = useState<'account' | 'client'>('account');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period>('last_30d');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [cachedAccounts, setCachedAccounts] = useState<CachedAdAccount[]>([]);
  const [isMetaConnected, setIsMetaConnected] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reports, setReports] = useState<FullAccountReport[]>([]);
  const [generateError, setGenerateError] = useState('');

  useEffect(() => {
    Promise.all([loadIntegrations(), loadCachedAdAccounts()]).then(([store, accounts]) => {
      setIsMetaConnected(store.meta.status === 'connected');
      setCachedAccounts(accounts);
    }).catch(() => {});
  }, []);

  const clientLinkedAccounts: CachedAdAccount[] = (() => {
    if (source !== 'client' || !selectedClientId) return [];
    const connection = getConnection(selectedClientId);
    if (!connection) return [];
    return cachedAccounts.filter(a => connection.accountIds.includes(a.id));
  })();

  const accountsForReport: CachedAdAccount[] =
    source === 'client'
      ? clientLinkedAccounts
      : cachedAccounts.filter(a => selectedAccountIds.includes(a.id));

  function toggleAccount(id: string) {
    setSelectedAccountIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  }

  const canGenerate = isMetaConnected &&
    (source === 'client' ? !!selectedClientId && clientLinkedAccounts.length > 0 : selectedAccountIds.length > 0) &&
    (period !== 'custom' || (!!dateFrom && !!dateTo));

  async function handleGenerate() {
    if (!canGenerate) return;
    setIsGenerating(true);
    setGenerateError('');
    setReports([]);
    try {
      const token = readIntegrations().meta.accessToken;
      const results = await Promise.all(
        accountsForReport.map(a => fetchFullReport(a.id, a.name, a.currency, token, period, dateFrom, dateTo)),
      );
      setReports(results);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Erro ao gerar relatório');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Criar Novo Relatório</h1>
        <p className="text-muted-foreground mt-1">Dados reais do Meta: campanhas, conjuntos, anúncios, breakdowns demográficos.</p>
      </div>

      {!isMetaConnected && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm">Meta Ads não conectado. <Link href="/integracoes" className="underline font-medium">Conecte na página de Integrações</Link>.</p>
        </div>
      )}

      <div className="grid gap-6">
        {/* Section 1: Source */}
        <Card>
          <CardHeader>
            <CardTitle>1. Fonte do Relatório</CardTitle>
            <CardDescription>Contas da conexão global ou por cliente cadastrado</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              {[
                { key: 'account', icon: <BarChart3 className="w-5 h-5 text-primary shrink-0" />, title: 'Contas de Anúncios', desc: 'Qualquer conta da conexão global' },
                { key: 'client', icon: <Users className="w-5 h-5 text-primary shrink-0" />, title: 'Por Cliente', desc: 'Contas vinculadas a um cliente' },
              ].map(opt => (
                <button key={opt.key} onClick={() => { setSource(opt.key as 'account' | 'client'); if (opt.key === 'account') setSelectedClientId(''); else setSelectedAccountIds([]); }}
                  className={`flex-1 flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left ${source === opt.key ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
                  {opt.icon}
                  <div><p className="font-semibold text-sm">{opt.title}</p><p className="text-xs text-muted-foreground">{opt.desc}</p></div>
                </button>
              ))}
            </div>

            {source === 'account' && (
              <div className="space-y-2">
                {cachedAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 rounded-lg bg-muted/30 text-center">
                    {isMetaConnected ? 'Nenhuma conta. Acesse Integrações e carregue os ativos.' : 'Conecte o Meta Ads.'}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {cachedAccounts.map(account => {
                      const sel = selectedAccountIds.includes(account.id);
                      return (
                        <button key={account.id} onClick={() => toggleAccount(account.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${sel ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${sel ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                            {sel && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{account.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{account.id}</p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">{account.currency}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedAccountIds.length > 0 && <p className="text-xs text-muted-foreground">{selectedAccountIds.length} conta(s) selecionada(s)</p>}
              </div>
            )}

            {source === 'client' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="" disabled>Selecione um cliente</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {selectedClientId && (clientLinkedAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3 rounded-lg bg-muted/30">
                    Sem contas vinculadas. <Link href={`/clientes/${selectedClientId}`} className="text-primary underline">Configurar →</Link>
                  </p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Contas vinculadas:</p>
                    {clientLinkedAccounts.map(a => (
                      <div key={a.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-sm">
                        <Check className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-medium flex-1">{a.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{a.id}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 2: Period */}
        <Card>
          <CardHeader><CardTitle>2. Período</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setPeriod(v)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${period === v ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/50'}`}>
                  {l}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>De</Label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
                <div className="space-y-2"><Label>Até</Label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
              </div>
            )}
          </CardContent>
        </Card>

        {generateError && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{generateError}</p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button render={<Link href="/relatorios" />} nativeButton={false} variant="outline">Cancelar</Button>
          <Button onClick={handleGenerate} disabled={!canGenerate || isGenerating}>
            {isGenerating ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Buscando dados da Meta...</> : <><Sparkles className="w-4 h-4 mr-2" />Gerar Relatório</>}
          </Button>
        </div>

        {/* Reports */}
        {reports.map((report, i) => (
          <div key={report.accountId} className={i > 0 ? 'pt-8 border-t-2 border-border' : ''}>
            <AccountReport report={report} />
          </div>
        ))}
      </div>
    </div>
  );
}
