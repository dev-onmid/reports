"use client";

import Link from 'next/link';
import { type ElementType, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Eye,
  Filter,
  Pencil,
  Plus,
  PlusCircle,
  RefreshCw,
  Send,
  Trash2,
  WalletCards,
  X,
  Zap,
} from 'lucide-react';
import {
  AreaChart, Area, PieChart, Pie, Cell,
  ResponsiveContainer, Tooltip, XAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useClients } from '@/lib/client-store';
import {
  type InvestmentPayment,
  type PaymentChannel,
  type PaymentStatus,
  PAYMENT_CHANNELS,
  PAYMENT_STATUS_OPTIONS,
  useInvestmentPayments,
} from '@/lib/payment-store';
import { getHoliday, previousBusinessDay, formatDateBR as formatHolidayDateBR } from '@/lib/holidays';
import { cn, formatCurrencyBRL, formatCurrencyInputBRL, parseCurrencyBRL } from '@/lib/utils';

// ── Ads account balance ───────────────────────────────────────────────────────
type AdsBalancePlatform = 'meta' | 'google';

type AdAccountBalance = {
  id: string;
  name: string;
  currency: string;
  balance: number | null;
  error: string | null;
  platform: AdsBalancePlatform;
  paymentUrl: string;
  connectionName?: string;
};

type ClientAccountLink = {
  id: string;
  clientId: string;
  platform: string;
  connectionId?: string;
  accountId: string;
  accountName?: string;
  currency: string;
  createdAt: string;
};

const LOW_BALANCE_THRESHOLD = 100; // R$100
const CLIENT_BILLING_MODE_PREFIX = 'clientAdsBillingMode_';

function MetaAdsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-4 w-4'} fill="none">
      <path
        d="M4.15 15.45c0-3.92 1.98-7.03 4.34-7.03 1.38 0 2.47 1.03 3.52 2.68 1.05-1.65 2.14-2.68 3.52-2.68 2.36 0 4.34 3.11 4.34 7.03 0 2.5-1.08 4.13-2.8 4.13-1.46 0-2.54-.95-4.96-5.18-2.42 4.23-3.5 5.18-4.96 5.18-1.72 0-3-1.63-3-4.13Z"
        stroke="#0668E1"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.01 11.1c2.4 3.78 3.45 5.47 5.06 5.47.74 0 1.19-.53 1.19-1.23 0-2.32-1.28-4.58-2.72-4.58-1.05 0-1.85.94-3.53 3.64-1.68-2.7-2.48-3.64-3.53-3.64-1.44 0-2.72 2.26-2.72 4.58 0 .7.45 1.23 1.19 1.23 1.61 0 2.66-1.69 5.06-5.47Z"
        stroke="#0668E1"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GoogleAdsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-4 w-4'}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function PaymentChannelLogo({
  channel,
  className,
}: {
  channel: PaymentChannel;
  className?: string;
}) {
  if (channel === 'Meta ADS' || channel === 'Google ADS') {
    const isMeta = channel === 'Meta ADS';
    return (
      <span className={cn('flex shrink-0 items-center justify-center', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={isMeta ? '/brand/meta-ads-logo.webp' : '/brand/google-ads-logo.png'}
          alt={isMeta ? 'Meta Ads' : 'Google Ads'}
          className="h-full w-full object-contain"
        />
      </span>
    );
  }

  return (
    <span className={cn('flex shrink-0 items-center justify-center', className)}>
      <WalletCards className="h-full w-full text-muted-foreground" />
    </span>
  );
}

// ── Low-balance alerts (list, only below threshold) ───────────────────────────
function CriticalBalanceAlerts({
  balances,
  loading,
  lastUpdated,
  onRefresh,
}: {
  balances: AdAccountBalance[];
  loading: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const critical = balances.filter(b => b.balance !== null && b.balance < LOW_BALANCE_THRESHOLD);
  const metaCritical = critical.filter((account) => account.platform === 'meta');
  const googleCritical = critical.filter((account) => account.platform === 'google');
  const visibleMetaCritical = metaCritical;
  const visibleGoogleCritical = googleCritical;

  if (!loading && critical.length === 0) return null;

  function renderAccountCard(account: AdAccountBalance) {
    const isMeta = account.platform === 'meta';
    const hasKnownBalance = account.balance !== null;
    const isCritical = hasKnownBalance && (account.balance ?? 0) < LOW_BALANCE_THRESHOLD;

    return (
      <div
        key={account.id}
        className={cn(
          'rounded-lg border p-3',
          isCritical ? 'border-red-500/30 bg-red-500/10' : 'border-border bg-card/60'
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-background',
            isCritical ? 'border-red-500/25' : 'border-border'
          )}>
            {isMeta ? <MetaAdsMark className="h-5 w-5" /> : <GoogleAdsMark className="h-5 w-5" />}
          </div>
          <p className={cn(
            'text-lg font-bold shrink-0 tabular-nums leading-none',
            isCritical ? 'text-red-400' : 'text-primary'
          )}>
            {hasKnownBalance ? formatCurrencyBRL(account.balance ?? 0) : 'Cobrança'}
          </p>
        </div>
        <div className="mt-2 min-w-0">
          <p className="text-sm font-semibold truncate">{account.name}</p>
          <p className="text-[10px] font-mono text-muted-foreground truncate">
            {isMeta ? 'Meta Ads' : 'Google Ads'} · {account.id}
          </p>
        </div>
        <a
          href={account.paymentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'mt-3 flex h-8 items-center justify-center gap-1 rounded-md px-2 text-[10px] font-bold text-white transition-colors',
            isCritical ? 'bg-red-500 hover:bg-red-600' : 'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
          title={`Adicionar saldo no ${isMeta ? 'Meta Ads Manager' : 'Google Ads'}`}
        >
          <PlusCircle className="w-3 h-3" />
          Adicionar saldo
          <ExternalLink className="w-3 h-3 ml-0.5" />
        </a>
      </div>
    );
  }

  function renderPlatformColumn(platform: AdsBalancePlatform, accounts: AdAccountBalance[], visibleAccounts: AdAccountBalance[]) {
    const isMeta = platform === 'meta';
    const criticalAccounts = accounts.filter((account) => account.balance !== null && account.balance < LOW_BALANCE_THRESHOLD);

    return (
      <div className="rounded-xl border border-red-500/25 bg-background/40 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card">
              {isMeta ? <MetaAdsMark className="h-6 w-6" /> : <GoogleAdsMark className="h-6 w-6" />}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider">{isMeta ? 'Meta Ads' : 'Google Ads'}</p>
              <p className="text-[10px] text-muted-foreground">
                {criticalAccounts.length > 0
                  ? `${criticalAccounts.length} conta${criticalAccounts.length === 1 ? '' : 's'} crítica${criticalAccounts.length === 1 ? '' : 's'}`
                  : `${accounts.length} conta${accounts.length === 1 ? '' : 's'} conectada${accounts.length === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>
          {accounts.length > 0 && (
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-300">
              {accounts.length}
            </span>
          )}
        </div>

        {loading && critical.length === 0 ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2].map(i => <div key={i} className="h-28 bg-red-500/10 rounded-lg animate-pulse" />)}
          </div>
        ) : visibleAccounts.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleAccounts.map(renderAccountCard)}
          </div>
        ) : (
          <div className="flex h-28 items-center justify-center rounded-lg border border-border/60 bg-card/30 text-xs font-semibold text-muted-foreground">
            Nenhuma conta crítica
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-red-500/35 bg-red-500/5">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10">
            <AlertTriangle className="h-4 w-4 text-red-400" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold uppercase tracking-wider text-red-400">
              {loading && critical.length === 0 ? 'Verificando saldos...' : `${critical.length} conta${critical.length > 1 ? 's' : ''} com saldo crítico`}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {loading && critical.length === 0
                ? 'Buscando contas Meta Ads e Google Ads com saldo baixo.'
                : 'Alerta minimizado. Expanda para ver contas e adicionar saldo.'}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground">
              {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[10px] font-bold text-red-300 transition-colors hover:bg-red-500/10"
          >
            {expanded ? 'Minimizar' : 'Expandir'}
            <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-red-500/20 p-4">
          {metaCritical.length > 0 && renderPlatformColumn('meta', metaCritical, visibleMetaCritical)}
          {googleCritical.length > 0 && renderPlatformColumn('google', googleCritical, visibleGoogleCritical)}
        </div>
      )}
    </div>
  );
}

// ── Per-client investment summary ─────────────────────────────────────────────
type ClientSummaryRow = {
  clientId: string;
  clientName: string;
  metaTotal: number;
  googleTotal: number;
  tiktokTotal: number;
  metaBalance: number | null;
  googleBalance: number | null;
};

function ClientInvestmentSummary({
  payments,
  balances,
  clientLinks,
}: {
  payments: InvestmentPayment[];
  balances: AdAccountBalance[];
  clientLinks: ClientAccountLink[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (payments.length === 0) return null;

  // Group payments by client
  const map = new Map<string, ClientSummaryRow>();
  for (const p of payments) {
    if (!map.has(p.clientId)) {
      map.set(p.clientId, { clientId: p.clientId, clientName: p.clientName, metaTotal: 0, googleTotal: 0, tiktokTotal: 0, metaBalance: null, googleBalance: null });
    }
    const row = map.get(p.clientId)!;
    if (p.channel === 'Meta ADS') row.metaTotal += p.amount;
    else if (p.channel === 'Google ADS') row.googleTotal += p.amount;
    else if (p.channel === 'TikTok ADS') row.tiktokTotal += p.amount;
  }

  // Attach balances per client via linked accounts
  for (const link of clientLinks) {
    const row = map.get(link.clientId);
    if (!row) continue;
    if (link.platform === 'meta_ads') {
      const normalizedLink = link.accountId.replace(/^act_/, '');
      const balance = balances.find(b => b.platform === 'meta' && b.id.replace(/^act_/, '') === normalizedLink && b.balance !== null);
      if (balance) row.metaBalance = (row.metaBalance ?? 0) + (balance.balance ?? 0);
    }
    if (link.platform === 'google_ads') {
      const normalizedLink = link.accountId.replace(/\D/g, '');
      const balance = balances.find(b => b.platform === 'google' && b.id.replace(/\D/g, '') === normalizedLink && b.balance !== null);
      if (balance) row.googleBalance = (row.googleBalance ?? 0) + (balance.balance ?? 0);
    }
  }

  const rows = Array.from(map.values()).sort((a, b) => (b.metaTotal + b.googleTotal) - (a.metaTotal + a.googleTotal));
  const totalMeta = rows.reduce((sum, row) => sum + row.metaTotal, 0);
  const totalGoogle = rows.reduce((sum, row) => sum + row.googleTotal, 0);
  const totalTikTok = rows.reduce((sum, row) => sum + row.tiktokTotal, 0);
  const total = totalMeta + totalGoogle + totalTikTok;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-4 rounded-[var(--radius)] border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/30"
      >
        <div>
          <h2 className="font-bold text-sm uppercase tracking-wider">Compilado por Cliente</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {rows.length} cliente{rows.length !== 1 ? 's' : ''} · {payments.length} Pix · Total {formatCurrencyBRL(total)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            {totalMeta > 0 && <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[10px] font-bold text-blue-400">Meta {formatCurrencyBRL(totalMeta)}</span>}
            {totalGoogle > 0 && <span className="rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-400">Google {formatCurrencyBRL(totalGoogle)}</span>}
          </div>
          <span className="rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
            {expanded ? 'Minimizar' : 'Expandir'}
          </span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {expanded && (
      <div className="rounded-[var(--radius)] border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-[10px] uppercase tracking-widest">
            <tr>
              <th className="px-4 py-3 text-left">Cliente</th>
              <th className="px-4 py-3 text-right">
                <span className="flex items-center justify-end gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                  Meta ADS
                </span>
              </th>
              <th className="px-4 py-3 text-right text-muted-foreground/70">Saldo Meta</th>
              <th className="px-4 py-3 text-right">
                <span className="flex items-center justify-end gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                  Google ADS
                </span>
              </th>
              <th className="px-4 py-3 text-right text-muted-foreground/70">Saldo Google</th>
              {rows.some(r => r.tiktokTotal > 0) && (
                <th className="px-4 py-3 text-right">
                  <span className="flex items-center justify-end gap-1">
                    <span className="w-2 h-2 rounded-full bg-foreground/50 inline-block" />
                    TikTok ADS
                  </span>
                </th>
              )}
              <th className="px-4 py-3 text-right font-bold text-foreground">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(row => {
              const total = row.metaTotal + row.googleTotal + row.tiktokTotal;
              const balanceLow = row.metaBalance !== null && row.metaBalance < LOW_BALANCE_THRESHOLD;
              const googleBalanceLow = row.googleBalance !== null && row.googleBalance < LOW_BALANCE_THRESHOLD;
              return (
                <tr key={row.clientId} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-semibold">{row.clientName}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.metaTotal > 0 ? (
                      <span className="text-blue-400">{formatCurrencyBRL(row.metaTotal)}</span>
                    ) : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.metaBalance !== null ? (
                      <span className={cn('font-medium', balanceLow ? 'text-red-400' : 'text-muted-foreground')}>
                        {balanceLow && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                        {formatCurrencyBRL(row.metaBalance)}
                      </span>
                    ) : <span className="text-muted-foreground/40 text-xs">sem dados</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.googleTotal > 0 ? (
                      <span className="text-red-400">{formatCurrencyBRL(row.googleTotal)}</span>
                    ) : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.googleBalance !== null ? (
                      <span className={cn('font-medium', googleBalanceLow ? 'text-red-400' : 'text-muted-foreground')}>
                        {googleBalanceLow && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                        {formatCurrencyBRL(row.googleBalance)}
                      </span>
                    ) : <span className="text-muted-foreground/40 text-xs">sem dados</span>}
                  </td>
                  {rows.some(r => r.tiktokTotal > 0) && (
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.tiktokTotal > 0 ? formatCurrencyBRL(row.tiktokTotal) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{formatCurrencyBRL(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

type ViewMode = 'dia' | 'semana' | 'mes';

const STATUS_STYLES: Record<PaymentStatus, string> = {
  Pendente: 'bg-orange-500/20 text-orange-300 border-orange-400/30',
  Enviado: 'bg-sky-500/20 text-sky-300 border-sky-400/30',
  Pago: 'bg-primary/20 text-primary border-primary/30',
  'Em atraso': 'bg-red-500/20 text-red-300 border-red-400/30',
};

const CHANNEL_STYLES: Record<PaymentChannel, string> = {
  'Meta ADS': 'bg-blue-500/20 text-blue-300 border-blue-400/30',
  'Google ADS': 'bg-red-500/20 text-red-300 border-red-400/30',
  'TikTok ADS': 'bg-foreground/10 text-foreground border-border',
};

const STATUS_PALETTE: Record<PaymentStatus, { bg: string; border: string; text: string; dot: string }> = {
  Pendente:     { bg: 'bg-orange-500/10', border: 'border-orange-400/25', text: 'text-orange-300',  dot: '#f97316' },
  Enviado:      { bg: 'bg-sky-500/10',    border: 'border-sky-400/25',    text: 'text-sky-300',     dot: '#0ea5e9' },
  Pago:         { bg: 'bg-emerald-500/10',border: 'border-emerald-400/25',text: 'text-emerald-400', dot: '#10b981' },
  'Em atraso':  { bg: 'bg-red-500/10',    border: 'border-red-400/25',    text: 'text-red-400',     dot: '#ef4444' },
};

function PagSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 0.01);
  const w = 56, h = 20;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 opacity-80">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const WEEKDAY_LABELS = ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA'];
const WEEKDAY_COLORS = [
  'bg-emerald-600',
  'bg-fuchsia-600',
  'bg-blue-700',
  'bg-violet-700',
  'bg-orange-500',
];

function makeDate(day: number): string {
  return `2026-05-${String(day).padStart(2, '0')}`;
}

function formatDateBR(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekDates(date: string): string[] {
  const base = parseDate(date);
  const weekday = base.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(base);
  monday.setDate(base.getDate() + mondayOffset);

  return Array.from({ length: 5 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return toISODate(day);
  });
}

function getMonthWeekdays(date: string): string[] {
  const base = parseDate(date);
  const year = base.getFullYear();
  const month = base.getMonth();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const result: string[] = [];

  for (let day = 1; day <= totalDays; day++) {
    const current = new Date(year, month, day);
    const weekday = current.getDay();
    if (weekday !== 0 && weekday !== 6) result.push(toISODate(current));
  }

  return result;
}

function getMonthBusinessWeeks(date: string): string[][] {
  const base = parseDate(date);
  const year = base.getFullYear();
  const month = base.getMonth();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const weeks: string[][] = [];
  let week = Array<string>(5).fill('');

  for (let day = 1; day <= totalDays; day++) {
    const current = new Date(year, month, day);
    const weekday = current.getDay();

    if (weekday === 0 || weekday === 6) continue;

    const col = weekday - 1;
    week[col] = toISODate(current);

    if (col === 4) {
      weeks.push(week);
      week = Array<string>(5).fill('');
    }
  }

  if (week.some(Boolean)) weeks.push(week);
  return weeks;
}

function isBusinessDate(date: string): boolean {
  const weekday = parseDate(date).getDay();
  return weekday !== 0 && weekday !== 6;
}

function getMonthLabel(date: string): string {
  const d = parseDate(date);
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shiftMonth(date: string, delta: number): string {
  const d = parseDate(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return toISODate(d);
}

function isDateInView(date: string, selectedDate: string, viewMode: ViewMode): boolean {
  if (!isBusinessDate(date)) return false;
  if (viewMode === 'dia') return date === selectedDate;
  if (viewMode === 'semana') return getWeekDates(selectedDate).includes(date);

  const current = parseDate(date);
  const selected = parseDate(selectedDate);
  return current.getFullYear() === selected.getFullYear() && current.getMonth() === selected.getMonth();
}

function scopeLabel(selectedDate: string, viewMode: ViewMode): string {
  if (viewMode === 'dia') return formatDateBR(selectedDate);
  if (viewMode === 'semana') {
    const week = getWeekDates(selectedDate);
    return `${formatDateBR(week[0])} a ${formatDateBR(week[week.length - 1])}`;
  }

  const date = parseDate(selectedDate);
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function StatusDropdown({ value, onChange }: { value: PaymentStatus; onChange: (status: PaymentStatus) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn('h-7 min-w-24 rounded-md border px-2 text-left text-[10px] font-bold transition-colors', STATUS_STYLES[value])}
      >
        {value}
      </button>
      {open && (
        <div className="grid w-44 grid-cols-2 gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {PAYMENT_STATUS_OPTIONS.filter((status) => status !== value).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => {
                onChange(status);
                setOpen(false);
              }}
              className="h-7 rounded-md px-2 text-[10px] font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {status}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HolidayPaymentNotice({ date, compact = false }: { date: string; compact?: boolean }) {
  const holiday = getHoliday(date);
  if (!holiday) return null;

  const sendDate = previousBusinessDay(date);

  return (
    <div className={cn(
      'rounded-lg border border-orange-400/30 bg-orange-500/10 text-orange-200',
      compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-2 text-xs',
    )}>
      <div className="flex items-start gap-1.5">
        <AlertTriangle className={cn('shrink-0', compact ? 'mt-0.5 h-3 w-3' : 'mt-0.5 h-4 w-4')} />
        <div>
          <p className="font-bold">{holiday.name}</p>
          <p className="text-orange-200/80">Enviar Pix até {formatHolidayDateBR(sendDate)}</p>
        </div>
      </div>
    </div>
  );
}

function StatusFilter({ value, onChange }: {
  value: PaymentStatus | 'Todos';
  onChange: (status: PaymentStatus | 'Todos') => void;
}) {
  const options: Array<PaymentStatus | 'Todos'> = ['Todos', ...PAYMENT_STATUS_OPTIONS];

  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
      {options.map((status) => {
        const selected = status === value;

        return (
          <button
            key={status}
            type="button"
            onClick={() => onChange(status)}
            className={cn(
              'h-7 rounded-md px-2 text-[10px] font-bold transition-colors',
              selected
                ? status === 'Todos' ? 'bg-foreground/10 text-foreground' : STATUS_STYLES[status]
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {status}
          </button>
        );
      })}
    </div>
  );
}

function CurrencyInput({ value, onChange, className }: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? formatCurrencyInputBRL(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseCurrencyBRL(e.target.value));
      }}
      onFocus={() => setDraft(formatCurrencyInputBRL(value))}
      onBlur={(e) => {
        onChange(parseCurrencyBRL(e.target.value));
        setDraft(null);
      }}
      className={className}
    />
  );
}

function PaymentMetricCard({
  label,
  value,
  color,
  glow,
  icon: Icon,
  sub,
  trend,
}: {
  label: string;
  value: number;
  color: string;
  glow: string;
  icon: ElementType;
  sub: ReactNode;
  trend: number[];
}) {
  return (
    <div
      className="relative min-h-[126px] overflow-hidden rounded-xl border p-4"
      style={{
        borderColor: `${color}35`,
        background: `radial-gradient(circle at 12% 28%, ${glow}, transparent 34%), linear-gradient(135deg, ${color}12, rgba(15,18,29,0.88) 58%, rgba(6,8,15,0.94))`,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.025), 0 0 26px ${color}12`,
      }}
    >
      <div className="flex items-start gap-4">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: `${color}22`, boxShadow: `0 0 22px ${color}28` }}
        >
          <Icon className="h-5 w-5" style={{ color }} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{label}</p>
          <p className="mt-2 font-heading font-normal text-xl leading-none text-foreground tabular-nums">
            {formatCurrencyBRL(value)}
          </p>
          <div className="mt-4 text-[11px] font-bold leading-none">{sub}</div>
        </div>
      </div>
      <div className="absolute bottom-4 right-4">
        <PagSparkline data={trend} color={color} />
      </div>
    </div>
  );
}

function DayMetricCard({
  label,
  value,
  color,
  glow,
  icon: Icon,
  count,
}: {
  label: string;
  value: number;
  color: string;
  glow: string;
  icon: ElementType;
  count: string;
}) {
  return (
    <div
      className="relative min-h-[118px] overflow-hidden rounded-xl border p-5"
      style={{
        borderColor: `${color}30`,
        background: `radial-gradient(circle at 10% 30%, ${glow}, transparent 36%), linear-gradient(135deg, ${color}10, rgba(10,13,22,0.9) 58%, rgba(5,8,14,0.96))`,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.025), 0 0 28px ${color}10`,
      }}
    >
      <div className="flex items-start gap-4">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: `${color}22`, boxShadow: `0 0 22px ${color}26` }}
        >
          <Icon className="h-5 w-5" style={{ color }} />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{label}</p>
          <p className="mt-3 font-heading font-normal text-xl leading-none text-foreground tabular-nums">
            {formatCurrencyBRL(value)}
          </p>
          <p className="mt-5 text-xs font-bold" style={{ color }}>{count}</p>
        </div>
      </div>
    </div>
  );
}

function MonthStatusIcon({ status }: { status: PaymentStatus }) {
  const cls = {
    Pendente: 'border-orange-400 text-orange-400',
    Enviado: 'border-sky-400 text-sky-400',
    Pago: 'border-primary text-primary',
    'Em atraso': 'border-rose-400 text-rose-400',
  }[status];

  const Icon = status === 'Pendente' ? Clock3 : status === 'Enviado' ? Send : status === 'Pago' ? CheckCircle2 : AlertTriangle;
  return (
    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', cls)}>
      <Icon className="h-3 w-3" />
    </span>
  );
}

// ── Edit Payment Modal ────────────────────────────────────────────────────────
function EditPaymentModal({
  payment,
  clients,
  onSave,
  onClose,
}: {
  payment: InvestmentPayment;
  clients: { id: string; name: string }[];
  onSave: (fields: Partial<Omit<InvestmentPayment, 'id'>>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    clientId: payment.clientId,
    clientName: payment.clientName,
    date: payment.date,
    destination: payment.destination,
    channel: payment.channel,
    amount: payment.amount,
    status: payment.status,
    extra: payment.extra ?? false,
  });

  function handleClientChange(clientId: string) {
    const client = clients.find(c => c.id === clientId);
    if (client) setForm(f => ({ ...f, clientId: client.id, clientName: client.name }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      clientId: form.clientId,
      clientName: form.clientName,
      date: form.date,
      destination: form.destination,
      channel: form.channel,
      amount: form.amount,
      status: form.status,
      extra: form.extra,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-violet-400/30 bg-card shadow-[0_0_60px_rgba(124,58,237,0.20)] p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/20 text-violet-300">
              <Pencil className="h-3.5 w-3.5" />
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider">Editar Pagamento</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground">Cliente</span>
              <select
                value={form.clientId}
                onChange={e => handleClientChange(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-violet-400"
              >
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground">Data de envio</span>
              <Input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="h-10 bg-background focus:border-violet-400"
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-foreground">Destino / Campanha</span>
            <Input
              value={form.destination}
              onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
              placeholder="Nome da campanha ou destino"
              className="h-10 bg-background focus:border-violet-400"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground">Canal</span>
              <select
                value={form.channel}
                onChange={e => setForm(f => ({ ...f, channel: e.target.value as PaymentChannel }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-violet-400"
              >
                {PAYMENT_CHANNELS.filter(ch => ch !== 'Todos').map(ch => <option key={ch}>{ch}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground">Valor</span>
              <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-violet-400">
                <span className="text-sm font-bold text-muted-foreground">R$</span>
                <CurrencyInput
                  value={form.amount}
                  onChange={amount => setForm(f => ({ ...f, amount }))}
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none"
                />
              </div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground">Status</span>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as PaymentStatus }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-bold text-amber-400 outline-none focus:border-violet-400"
              >
                {PAYMENT_STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-2 pb-0.5">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, extra: !f.extra }))}
                className={cn(
                  'flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border text-sm font-bold transition-colors',
                  form.extra
                    ? 'border-violet-400/60 bg-violet-500/20 text-violet-300'
                    : 'border-border bg-background text-muted-foreground hover:text-violet-300',
                )}
              >
                <Zap className={cn('h-3.5 w-3.5', form.extra && 'fill-violet-400')} />
                Extra
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
              Cancelar
            </button>
            <button type="submit" className="flex-1 h-10 rounded-lg bg-violet-500 text-sm font-bold text-white hover:bg-violet-400 transition-colors shadow-[0_0_20px_rgba(124,58,237,0.35)]">
              Salvar alterações
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MonthPaymentCard({
  payment,
  index,
  onStatusChange,
  onDelete,
  onToggleExtra,
  onEdit,
}: {
  payment: InvestmentPayment;
  index: number;
  onStatusChange: (status: PaymentStatus) => void;
  onDelete: () => void;
  onToggleExtra: () => void;
  onEdit: () => void;
}) {
  const statusTone: Record<PaymentStatus, { border: string; bg: string; text: string; amount: string }> = {
    Pendente: { border: 'border-orange-400/55', bg: 'bg-orange-500/13', text: 'text-orange-300', amount: 'text-orange-300' },
    Enviado: { border: 'border-sky-400/55', bg: 'bg-sky-500/13', text: 'text-sky-300', amount: 'text-sky-300' },
    Pago: { border: 'border-primary/55', bg: 'bg-primary/13', text: 'text-primary', amount: 'text-primary' },
    'Em atraso': { border: 'border-rose-400/55', bg: 'bg-rose-500/13', text: 'text-rose-300', amount: 'text-rose-300' },
  };
  const extraTone = { border: 'border-violet-400/55', bg: 'bg-violet-500/13', text: 'text-violet-300', amount: 'text-violet-300' };
  const tone = payment.extra ? extraTone : statusTone[payment.status];
  const times = ['08:00', '09:30', '10:30', '11:30', '13:00', '14:00', '15:30', '16:00', '18:00'];
  const time = times[index % times.length];

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', payment.id); e.dataTransfer.effectAllowed = 'move'; }}
      className={cn('group relative min-h-[68px] cursor-grab overflow-hidden rounded-lg border px-2.5 py-2 transition-colors hover:bg-card/80 active:cursor-grabbing', tone.border, tone.bg)}
      style={{ boxShadow: payment.extra ? '0 0 22px rgba(168,85,247,0.35), inset 0 0 18px rgba(0,0,0,0.18)' : `0 0 16px ${tone.amount === 'text-primary' ? 'rgba(85,245,47,0.12)' : 'rgba(0,0,0,0.16)'}, inset 0 0 18px rgba(0,0,0,0.18)` }}
    >
      {payment.extra && (
        <span className="absolute inset-y-0 left-0 w-[3px] bg-violet-500 shadow-[2px_0_10px_rgba(168,85,247,0.7)]" />
      )}
      <button type="button" onClick={onEdit} className="grid w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 text-left">
        <PaymentChannelLogo channel={payment.channel} className="h-9 w-10" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className={cn('shrink-0 text-[10px] font-bold leading-none tabular-nums', tone.text)}>{time}</p>
            <p className="truncate text-xs font-bold leading-tight text-foreground">{payment.clientName}</p>
          </div>
          <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">{payment.channel.replace(' ADS', ' Ads')}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <p className={cn('font-heading font-normal text-sm leading-none tabular-nums', tone.amount)}>
              {formatCurrencyBRL(payment.amount)}
            </p>
            {payment.extra && (
              <span className="inline-flex items-center gap-0.5 rounded border border-violet-500/50 bg-violet-500/20 px-1 py-0.5 text-[8px] font-black uppercase tracking-wide text-violet-300">
                <Zap className="h-2 w-2 fill-violet-400" /> EXTRA
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            onClick={onToggleExtra}
            title={payment.extra ? 'Remover destaque extra' : 'Marcar como extra'}
            className={cn('rounded-full p-0.5 transition-all', payment.extra ? 'text-violet-400' : 'opacity-0 text-muted-foreground/30 group-hover:opacity-100 hover:text-violet-400')}
          >
            <Zap className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              const current = PAYMENT_STATUS_OPTIONS.indexOf(payment.status);
              onStatusChange(PAYMENT_STATUS_OPTIONS[(current + 1) % PAYMENT_STATUS_OPTIONS.length]);
            }}
            title="Alterar status"
            className="rounded-full opacity-90 transition-opacity group-hover:opacity-100"
          >
            <MonthStatusIcon status={payment.status} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Excluir pagamento"
            className="rounded-full p-0.5 text-muted-foreground/30 opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </button>
    </div>
  );
}

function DayTimelinePaymentCard({
  payment,
  index,
  onStatusChange,
  onDelete,
  onToggleExtra,
  onEdit,
}: {
  payment: InvestmentPayment;
  index: number;
  onStatusChange: (status: PaymentStatus) => void;
  onDelete: () => void;
  onToggleExtra: () => void;
  onEdit: () => void;
}) {
  const config: Record<PaymentStatus, { border: string; bg: string; text: string; pill: string; glow: string }> = {
    Pendente: {
      border: 'border-orange-400/60',
      bg: 'bg-orange-500/12',
      text: 'text-orange-300',
      pill: 'border-orange-400/35 bg-orange-500/15 text-orange-300',
      glow: 'rgba(245,158,11,0.16)',
    },
    Enviado: {
      border: 'border-sky-400/60',
      bg: 'bg-sky-500/12',
      text: 'text-sky-300',
      pill: 'border-sky-400/35 bg-sky-500/15 text-sky-300',
      glow: 'rgba(36,152,255,0.16)',
    },
    Pago: {
      border: 'border-primary/60',
      bg: 'bg-primary/12',
      text: 'text-primary',
      pill: 'border-primary/35 bg-primary/15 text-primary',
      glow: 'rgba(85,245,47,0.14)',
    },
    'Em atraso': {
      border: 'border-rose-400/60',
      bg: 'bg-rose-500/12',
      text: 'text-rose-300',
      pill: 'border-rose-400/35 bg-rose-500/15 text-rose-300',
      glow: 'rgba(255,71,120,0.16)',
    },
  };
  const extraConfig = { border: 'border-violet-400/60', bg: 'bg-violet-500/12', text: 'text-violet-300', pill: 'border-violet-400/35 bg-violet-500/15 text-violet-300', glow: 'rgba(168,85,247,0.16)' };
  const tone = payment.extra ? extraConfig : config[payment.status];
  const times = ['08:30', '09:45', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30', '17:30'];
  const time = times[index % times.length];

  return (
    <div
      className={cn('group relative overflow-hidden rounded-xl border px-4 py-3', tone.border, tone.bg)}
      style={{
        background: `radial-gradient(circle at 8% 50%, ${tone.glow}, transparent 34%), rgba(10,14,24,0.82)`,
        boxShadow: payment.extra
          ? '0 0 22px rgba(168,85,247,0.35), inset 0 0 18px rgba(0,0,0,0.18)'
          : `0 0 24px ${tone.glow}, inset 0 0 0 1px rgba(255,255,255,0.025)`,
      }}
    >
      {payment.extra && (
        <span className="absolute inset-y-0 left-0 w-[3px] bg-violet-500 shadow-[2px_0_10px_rgba(168,85,247,0.7)]" />
      )}
      <button type="button" onClick={onEdit} className="flex w-full items-center justify-between gap-4 text-left">
        <div className="flex min-w-0 items-center gap-4">
          <PaymentChannelLogo channel={payment.channel} className="h-11 w-11" />
          <div className="min-w-0">
            <div className="flex items-center gap-6">
              <p className={cn('text-xs font-bold tabular-nums', tone.text)}>{time}</p>
              <p className="truncate text-sm font-bold text-foreground">{payment.clientName}</p>
              {payment.extra && (
                <span className="inline-flex items-center gap-0.5 rounded border border-violet-500/50 bg-violet-500/20 px-1 py-0.5 text-[8px] font-black uppercase tracking-wide text-violet-300">
                  <Zap className="h-2 w-2 fill-violet-400" /> EXTRA
                </span>
              )}
            </div>
            <p className="mt-1 text-xs font-medium text-muted-foreground">{payment.channel.replace(' ADS', ' Ads')}</p>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1" onClick={e => e.stopPropagation()}>
          <p className="font-heading font-normal text-sm text-foreground tabular-nums">{formatCurrencyBRL(payment.amount)}</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleExtra}
              title={payment.extra ? 'Remover destaque extra' : 'Marcar como extra'}
              className={cn('rounded-full p-1 transition-all', payment.extra ? 'text-violet-400' : 'opacity-0 text-muted-foreground/30 group-hover:opacity-100 hover:text-violet-400')}
            >
              <Zap className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                const current = PAYMENT_STATUS_OPTIONS.indexOf(payment.status);
                onStatusChange(PAYMENT_STATUS_OPTIONS[(current + 1) % PAYMENT_STATUS_OPTIONS.length]);
              }}
              className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold', tone.pill)}
            >
              {payment.status}
              <MonthStatusIcon status={payment.status} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              title="Excluir pagamento"
              className="rounded-full border border-border p-1 text-muted-foreground/40 transition-colors hover:border-red-500/40 hover:text-red-400"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </button>
    </div>
  );
}

function WeekPaymentCard({
  payment,
  index,
  onStatusChange,
  onDelete,
  onToggleExtra,
  onEdit,
}: {
  payment: InvestmentPayment;
  index: number;
  onStatusChange: (status: PaymentStatus) => void;
  onDelete: () => void;
  onToggleExtra: () => void;
  onEdit: () => void;
}) {
  const toneMap: Record<PaymentStatus, { border: string; bg: string; text: string; dot: string; label: string }> = {
    Pendente: { border: 'border-orange-400/45', bg: 'bg-orange-500/10', text: 'text-orange-300', dot: '#f59e0b', label: 'PENDENTE' },
    Enviado: { border: 'border-sky-400/45', bg: 'bg-sky-500/10', text: 'text-sky-300', dot: '#2498ff', label: 'ENVIADO' },
    Pago: { border: 'border-primary/45', bg: 'bg-primary/10', text: 'text-primary', dot: '#55f52f', label: 'PAGO' },
    'Em atraso': { border: 'border-rose-400/45', bg: 'bg-rose-500/10', text: 'text-rose-300', dot: '#ff4778', label: 'ATRASO' },
  };
  const extraCfg = { border: 'border-violet-400/45', bg: 'bg-violet-500/10', text: 'text-violet-300', dot: '#a855f7', label: 'EXTRA' };
  const cfg = payment.extra ? extraCfg : toneMap[payment.status];
  const times = ['09:00', '09:30', '10:00', '11:00', '11:30', '12:00', '13:00', '14:00', '14:30', '15:00', '16:30', '17:00'];
  const time = times[index % times.length];

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', payment.id); e.dataTransfer.effectAllowed = 'move'; }}
      className={cn('group relative cursor-grab overflow-hidden rounded-lg border px-3 py-2.5 transition-colors hover:bg-card/80 active:cursor-grabbing', cfg.border, cfg.bg)}
      style={{
        boxShadow: payment.extra ? '0 0 22px rgba(168,85,247,0.35), inset 0 0 0 1px rgba(255,255,255,0.02)' : `0 0 18px ${cfg.dot}14, inset 0 0 0 1px rgba(255,255,255,0.02)`,
      }}
    >
      {payment.extra && (
        <span className="absolute inset-y-0 left-0 w-[3px] bg-violet-500 shadow-[2px_0_10px_rgba(168,85,247,0.7)]" />
      )}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-muted-foreground tabular-nums">{time}</span>
          {payment.extra && (
            <span className="inline-flex items-center gap-0.5 rounded border border-violet-500/50 bg-violet-500/20 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-violet-300">
              <Zap className="h-2.5 w-2.5 fill-violet-400" /> EXTRA
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const current = PAYMENT_STATUS_OPTIONS.indexOf(payment.status);
              onStatusChange(PAYMENT_STATUS_OPTIONS[(current + 1) % PAYMENT_STATUS_OPTIONS.length]);
            }}
            className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-bold', cfg.text)}
            style={{ background: `${cfg.dot}18` }}
            title="Alterar status"
          >
            {cfg.label}
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: cfg.dot }} />
          </button>
          <button
            type="button"
            onClick={onToggleExtra}
            title={payment.extra ? 'Remover destaque extra' : 'Marcar como extra'}
            className={cn('rounded-full p-0.5 transition-all', payment.extra ? 'text-violet-400' : 'opacity-0 text-muted-foreground/30 group-hover:opacity-100 hover:text-violet-400')}
          >
            <Zap className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Excluir pagamento"
            className="rounded-full p-0.5 text-muted-foreground/30 opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <button type="button" onClick={onEdit} className="flex w-full items-center gap-3 text-left">
        <PaymentChannelLogo channel={payment.channel} className="h-9 w-9" />
        <div className="min-w-0">
          <p className="truncate text-xs font-bold leading-tight text-foreground">{payment.clientName}</p>
          <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">{payment.channel.replace(' ADS', ' Ads')}</p>
          <p className={cn('mt-1 font-heading font-normal text-sm leading-none tabular-nums', cfg.text)}>{formatCurrencyBRL(payment.amount)}</p>
        </div>
      </button>
    </div>
  );
}

function WeekChannelSummaryCard({
  channel,
  value,
  total,
  trend,
}: {
  channel: 'Meta Ads' | 'Google Ads';
  value: number;
  total: number;
  trend: number[];
}) {
  const isMeta = channel === 'Meta Ads';
  const color = isMeta ? '#2498ff' : '#55f52f';
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: `${color}32`,
        background: `radial-gradient(circle at 12% 20%, ${color}18, transparent 42%), rgba(10,14,24,0.72)`,
        boxShadow: `0 0 24px ${color}0f`,
      }}
    >
      <div className="flex items-center gap-3">
        {isMeta ? <MetaAdsMark className="h-10 w-10 shrink-0" /> : <GoogleAdsMark className="h-10 w-10 shrink-0" />}
        <div>
          <p className="text-sm font-medium text-muted-foreground">{channel}</p>
          <p className="mt-2 font-heading font-normal text-xl leading-none text-foreground tabular-nums">{formatCurrencyBRL(value)}</p>
          <p className="mt-2 text-xs font-bold text-muted-foreground">{pct.toFixed(1)}% do total</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <PagSparkline data={trend} color={color} />
      </div>
    </div>
  );
}

export default function PagamentosPage() {
  const { clients } = useClients();
  const { payments, addPayment, updatePayment, updatePaymentStatus, deletePayment, movePaymentDate, togglePaymentExtra } = useInvestmentPayments();
  const [editingPayment, setEditingPayment] = useState<InvestmentPayment | null>(null);
  const visibleClientIds = new Set(clients.map((client) => client.id));
  const visiblePayments = payments.filter((payment) => visibleClientIds.has(payment.clientId));

  // ── Lifted balance state ──────────────────────────────────────────────────
  const [balances, setBalances] = useState<AdAccountBalance[]>([]);
  const [clientLinks, setClientLinks] = useState<ClientAccountLink[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesLastUpdated, setBalancesLastUpdated] = useState<Date | null>(null);

  const loadBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      const [metaRes, googleRes, linksRes] = await Promise.all([
        fetch('/api/meta/account-balances'),
        fetch('/api/google/account-balances'),
        fetch('/api/clients/links'),
      ]);

      const metaRaw: Array<Omit<AdAccountBalance, 'platform' | 'paymentUrl'>> = metaRes.ok ? await metaRes.json() : [];
      const googleRaw: Array<Omit<AdAccountBalance, 'platform' | 'paymentUrl'>> = googleRes.ok ? await googleRes.json() : [];
      const links: ClientAccountLink[] = linksRes.ok ? await linksRes.json() : [];

      const metaBalances: AdAccountBalance[] = metaRaw.map((account) => ({
        ...account,
        platform: 'meta',
        paymentUrl: `https://business.facebook.com/ads/manager/billing/?act=${account.id.replace('act_', '')}`,
      }));
      const googleBalances: AdAccountBalance[] = googleRaw.map((account) => ({
        ...account,
        platform: 'google',
        paymentUrl: `https://ads.google.com/aw/billing/summary?ocid=${account.id.replace(/\D/g, '')}&__c=${account.id.replace(/\D/g, '')}`,
      }));

      const metaLinked = new Set(links.filter(l => l.platform === 'meta_ads').map(l => l.accountId.replace(/^act_/, '')));
      const googleLinked = new Set(links.filter(l => l.platform === 'google_ads').map(l => l.accountId.replace(/\D/g, '')));
      const linkedBalances = [
        ...metaBalances.filter(b => metaLinked.has(b.id.replace(/^act_/, ''))),
        ...googleBalances.filter(b => googleLinked.has(b.id.replace(/\D/g, ''))),
      ];

      setClientLinks(links);
      setBalances(linkedBalances);
      setBalancesLastUpdated(new Date());
    } finally {
      setBalancesLoading(false);
    }
  }, []);

  useEffect(() => { loadBalances(); }, [loadBalances]);

  const activeClientIds = new Set(clients.filter(c => c.status === 'Ativo').map(c => c.id));
  const activeClientLinks = clientLinks.filter(l => activeClientIds.has(l.clientId));
  const balanceAlertClientLinks = activeClientLinks.filter((link) => {
    const client = clients.find(c => c.id === link.clientId);
    const billingMode = client?.ads_billing_mode
      ?? (typeof window !== 'undefined' ? localStorage.getItem(`${CLIENT_BILLING_MODE_PREFIX}${link.clientId}`) : null)
      ?? 'prepaid';
    return billingMode !== 'card';
  });
  const activeBalances = balances.filter(b =>
    balanceAlertClientLinks.some(l => {
      if (l.platform === 'meta_ads' && b.platform === 'meta')
        return b.id.replace(/^act_/, '') === l.accountId.replace(/^act_/, '');
      if (l.platform === 'google_ads' && b.platform === 'google')
        return b.id.replace(/\D/g, '') === l.accountId.replace(/\D/g, '');
      return false;
    })
  );

  // Helper: get total Meta balance for a client
  function getClientMetaBalance(clientId: string): number | null {
    const accountIds = activeClientLinks
      .filter((link) => link.clientId === clientId && link.platform === 'meta_ads')
      .map((link) => link.accountId);
    const linked = activeBalances.filter(b => b.platform === 'meta' && accountIds.includes(b.id) && b.balance !== null);
    if (linked.length === 0) return null;
    return linked.reduce((sum, b) => sum + (b.balance ?? 0), 0);
  }

  function getClientGoogleBalance(clientId: string): number | null {
    const accountIds = activeClientLinks
      .filter((link) => link.clientId === clientId && link.platform === 'google_ads')
      .map((link) => link.accountId);
    const linked = activeBalances.filter(b => b.platform === 'google' && accountIds.includes(b.id) && b.balance !== null);
    if (linked.length === 0) return null;
    return linked.reduce((sum, b) => sum + (b.balance ?? 0), 0);
  }
  const [selectedDate, setSelectedDate] = useState(makeDate(6));
  const [viewMode, setViewMode] = useState<ViewMode>('mes');
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'Todos'>('Todos');
  const [channelFilter, setChannelFilter] = useState<PaymentChannel | 'Todos'>('Todos');
  const [newPayment, setNewPayment] = useState<Omit<InvestmentPayment, 'id'>>({
    clientId: clients[0]?.id ?? '',
    clientName: clients[0]?.name ?? '',
    date: makeDate(6),
    destination: clients[0] ? `${clients[0].name} - Novo investimento` : '',
    amount: 500,
    channel: 'Meta ADS',
    status: 'Pendente',
    extra: false,
  });
  const formRef = useRef<HTMLDivElement>(null);

  type RecurMode = 'none' | 'weekdays' | 'interval' | 'monthly';
  const [recurMode, setRecurMode] = useState<RecurMode>('none');
  const [recurWeekdays, setRecurWeekdays] = useState<number[]>([1, 2, 3, 4, 5]); // 0=Dom,1=Seg..6=Sáb
  const [recurInterval, setRecurInterval] = useState(7);
  const [recurHasEnd, setRecurHasEnd] = useState(false);
  const [recurUntil, setRecurUntil] = useState('');

  function getMonthEnd(dateStr: string): string {
    const d = parseDate(dateStr);
    return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }

  function addMonthsToDate(dateStr: string, months: number): string {
    const d = parseDate(dateStr);
    d.setMonth(d.getMonth() + months);
    return toISODate(d);
  }

  function generateRecurDates(
    startDate: string,
    mode: Exclude<RecurMode, 'none'>,
    weekdays: number[],
    intervalDays: number,
    until: string,
  ): string[] {
    const dates: string[] = [];
    const start = parseDate(startDate);
    const end = parseDate(until);
    if (end < start) return dates;
    if (mode === 'weekdays') {
      if (weekdays.length === 0) return dates;
      const cur = new Date(start);
      while (cur <= end) {
        if (weekdays.includes(cur.getDay())) dates.push(toISODate(cur));
        cur.setDate(cur.getDate() + 1);
      }
    } else if (mode === 'interval') {
      const step = Math.max(1, intervalDays);
      const cur = new Date(start);
      while (cur <= end) {
        dates.push(toISODate(cur));
        cur.setDate(cur.getDate() + step);
      }
    } else if (mode === 'monthly') {
      const cur = new Date(start);
      while (cur <= end) {
        dates.push(toISODate(cur));
        cur.setMonth(cur.getMonth() + 1);
      }
    }
    return dates;
  }

  const recurUntilResolved = recurHasEnd && recurUntil
    ? recurUntil
    : addMonthsToDate(newPayment.date, 12);
  const previewDates = recurMode !== 'none'
    ? generateRecurDates(newPayment.date, recurMode, recurWeekdays, recurInterval, recurUntilResolved)
    : [];
  const previewCount = previewDates.length;

  const filteredPayments = visiblePayments.filter((payment) => {
    const dateMatches = isDateInView(payment.date, selectedDate, viewMode);
    const statusMatches = statusFilter === 'Todos' || payment.status === statusFilter;
    const channelMatches = channelFilter === 'Todos' || payment.channel === channelFilter;
    return dateMatches && statusMatches && channelMatches;
  });

  const selectedScopePayments = visiblePayments.filter((payment) => isDateInView(payment.date, selectedDate, viewMode));
  const totalDay = selectedScopePayments.reduce((sum, payment) => sum + payment.amount, 0);
  const pendingDay = selectedScopePayments.filter((payment) => payment.status === 'Pendente').reduce((sum, payment) => sum + payment.amount, 0);
  const sentDay = selectedScopePayments.filter((payment) => payment.status === 'Enviado').reduce((sum, payment) => sum + payment.amount, 0);
  const paidDay = selectedScopePayments.filter((payment) => payment.status === 'Pago').reduce((sum, payment) => sum + payment.amount, 0);
  const overdueDay = selectedScopePayments.filter((payment) => payment.status === 'Em atraso').reduce((sum, payment) => sum + payment.amount, 0);

  const availableDates = Array.from(new Set(visiblePayments.map((payment) => payment.date))).sort();
  const weekDates = getWeekDates(selectedDate);
  const monthWeeks = getMonthBusinessWeeks(selectedDate);
  const monthAllWeeks = monthWeeks;
  const summaryLabel = viewMode === 'dia' ? 'do dia' : 'do período';
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    if (clients.length === 0) {
      setNewPayment((prev) => ({ ...prev, clientId: '', clientName: '', destination: '' }));
      return;
    }

    if (!clients.some((client) => client.id === newPayment.clientId)) {
      const firstClient = clients[0];
      setNewPayment((prev) => ({
        ...prev,
        clientId: firstClient.id,
        clientName: firstClient.name,
        destination: `${firstClient.name} - Novo investimento`,
      }));
    }
  }, [clients, newPayment.clientId]);

  function handleClientChange(clientId: string) {
    const client = clients.find((item) => item.id === clientId);
    if (!client) return;

    setNewPayment((prev) => ({
      ...prev,
      clientId: client.id,
      clientName: client.name,
      destination: `${client.name} - Novo investimento`,
    }));
  }

  function handleAddPayment() {
    if (!newPayment.clientId || !newPayment.destination.trim() || newPayment.amount <= 0) return;
    const base = { ...newPayment, destination: newPayment.destination.trim() };

    if (recurMode === 'none') {
      addPayment(base);
      setSelectedDate(newPayment.date);
    } else {
      const dates = previewDates;
      for (const date of dates) addPayment({ ...base, date });
      if (dates.length > 0) setSelectedDate(dates[0]);
    }

    setNewPayment((prev) => ({ ...prev, destination: `${prev.clientName} - Novo investimento`, amount: 500, extra: false }));
    setRecurMode('none');
    setRecurHasEnd(false);
    setRecurUntil('');
  }

  const todayStr = toISODate(new Date());

  return (
    <div className="space-y-5 pb-10">
      {editingPayment && (
        <EditPaymentModal
          payment={editingPayment}
          clients={clients}
          onSave={(fields) => updatePayment(editingPayment.id, fields)}
          onClose={() => setEditingPayment(null)}
        />
      )}
      <div className="flex flex-wrap items-start justify-between gap-4 pt-2">
        <div>
          <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">Acompanhamento de Pagamentos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gerencie investimentos, recorrências e status dos pagamentos dos clientes.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex h-11 items-center gap-1 rounded-[var(--radius)] border border-border bg-card/70 p-1">
            {([
              { key: 'dia' as ViewMode, label: 'Dia' },
              { key: 'semana' as ViewMode, label: 'Semana' },
              { key: 'mes' as ViewMode, label: 'Mês' },
            ]).map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() => setViewMode(mode.key)}
                className={cn(
                  'h-8 rounded-lg px-5 text-sm font-bold transition-all',
                  viewMode === mode.key
                    ? 'bg-primary/25 text-primary shadow-[0_0_14px_rgba(85,245,47,0.28)] ring-1 ring-primary/35'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="flex h-11 items-center gap-3 rounded-[var(--radius)] border border-border bg-card/70 px-4">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setNewPayment((p) => ({ ...p, date: e.target.value }));
              }}
              className="w-36 bg-transparent text-sm font-bold text-foreground outline-none"
            />
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </div>

      {(activeBalances.length > 0 || balancesLoading) && (
        <CriticalBalanceAlerts balances={activeBalances} loading={balancesLoading} lastUpdated={balancesLastUpdated} onRefresh={loadBalances} />
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        {viewMode === 'dia' ? (
          <>
            <DayMetricCard label="Total do dia" value={totalDay} color="#a855f7" glow="rgba(168,85,247,0.18)" icon={WalletCards} count={`${selectedScopePayments.length} pagamentos`} />
            <DayMetricCard label="Pendente" value={pendingDay} color="#f59e0b" glow="rgba(245,158,11,0.16)" icon={Clock3} count={`${selectedScopePayments.filter(p => p.status === 'Pendente').length} pagamentos`} />
            <DayMetricCard label="Enviado" value={sentDay} color="#2498ff" glow="rgba(36,152,255,0.17)" icon={Send} count={`${selectedScopePayments.filter(p => p.status === 'Enviado').length} pagamentos`} />
            <DayMetricCard label="Pago" value={paidDay} color="#55f52f" glow="rgba(85,245,47,0.16)" icon={CheckCircle2} count={`${selectedScopePayments.filter(p => p.status === 'Pago').length} pagamentos`} />
            <DayMetricCard label="Em atraso" value={overdueDay} color="#ff4778" glow="rgba(255,71,120,0.16)" icon={AlertTriangle} count={`${selectedScopePayments.filter(p => p.status === 'Em atraso').length} pagamentos`} />
          </>
        ) : (
          <>
            <PaymentMetricCard label="Total do período" value={totalDay} color="#a855f7" glow="rgba(168,85,247,0.18)" icon={WalletCards} sub={<span className="text-primary">▲ 11,2% <span className="text-muted-foreground">vs. mês anterior</span></span>} trend={[2, 4, 3, 7, 4, 6]} />
            <PaymentMetricCard label="Pendente" value={pendingDay} color="#f59e0b" glow="rgba(245,158,11,0.16)" icon={Clock3} sub={<span className="text-amber-400">{selectedScopePayments.filter(p => p.status === 'Pendente').length} pagamentos</span>} trend={[1, 2, 1, 3, 2, 4]} />
            <PaymentMetricCard label="Enviado" value={sentDay} color="#2498ff" glow="rgba(36,152,255,0.17)" icon={Send} sub={<span className="text-sky-400">{selectedScopePayments.filter(p => p.status === 'Enviado').length} pagamentos</span>} trend={[2, 1, 2, 4, 3, 5]} />
            <PaymentMetricCard label="Pago" value={paidDay} color="#55f52f" glow="rgba(85,245,47,0.16)" icon={CheckCircle2} sub={<span className="text-primary">▲ 22,4% <span className="text-muted-foreground">vs. mês anterior</span></span>} trend={[1, 2, 4, 3, 7, 5]} />
            <PaymentMetricCard label="Em atraso" value={overdueDay} color="#ff4778" glow="rgba(255,71,120,0.16)" icon={AlertTriangle} sub={<span className="text-rose-400">{selectedScopePayments.filter(p => p.status === 'Em atraso').length} pagamentos</span>} trend={[1, 1, 2, 1, 3, 2]} />
          </>
        )}
      </div>

      {viewMode !== 'dia' && <div ref={formRef} id="novo-pagamento-form" className="rounded-xl border border-violet-400/25 bg-card/80 p-4 shadow-[0_0_34px_rgba(124,58,237,0.08)]">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/20 text-violet-300 shadow-[0_0_18px_rgba(124,58,237,0.25)]">
            <Plus className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wider">Novo Pagamento</h2>
          <p className="text-xs text-muted-foreground">Cadastre um novo Pix ou agende para futuras datas.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr_1.25fr_0.9fr_0.7fr_0.75fr_auto_0.8fr]">
          <label className="space-y-2">
            <span className="text-xs font-bold text-foreground">Cliente</span>
            <select value={newPayment.clientId} onChange={(e) => handleClientChange(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground outline-none focus:border-primary">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold text-foreground">Data de envio</span>
            <Input type="date" value={newPayment.date} onChange={(e) => setNewPayment((p) => ({ ...p, date: e.target.value }))} className="h-10 bg-background" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold text-foreground">Destino / Campanha</span>
            <Input value={newPayment.destination} onChange={(e) => setNewPayment((p) => ({ ...p, destination: e.target.value }))} className="h-10 bg-background" placeholder="Selecione a campanha" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold text-foreground">Canal</span>
            <select value={newPayment.channel} onChange={(e) => setNewPayment((p) => ({ ...p, channel: e.target.value as PaymentChannel }))} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
              {PAYMENT_CHANNELS.filter((ch) => ch !== 'Todos').map((ch) => <option key={ch}>{ch}</option>)}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold text-foreground">Valor</span>
            <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3">
              <span className="text-sm font-bold text-muted-foreground">R$</span>
              <CurrencyInput value={newPayment.amount} onChange={(amount) => setNewPayment((p) => ({ ...p, amount }))} className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" />
            </div>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold text-foreground">Status</span>
            <select value={newPayment.status} onChange={(e) => setNewPayment((p) => ({ ...p, status: e.target.value as PaymentStatus }))} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-bold text-amber-400 outline-none focus:border-primary">
              {PAYMENT_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <div className="flex flex-col items-center justify-end gap-1">
            <span className="text-xs font-bold text-foreground">Extra</span>
            <button
              type="button"
              onClick={() => setNewPayment((p) => ({ ...p, extra: !p.extra }))}
              title={newPayment.extra ? 'Remover destaque extra' : 'Marcar como pagamento extra'}
              className={cn(
                'flex h-10 w-14 items-center justify-center rounded-lg border transition-all',
                newPayment.extra
                  ? 'border-violet-500/60 bg-violet-500/20 text-violet-300 shadow-[0_0_14px_rgba(168,85,247,0.4)]'
                  : 'border-border bg-background text-muted-foreground hover:border-violet-500/40 hover:text-violet-400',
              )}
            >
              <Zap className={cn('h-4 w-4', newPayment.extra && 'fill-violet-400')} />
            </button>
          </div>
          <button
            type="button"
            onClick={handleAddPayment}
            disabled={recurMode !== 'none' && previewCount === 0}
            className="mt-6 flex h-14 items-center justify-center gap-2 rounded-xl border border-primary/60 bg-primary/15 px-4 text-sm font-bold text-foreground shadow-[0_0_24px_rgba(85,245,47,0.28)] transition-all hover:bg-primary/25 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Adicionar Pix
          </button>
        </div>
        {/* ── Recorrência ─────────────────────────────────────────── */}
        <div className="mt-4 border-t border-border/50 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setRecurMode(prev => prev === 'none' ? 'weekdays' : 'none')}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all',
                recurMode !== 'none'
                  ? 'border-violet-400/40 bg-violet-500/15 text-violet-300 shadow-[0_0_14px_rgba(168,85,247,0.2)]'
                  : 'border-border text-muted-foreground hover:border-violet-400/30 hover:text-violet-400',
              )}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recorrência
            </button>
            {recurMode !== 'none' && (
              <div className="flex gap-1">
                {([
                  { key: 'weekdays' as const, label: 'Dias da semana' },
                  { key: 'interval' as const, label: 'A cada N dias' },
                  { key: 'monthly' as const, label: 'Mensal' },
                ]).map(m => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setRecurMode(m.key)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-bold transition-all',
                      recurMode === m.key
                        ? 'border-violet-400/40 bg-violet-500/15 text-violet-300'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {recurMode !== 'none' && (
            <div className="mt-3 space-y-3">
              {/* Config by mode */}
              {recurMode === 'weekdays' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground">Repetir em:</span>
                  {[
                    { day: 1, label: 'Seg' },
                    { day: 2, label: 'Ter' },
                    { day: 3, label: 'Qua' },
                    { day: 4, label: 'Qui' },
                    { day: 5, label: 'Sex' },
                    { day: 6, label: 'Sáb' },
                    { day: 0, label: 'Dom' },
                  ].map(({ day, label }) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setRecurWeekdays(prev =>
                        prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
                      )}
                      className={cn(
                        'h-7 w-10 rounded-md border text-xs font-bold transition-all',
                        recurWeekdays.includes(day)
                          ? 'border-violet-400/40 bg-violet-500/20 text-violet-300'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {recurMode === 'interval' && (
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground">Repetir a cada</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={recurInterval}
                    onChange={(e) => setRecurInterval(Math.max(1, parseInt(e.target.value) || 1))}
                    className="h-8 w-16 rounded-lg border border-border bg-background px-2 text-center text-sm font-bold text-foreground outline-none focus:border-violet-400/50"
                  />
                  <span className="text-xs font-bold text-muted-foreground">dia(s)</span>
                  <span className="text-xs text-muted-foreground/60">(7 = semanal · 14 = quinzenal · 30 = mensal)</span>
                </div>
              )}

              {recurMode === 'monthly' && (
                <p className="text-xs text-muted-foreground">
                  Todo dia <span className="font-bold text-violet-300">{parseDate(newPayment.date).getDate()}</span> de cada mês, a partir de <span className="font-bold text-violet-300">{formatDateBR(newPayment.date)}</span>.
                </p>
              )}

              {/* Duration */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground">Duração:</span>
                <button
                  type="button"
                  onClick={() => setRecurHasEnd(false)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-bold transition-all',
                    !recurHasEnd ? 'border-violet-400/40 bg-violet-500/15 text-violet-300' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  Sem prazo
                </button>
                <button
                  type="button"
                  onClick={() => { setRecurHasEnd(true); if (!recurUntil) setRecurUntil(addMonthsToDate(newPayment.date, 3)); }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-bold transition-all',
                    recurHasEnd ? 'border-violet-400/40 bg-violet-500/15 text-violet-300' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  Até:
                </button>
                {recurHasEnd && (
                  <Input
                    type="date"
                    value={recurUntil}
                    min={newPayment.date}
                    onChange={(e) => setRecurUntil(e.target.value)}
                    className="h-7 w-36 bg-background text-xs"
                  />
                )}
              </div>

              {/* Preview */}
              {previewCount > 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-violet-400/20 bg-violet-500/8 px-3 py-2">
                  <span className="text-xs font-bold text-violet-300">{previewCount} pagamento{previewCount !== 1 ? 's' : ''} serão criados</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateBR(previewDates[0])}
                    {previewDates.length > 1 && ` → ${formatDateBR(previewDates[previewDates.length - 1])}`}
                  </span>
                  {!recurHasEnd && <span className="ml-auto rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-400">prévia 12 meses</span>}
                </div>
              ) : (
                recurMode === 'weekdays' && recurWeekdays.length === 0 && (
                  <p className="text-xs text-amber-400">Selecione pelo menos um dia da semana.</p>
                )
              )}
            </div>
          )}
        </div>
        <HolidayPaymentNotice date={newPayment.date} />
      </div>}

      {viewMode === 'mes' && (
        <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card shadow-[0_0_38px_rgba(15,23,42,0.28)]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 px-5 py-5">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/35 bg-primary/10 text-primary shadow-[0_0_16px_rgba(85,245,47,0.2)]">
                <CalendarDays className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider">Planejamento de Pagamentos</h2>
                <p className="text-sm text-muted-foreground">Visualize e gerencie os pagamentos do mês.</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setSelectedDate(shiftMonth(selectedDate, -1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-36 text-center text-base font-bold text-foreground">{getMonthLabel(selectedDate)}</span>
                <button type="button" onClick={() => setSelectedDate(shiftMonth(selectedDate, 1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground">
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setSelectedDate(todayStr)} className="h-9 rounded-lg border border-border bg-background px-4 text-sm font-bold text-foreground hover:border-primary/40">Hoje</button>
              </div>
              <div className="hidden items-center gap-5 lg:flex">
                {PAYMENT_STATUS_OPTIONS.map((status) => (
                  <span key={status} className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="h-3 w-3 rounded-full" style={{ background: STATUS_PALETTE[status].dot }} />
                    {status}
                  </span>
                ))}
              </div>
              {(() => {
                const statusData = PAYMENT_STATUS_OPTIONS.map((status) => ({
                  status,
                  count: selectedScopePayments.filter((p) => p.status === status).length,
                  color: STATUS_PALETTE[status].dot,
                })).filter((item) => item.count > 0);
                const total = statusData.reduce((sum, item) => sum + item.count, 0);
                return (
                  <div className="relative h-20 w-20">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusData.length ? statusData : [{ status: 'Total', count: 1, color: '#1f2937' }]} dataKey="count" innerRadius={24} outerRadius={38} paddingAngle={2} startAngle={90} endAngle={-270}>
                          {(statusData.length ? statusData : [{ color: '#1f2937' }]).map((entry, index) => <Cell key={index} fill={entry.color} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-heading font-normal text-lg leading-none">{total}</span>
                      <span className="text-[9px] font-bold uppercase text-muted-foreground">Total</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
          <div className="grid grid-cols-5 border-b border-border/70">
            {[
              { label: 'SEG', color: '#55f52f' },
              { label: 'TER', color: '#f59e0b' },
              { label: 'QUA', color: '#2498ff' },
              { label: 'QUI', color: '#a855f7' },
              { label: 'SEX', color: '#ff4778' },
            ].map((day, i) => (
              <div key={day.label} className="border-r border-border/70 py-4 text-center last:border-r-0">
                <p className="text-sm font-bold tracking-widest text-foreground">
                  <span style={{ color: day.color }}>{day.label}</span>
                  <span className="ml-2 text-muted-foreground">{monthAllWeeks[0]?.[i]?.split('-')[2] ?? ''}</span>
                </p>
              </div>
            ))}
          </div>
          {monthAllWeeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-5 border-b border-border/70 last:border-b-0">
              {week.map((date, di) => {
                const dayPayments = date ? filteredPayments.filter(p => p.date === date) : [];
                const isToday = date === todayStr;
                return (
                  <div
                    key={`${wi}-${di}`}
                    className={cn('group min-h-[148px] border-r border-border/70 p-2.5 last:border-r-0 transition-colors', !date && 'bg-muted/5 opacity-40', dragOverDate === date && date && 'bg-violet-500/10 ring-1 ring-inset ring-violet-500/30')}
                    onDragOver={(e) => { if (date) { e.preventDefault(); setDragOverDate(date); } }}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id && date) movePaymentDate(id, date); setDragOverDate(null); }}
                  >
                    {date && (
                      <>
                        {wi > 0 && (
                          <div className="mb-2 flex h-5 items-center justify-between">
                            <span className={cn('text-sm font-bold text-muted-foreground', isToday && 'rounded-full bg-primary px-2 text-black shadow-[0_0_14px_rgba(85,245,47,0.4)]')}>
                              {date.split('-')[2]}
                            </span>
                            <button
                              type="button"
                              title="Criar pagamento neste dia"
                              onClick={() => {
                                setNewPayment((p) => ({ ...p, date }));
                                formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }}
                              className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground/40 opacity-0 transition-all hover:bg-violet-500/20 hover:text-violet-400 group-hover:opacity-100"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                        <div className="space-y-2">
                          {(expandedDates.has(date) ? dayPayments : dayPayments.slice(0, 2)).map((payment, idx) => (
                            <MonthPaymentCard key={payment.id} payment={payment} index={idx + wi + di} onStatusChange={(status) => updatePaymentStatus(payment.id, status)} onDelete={() => deletePayment(payment.id)} onToggleExtra={() => togglePaymentExtra(payment.id)} onEdit={() => setEditingPayment(payment)} />
                          ))}
                          {dayPayments.length > 2 && (
                            <button
                              type="button"
                              onClick={() => setExpandedDates(prev => {
                                const next = new Set(prev);
                                next.has(date) ? next.delete(date) : next.add(date);
                                return next;
                              })}
                              className="w-full rounded-md py-1 text-center text-xs font-bold text-muted-foreground hover:text-primary"
                            >
                              {expandedDates.has(date)
                                ? '▲ Recolher'
                                : `+ Ver ${dayPayments.length - 2} pagamento${dayPayments.length - 2 !== 1 ? 's' : ''}`}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <ClientInvestmentSummary payments={visiblePayments} balances={activeBalances} clientLinks={activeClientLinks} />

      {/* ──────────────────────────────────────────────
          DIA VIEW
      ────────────────────────────────────────────── */}

      {/* ──────────────────────────────────────────────
          DIA VIEW
      ────────────────────────────────────────────── */}
      {viewMode === 'dia' && (() => {
        const sortedPayments = [...filteredPayments].sort((a, b) => a.clientName.localeCompare(b.clientName));
        const hours = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
        const channelData = [
          { name: 'Meta Ads', value: selectedScopePayments.filter(p => p.channel === 'Meta ADS').reduce((sum, p) => sum + p.amount, 0), count: selectedScopePayments.filter(p => p.channel === 'Meta ADS').length, color: '#0b84ff' },
          { name: 'Google Ads', value: selectedScopePayments.filter(p => p.channel === 'Google ADS').reduce((sum, p) => sum + p.amount, 0), count: selectedScopePayments.filter(p => p.channel === 'Google ADS').length, color: '#55f52f' },
        ].filter(item => item.value > 0 || item.count > 0);
        const channelTotal = channelData.reduce((sum, item) => sum + item.value, 0);

        return (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
            <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card shadow-[0_0_34px_rgba(15,23,42,0.28)]">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 px-5 py-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground">
                    <CalendarDays className="h-5 w-5" />
                  </span>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Agenda do dia</h2>
                  <span className="text-lg text-muted-foreground">•</span>
                  <span className="text-lg font-medium text-muted-foreground">{parseDate(selectedDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                </div>
                <div className="flex items-center gap-5">
                  {PAYMENT_STATUS_OPTIONS.map((status) => (
                    <span key={status} className="flex items-center gap-2 text-sm text-foreground">
                      <span className="h-3 w-3 rounded-full" style={{ background: STATUS_PALETTE[status].dot }} />
                      {status}
                    </span>
                  ))}
                </div>
              </div>
              {sortedPayments.length > 0 ? (
                <div className="relative px-5 py-5">
                  <div className="absolute bottom-10 left-[78px] top-8 w-px bg-border" />
                  <div className="space-y-0">
                    {hours.map((hour, index) => {
                      const payment = sortedPayments[index];
                      return (
                        <div key={hour} className="relative grid min-h-[56px] grid-cols-[64px_1fr] items-start border-b border-dashed border-border/70 last:border-b-0">
                          <div className="pt-1 text-sm font-medium tabular-nums text-muted-foreground">{hour}</div>
                          <div className="relative min-h-[56px] pl-5">
                            <span className="absolute left-0 top-2 h-5 w-px bg-border" />
                            {payment && (
                              <div className={cn('w-[46%]', index % 2 === 0 ? 'ml-5' : 'ml-[48%]')}>
                                <DayTimelinePaymentCard payment={payment} index={index} onStatusChange={(status) => updatePaymentStatus(payment.id, status)} onDelete={() => deletePayment(payment.id)} onToggleExtra={() => togglePaymentExtra(payment.id)} onEdit={() => setEditingPayment(payment)} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="py-20 text-center">
                  <CalendarDays className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" />
                  <p className="font-semibold text-muted-foreground">Nenhum pagamento para este dia</p>
                  <p className="mt-1 text-xs text-muted-foreground/70">Altere a data ou cadastre um novo Pix na visão Mês.</p>
                </div>
              )}
            </div>

            <div className="rounded-[var(--radius)] border border-border bg-card p-5 shadow-[0_0_34px_rgba(15,23,42,0.28)]">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300 shadow-[0_0_18px_rgba(124,58,237,0.2)]">
                  <BarChart3 className="h-4 w-4" />
                </span>
                <h3 className="font-heading font-normal text-lg">Resumo do dia</h3>
              </div>

              <div className="rounded-[var(--radius)] border border-border bg-background/40 p-5">
                <p className="text-sm text-muted-foreground">Total de pagamentos</p>
                <div className="mt-3 flex items-end justify-between gap-4">
                  <p className="font-heading font-normal text-xl leading-none tabular-nums">{selectedScopePayments.length}</p>
                  <p className="text-lg font-bold text-primary tabular-nums">{formatCurrencyBRL(totalDay)}</p>
                </div>
              </div>

              <div className="mt-4 rounded-[var(--radius)] border border-border bg-background/40 p-5">
                <p className="mb-4 text-sm font-bold text-foreground">Por canal</p>
                {channelData.length > 0 ? (
                  <div className="grid grid-cols-[1fr_132px] items-center gap-4">
                    <div className="space-y-5">
                      {channelData.map((item) => {
                        const pct = channelTotal > 0 ? Math.round((item.value / channelTotal) * 100) : 0;
                        return (
                          <div key={item.name} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="h-3 w-3 rounded-full" style={{ background: item.color }} />
                              <span className="text-sm text-muted-foreground">{item.name}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 text-sm">
                              <span className="font-bold text-foreground">{formatCurrencyBRL(item.value)}</span>
                              <span className="text-muted-foreground">{pct}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="relative h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={channelData} dataKey="value" innerRadius={40} outerRadius={62} paddingAngle={1} startAngle={90} endAngle={-270}>
                            {channelData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-xs font-bold text-foreground">R$</span>
                        <span className="font-heading font-normal text-sm leading-tight text-foreground">{formatCurrencyBRL(totalDay).replace('R$', '').trim()}</span>
                        <span className="text-[10px] font-bold text-muted-foreground">Total</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem pagamentos no dia.</p>
                )}
              </div>

              <div className="mt-4 rounded-[var(--radius)] border border-border bg-background/40 p-5">
                <p className="mb-4 text-sm font-bold text-foreground">Status dos pagamentos</p>
                <div className="space-y-3">
                  {PAYMENT_STATUS_OPTIONS.map((status) => {
                    const statusPayments = selectedScopePayments.filter((payment) => payment.status === status);
                    const total = statusPayments.reduce((sum, payment) => sum + payment.amount, 0);
                    const palette = STATUS_PALETTE[status];
                    return (
                      <div key={status} className="grid grid-cols-[minmax(0,1fr)_104px] items-center gap-4 rounded-lg px-1 py-1 text-sm">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: `${palette.dot}24`, color: palette.dot }}>
                            <span className="h-2 w-2 rounded-full" style={{ background: palette.dot }} />
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-muted-foreground">{status}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground/80">
                              {statusPayments.length} pagamento{statusPayments.length === 1 ? '' : 's'}
                            </p>
                          </div>
                        </div>
                        <span className="text-right font-bold tabular-nums leading-tight" style={{ color: palette.dot }}>{formatCurrencyBRL(total)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Link href="/relatorios" className="mt-4 flex h-11 items-center justify-between rounded-[var(--radius)] border border-border bg-background/40 px-4 text-sm font-medium text-foreground transition-colors hover:border-primary/40">
                Ver relatórios completos
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </div>
          </div>
        );
      })()}

      {/* ──────────────────────────────────────────────
          SEMANA VIEW
      ────────────────────────────────────────────── */}
      {viewMode === 'semana' && (() => {
        const DAY_LABELS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX'];
        const DAY_NAMES: Record<string, string> = {
          SEG: 'Segunda-feira',
          TER: 'Terça-feira',
          QUA: 'Quarta-feira',
          QUI: 'Quinta-feira',
          SEX: 'Sexta-feira',
        };
        const dailyData = weekDates.map((date, i) => {
          const dayPs = filteredPayments.filter(p => p.date === date);
          return {
            day: `${DAY_LABELS[i]} ${Number(date.split('-')[2])}`,
            label: DAY_LABELS[i],
            date,
            total: dayPs.reduce((s, p) => s + p.amount, 0),
            count: dayPs.length,
            payments: dayPs,
          };
        });
        const metaTotal = filteredPayments.filter(p => p.channel === 'Meta ADS').reduce((s, p) => s + p.amount, 0);
        const googleTotal = filteredPayments.filter(p => p.channel === 'Google ADS').reduce((s, p) => s + p.amount, 0);
        const nonZero = dailyData.filter(d => d.total > 0);
        const maxDay = nonZero.length > 0 ? nonZero.reduce((a, b) => a.total > b.total ? a : b) : null;
        const minDay = nonZero.length > 1 ? nonZero.reduce((a, b) => a.total < b.total ? a : b) : null;
        const weekTotal = dailyData.reduce((sum, day) => sum + day.total, 0);
        const statusRows = PAYMENT_STATUS_OPTIONS.map((status) => {
          const statusPayments = filteredPayments.filter((payment) => payment.status === status);
          const total = statusPayments.reduce((sum, payment) => sum + payment.amount, 0);
          return { status, total, pct: weekTotal > 0 ? (total / weekTotal) * 100 : 0 };
        });
        return (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card shadow-[0_0_34px_rgba(15,23,42,0.28)]">
              <div className="grid grid-cols-5 border-b border-border/70">
                {dailyData.map((day, i) => (
                  <div key={day.date} className="border-r border-border/70 px-4 py-5 text-center last:border-r-0">
                    <p className="text-lg font-bold text-foreground">{day.label}</p>
                    <p className={cn('mt-1 text-sm font-bold tabular-nums', day.date === todayStr ? 'text-primary' : 'text-primary')}>
                      {Number(day.date.split('-')[2])}/{Number(day.date.split('-')[1])}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid min-h-[370px] grid-cols-5">
                {dailyData.map((day, di) => (
                  <div
                    key={day.date}
                    className={cn('flex flex-col border-r border-border/70 last:border-r-0 transition-colors', dragOverDate === day.date && 'bg-violet-500/10 ring-1 ring-inset ring-violet-500/30')}
                    onDragOver={(e) => { e.preventDefault(); setDragOverDate(day.date); }}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) movePaymentDate(id, day.date); setDragOverDate(null); }}
                  >
                    <div className="min-h-[342px] flex-1 space-y-2.5 p-3">
                      {day.payments.slice(0, 4).map((payment, index) => (
                        <WeekPaymentCard key={payment.id} payment={payment} index={index + di} onStatusChange={(status) => updatePaymentStatus(payment.id, status)} onDelete={() => deletePayment(payment.id)} onToggleExtra={() => togglePaymentExtra(payment.id)} onEdit={() => setEditingPayment(payment)} />
                      ))}
                      {day.payments.length > 4 && (
                        <button type="button" onClick={() => { setSelectedDate(day.date); setViewMode('dia'); }} className="w-full rounded-lg py-2 text-center text-xs font-bold text-muted-foreground hover:bg-muted/30 hover:text-primary">
                          + Ver {day.payments.length - 4}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t border-border/70 px-4 py-3">
                      <span className="text-sm text-muted-foreground">Total do dia</span>
                      <span className="font-heading font-normal text-sm tabular-nums text-foreground">{formatCurrencyBRL(day.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid overflow-hidden rounded-[var(--radius)] border border-border bg-card shadow-[0_0_34px_rgba(15,23,42,0.28)] xl:grid-cols-[1.15fr_1.05fr_0.55fr]">
              <div className="border-r border-border/70 p-5">
                <h3 className="mb-4 text-sm font-bold uppercase tracking-wider">Resumo da semana por canal</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <WeekChannelSummaryCard channel="Meta Ads" value={metaTotal} total={weekTotal} trend={[1, 2, 1, 3, 2, 5, 4]} />
                  <WeekChannelSummaryCard channel="Google Ads" value={googleTotal} total={weekTotal} trend={[2, 1, 3, 2, 4, 3, 5]} />
                </div>
              </div>

              <div className="grid grid-cols-[240px_1fr] border-r border-border/70">
                <div className="space-y-4 p-5">
                  {statusRows.map(({ status, total, pct }) => {
                    const palette = STATUS_PALETTE[status];
                    return (
                      <div key={status} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 text-sm">
                        <div className="flex items-center gap-3">
                          <span className="h-3 w-3 rounded-full" style={{ background: palette.dot }} />
                          <span className="text-muted-foreground">{status}</span>
                        </div>
                        <span className="font-bold tabular-nums text-foreground">{formatCurrencyBRL(total)}</span>
                        <span className="w-12 text-right text-muted-foreground">{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
                <div className="border-l border-border/70 p-5">
                  <p className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">Evolução diária (total)</p>
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={dailyData} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="weekAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#a855f7" stopOpacity={0.65} />
                          <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                      <Area type="monotone" dataKey="total" stroke="#a855f7" fill="url(#weekAreaGrad)" strokeWidth={2} dot={{ r: 3, fill: '#a855f7' }} />
                      <Tooltip
                        formatter={(v) => [formatCurrencyBRL(Number(v)), 'Total']}
                        contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: '11px' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-3 p-5">
                {maxDay && (
                  <div className="rounded-lg border border-border bg-background/45 p-4">
                    <p className="text-sm text-muted-foreground">Maior dia</p>
                    <p className="mt-1 text-sm font-bold text-foreground">{DAY_NAMES[maxDay.label]}</p>
                    <p className="mt-1 font-heading font-normal text-lg tabular-nums text-foreground">{formatCurrencyBRL(maxDay.total)}</p>
                  </div>
                )}
                {minDay && (
                  <div className="rounded-lg border border-border bg-background/45 p-4">
                    <p className="text-sm text-muted-foreground">Menor dia</p>
                    <p className="mt-1 text-sm font-bold text-foreground">{DAY_NAMES[minDay.label]}</p>
                    <p className="mt-1 font-heading font-normal text-lg tabular-nums text-foreground">{formatCurrencyBRL(minDay.total)}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
