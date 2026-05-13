"use client";

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  Filter,
  PlusCircle,
  RefreshCw,
  Send,
  Trash2,
  WalletCards,
  ChevronDown,
} from 'lucide-react';
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
  const visibleMetaCritical = expanded ? metaCritical : metaCritical.slice(0, 2);
  const visibleGoogleCritical = expanded ? googleCritical : googleCritical.slice(0, 2);

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
          <div className="grid gap-2 sm:grid-cols-2">
            {[1, 2].map(i => <div key={i} className="h-28 bg-red-500/10 rounded-lg animate-pulse" />)}
          </div>
        ) : visibleAccounts.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
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
    <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <h2 className="font-bold text-sm text-red-400 uppercase tracking-wider">
            {loading && critical.length === 0 ? 'Verificando saldos...' : `${critical.length} conta${critical.length > 1 ? 's' : ''} com saldo crítico`}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {critical.length > 4 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[10px] font-bold text-red-300 transition-colors hover:bg-red-500/10"
            >
              {expanded ? 'Minimizar' : `Ver ${critical.length}`}
              <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
            </button>
          )}
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
        </div>
      </div>

      <div className={cn('grid gap-3', metaCritical.length > 0 && googleCritical.length > 0 ? 'lg:grid-cols-2' : 'lg:grid-cols-1 max-w-xl')}>
        {metaCritical.length > 0 && renderPlatformColumn('meta', metaCritical, visibleMetaCritical)}
        {googleCritical.length > 0 && renderPlatformColumn('google', googleCritical, visibleGoogleCritical)}
      </div>
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

  return (
    <div className="space-y-3">
      <h2 className="font-bold text-sm uppercase tracking-wider">Compilado por Cliente</h2>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
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

function isDateInView(date: string, selectedDate: string, viewMode: ViewMode): boolean {
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

export default function PagamentosPage() {
  const { clients } = useClients();
  const { payments, addPayment, updatePaymentStatus, deletePayment } = useInvestmentPayments();
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
  const activeBalances = balances.filter(b =>
    activeClientLinks.some(l => {
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
  });

  type RecurMode = 'none' | 'weekdays' | 'interval';
  const [recurMode, setRecurMode] = useState<RecurMode>('none');
  const [recurWeekdays, setRecurWeekdays] = useState<number[]>([1, 2, 3, 4, 5]); // 0=Dom,1=Seg..6=Sáb
  const [recurInterval, setRecurInterval] = useState(7);
  const [recurUntil, setRecurUntil] = useState('');

  function getMonthEnd(dateStr: string): string {
    const d = parseDate(dateStr);
    return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }

  function generateRecurDates(
    startDate: string,
    mode: 'weekdays' | 'interval',
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
    } else {
      const step = Math.max(1, intervalDays);
      const cur = new Date(start);
      while (cur <= end) {
        dates.push(toISODate(cur));
        cur.setDate(cur.getDate() + step);
      }
    }
    return dates;
  }

  const recurUntilResolved = recurUntil || getMonthEnd(newPayment.date);
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
  const summaryLabel = viewMode === 'dia' ? 'do dia' : 'do período';

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

    setNewPayment((prev) => ({ ...prev, destination: `${prev.clientName} - Novo investimento`, amount: 500 }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Acompanhamento de Pagamentos</h1>
          <p className="text-muted-foreground mt-1">Veja os Pix de investimento por dia, semana ou mês para todos os clientes cadastrados.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-border bg-card p-1">
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
                  'h-7 rounded-md px-3 text-xs font-bold transition-colors',
                  viewMode === mode.key ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-40 bg-card"
          />
          <HolidayPaymentNotice date={selectedDate} compact />
        </div>
      </div>

      <div className="sticky top-0 z-20">
        <div className="bg-card border border-border rounded-xl p-4 shadow-lg shadow-black/20">
          {/* ── Row 1: payment fields ── */}
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Cliente</p>
              <select
                value={newPayment.clientId}
                onChange={(e) => handleClientChange(e.target.value)}
                className="h-9 min-w-44 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Data início</p>
              <Input
                type="date"
                value={newPayment.date}
                onChange={(e) => setNewPayment((prev) => ({ ...prev, date: e.target.value }))}
                className="w-40 bg-background"
              />
            </div>
            <div className="space-y-1.5 flex-1 min-w-56">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Destino / Campanha</p>
              <Input
                value={newPayment.destination}
                onChange={(e) => setNewPayment((prev) => ({ ...prev, destination: e.target.value }))}
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Canal</p>
              <select
                value={newPayment.channel}
                onChange={(e) => setNewPayment((prev) => ({ ...prev, channel: e.target.value as PaymentChannel }))}
                className="h-9 w-32 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {PAYMENT_CHANNELS.filter((channel) => channel !== 'Todos').map((channel) => <option key={channel}>{channel}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Valor</p>
              <div className="flex h-9 w-36 items-center gap-2 rounded-lg border border-input bg-background px-3">
                <span className="text-sm font-bold text-muted-foreground">R$</span>
                <CurrencyInput
                  value={newPayment.amount}
                  onChange={(amount) => setNewPayment((prev) => ({ ...prev, amount }))}
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold focus:outline-none"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</p>
              <StatusDropdown
                value={newPayment.status}
                onChange={(status) => setNewPayment((prev) => ({ ...prev, status }))}
              />
            </div>
            <Button
              onClick={handleAddPayment}
              disabled={recurMode !== 'none' && previewCount === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {recurMode !== 'none' && previewCount > 0
                ? `Criar ${previewCount} Pix`
                : 'Adicionar Pix'}
            </Button>
          </div>

          {/* ── Row 2: recurrence ── */}
          <div className="mt-3 flex items-center gap-3 flex-wrap border-t border-border/40 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">Recorrência</p>
            <div className="flex rounded-lg border border-border bg-background p-0.5 shrink-0">
              {([
                { key: 'none', label: 'Nenhuma' },
                { key: 'weekdays', label: 'Dias da semana' },
                { key: 'interval', label: 'A cada N dias' },
              ] as { key: RecurMode; label: string }[]).map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setRecurMode(mode.key)}
                  className={cn(
                    'h-7 rounded-md px-3 text-xs font-bold transition-colors',
                    recurMode === mode.key ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {recurMode === 'weekdays' && (
              <>
                <div className="flex gap-1">
                  {([
                    { label: 'Dom', value: 0 },
                    { label: 'Seg', value: 1 },
                    { label: 'Ter', value: 2 },
                    { label: 'Qua', value: 3 },
                    { label: 'Qui', value: 4 },
                    { label: 'Sex', value: 5 },
                    { label: 'Sáb', value: 6 },
                  ]).map((day) => {
                    const active = recurWeekdays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => setRecurWeekdays((prev) =>
                          active ? prev.filter((d) => d !== day.value) : [...prev, day.value],
                        )}
                        className={cn(
                          'h-7 w-9 rounded-md border text-[10px] font-bold transition-colors',
                          active ? 'border-primary/40 bg-primary/20 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50',
                        )}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Até</p>
                  <Input
                    type="date"
                    value={recurUntilResolved}
                    onChange={(e) => setRecurUntil(e.target.value)}
                    className="w-36 h-7 bg-background text-xs py-0"
                  />
                </div>
                {previewCount > 0 && (
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    {previewCount} pagamento{previewCount !== 1 ? 's' : ''}
                  </span>
                )}
              </>
            )}

            {recurMode === 'interval' && (
              <>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">A cada</p>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={recurInterval}
                    onChange={(e) => setRecurInterval(Math.max(1, parseInt(e.target.value) || 1))}
                    className="h-7 w-14 rounded-lg border border-input bg-background px-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary text-center"
                  />
                  <p className="text-xs text-muted-foreground">dias</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Até</p>
                  <Input
                    type="date"
                    value={recurUntilResolved}
                    onChange={(e) => setRecurUntil(e.target.value)}
                    className="w-36 h-7 bg-background text-xs py-0"
                  />
                </div>
                {previewCount > 0 && (
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    {previewCount} pagamento{previewCount !== 1 ? 's' : ''}
                  </span>
                )}
              </>
            )}
          </div>

          <div className="mt-3">
            <HolidayPaymentNotice date={newPayment.date} />
          </div>
        </div>
      </div>

      {(activeBalances.length > 0 || balancesLoading) && (
        <CriticalBalanceAlerts
          balances={activeBalances}
          loading={balancesLoading}
          lastUpdated={balancesLastUpdated}
          onRefresh={loadBalances}
        />
      )}

      <ClientInvestmentSummary payments={visiblePayments} balances={activeBalances} clientLinks={activeClientLinks} />

      <div className="grid gap-3 md:grid-cols-5">
        {[
          { label: `Total ${summaryLabel}`, value: totalDay, icon: WalletCards, tone: 'text-foreground' },
          { label: 'Pendente', value: pendingDay, icon: Clock3, tone: 'text-orange-300' },
          { label: 'Enviado', value: sentDay, icon: Send, tone: 'text-sky-300' },
          { label: 'Pago', value: paidDay, icon: CheckCircle2, tone: 'text-primary' },
          { label: 'Em atraso', value: overdueDay, icon: AlertTriangle, tone: 'text-red-300' },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
              <Icon className={cn('w-4 h-4 shrink-0', tone)} />
            </div>
            <p className={cn('text-2xl font-bold font-heading mt-3', tone)}>{formatCurrencyBRL(value)}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {availableDates.map((date) => {
          const count = visiblePayments.filter((payment) => payment.date === date).length;
          const selected = viewMode === 'dia' ? date === selectedDate : isDateInView(date, selectedDate, viewMode);
          const holiday = getHoliday(date);

          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDate(date)}
              className={cn(
                'min-w-32 rounded-lg border px-3 py-2 text-left transition-colors',
                selected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted/50',
              )}
            >
              <p className="text-xs font-bold">{formatDateBR(date)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{count} Pix programado{count === 1 ? '' : 's'}</p>
              {holiday && <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-orange-300">{holiday.name}</p>}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-sm uppercase tracking-wider">Pix de {scopeLabel(selectedDate, viewMode)}</h2>
          <p className="text-xs text-muted-foreground mt-1">{filteredPayments.length} lançamento{filteredPayments.length === 1 ? '' : 's'} visível{filteredPayments.length === 1 ? '' : 's'} após filtros.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value as PaymentChannel | 'Todos')}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {PAYMENT_CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}
          </select>
          <StatusFilter value={statusFilter} onChange={setStatusFilter} />
        </div>
      </div>

      {viewMode === 'semana' && (
        <div className="grid gap-3 lg:grid-cols-5">
          {weekDates.map((date, dateIndex) => {
            const dayPayments = filteredPayments.filter((payment) => payment.date === date);
            const hasPayments = dayPayments.length > 0;
            const holiday = getHoliday(date);

            return (
              <div key={date} className={cn('min-h-52 rounded-xl border overflow-hidden', holiday ? 'border-orange-400/40 bg-orange-500/5' : hasPayments ? 'border-border bg-card' : 'border-border/30 bg-card/25 opacity-45')}>
                <div className={cn('px-3 py-2 text-xs font-bold', hasPayments || holiday ? cn('text-white', WEEKDAY_COLORS[dateIndex]) : 'bg-muted/20 text-muted-foreground/50')}>
                  {formatDateBR(date)}
                </div>
                <div className="p-2 space-y-2">
                  <HolidayPaymentNotice date={date} compact />
                  {hasPayments ? dayPayments.map((payment) => (
                    <div key={payment.id} className="rounded-lg bg-muted/35 p-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-bold">{payment.clientName}</p>
                          <p className="font-bold mt-1">{formatCurrencyBRL(payment.amount)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => deletePayment(payment.id)}
                          className="rounded-md p-1 text-muted-foreground/60 hover:bg-red-500/10 hover:text-red-300"
                          title="Apagar programação"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', CHANNEL_STYLES[payment.channel])}>{payment.channel}</span>
                      </div>
                      <div className="mt-2">
                        <StatusDropdown value={payment.status} onChange={(status) => updatePaymentStatus(payment.id, status)} />
                      </div>
                    </div>
                  )) : <div className="h-24" />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'mes' && (
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[980px] space-y-2">
            <div className="grid grid-cols-5 gap-2">
              {WEEKDAY_LABELS.map((label, idx) => (
                <div key={label} className={cn('rounded-t-lg px-3 py-2 text-center text-xs font-bold tracking-widest text-white', WEEKDAY_COLORS[idx])}>
                  {label}
                </div>
              ))}
            </div>
            {monthWeeks.map((week, weekIndex) => (
              <div key={weekIndex} className="grid grid-cols-5 gap-2">
                {week.map((date, dayIndex) => {
                  const dayPayments = filteredPayments.filter((payment) => payment.date === date);
                  const hasPayments = dayPayments.length > 0;
                  const holiday = date ? getHoliday(date) : undefined;

                  return (
                    <div
                      key={`${weekIndex}-${dayIndex}`}
                      className={cn(
                        'min-h-[150px] rounded-b-lg border overflow-hidden',
                        holiday ? 'border-orange-400/40 bg-orange-500/5' : hasPayments ? 'border-border bg-card' : 'border-border/30 bg-card/25 opacity-45',
                      )}
                    >
                      {date ? (
                        <>
                          <div className={cn('px-3 py-2 text-center text-xs font-bold', hasPayments || holiday ? cn('text-white', WEEKDAY_COLORS[dayIndex]) : 'bg-muted/20 text-muted-foreground/50')}>
                            {formatDateBR(date)}
                          </div>
                          <div className="p-2 space-y-1.5">
                            <HolidayPaymentNotice date={date} compact />
                            {hasPayments ? dayPayments.map((payment) => (
                              <div key={payment.id} className="rounded-md bg-muted/35 p-2 text-xs">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="font-bold truncate">{payment.clientName}</p>
                                    <p className="text-[11px] font-bold mt-1">{formatCurrencyBRL(payment.amount)}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => deletePayment(payment.id)}
                                    className="rounded-md p-1 text-muted-foreground/60 hover:bg-red-500/10 hover:text-red-300"
                                    title="Apagar programação"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <div className="mt-2">
                                  <StatusDropdown value={payment.status} onChange={(status) => updatePaymentStatus(payment.id, status)} />
                                </div>
                              </div>
                            )) : <div className="h-20" />}
                          </div>
                        </>
                      ) : (
                        <div className="h-full bg-muted/20" />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'dia' && (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[minmax(200px,1.5fr)_110px_130px_130px_140px_112px] gap-3 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border">
          <span>Cliente</span>
          <span>Canal</span>
          <span>Valor Pix</span>
          <span>Status</span>
          <span>Saldo Conta</span>
          <span className="text-right">Ações</span>
        </div>

        {filteredPayments.length > 0 ? (
          <div className="divide-y divide-border">
            {filteredPayments.map((payment) => {
              const metaBalance = payment.channel === 'Meta ADS' ? getClientMetaBalance(payment.clientId) : null;
              const googleBalance = payment.channel === 'Google ADS' ? getClientGoogleBalance(payment.clientId) : null;
              const accountBalance = payment.channel === 'Meta ADS' ? metaBalance : payment.channel === 'Google ADS' ? googleBalance : null;
              const balanceLow = accountBalance !== null && accountBalance < LOW_BALANCE_THRESHOLD;
              return (
              <div key={payment.id} className="grid grid-cols-[minmax(200px,1.5fr)_110px_130px_130px_140px_112px] gap-3 px-4 py-3 items-center text-sm hover:bg-muted/35 transition-colors">
                <div>
                  <p className="font-bold">{payment.clientName}</p>
                  <p className="text-xs text-muted-foreground">{formatDateBR(payment.date)}</p>
                  <HolidayPaymentNotice date={payment.date} compact />
                </div>
                <span className={cn('w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold', CHANNEL_STYLES[payment.channel])}>
                  {payment.channel}
                </span>
                <p className="font-bold">{formatCurrencyBRL(payment.amount)}</p>
                <StatusDropdown
                  value={payment.status}
                  onChange={(status) => updatePaymentStatus(payment.id, status)}
                />
                <div>
                  {payment.channel === 'Meta ADS' || payment.channel === 'Google ADS' ? (
                    accountBalance !== null ? (
                      <span className={cn(
                        'inline-flex items-center gap-1 text-xs font-semibold tabular-nums px-2 py-0.5 rounded-lg',
                        balanceLow
                          ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                          : 'bg-muted text-muted-foreground',
                      )}>
                        {balanceLow && <AlertTriangle className="w-3 h-3 shrink-0" />}
                        {formatCurrencyBRL(accountBalance)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground/50">—</span>
                  )}
                </div>
                <div className="flex justify-end gap-1">
                  <Button
                    render={<Link href={`/clientes/${payment.clientId}`} />}
                    nativeButton={false}
                    variant="ghost"
                    size="icon-sm"
                    title="Abrir cliente"
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Apagar programação"
                    className="text-muted-foreground hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => deletePayment(payment.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="py-16 text-center">
            <p className="font-semibold text-muted-foreground">Nenhum Pix para este dia</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Troque a data ou limpe os filtros para ver outras programações.</p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
