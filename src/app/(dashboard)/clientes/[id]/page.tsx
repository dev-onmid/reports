"use client";

import { use, useEffect, useState, type ComponentType } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { mockDashboardData, mockClients } from '@/lib/mock-data';
import { useClients } from '@/lib/client-store';
import {
  type MetaAdsMetrics,
  useMetaAdsConnections,
} from '@/lib/meta-ads-store';
import { GOOGLE_ADS_MANAGERS, type GoogleAdsMetrics, useGoogleAds } from '@/lib/google-ads-store';
import { loadIntegrations, loadCachedAdAccounts, readIntegrations, type CachedAdAccount } from '@/lib/integration-store';
import {
  Calendar, Users, BarChart3, TrendingUp, UploadCloud,
  Link as LinkIcon, Link2, Plus, X, ChevronDown, LayoutGrid,
  WalletCards, Send, CheckCircle2, Clock3, AlertTriangle, Filter, Trash2,
  UserRound, Phone, Mail, Briefcase, SlidersHorizontal, Check, Hash, BarChart2, Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  type InvestmentPayment,
  type PaymentChannel,
  type PaymentStatus,
  PAYMENT_CHANNELS,
  PAYMENT_STATUS_OPTIONS,
  useInvestmentPayments,
  wasDispatched,
} from '@/lib/payment-store';
import { getHoliday, previousBusinessDay, formatDateBR as formatHolidayDateBR } from '@/lib/holidays';
import { cn, formatCurrencyBRL, formatCurrencyInputBRL, parseCurrencyBRL } from '@/lib/utils';
import { LinkAccountsDialog } from '@/components/link-accounts-dialog';
import { ClientAvatar } from '@/components/client-avatar';

// ── Funnel types & logic ───────────────────────────────────────────────────────
type FunnelStage = { id: string; name: string; conversion: number };

const DEFAULT_STAGES: FunnelStage[] = [
  { id: 's5', name: '5º — Contatos (Leads)',     conversion: 50  },
  { id: 's4', name: '4º — Qualificados',          conversion: 100 },
  { id: 's3', name: '3º — Agendamentos',          conversion: 50  },
  { id: 's2', name: '2º — Comparecimentos',       conversion: 47  },
  { id: 's1', name: '1º — Fechamentos (Vendas)',  conversion: 0   },
];

const STAGE_COLORS = ['#55F52F', '#7B2CFF', '#3B82F6', '#F59E0B', '#EC4899', '#10B981', '#EF4444'];

function computeFunnel(stages: FunnelStage[], metaRS: number, tkm: number): number[] {
  const n = stages.length;
  const vols = new Array<number>(n).fill(0);
  if (tkm <= 0 || metaRS <= 0 || n === 0) return vols;
  vols[n - 1] = Math.ceil(metaRS / tkm);
  for (let i = n - 2; i >= 0; i--) {
    const rate = stages[i].conversion / 100;
    vols[i] = rate > 0 ? Math.ceil(vols[i + 1] / rate) : 0;
  }
  return vols;
}

function fmtBRL(v: number): string {
  return formatCurrencyBRL(v);
}

// ── Meta real-time insights ─────────────────────────────────────────────────
type MetaInsightsPeriod = 'last_7d' | 'last_30d' | 'last_month' | 'this_month';
const PERIOD_LABELS_CLIENT: Record<MetaInsightsPeriod, string> = {
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
  last_month: 'Mês passado',
  this_month: 'Este mês',
};

type MetaInsightAction = { action_type: string; value: string };
const LEAD_ACTION_TYPES = [
  'lead',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.lead_grouped',
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
];

async function fetchClientMetaMetrics(
  accountIds: string[],
  token: string,
  period: MetaInsightsPeriod,
): Promise<MetaAdsMetrics> {
  const fields = 'spend,impressions,clicks,actions';
  const results = await Promise.all(
    accountIds.map(async (accountId) => {
      const url = `https://graph.facebook.com/v21.0/${accountId}/insights?fields=${fields}&level=account&date_preset=${period}&access_token=${token}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const row = data.data?.[0] ?? {};
      const leads = ((row.actions as MetaInsightAction[]) ?? [])
        .filter(a => LEAD_ACTION_TYPES.includes(a.action_type))
        .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0);
      return {
        spend: parseFloat(row.spend || '0'),
        impressions: parseInt(row.impressions || '0', 10),
        clicks: parseInt(row.clicks || '0', 10),
        leads,
        cpl: 0,
      };
    }),
  );
  const agg = results.reduce(
    (acc, m) => ({ spend: acc.spend + m.spend, impressions: acc.impressions + m.impressions, clicks: acc.clicks + m.clicks, leads: acc.leads + m.leads, cpl: 0 }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0 },
  );
  agg.cpl = agg.leads > 0 ? agg.spend / agg.leads : 0;
  return agg;
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

const CHANNEL_STYLES: Record<PaymentChannel, string> = {
  'Meta ADS': 'bg-blue-500/20 text-blue-300 border-blue-400/30',
  'Google ADS': 'bg-red-500/20 text-red-300 border-red-400/30',
  'TikTok ADS': 'bg-foreground/10 text-foreground border-border',
};

const STATUS_STYLES: Record<PaymentStatus, string> = {
  Pendente: 'bg-orange-500/20 text-orange-300 border-orange-400/30',
  Enviado: 'bg-sky-500/20 text-sky-300 border-sky-400/30',
  Pago: 'bg-primary/20 text-primary border-primary/30',
  'Em atraso': 'bg-red-500/20 text-red-300 border-red-400/30',
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

function getBusinessWeeks(year: number, monthIndex: number, startDay = 1): string[][] {
  const days: string[][] = [];
  let week = Array<string>(5).fill('');
  const totalDays = new Date(year, monthIndex + 1, 0).getDate();

  for (let day = startDay; day <= totalDays; day++) {
    const date = new Date(year, monthIndex, day);
    const weekday = date.getDay();

    if (weekday === 0 || weekday === 6) continue;

    const col = weekday - 1;
    week[col] = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    if (col === 4) {
      days.push(week);
      week = Array<string>(5).fill('');
    }
  }

  if (week.some(Boolean)) days.push(week);

  return days;
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

function StatusDropdown({ value, onChange }: { value: PaymentStatus; onChange: (status: PaymentStatus) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'h-7 w-full rounded-md border px-2 text-left text-[10px] font-bold transition-colors',
          STATUS_STYLES[value],
        )}
      >
        {value}
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-background/90 p-1">
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

function StatusFilterToggle({ value, onChange }: {
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

// ── Integrations data ──────────────────────────────────────────────────────────
const integracoes = [
  { id: 1, name: 'Meta Ads',            status: 'Conectado',    logo: <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none"><path d="M4.15 15.45c0-3.92 1.98-7.03 4.34-7.03 1.38 0 2.47 1.03 3.52 2.68 1.05-1.65 2.14-2.68 3.52-2.68 2.36 0 4.34 3.11 4.34 7.03 0 2.5-1.08 4.13-2.8 4.13-1.46 0-2.54-.95-4.96-5.18-2.42 4.23-3.5 5.18-4.96 5.18-1.72 0-3-1.63-3-4.13Z" stroke="#0668E1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M12.01 11.1c2.4 3.78 3.45 5.47 5.06 5.47.74 0 1.19-.53 1.19-1.23 0-2.32-1.28-4.58-2.72-4.58-1.05 0-1.85.94-3.53 3.64-1.68-2.7-2.48-3.64-3.53-3.64-1.44 0-2.72 2.26-2.72 4.58 0 .7.45 1.23 1.19 1.23 1.61 0 2.66-1.69 5.06-5.47Z" stroke="#0668E1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { id: 2, name: 'Google Ads',          status: 'Desconectado', logo: <svg viewBox="0 0 24 24" className="w-6 h-6"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> },
  { id: 5, name: 'Google Meu Negócio',  status: 'Conectado',    logo: <svg viewBox="0 0 24 24" className="w-6 h-6"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> },
  { id: 6, name: 'Google Sheets (CRM)', status: 'Desconectado', logo: <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#34A853"><path d="M11.318 12.545H7.91v-1.909h3.41v1.91zm1.364 0v-1.909h3.408v1.91h-3.408zm0 1.364h3.408v1.909h-3.408v-1.909zm-1.364 0H7.91v1.909h3.41v-1.909zM24 4.364v15.272A4.368 4.368 0 0 1 19.636 24H4.364A4.368 4.368 0 0 1 0 19.636V4.364A4.368 4.368 0 0 1 4.364 0h15.272A4.368 4.368 0 0 1 24 4.364zm-4.363 4.5H4.363v11.772h15.273V8.864z"/></svg> },
];

// ── Funnel planning tab ────────────────────────────────────────────────────────
function FunnelTab({ clientName, goalConfig }: { clientName: string; goalConfig: ClientGoalConfig }) {
  const [tkm,      setTkm]      = useState(9000);
  const [cplMeta,  setCplMeta]  = useState(30);
  const [stages,   setStages]   = useState<FunnelStage[]>(DEFAULT_STAGES);

  const cplPlanejado = cplMeta;
  const vols     = plannedFunnelFromGoal(goalConfig, stages, tkm);
  const topVol   = vols[0] ?? 0;
  const botVol   = vols[stages.length - 1] ?? 0;
  const invPla   = topVol * cplPlanejado;
  const cac      = botVol > 0 ? invPla / botVol : 0;
  const roi      = goalConfig.type === 'revenue' && invPla > 0 ? goalConfig.target / invPla : 0;
  const maxVol   = topVol || 1;
  const goalValue = formatClientGoalValue(goalConfig.target, goalConfig.format);
  const lastStageLabel = stages[stages.length - 1]?.name.replace(/^\d+º\s—\s/, '') ?? 'Resultado final';

  function updateConversion(idx: number, val: number) {
    setStages((prev) => prev.map((s, i) => i === idx ? { ...s, conversion: Math.min(100, Math.max(0, val)) } : s));
  }
  function updateName(idx: number, val: string) {
    setStages((prev) => prev.map((s, i) => i === idx ? { ...s, name: val } : s));
  }
  function addStage() {
    if (stages.length >= 7) return;
    setStages((prev) => [{ id: `s${Date.now()}`, name: `${prev.length + 1}º — Nova Etapa`, conversion: 50 }, ...prev]);
  }
  function removeStage(idx: number) {
    if (stages.length <= 2) return;
    setStages((prev) => prev.filter((_, i) => i !== idx));
  }

  const inputCls = "bg-transparent focus:outline-none border-b border-transparent hover:border-border focus:border-primary transition-colors w-full";

  return (
    <div className="space-y-5 pt-2">
      {/* Client context */}
      <p className="text-sm text-muted-foreground">
        Configuração do funil de planejamento para <strong className="text-foreground">{clientName}</strong>.
        A meta principal é <strong className="text-foreground">{goalConfig.label}</strong>; ajuste as taxas de conversão para recalcular o plano.
      </p>

      {/* Config row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">META ({goalConfig.label})</p>
          <p className="text-2xl font-bold font-heading text-foreground">{goalValue}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Configurada na meta principal do cliente</p>
        </div>
        {[
          { label: 'TKM (Ticket Médio)',        value: tkm,      set: setTkm,      color: 'text-foreground', desc: 'Valor médio por venda'     },
          { label: 'CPL META (Custo/Lead)',     value: cplMeta,  set: setCplMeta,  color: 'text-primary',    desc: 'CPL planejado'             },
        ].map(({ label, value, set, color, desc }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{label}</p>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold text-muted-foreground">R$</span>
              <CurrencyInput
                value={value}
                onChange={set}
                className={cn('text-2xl font-bold font-heading flex-1 min-w-0', color, inputCls)}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{desc}</p>
          </div>
        ))}
      </div>

      {/* Funnel + Summary side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* LEFT — Funnel stages */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider">Funil de Conversão</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Edite nomes e taxas — volumes calculados automaticamente</p>
            </div>
            <button
              onClick={addStage}
              disabled={stages.length >= 7}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              Etapa
            </button>
          </div>

          <div className="space-y-1">
            {stages.map((stage, idx) => {
              const isLast  = idx === stages.length - 1;
              const vol     = vols[idx] ?? 0;
              const pct     = Math.round((vol / maxVol) * 100);
              const color   = STAGE_COLORS[idx % STAGE_COLORS.length];
              const nextVol = vols[idx + 1] ?? 0;

              return (
                <div key={stage.id}>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <input
                          type="text"
                          value={stage.name}
                          onChange={(e) => updateName(idx, e.target.value)}
                          className="flex-1 text-sm font-semibold focus:outline-none border-b border-transparent hover:border-border focus:border-primary transition-colors bg-transparent"
                        />
                        <span className="text-xl font-bold font-heading shrink-0" style={{ color }}>
                          {vol.toLocaleString('pt-BR')}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0 w-9 text-right">{pct}%</span>
                        {stages.length > 2 && (
                          <button onClick={() => removeStage(idx)} className="text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="h-7 rounded-lg bg-muted/30 overflow-hidden">
                        <div
                          className="h-full rounded-lg transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.75 }}
                        />
                      </div>
                    </div>
                  </div>

                  {!isLast && (
                    <div className="flex items-center gap-3 my-1.5 pl-2">
                      <div className="w-px h-6 border-l-2 border-dashed ml-3" style={{ borderColor: `${color}50` }} />
                      <div className="flex items-center gap-2 text-xs">
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">Conversão:</span>
                        <div className="flex items-center gap-0.5 bg-muted rounded px-2 py-0.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={stage.conversion}
                            onChange={(e) => updateConversion(idx, Number(e.target.value))}
                            className="w-10 bg-transparent text-sm font-bold text-center focus:outline-none"
                            style={{ color }}
                          />
                          <span className="text-xs font-bold text-muted-foreground">%</span>
                        </div>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-semibold" style={{ color: STAGE_COLORS[(idx + 1) % STAGE_COLORS.length] }}>
                          {nextVol.toLocaleString('pt-BR')} na próxima etapa
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — Summary KPIs */}
        <div className="flex flex-col gap-4">
          <div className="bg-primary/10 border border-primary/30 rounded-xl p-5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-primary mb-2">INV. PLANEJADO</p>
            <p className="text-4xl font-bold font-heading text-primary">{fmtBRL(invPla)}</p>
            <p className="text-xs text-muted-foreground mt-2">{topVol} leads × {fmtBRL(cplPlanejado)} CPL planejado</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{lastStageLabel.toUpperCase()} NECESSÁRIAS</p>
              <p className="text-3xl font-bold font-heading">{botVol}</p>
              <p className="text-xs text-muted-foreground mt-2">
                {goalConfig.type === 'revenue' ? `${goalValue} ÷ ${fmtBRL(tkm)}` : `Meta principal: ${goalValue}`}
              </p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">CAC</p>
              <p className="text-3xl font-bold font-heading">{fmtBRL(cac)}</p>
              <p className="text-xs text-muted-foreground mt-2">Custo por aquisição</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              {goalConfig.type === 'revenue' ? 'ROI ESPERADO' : `CUSTO POR ${goalConfig.label.toUpperCase()}`}
            </p>
            <p className={cn('text-4xl font-bold font-heading', goalConfig.type === 'revenue' ? (roi >= 3 ? 'text-primary' : roi >= 1.5 ? 'text-yellow-400' : 'text-red-400') : 'text-primary')}>
              {goalConfig.type === 'revenue' ? `${roi.toFixed(1)}x` : fmtBRL(goalConfig.target > 0 ? invPla / goalConfig.target : 0)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {goalConfig.type === 'revenue' ? 'Meta de faturamento ÷ investimento planejado' : 'Investimento planejado ÷ meta principal'}
            </p>
            <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min((goalConfig.type === 'revenue' ? roi / 10 : goalConfig.realized / Math.max(goalConfig.target, 1)) * 100, 100)}%`, backgroundColor: goalConfig.type === 'revenue' ? (roi >= 3 ? '#55F52F' : roi >= 1.5 ? '#F59E0B' : '#EF4444') : '#55F52F' }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              {goalConfig.type === 'revenue' ? (
                <>
                  <span>0x</span><span>5x</span><span>10x</span>
                </>
              ) : (
                <>
                  <span>0%</span><span>50%</span><span>100%</span>
                </>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-3">RESUMO DO FUNIL</p>
            <div className="space-y-2">
              {stages.map((stage, idx) => {
                const vol   = vols[idx] ?? 0;
                const color = STAGE_COLORS[idx % STAGE_COLORS.length];
                return (
                  <div key={stage.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground truncate flex-1">{stage.name}</span>
                    <span className="font-bold ml-3 shrink-0" style={{ color }}>{vol.toLocaleString('pt-BR')}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Investment payments tab ───────────────────────────────────────────────────
function InvestmentPaymentsTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const {
    payments: allPayments,
    addPayment: addSharedPayment,
    updatePaymentStatus,
    deletePayment,
  } = useInvestmentPayments();
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'Todos'>('Todos');
  const [channelFilter, setChannelFilter] = useState<PaymentChannel | 'Todos'>('Todos');
  const [newPayment, setNewPayment] = useState<Omit<InvestmentPayment, 'id'>>({
    clientId,
    clientName,
    date: makeDate(6),
    destination: `${clientName} - Novo investimento`,
    amount: 500,
    channel: 'Meta ADS',
    status: 'Pendente',
  });

  const payments = allPayments.filter((payment) => payment.clientId === clientId);
  const filteredPayments = payments.filter((payment) => {
    const statusMatches = statusFilter === 'Todos' || payment.status === statusFilter;
    const channelMatches = channelFilter === 'Todos' || payment.channel === channelFilter;
    return statusMatches && channelMatches;
  });

  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const sent = payments.filter((payment) => payment.status === 'Enviado').reduce((sum, payment) => sum + payment.amount, 0);
  const paid = payments.filter((payment) => payment.status === 'Pago').reduce((sum, payment) => sum + payment.amount, 0);
  const pending = payments.filter((payment) => payment.status === 'Pendente').reduce((sum, payment) => sum + payment.amount, 0);
  const overdue = payments.filter((payment) => payment.status === 'Em atraso').reduce((sum, payment) => sum + payment.amount, 0);
  const weeks = getBusinessWeeks(2026, 4, 4);

  function addPayment() {
    if (!newPayment.destination.trim() || newPayment.amount <= 0) return;

    addSharedPayment({ ...newPayment, destination: newPayment.destination.trim() });
    setNewPayment((prev) => ({ ...prev, destination: `${clientName} - Novo investimento`, amount: 500 }));
  }

  return (
    <div className="space-y-5 pt-1">
      <div className="grid gap-3 md:grid-cols-5">
        {[
          { label: 'Total programado', value: total, icon: WalletCards, tone: 'text-foreground' },
          { label: 'Pendente', value: pending, icon: Clock3, tone: 'text-orange-300' },
          { label: 'Pix enviado', value: sent, icon: Send, tone: 'text-sky-300' },
          { label: 'Pago pelo cliente', value: paid, icon: CheckCircle2, tone: 'text-primary' },
          { label: 'Em atraso', value: overdue, icon: AlertTriangle, tone: 'text-red-300' },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
              <Icon className={cn('w-4 h-4 shrink-0', tone)} />
            </div>
            <p className={cn('text-2xl font-bold font-heading mt-3', tone)}>{fmtBRL(value)}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider">Calendário de Pix de Investimento</h3>
              <p className="text-xs text-muted-foreground mt-1">Organize os valores por dia, canal e status antes de enviar ao cliente.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value as PaymentChannel | 'Todos')}
                className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option>Todos</option>
                <option>Meta ADS</option>
                <option>Google ADS</option>
                <option>TikTok ADS</option>
              </select>
              <StatusFilterToggle value={statusFilter} onChange={setStatusFilter} />
            </div>
          </div>

          <div className="overflow-x-auto pb-2">
            <div className="min-w-[980px] space-y-2">
              <div className="grid grid-cols-5 gap-2">
                {WEEKDAY_LABELS.map((label, idx) => (
                  <div key={label} className={cn('rounded-t-lg px-3 py-2 text-center text-xs font-bold tracking-widest text-white', WEEKDAY_COLORS[idx])}>
                    {label}
                  </div>
                ))}
              </div>

              {weeks.map((week, weekIdx) => (
                <div key={weekIdx} className="grid grid-cols-5 gap-2">
                  {week.map((date, dayIdx) => {
                    const dayPayments = filteredPayments
                      .filter((payment) => payment.date === date)
                      .sort((a, b) => a.destination.localeCompare(b.destination));
                    const dayTotal = dayPayments.reduce((sum, payment) => sum + payment.amount, 0);
                    const hasPayments = dayPayments.length > 0;
                    const holiday = date ? getHoliday(date) : undefined;

                    return (
                      <div
                        key={`${weekIdx}-${dayIdx}`}
                        className={cn(
                          'min-h-[190px] overflow-hidden rounded-b-lg border transition-colors',
                          holiday
                            ? 'border-orange-400/40 bg-orange-500/5'
                            : hasPayments
                            ? 'border-border bg-card shadow-[0_0_0_1px_rgba(255,255,255,0.03)]'
                            : 'border-border/30 bg-card/25 opacity-45',
                        )}
                      >
                        {date ? (
                          <>
                            <div
                              className={cn(
                                'px-3 py-2 text-center text-xs font-bold',
                                hasPayments || holiday
                                  ? cn('text-white', WEEKDAY_COLORS[dayIdx])
                                  : 'bg-muted/20 text-muted-foreground/50',
                              )}
                            >
                              {formatDateBR(date)}
                            </div>
                            <div className="p-2 space-y-2">
                              <HolidayPaymentNotice date={date} compact />
                              {hasPayments ? (
                                <>
                                  {dayPayments.map((payment) => {
                                    return (
                                      <div key={payment.id} className="group/payment rounded-lg bg-muted/35 p-2 text-xs">
                                        <div className="flex items-start justify-between gap-2">
                                          <p className="font-bold leading-tight">{clientName}</p>
                                          <button
                                            type="button"
                                            onClick={() => deletePayment(payment.id)}
                                            className="rounded-md p-1 text-muted-foreground/50 opacity-70 transition-colors hover:bg-red-500/10 hover:text-red-300 group-hover/payment:opacity-100"
                                            title="Apagar programação"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                        <div className="mt-2 flex items-center justify-between gap-2">
                                          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', CHANNEL_STYLES[payment.channel])}>
                                            {payment.channel}
                                          </span>
                                          <p className="font-bold whitespace-nowrap">{fmtBRL(payment.amount)}</p>
                                        </div>
                                        <div className="mt-2 space-y-1">
                                          <StatusDropdown
                                            value={payment.status}
                                            onChange={(status) => updatePaymentStatus(payment.id, status)}
                                          />
                                          {wasDispatched(payment.status) && payment.status !== 'Enviado' && (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[9px] font-bold text-sky-300">
                                              ✓ Enviado
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  <div className="flex justify-between border-t border-border pt-2 text-[11px] font-bold">
                                    <span>Total do dia</span>
                                    <span>{fmtBRL(dayTotal)}</span>
                                  </div>
                                </>
                              ) : (
                                <div className="h-28" />
                              )}
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
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-4 sticky top-4">
          <div>
            <h3 className="font-bold text-sm uppercase tracking-wider">Novo Pix</h3>
            <p className="text-xs text-muted-foreground mt-1">Adicione uma solicitação de investimento para {clientName}.</p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input
                type="date"
                value={newPayment.date}
                onChange={(e) => setNewPayment((prev) => ({ ...prev, date: e.target.value }))}
                className="bg-background"
              />
              <HolidayPaymentNotice date={newPayment.date} />
            </div>
            <div className="space-y-1.5">
              <Label>Destino / Campanha</Label>
              <Input
                value={newPayment.destination}
                onChange={(e) => setNewPayment((prev) => ({ ...prev, destination: e.target.value }))}
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor</Label>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3">
                <span className="text-sm font-bold text-muted-foreground">R$</span>
                <CurrencyInput
                  value={newPayment.amount}
                  onChange={(amount) => setNewPayment((prev) => ({ ...prev, amount }))}
                  className="h-9 flex-1 bg-transparent text-sm font-semibold focus:outline-none"
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Canal</Label>
                <select
                  value={newPayment.channel}
                  onChange={(e) => setNewPayment((prev) => ({ ...prev, channel: e.target.value as PaymentChannel }))}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {PAYMENT_CHANNELS.filter((channel) => channel !== 'Todos').map((channel) => <option key={channel}>{channel}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <StatusDropdown
                  value={newPayment.status}
                  onChange={(status) => setNewPayment((prev) => ({ ...prev, status }))}
                />
              </div>
            </div>
          </div>

          <Button onClick={addPayment} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-1" />
            Adicionar Pix
          </Button>
        </div>
      </div>
    </div>
  );
}

type GoalProgress = {
  label: string;
  realized: number;
  partial: number;
  target: number;
  format: 'currency' | 'number' | 'percent';
  inverse?: boolean;
};
type ClientGoalType = 'revenue' | 'leads' | 'enrollments';
type ClientGoalConfig = {
  type: ClientGoalType;
  label: string;
  target: number;
  partial: number;
  realized: number;
  format: 'currency' | 'number';
};

function autoPartial(target: number): number {
  const now = new Date();
  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round((target * day) / daysInMonth);
}
type TodayProgress = {
  revenue: number;
  enrollments: number;
  ticket: number;
  cpl: number;
  funnel: number[];
};

const PLANNING_GOALS = {
  revenue: 150000,
  ticket: 9000,
  cpl: 30,
  stages: DEFAULT_STAGES,
};

const TODAY_PROGRESS: TodayProgress = {
  revenue: 38250,
  enrollments: 9,
  ticket: 8500,
  cpl: 34,
  funnel: [42, 25, 13, 7, 4],
};

const ZERO_TODAY_PROGRESS: TodayProgress = {
  revenue: 0,
  enrollments: 0,
  ticket: 0,
  cpl: 0,
  funnel: [0, 0, 0, 0, 0],
};

const ZERO_DASHBOARD_DATA: typeof mockDashboardData = {
  salesTargets: {
    marketing: { value: 0, max: 0, label: 'Marketing Channels', color: 'bg-secondary' },
    leads: { value: 0, max: 0, label: 'Leads & Conversions', color: 'bg-primary' },
    reasons: { value: 0, max: 0, label: 'Reasons Not Booked', color: 'bg-orange-500' },
  },
  newLeadsData: mockDashboardData.newLeadsData.map((item) => ({ ...item, facebook: 0, instagram: 0 })),
  marketingChannelData: mockDashboardData.marketingChannelData.map((item) => ({ ...item, value: 0 })),
  statsData: mockDashboardData.statsData.map((item) => ({ ...item, value: 0 })),
};

const GOAL_TYPE_OPTIONS: { type: ClientGoalType; label: string; format: ClientGoalConfig['format'] }[] = [
  { type: 'leads', label: 'Leads', format: 'number' },
  { type: 'revenue', label: 'Faturamento', format: 'currency' },
  { type: 'enrollments', label: 'Matrículas', format: 'number' },
];

const DEFAULT_CLIENT_GOAL: ClientGoalConfig = {
  type: 'revenue',
  label: 'Faturamento',
  target: 150000,
  partial: autoPartial(150000),
  realized: 0,
  format: 'currency',
};

const ZERO_CLIENT_GOAL: ClientGoalConfig = {
  type: 'revenue',
  label: 'Faturamento',
  target: 0,
  partial: 0,
  realized: 0,
  format: 'currency',
};

function readSavedClientGoal(clientId: string, fallback: ClientGoalConfig): ClientGoalConfig {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(`clientGoal_${clientId}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ClientGoalConfig>;
    const option = GOAL_TYPE_OPTIONS.find((item) => item.type === parsed.type);
    if (!option) return fallback;
    const target = Number(parsed.target ?? fallback.target);
    return {
      type: option.type,
      label: option.label,
      format: option.format,
      target,
      partial: autoPartial(target),
      realized: Number(parsed.realized ?? fallback.realized ?? 0),
    };
  } catch {
    return fallback;
  }
}

function saveClientGoal(clientId: string, goal: ClientGoalConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`clientGoal_${clientId}`, JSON.stringify(goal));
}

function buildDashboardDataFromMetaAds(metrics: MetaAdsMetrics): typeof mockDashboardData {
  const facebookLeads = Math.round(metrics.leads * 0.62);
  const instagramLeads = Math.max(metrics.leads - facebookLeads, 0);
  const dayWeights = [0.14, 0.11, 0.18, 0.16, 0.2, 0.21];

  return {
    salesTargets: {
      marketing: {
        value: Math.round(metrics.impressions / 100),
        max: Math.max(Math.round(metrics.impressions / 80), 1),
        label: 'Impressões Meta Ads',
        color: 'bg-secondary',
      },
      leads: {
        value: metrics.leads,
        max: Math.max(Math.round(metrics.leads * 1.25), 1),
        label: 'Leads Meta Ads',
        color: 'bg-primary',
      },
      reasons: {
        value: Math.round(metrics.cpl),
        max: Math.max(Math.round(metrics.cpl * 1.4), 1),
        label: 'CPL Meta Ads',
        color: 'bg-red-500',
      },
    },
    newLeadsData: mockDashboardData.newLeadsData.map((item, index) => ({
      ...item,
      facebook: Math.round(facebookLeads * dayWeights[index]),
      instagram: Math.round(instagramLeads * dayWeights[index]),
    })),
    marketingChannelData: [
      { name: 'Facebook', value: 62, fill: '#55F52F' },
      { name: 'Instagram', value: 38, fill: '#7B2CFF' },
    ],
    statsData: mockDashboardData.statsData.map((item, index) => ({
      ...item,
      value: Math.max(0, Math.round(metrics.clicks * dayWeights[index] / 10)),
    })),
  };
}

function buildDashboardDataFromPaidMedia(meta: MetaAdsMetrics | null, google: GoogleAdsMetrics | null): typeof mockDashboardData {
  const metaLeads = meta?.leads ?? 0;
  const googleConversions = google?.conversions ?? 0;
  const totalResults = metaLeads + googleConversions;
  const totalSpend = (meta?.spend ?? 0) + (google?.cost ?? 0);
  const totalImpressions = (meta?.impressions ?? 0) + (google?.impressions ?? 0);
  const totalClicks = (meta?.clicks ?? 0) + (google?.clicks ?? 0);
  const blendedCost = totalResults > 0 ? totalSpend / totalResults : 0;
  const dayWeights = [0.14, 0.11, 0.18, 0.16, 0.2, 0.21];
  const metaShare = totalResults > 0 ? Math.round((metaLeads / totalResults) * 100) : 0;
  const googleShare = totalResults > 0 ? 100 - metaShare : 0;

  return {
    salesTargets: {
      marketing: {
        value: Math.round(totalImpressions / 100),
        max: Math.max(Math.round(totalImpressions / 80), 1),
        label: 'Impressões Ads',
        color: 'bg-secondary',
      },
      leads: {
        value: totalResults,
        max: Math.max(Math.round(totalResults * 1.25), 1),
        label: 'Resultados Ads',
        color: 'bg-primary',
      },
      reasons: {
        value: Math.round(blendedCost),
        max: Math.max(Math.round(blendedCost * 1.4), 1),
        label: 'Custo por Resultado',
        color: 'bg-red-500',
      },
    },
    newLeadsData: mockDashboardData.newLeadsData.map((item, index) => ({
      ...item,
      facebook: Math.round(metaLeads * dayWeights[index]),
      instagram: Math.round(googleConversions * dayWeights[index]),
    })),
    marketingChannelData: [
      { name: 'Meta Ads', value: metaShare, fill: '#55F52F' },
      { name: 'Google Ads', value: googleShare, fill: '#7B2CFF' },
    ],
    statsData: mockDashboardData.statsData.map((item, index) => ({
      ...item,
      value: Math.max(0, Math.round(totalClicks * dayWeights[index] / 10)),
    })),
  };
}

function buildTodayProgressFromMetaAds(metrics: MetaAdsMetrics): TodayProgress {
  return {
    revenue: 0,
    enrollments: 0,
    ticket: 0,
    cpl: Math.round(metrics.cpl),
    funnel: [
      metrics.leads,
      Math.round(metrics.leads * 0.62),
      Math.round(metrics.leads * 0.35),
      Math.round(metrics.leads * 0.18),
      Math.round(metrics.leads * 0.08),
    ],
  };
}

function buildTodayProgressFromPaidMedia(meta: MetaAdsMetrics | null, google: GoogleAdsMetrics | null): TodayProgress {
  const results = (meta?.leads ?? 0) + (google?.conversions ?? 0);
  const spend = (meta?.spend ?? 0) + (google?.cost ?? 0);
  const cost = results > 0 ? spend / results : 0;

  return {
    revenue: 0,
    enrollments: 0,
    ticket: 0,
    cpl: Math.round(cost),
    funnel: [
      results,
      Math.round(results * 0.62),
      Math.round(results * 0.35),
      Math.round(results * 0.18),
      Math.round(results * 0.08),
    ],
  };
}

function formatClientGoalValue(value: number, format: ClientGoalConfig['format']) {
  return format === 'currency' ? fmtBRL(value) : value.toLocaleString('pt-BR');
}

function plannedFunnelFromGoal(goal: ClientGoalConfig, stages: FunnelStage[], ticket = PLANNING_GOALS.ticket): number[] {
  const volumes = new Array<number>(stages.length).fill(0);
  if (stages.length === 0 || goal.target <= 0) return volumes;

  if (goal.type === 'leads') {
    volumes[0] = Math.ceil(goal.target);
    for (let i = 1; i < stages.length; i++) {
      const rate = stages[i - 1].conversion / 100;
      volumes[i] = rate > 0 ? Math.ceil(volumes[i - 1] * rate) : 0;
    }
    return volumes;
  }

  if (goal.type === 'revenue') {
    return computeFunnel(stages, goal.target, ticket);
  }

  volumes[stages.length - 1] = Math.ceil(goal.target);
  for (let i = stages.length - 2; i >= 0; i--) {
    const rate = stages[i].conversion / 100;
    volumes[i] = rate > 0 ? Math.ceil(volumes[i + 1] / rate) : 0;
  }
  return volumes;
}

function goalPercent(current: number, target: number, inverse = false): number {
  if (target <= 0 || current <= 0) return 0;
  const raw = inverse ? (target / current) * 100 : (current / target) * 100;
  return Math.min(Math.round(raw), 100);
}

function formatGoalValue(value: number, format: GoalProgress['format']): string {
  if (format === 'currency') return fmtBRL(value);
  if (format === 'percent') return `${value.toFixed(1)}%`;
  return value.toLocaleString('pt-BR');
}

function goalVisualColor(progress: number): string {
  if (progress >= 90) return '#55F52F';
  if (progress >= 60) return '#7B2CFF';
  return '#EF4444';
}

function goalToneLabel(progress: number): string {
  if (progress >= 90) return 'No ritmo';
  if (progress >= 60) return 'Atenção';
  return 'Crítico';
}

function GoalProgressCard({ goal }: { goal: GoalProgress }) {
  const progress = goalPercent(goal.realized, goal.partial, goal.inverse);
  const color = goal.label === 'Faturamento' ? '#55F52F' : goalVisualColor(progress);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="h-1.5" style={{ backgroundColor: color }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h4 className="text-xl font-bold" style={{ color }}>{goal.label}</h4>
            <p className="mt-1 text-xs text-muted-foreground">Realizado contra a meta parcial do dia.</p>
          </div>
          <div className="rounded-lg border px-3 py-2 text-right" style={{ borderColor: `${color}55`, backgroundColor: `${color}14` }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{goalToneLabel(progress)}</p>
          </div>
        </div>

        <div className="relative mt-5 min-h-28 overflow-hidden rounded-lg border border-border bg-background/60">
          <div
            className="absolute inset-y-0 left-0 transition-all duration-500"
            style={{
              width: `${progress}%`,
              backgroundColor: color,
              boxShadow: `0 0 28px ${color}44`,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/10 via-background/35 to-background/80" />
          <div className="relative flex min-h-28 items-center justify-between gap-4 p-4">
            <div className="rounded-lg bg-background/80 px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
              <p className="mt-1 font-heading text-4xl leading-none tracking-wide text-foreground">
                {formatGoalValue(goal.realized, goal.format)}
              </p>
            </div>
            <div className="rounded-lg bg-background/80 px-3 py-2 text-right shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur">
              <p className="font-heading text-3xl leading-none" style={{ color }}>{progress}%</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{goalToneLabel(progress)}</p>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-background/60 p-3">
            <p className="text-sm font-bold">{formatGoalValue(goal.target, goal.format)}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Meta</p>
          </div>
          <div className="rounded-lg bg-background/60 p-3">
            <p className="text-sm font-bold">{formatGoalValue(goal.partial, goal.format)}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Parcial</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FunnelStageCard({ stage, target, partial, current, progress }: {
  stage: FunnelStage;
  target: number;
  partial: number;
  current: number;
  progress: number;
}) {
  const color = goalVisualColor(progress);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
      <div className="h-1.5" style={{ backgroundColor: color }} />
      <div className="p-4">
        <div className="flex min-h-28 flex-col justify-between gap-3">
          <div>
            <p className="max-h-10 overflow-hidden text-sm font-semibold leading-5">{stage.name}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
              {goalToneLabel(progress)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
            <p className="mt-1 font-heading text-4xl leading-none" style={{ color }}>
              {current.toLocaleString('pt-BR')}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-md bg-background/60 p-2">
            <p className="text-xs font-bold">{target.toLocaleString('pt-BR')}</p>
            <p className="text-[9px] font-bold text-muted-foreground">Meta</p>
          </div>
          <div className="rounded-md bg-background/60 p-2">
            <p className="text-xs font-bold">{partial.toLocaleString('pt-BR')}</p>
            <p className="text-[9px] font-bold text-muted-foreground">Parcial</p>
          </div>
          <div className="rounded-md bg-background/60 p-2">
            <p className="text-xs font-bold">{progress}%</p>
            <p className="text-[9px] font-bold text-muted-foreground">Ritmo</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TargetSummaryCard({ label, value, max }: {
  label: string;
  value: number;
  max: number;
}) {
  const progress = goalPercent(value, max);
  const color = goalVisualColor(progress);

  return (
    <Card className="overflow-hidden bg-card border-border">
      <div className="h-1.5" style={{ backgroundColor: color }} />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <TrendingUp className="h-4 w-4" style={{ color }} />
      </CardHeader>
      <CardContent>
        <div className="rounded-lg bg-background/60 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Valor atual</p>
          <span className="mt-1 block font-heading text-4xl leading-none tracking-wide" style={{ color }}>
            {fmtBRL(value)}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color }}>
            {goalToneLabel(progress)}
          </p>
          <p className="rounded-md border px-2 py-1 text-xs font-bold" style={{ borderColor: `${color}55`, color }}>
            {progress}%
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DataHighlightCard({ label, value, detail, color }: {
  label: string;
  value: string;
  detail: string;
  color: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background/60">
      <div className="h-1.5" style={{ backgroundColor: color }} />
      <div className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="mt-2 font-heading text-4xl leading-none tracking-wide" style={{ color }}>
          {value}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function ClientGoalSettings({ goal, onChange }: {
  goal: ClientGoalConfig;
  onChange: (goal: ClientGoalConfig) => void;
}) {
  function handleTypeChange(type: ClientGoalType) {
    const option = GOAL_TYPE_OPTIONS.find((o) => o.type === type)!;
    onChange({ ...goal, type, label: option.label, format: option.format, partial: autoPartial(goal.target) });
  }

  function handleTargetChange(target: number) {
    onChange({ ...goal, target, partial: autoPartial(target) });
  }

  return (
    <div className="flex flex-wrap items-end gap-4 py-1">
      <div className="space-y-1.5">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Tipo de meta</Label>
        <div className="flex gap-1 p-1 bg-muted/40 rounded-lg border border-border">
          {GOAL_TYPE_OPTIONS.map((option) => (
            <button
              key={option.type}
              onClick={() => handleTypeChange(option.type)}
              className={cn(
                'px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors',
                goal.type === option.type
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Meta</Label>
        <Input
          type="number"
          value={goal.target || ''}
          onChange={(e) => handleTargetChange(Number(e.target.value))}
          className="bg-background w-44"
          placeholder="0"
        />
      </div>
    </div>
  );
}

function PlanningGoalsDashboard({ goalConfig, todayProgress }: { goalConfig: ClientGoalConfig; todayProgress: TodayProgress }) {
  const plannedFunnel = plannedFunnelFromGoal(goalConfig, PLANNING_GOALS.stages);
  const leadsGoal = plannedFunnel[0] ?? 0;
  const goals: GoalProgress[] = [
    { label: goalConfig.label, realized: goalConfig.realized, partial: goalConfig.partial, target: goalConfig.target, format: goalConfig.format },
    ...(goalConfig.type === 'leads' ? [] : [{ label: 'Leads', realized: todayProgress.funnel[0], partial: 60, target: leadsGoal, format: 'number' as const }]),
    { label: 'Ticket Médio', realized: todayProgress.ticket, partial: PLANNING_GOALS.ticket, target: PLANNING_GOALS.ticket, format: 'currency' },
    { label: 'CPL', realized: todayProgress.cpl, partial: PLANNING_GOALS.cpl, target: PLANNING_GOALS.cpl, format: 'currency', inverse: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm uppercase tracking-wider">Parcial do Dia vs Planejamento</h3>
          <p className="text-xs text-muted-foreground mt-1">Acompanhe o avanço das metas principais e do funil previsto.</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Atualizado hoje</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {goals.map((goal) => <GoalProgressCard key={goal.label} goal={goal} />)}
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Funil planejado</CardTitle>
          <CardDescription>Parcial atual comparada com o volume necessário por etapa.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {PLANNING_GOALS.stages.map((stage, idx) => {
              const current = todayProgress.funnel[idx] ?? 0;
              const target = plannedFunnel[idx] ?? 0;
              const partial = Math.ceil(target * 0.16);
              const progress = goalPercent(current, partial);

              return (
                <FunnelStageCard
                  key={stage.id}
                  stage={stage}
                  target={target}
                  partial={partial}
                  current={current}
                  progress={progress}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Client team tab ────────────────────────────────────────────────────────────
type ClientTeamRole =
  | 'Responsável'
  | 'Atendimento'
  | 'Vendas'
  | 'Atendimento aos leads'
  | 'Gerente'
  | 'Comercial'
  | 'Financeiro'
  | 'Operacional';

type ClientTeamMember = {
  id: string;
  name: string;
  role: string;
  phone: string;
};

const TEAM_ROLES = [
  'Responsável',
  'Atendimento',
  'Vendas',
  'Atendimento aos leads',
  'Gerente',
  'Comercial',
  'Financeiro',
  'Operacional',
];

const ROLE_COLORS: Record<string, string> = {
  Responsável: '#55F52F',
  Atendimento: '#7B2CFF',
  Vendas: '#55F52F',
  'Atendimento aos leads': '#7B2CFF',
  Gerente: '#55F52F',
  Comercial: '#7B2CFF',
  Financeiro: '#38BDF8',
  Operacional: '#F59E0B',
};

const DNA_STORAGE_KEY = (clientId: string) => `dna-members-${clientId}`;

function ClientDnaTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [members, setMembers] = useState<ClientTeamMember[]>(() => {
    try {
      const raw = localStorage.getItem(DNA_STORAGE_KEY(clientId));
      return raw ? (JSON.parse(raw) as ClientTeamMember[]) : [];
    } catch { return []; }
  });
  const [form, setForm] = useState({ name: '', role: TEAM_ROLES[0], phone: '' });
  const [saved, setSaved] = useState(false);

  function addMember() {
    if (!form.name.trim()) return;
    setMembers((prev) => [...prev, { id: `team-${Date.now()}`, name: form.name.trim(), role: form.role, phone: form.phone.trim() }]);
    setForm({ name: '', role: TEAM_ROLES[0], phone: '' });
    setSaved(false);
  }

  function removeMember(id: string) {
    setMembers((prev) => prev.filter((m) => m.id !== id));
    setSaved(false);
  }

  function handleSave() {
    localStorage.setItem(DNA_STORAGE_KEY(clientId), JSON.stringify(members));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-sm uppercase tracking-wider">DNA do Cliente</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Mapeie os contatos-chave de {clientName}.
          </p>
        </div>
        <Button
          onClick={handleSave}
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 text-xs font-bold uppercase tracking-wider"
        >
          {saved ? <Check className="mr-1.5 h-3.5 w-3.5" /> : null}
          {saved ? 'Salvo!' : 'Salvar DNA'}
        </Button>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="pt-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_180px_auto]">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Nome do funcionário"
                className="bg-background"
                onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Função</Label>
              <select
                value={form.role}
                onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {TEAM_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="(00) 00000-0000"
                className="bg-background"
                onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={addMember} disabled={!form.name.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 w-9 p-0">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {members.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
          <UserRound className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum contato cadastrado ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member) => {
            const color = ROLE_COLORS[member.role] ?? '#8B8B8B';
            const initials = member.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
            return (
              <div key={member.id} className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-heading text-sm font-bold"
                  style={{ borderColor: `${color}55`, backgroundColor: `${color}14`, color }}
                >
                  {initials || <UserRound className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{member.name}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color }}>{member.role}</p>
                </div>
                {member.phone && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span>{member.phone}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeMember(member.id)}
                  className="text-muted-foreground/60 hover:text-destructive transition-colors ml-2"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ClientChartType = 'kpi' | 'bar' | 'line' | 'area';
type ClientWidgetSize = 1 | 2 | 3;
type ClientMetricFormat = 'number' | 'currency' | 'percent' | 'times';
type ClientMetricDef = {
  key: string;
  group: string;
  label: string;
  short: string;
  format: ClientMetricFormat;
  color: string;
  computed: boolean;
  value: number;
};
type ClientDashboardWidget = {
  id: string;
  title: string;
  metrics: string[];
  chartType: ClientChartType;
  size: ClientWidgetSize;
};

const CLIENT_METRICS: ClientMetricDef[] = [
  { key: 'ml',  group: 'Meta Ads', label: 'Leads Capturados (Meta)', short: 'Leads Meta', format: 'number', color: '#55F52F', computed: false, value: 107 },
  { key: 'sp',  group: 'Meta Ads', label: 'Investimento', short: 'Investimento', format: 'currency', color: '#F59E0B', computed: false, value: 1570 },
  { key: 'im',  group: 'Meta Ads', label: 'Impressões', short: 'Impressões', format: 'number', color: '#8B5CF6', computed: false, value: 45000 },
  { key: 'cpl', group: 'Meta Ads', label: 'CPL (Custo por Lead)', short: 'CPL', format: 'currency', color: '#EF4444', computed: true, value: 14.67 },
  { key: 'ctr', group: 'Meta Ads', label: 'CTR (%)', short: 'CTR', format: 'percent', color: '#EC4899', computed: true, value: 2.68 },
  { key: 'ql',  group: 'CRM', label: 'Leads Qualificados', short: 'Qualificados', format: 'number', color: '#7B2CFF', computed: false, value: 65 },
  { key: 'ag',  group: 'CRM', label: 'Agendamentos', short: 'Agendamentos', format: 'number', color: '#3B82F6', computed: false, value: 42 },
  { key: 'cv',  group: 'CRM', label: 'Conversões (Vendas)', short: 'Conversões', format: 'number', color: '#10B981', computed: false, value: 15 },
  { key: 'rv',  group: 'CRM', label: 'Receita (R$)', short: 'Receita', format: 'currency', color: '#22D3EE', computed: false, value: 30000 },
  { key: 'cr',  group: 'CRM', label: 'Taxa de Conversão (%)', short: 'Conv.%', format: 'percent', color: '#F97316', computed: true, value: 23.08 },
  { key: 'roi', group: 'CRM', label: 'ROI', short: 'ROI', format: 'times', color: '#FCD34D', computed: true, value: 19.1 },
  { key: 'mg',  group: 'Cidades', label: 'Leads — Maringá', short: 'Maringá', format: 'number', color: '#F472B6', computed: false, value: 64 },
  { key: 'ld',  group: 'Cidades', label: 'Leads — Londrina', short: 'Londrina', format: 'number', color: '#FB923C', computed: false, value: 32 },
  { key: 'ou',  group: 'Cidades', label: 'Leads — Outras Cidades', short: 'Outras', format: 'number', color: '#A3E635', computed: false, value: 11 },
];
const CLIENT_METRIC_GROUPS = ['Meta Ads', 'CRM', 'Cidades'];
const CLIENT_METRIC_MAP = Object.fromEntries(CLIENT_METRICS.map((metric) => [metric.key, metric])) as Record<string, ClientMetricDef>;
const CLIENT_CHART_OPTIONS: { key: ClientChartType; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { key: 'kpi', label: 'Número(s)', Icon: Hash },
  { key: 'bar', label: 'Barras', Icon: BarChart2 },
  { key: 'line', label: 'Linha', Icon: TrendingUp },
  { key: 'area', label: 'Área', Icon: Layers },
];

function formatClientMetricValue(value: number, format: ClientMetricFormat): string {
  if (format === 'currency') return fmtBRL(value);
  if (format === 'percent') return `${value.toFixed(2)}%`;
  if (format === 'times') return `${value.toFixed(1)}x`;
  return value.toLocaleString('pt-BR');
}

function clientWidgetTitle(metrics: string[]): string {
  if (metrics.length === 0) return 'Novo Bloco';
  return metrics.map((key) => CLIENT_METRIC_MAP[key]?.short ?? key).join(' vs. ');
}

function ClientWidgetCard({ widget, editable, onRemove }: {
  widget: ClientDashboardWidget;
  editable: boolean;
  onRemove: () => void;
}) {
  const metrics = widget.metrics.map((key) => CLIENT_METRIC_MAP[key]).filter((metric): metric is ClientMetricDef => !!metric);
  const accent = metrics[0]?.color ?? '#55F52F';

  return (
    <div className={cn(
      'relative overflow-hidden rounded-xl border border-border bg-card',
      widget.size === 2 && 'md:col-span-2',
      widget.size === 3 && 'md:col-span-2 xl:col-span-3',
    )}>
      <div className="h-1.5" style={{ backgroundColor: accent }} />
      {editable && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-2 top-2 z-10 rounded-md bg-background/80 p-1 text-muted-foreground shadow hover:text-destructive"
          title="Remover bloco"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider">{widget.title}</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Visualização: {CLIENT_CHART_OPTIONS.find((option) => option.key === widget.chartType)?.label ?? 'Número(s)'}
            </p>
          </div>
        </div>
        <div className={cn('mt-4 grid gap-3', metrics.length > 1 && 'sm:grid-cols-2 xl:grid-cols-3')}>
          {metrics.map((metric) => (
            <div key={metric.key} className="rounded-lg bg-background/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{metric.short}</p>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: metric.color }} />
              </div>
              <p className="mt-2 font-heading text-4xl leading-none tracking-wide" style={{ color: metric.color }}>
                {formatClientMetricValue(metric.value, metric.format)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{metric.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddClientWidgetDialog({ open, onClose, onAdd }: {
  open: boolean;
  onClose: () => void;
  onAdd: (widget: Omit<ClientDashboardWidget, 'id'>) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [chart, setChart] = useState<ClientChartType>('bar');
  const [size, setSize] = useState<ClientWidgetSize>(2);
  const [customTitle, setCustomTitle] = useState('');
  const allCanChart = selected.length > 0 && selected.every((key) => !CLIENT_METRIC_MAP[key]?.computed);
  const availableCharts: ClientChartType[] = allCanChart ? ['kpi', 'bar', 'line', 'area'] : ['kpi'];

  function toggleMetric(key: string) {
    if (selected.includes(key)) {
      const next = selected.filter((item) => item !== key);
      setSelected(next);
      const nextCanChart = next.length > 0 && next.every((item) => !CLIENT_METRIC_MAP[item]?.computed);
      if (!nextCanChart) setChart('kpi');
      return;
    }

    if (selected.length >= 3) return;
    setSelected((prev) => [...prev, key]);
    if (CLIENT_METRIC_MAP[key]?.computed) setChart('kpi');
  }

  function handleClose() {
    setSelected([]);
    setChart('bar');
    setSize(2);
    setCustomTitle('');
    onClose();
  }

  function handleAdd() {
    if (selected.length === 0) return;
    onAdd({
      title: customTitle.trim() || clientWidgetTitle(selected),
      metrics: selected,
      chartType: chart,
      size,
    });
    handleClose();
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-5xl p-0 overflow-hidden">
        <div className="p-6">
          <DialogHeader>
            <DialogTitle className="text-xl uppercase tracking-wider">Adicionar Bloco ao Dashboard</DialogTitle>
          </DialogHeader>

          <div className="mt-6 max-h-[62vh] space-y-5 overflow-y-auto pr-1">
            {selected.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Comparando:</span>
                {selected.map((key) => {
                  const metric = CLIENT_METRIC_MAP[key];

                  return (
                    <span
                      key={key}
                      className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                      style={{ borderColor: `${metric?.color}66`, color: metric?.color, backgroundColor: `${metric?.color}18` }}
                    >
                      {metric?.short ?? key}
                      <button type="button" onClick={() => toggleMetric(key)} className="ml-0.5 opacity-60 hover:opacity-100">x</button>
                    </span>
                  );
                })}
                {selected.length < 3 && (
                  <span className="text-[11px] text-muted-foreground/60">+ até {3 - selected.length} mais</span>
                )}
              </div>
            )}

            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                1. Selecione as Métricas <span className="font-normal normal-case text-muted-foreground/50">(até 3 para comparar)</span>
              </p>
              {CLIENT_METRIC_GROUPS.map((group) => {
                const metrics = CLIENT_METRICS.filter((metric) => metric.group === group);

                return (
                  <div key={group} className="mb-5">
                    <p className="mb-2 px-0.5 text-[10px] uppercase tracking-widest text-muted-foreground/60">{group}</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {metrics.map((metric) => {
                        const isSelected = selected.includes(metric.key);
                        const isDisabled = !isSelected && selected.length >= 3;

                        return (
                          <button
                            key={metric.key}
                            type="button"
                            onClick={() => !isDisabled && toggleMetric(metric.key)}
                            disabled={isDisabled}
                            className={cn(
                              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                              isSelected ? 'border-primary/60 bg-primary/10' : 'border-border bg-card',
                              isDisabled ? 'cursor-not-allowed opacity-30' : 'hover:bg-muted/50',
                            )}
                          >
                            <div
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2"
                              style={isSelected ? { backgroundColor: metric.color, borderColor: metric.color } : { borderColor: '#4B5563' }}
                            >
                              {isSelected && <Check className="h-3 w-3 text-black" />}
                            </div>
                            <p className="min-w-0 flex-1 truncate text-sm font-medium">{metric.label}</p>
                            <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: metric.color }} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {selected.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">2. Visualização</p>
                <div className="flex flex-wrap gap-2">
                  {CLIENT_CHART_OPTIONS.filter((option) => availableCharts.includes(option.key)).map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setChart(key)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                        chart === key ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/50',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>
                {!allCanChart && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground/60">
                    Métricas calculadas como CPL, CTR, ROI e Taxa de Conversão entram como número.
                  </p>
                )}
              </div>
            )}

            {selected.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">3. Título (opcional)</p>
                <Input
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder={clientWidgetTitle(selected)}
                  className="bg-card"
                />
              </div>
            )}

            {selected.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">4. Tamanho</p>
                <div className="flex gap-2">
                  {([
                    { key: 1 as ClientWidgetSize, label: '1 Coluna', sub: 'Compacto' },
                    { key: 2 as ClientWidgetSize, label: '2 Colunas', sub: 'Médio' },
                    { key: 3 as ClientWidgetSize, label: '3 Colunas', sub: 'Largo' },
                  ]).map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setSize(option.key)}
                      className={cn(
                        'flex-1 rounded-lg border p-2 text-center transition-colors',
                        size === option.key ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/50',
                      )}
                    >
                      <p className="text-xs font-semibold">{option.label}</p>
                      <p className="text-[10px] text-muted-foreground">{option.sub}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          <Button
            onClick={handleAdd}
            disabled={selected.length === 0}
            className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar Bloco
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientDashboardTab({
  editable = false,
  goalConfig,
  dashboardData,
  todayProgress,
  customBlocks,
  onAddCustomBlock,
  onRemoveCustomBlock,
  onEditToggle,
}: {
  editable?: boolean;
  goalConfig: ClientGoalConfig;
  dashboardData: typeof mockDashboardData;
  todayProgress: TodayProgress;
  customBlocks: ClientDashboardWidget[];
  onAddCustomBlock: (widget: Omit<ClientDashboardWidget, 'id'>) => void;
  onRemoveCustomBlock: (id: string) => void;
  onEditToggle: () => void;
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const facebookLeads = dashboardData.newLeadsData.reduce((sum, item) => sum + item.facebook, 0);
  const instagramLeads = dashboardData.newLeadsData.reduce((sum, item) => sum + item.instagram, 0);
  const totalLeads = facebookLeads + instagramLeads;
  const hasGoogleAdsMix = dashboardData.marketingChannelData.some((channel) => channel.name === 'Google Ads');
  const primaryLeadLabel = hasGoogleAdsMix ? 'Meta Ads' : 'Facebook';
  const secondaryLeadLabel = hasGoogleAdsMix ? 'Google Ads' : 'Instagram';
  const primaryLeadDetail = hasGoogleAdsMix ? 'Resultados vindos do Meta Ads.' : 'Origem Meta/Facebook.';
  const secondaryLeadDetail = hasGoogleAdsMix ? 'Conversões vindas do Google Ads.' : 'Origem Instagram.';

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          onClick={onEditToggle}
          variant={editable ? 'default' : 'outline'}
          className={cn(editable && 'bg-primary text-primary-foreground hover:bg-primary/90')}
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          {editable ? 'Concluir edição' : 'Editar Dashboard'}
        </Button>
      </div>

      {editable && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                  <LayoutGrid className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Construtor da Dashboard</CardTitle>
                  <CardDescription>Adicione blocos personalizados escolhendo métricas e visualizações.</CardDescription>
                </div>
              </div>
              <Button onClick={() => setAddDialogOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" />
                Adicionar Bloco
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      <AddClientWidgetDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdd={onAddCustomBlock}
      />

      <PlanningGoalsDashboard goalConfig={goalConfig} todayProgress={todayProgress} />

      <div className="grid gap-5 md:grid-cols-3">
        {Object.entries(dashboardData.salesTargets).map(([key, target]) => (
          <TargetSummaryCard key={key} label={target.label} value={target.value} max={target.max} />
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-muted"><Users className="w-4 h-4" /></div>
                  <CardTitle className="text-lg">Novos Leads</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mt-2 grid gap-3 xl:grid-cols-3">
                  <DataHighlightCard
                    label="Total"
                    value={totalLeads.toLocaleString('pt-BR')}
                    detail="Leads somados no período."
                    color="#55F52F"
                  />
                  <DataHighlightCard
                    label={primaryLeadLabel}
                    value={facebookLeads.toLocaleString('pt-BR')}
                    detail={primaryLeadDetail}
                    color="#55F52F"
                  />
                  <DataHighlightCard
                    label={secondaryLeadLabel}
                    value={instagramLeads.toLocaleString('pt-BR')}
                    detail={secondaryLeadDetail}
                    color="#7B2CFF"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-muted"><BarChart3 className="w-4 h-4" /></div>
                  <CardTitle className="text-lg">Canais de Marketing</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {dashboardData.marketingChannelData.map((channel) => (
                    <DataHighlightCard
                      key={channel.name}
                      label={channel.name}
                      value={`${channel.value.toLocaleString('pt-BR')}%`}
                      detail="Participação no mix de canais."
                      color={channel.fill}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
      </div>

      {customBlocks.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {customBlocks.map((widget) => (
            <ClientWidgetCard
              key={widget.id}
              widget={widget}
              editable={editable}
              onRemove={() => onRemoveCustomBlock(widget.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const AD_ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: 'Ativa', 2: 'Desativada', 3: 'Não gasta', 7: 'Cancelada',
};

function MetaAdsConnectionDialog({
  open,
  onClose,
  clientId,
  clientName,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}) {
  const { getConnection, saveConnection, disconnectClient } = useMetaAdsConnections();
  const connection = getConnection(clientId);

  const [globalMeta, setGlobalMeta] = useState(readIntegrations().meta);
  const [cachedAccounts, setCachedAccounts] = useState<CachedAdAccount[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([loadIntegrations(), loadCachedAdAccounts()]).then(([store, accounts]) => {
      setGlobalMeta(store.meta);
      setCachedAccounts(accounts);
      setSelectedIds(connection?.accountIds ?? []);
    }).catch(() => {});
  }, [open, connection]); // eslint-disable-line react-hooks/exhaustive-deps

  const globalConnected = globalMeta.status === 'connected';
  const hasAccounts = cachedAccounts.length > 0;

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSave() {
    if (selectedIds.length === 0) return;
    const firstName = cachedAccounts.find((a) => a.id === selectedIds[0])?.name ?? selectedIds[0];
    saveConnection(clientId, firstName, selectedIds);
    onClose();
  }

  function handleDisconnect() {
    disconnectClient(clientId);
    setSelectedIds([]);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl uppercase tracking-wider">Configurar Meta Ads</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Selecione a(s) conta(s) de anúncio de <strong>{clientName}</strong>.
          </p>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Global status */}
          {!globalConnected ? (
            <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
              <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
              <div className="text-xs text-yellow-300 leading-relaxed">
                <p className="font-semibold">Meta Ads não conectado globalmente.</p>
                <p className="text-yellow-300/70 mt-0.5">Vá em <strong>Integrações</strong> e conecte o Meta Ads primeiro.</p>
              </div>
            </div>
          ) : !hasAccounts ? (
            <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
              <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
              <div className="text-xs text-yellow-300 leading-relaxed">
                <p className="font-semibold">Nenhuma conta de anúncio encontrada.</p>
                <p className="text-yellow-300/70 mt-0.5">Vá em <strong>Integrações → Meta Ads</strong> e aguarde o painel de ativos carregar as contas.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Connected as */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>Conectado como <strong className="text-foreground">{globalMeta.userName}</strong> · {cachedAccounts.length} conta(s) disponíve{cachedAccounts.length === 1 ? 'l' : 'is'}</span>
              </div>

              {/* Account list */}
              <div className="grid gap-2 max-h-72 overflow-y-auto pr-1">
                {cachedAccounts.map((acc) => {
                  const selected = selectedIds.includes(acc.id);
                  const statusLabel = AD_ACCOUNT_STATUS_LABEL[acc.account_status] ?? 'Desconhecido';
                  const isActive = acc.account_status === 1;
                  const spent = acc.amount_spent ? (Number(acc.amount_spent) / 100) : null;

                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => toggle(acc.id)}
                      className={cn(
                        'flex items-center justify-between gap-4 rounded-lg border p-3.5 text-left transition-colors',
                        selected
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-border bg-background hover:border-primary/30 hover:bg-muted/30',
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                        )}>
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{acc.name}</p>
                          <p className="text-xs font-mono text-muted-foreground mt-0.5">{acc.id} · {acc.currency}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <p className={cn('text-[11px] font-bold', isActive ? 'text-emerald-400' : 'text-yellow-400')}>
                          {statusLabel}
                        </p>
                        {spent !== null && (
                          <p className="text-[11px] text-muted-foreground">
                            {spent.toLocaleString('pt-BR', { style: 'currency', currency: acc.currency })}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedIds.length > 0 && (
                <p className="text-xs text-primary font-semibold">
                  {selectedIds.length} conta(s) selecionada(s)
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {connection && (
              <Button variant="outline" onClick={handleDisconnect} className="border-red-500/40 text-red-400 hover:bg-red-500/10">
                Desvincular
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={!globalConnected || !hasAccounts || selectedIds.length === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Salvar vínculo
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GoogleAdsConnectionDialog({
  open,
  onClose,
  clientId,
  clientName,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}) {
  const {
    integration,
    accounts: allGoogleAccounts,
    getConnection,
    saveClientConnection,
    disconnectClient,
  } = useGoogleAds();
  const connection = getConnection(clientId);
  const [managerId, setManagerId] = useState(integration.managerId || GOOGLE_ADS_MANAGERS[0].id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setManagerId(connection?.managerId || integration.managerId || GOOGLE_ADS_MANAGERS[0].id);
    setSelectedIds(connection?.accountIds ?? []);
  }, [connection, integration.managerId, open]);

  const globalConnected = integration.status === 'connected';
  const accounts = allGoogleAccounts.filter((account) => account.managerId === managerId);
  const selectedMetrics = allGoogleAccounts
    .filter((account) => selectedIds.includes(account.id))
    .reduce(
      (total, account) => ({
        cost: total.cost + account.metrics.cost,
        impressions: total.impressions + account.metrics.impressions,
        clicks: total.clicks + account.metrics.clicks,
        conversions: total.conversions + account.metrics.conversions,
        cpc: 0,
      }),
      { cost: 0, impressions: 0, clicks: 0, conversions: 0, cpc: 0 },
    );
  const cpc = selectedMetrics.clicks > 0 ? selectedMetrics.cost / selectedMetrics.clicks : 0;

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSave() {
    if (selectedIds.length === 0) return;
    saveClientConnection(clientId, managerId, selectedIds);
    onClose();
  }

  function handleDisconnect() {
    disconnectClient(clientId);
    setSelectedIds([]);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl uppercase tracking-wider">Configurar Google Ads</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Selecione as contas Google Ads de <strong>{clientName}</strong>.
          </p>
        </DialogHeader>

        <div className="grid gap-4">
          {!globalConnected ? (
            <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
              <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
              <div className="text-xs text-yellow-300 leading-relaxed">
                <p className="font-semibold">Google Ads não conectado globalmente.</p>
                <p className="text-yellow-300/70 mt-0.5">Vá em <strong>Integrações</strong> e conecte o Google Ads pelo Gmail ou MCC primeiro.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">MCC / Conta gerente</Label>
                <select
                  value={managerId}
                  onChange={(e) => { setManagerId(e.target.value); setSelectedIds([]); }}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {GOOGLE_ADS_MANAGERS.map((manager) => (
                    <option key={manager.id} value={manager.id}>{manager.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2 max-h-72 overflow-y-auto pr-1">
                {accounts.map((account) => {
                  const selected = selectedIds.includes(account.id);
                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => toggle(account.id)}
                      className={cn(
                        'flex items-center justify-between gap-4 rounded-lg border p-3.5 text-left transition-colors',
                        selected ? 'border-primary/60 bg-primary/10' : 'border-border bg-background hover:border-primary/30 hover:bg-muted/30',
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                        )}>
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{account.name}</p>
                          <p className="text-xs font-mono text-muted-foreground mt-0.5">{account.id} - {account.currency}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <p className={cn('text-[11px] font-bold', account.status === 'Ativa' ? 'text-emerald-400' : 'text-yellow-400')}>
                          {account.status}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {account.metrics.conversions} conv.
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-2 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground sm:grid-cols-4">
                <div><p>Investimento</p><strong className="text-foreground">{formatCurrencyBRL(selectedMetrics.cost)}</strong></div>
                <div><p>Cliques</p><strong className="text-foreground">{selectedMetrics.clicks.toLocaleString('pt-BR')}</strong></div>
                <div><p>Conversões</p><strong className="text-primary">{selectedMetrics.conversions.toLocaleString('pt-BR')}</strong></div>
                <div><p>CPC</p><strong className="text-foreground">{formatCurrencyBRL(cpc)}</strong></div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {connection && (
              <Button variant="outline" onClick={handleDisconnect} className="border-red-500/40 text-red-400 hover:bg-red-500/10">
                Desvincular
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={!globalConnected || selectedIds.length === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Salvar vínculo
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientIntegrationsTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { getConnection, getClientAccounts, getClientMetrics } = useMetaAdsConnections();
  const googleAds = useGoogleAds();
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);
  const [googleDialogOpen, setGoogleDialogOpen] = useState(false);
  const metaConnection = getConnection(clientId);
  const metaAccounts = getClientAccounts(clientId);
  const metaMetrics = getClientMetrics(clientId);
  const googleConnection = googleAds.getConnection(clientId);
  const googleAccounts = googleAds.getClientAccounts(clientId);
  const googleMetrics = googleAds.getClientMetrics(clientId);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 pt-1">
        {integracoes.map((int) => {
          const isMetaAds = int.name === 'Meta Ads';
          const isGoogleAds = int.name === 'Google Ads';
          const status = isMetaAds
            ? metaConnection ? 'Conectado' : 'Desconectado'
            : isGoogleAds
              ? googleConnection ? 'Conectado' : 'Desconectado'
            : int.status;
          const connected = status === 'Conectado';

          return (
            <Card key={int.id} className="bg-card border-border">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="w-11 h-11 rounded-xl bg-background border border-border flex items-center justify-center">
                    {int.logo}
                  </div>
                  <span className={cn(
                    'text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border',
                    connected ? 'bg-primary/20 text-primary border-primary/30' : 'bg-muted text-muted-foreground border-border',
                  )}>
                    {status}
                  </span>
                </div>
                <CardTitle className="mt-3">{int.name}</CardTitle>
                <CardDescription>Sincronização de {clientName} com {int.name}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isMetaAds && metaConnection && (
                  <div className="grid gap-2 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>Contas vinculadas</span>
                      <strong className="text-foreground">{metaAccounts.length}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Leads Meta Ads</span>
                      <strong className="text-primary">{metaMetrics.leads.toLocaleString('pt-BR')}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>CPL médio</span>
                      <strong className={metaMetrics.cpl > 25 ? 'text-red-400' : 'text-primary'}>
                        {formatCurrencyBRL(metaMetrics.cpl)}
                      </strong>
                    </div>
                  </div>
                )}
                {isGoogleAds && googleConnection && (
                  <div className="grid gap-2 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>Contas vinculadas</span>
                      <strong className="text-foreground">{googleAccounts.length}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Conversões</span>
                      <strong className="text-primary">{googleMetrics.conversions.toLocaleString('pt-BR')}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>CPC médio</span>
                      <strong className="text-foreground">{formatCurrencyBRL(googleMetrics.cpc)}</strong>
                    </div>
                  </div>
                )}
                <Button
                  variant={connected ? 'outline' : 'default'}
                  className="w-full text-xs font-bold uppercase h-9"
                  onClick={() => {
                    if (isMetaAds) setMetaDialogOpen(true);
                    if (isGoogleAds) setGoogleDialogOpen(true);
                  }}
                  disabled={!isMetaAds && !isGoogleAds}
                >
                  {connected ? 'Configurar / Desconectar' : 'Conectar Conta'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <MetaAdsConnectionDialog
        open={metaDialogOpen}
        onClose={() => setMetaDialogOpen(false)}
        clientId={clientId}
        clientName={clientName}
      />
      <GoogleAdsConnectionDialog
        open={googleDialogOpen}
        onClose={() => setGoogleDialogOpen(false)}
        clientId={clientId}
        clientName={clientName}
      />
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
const TABS = ['planejamento', 'pagamentos', 'dna', 'importar'] as const;
type Tab = typeof TABS[number];

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { allClients } = useClients();
  const googleAds = useGoogleAds();
  const baseClient = mockClients.find((c) => c.id === id);
  const storedClient = allClients.find((c) => c.id === id);
  const client = storedClient ?? { name: 'Cliente', segment: '', status: 'Ativo' };
  const isNewClient = !baseClient || !storedClient;

  const [realMetrics, setRealMetrics] = useState<MetaAdsMetrics | null>(null);
  const [apiGoogleMetrics, setApiGoogleMetrics] = useState<GoogleAdsMetrics | null>(null);

  useEffect(() => {
    fetch(`/api/clients/${id}/metrics`)
      .then(res => res.ok ? res.json() as Promise<{ meta: MetaAdsMetrics | null; google: GoogleAdsMetrics | null }> : null)
      .then(data => { setRealMetrics(data?.meta ?? null); setApiGoogleMetrics(data?.google ?? null); })
      .catch(() => { setRealMetrics(null); setApiGoogleMetrics(null); });
  }, [id]);

  const googleConnection = googleAds.getConnection(id);
  const googleMetrics: GoogleAdsMetrics | null = apiGoogleMetrics ?? (googleConnection ? googleAds.getClientMetrics(id) : null);

  const [tab, setTab] = useState<Tab>('planejamento');
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [clientGoal, setClientGoal] = useState<ClientGoalConfig>(() =>
    readSavedClientGoal(id, isNewClient ? ZERO_CLIENT_GOAL : DEFAULT_CLIENT_GOAL)
  );
  const [clientGoalLoadedFor, setClientGoalLoadedFor] = useState(id);

  useEffect(() => {
    setClientGoal(readSavedClientGoal(id, isNewClient ? ZERO_CLIENT_GOAL : DEFAULT_CLIENT_GOAL));
    setClientGoalLoadedFor(id);
  }, [id, isNewClient]);

  useEffect(() => {
    if (clientGoalLoadedFor !== id) return;
    saveClientGoal(id, clientGoal);
  }, [id, clientGoal, clientGoalLoadedFor]);

  useEffect(() => {
    setClientGoal((prev) => ({
      ...prev,
      partial: autoPartial(prev.target),
      realized:
        prev.type === 'leads' ? (realMetrics?.leads ?? prev.realized)
        : prev.type === 'revenue' ? prev.realized
        : prev.type === 'enrollments' ? (googleMetrics?.conversions ?? prev.realized)
        : prev.realized,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realMetrics, googleMetrics]);
  const tabLabel: Record<Tab, string> = {
    planejamento: 'Planejamento',
    pagamentos:   'Pagamentos',
    dna:          'DNA do Cliente',
    importar:     'Importar Dados',
  };

  return (
    <div className="space-y-6 pb-10 relative">
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-secondary/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-4">
          <ClientAvatar clientId={id} name={client.name} size="lg" />
          <div>
            <div className="px-2 py-0.5 rounded text-[10px] font-bold tracking-widest bg-primary/20 text-primary border border-primary/30 uppercase w-fit mb-2">
              {client.status}
            </div>
            <h1 className="text-4xl font-heading tracking-wider uppercase">{client.name}</h1>
            <p className="text-sm text-muted-foreground mt-1 uppercase tracking-wide">{client.segment}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="border-border h-9 text-xs font-bold uppercase tracking-wider gap-2"
            onClick={() => setLinkDialogOpen(true)}
          >
            <Link2 className="w-4 h-4 text-primary" />
            Vincular Contas
          </Button>
        </div>
      </div>

      {/* Tabs nav */}
      <div className="flex gap-1 bg-card border border-border p-1 rounded-xl w-fit flex-wrap">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors',
              tab === t
                ? 'bg-primary/20 text-primary shadow-[0_0_10px_rgba(85,245,47,0.15)]'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            {tabLabel[t]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'planejamento' && (
        <div className="space-y-5">
          <ClientGoalSettings goal={clientGoal} onChange={setClientGoal} />
          <FunnelTab clientName={client.name} goalConfig={clientGoal} />
        </div>
      )}

      {tab === 'dna' && <ClientDnaTab clientId={id} clientName={client.name} />}

      {tab === 'pagamentos' && <InvestmentPaymentsTab clientId={id} clientName={client.name} />}



      {tab === 'importar' && (
        <div className="grid gap-5 md:grid-cols-2 pt-1">
          <Card className="bg-card border-border border-dashed">
            <CardHeader>
              <CardTitle>Upload de Planilha</CardTitle>
              <CardDescription>CSV, XLSX ou XML com dados de leads/CRM</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center py-10 text-center">
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
                <UploadCloud className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground mb-4">Arraste ou selecione o arquivo de {client.name}</p>
              <Button variant="outline">Selecionar Arquivo</Button>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Google Sheets</CardTitle>
              <CardDescription>Sincronizar planilha CRM online</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>URL da Planilha</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <LinkIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="https://docs.google.com/spreadsheets/d/..." className="pl-9 bg-muted/50" />
                  </div>
                  <Button>Conectar</Button>
                </div>
              </div>
              <div className="pt-3 border-t border-border">
                <Button variant="link" className="h-auto p-0 text-primary text-sm">
                  Baixar modelo ONMID e mapear colunas
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <LinkAccountsDialog
        clientId={id}
        clientName={client.name}
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
      />
    </div>
  );
}
