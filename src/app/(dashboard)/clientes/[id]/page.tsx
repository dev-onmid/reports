"use client";

import { use, useEffect, useRef, useState, type ComponentType, type CSSProperties, type PointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { mockDashboardData, mockClients, type ClientStatus, type DashboardType } from '@/lib/mock-data';
import { useClients } from '@/lib/client-store';
import { getAuthSession, verifyUserCredentials } from '@/lib/auth-store';
import { DictateButton } from '@/components/ui/dictate-button';
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
  Power, PowerOff, Search, BookMarked, ExternalLink, RefreshCw, ChevronRight,
  PiggyBank, Wallet, Info, Lightbulb, UserPlus, Brain, Save, MousePointer2,
  Maximize2, Minimize2, ZoomIn, ZoomOut, ImageIcon, Unlink, History, Copy, Sparkles,
  Store,
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
import { HistoricoTab } from '@/components/historico-tab';
import { VaultTab } from '@/components/vault-tab';
import CrmWorkspace from '@/app/(dashboard)/crm/page';
import { ClientTrackingTab } from './tracking-tab';

// ── Funnel types & logic ───────────────────────────────────────────────────────
type FunnelStage = { id: string; name: string; conversion: number };

const DEFAULT_STAGES: FunnelStage[] = [
  { id: 's5', name: '5º — Leads',                  conversion: 50 },
  { id: 's4', name: '4º — Contatos',               conversion: 50 },
  { id: 's3', name: '3º — Agendamentos / Proposta',        conversion: 50 },
  { id: 's2', name: '2º — Comparecimento / Negociação',   conversion: 50 },
  { id: 's1', name: '1º — Fechamentos (Vendas)',   conversion: 0  },
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
  { id: 1, name: 'Meta Ads',            status: 'Conectado',    logo: <img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className="h-8 w-10 object-contain" /> },
  { id: 2, name: 'Google Ads',          status: 'Desconectado', logo: <img src="/brand/google-ads-logo.png" alt="Google Ads" className="h-8 w-10 object-contain" /> },
  { id: 5, name: 'Google Meu Negócio',  status: 'Conectado',    logo: <svg viewBox="0 0 24 24" className="w-6 h-6"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> },
  { id: 6, name: 'Google Sheets (CRM)', status: 'Desconectado', logo: <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#34A853"><path d="M11.318 12.545H7.91v-1.909h3.41v1.91zm1.364 0v-1.909h3.408v1.91h-3.408zm0 1.364h3.408v1.909h-3.408v-1.909zm-1.364 0H7.91v1.909h3.41v-1.909zM24 4.364v15.272A4.368 4.368 0 0 1 19.636 24H4.364A4.368 4.368 0 0 1 0 19.636V4.364A4.368 4.368 0 0 1 4.364 0h15.272A4.368 4.368 0 0 1 24 4.364zm-4.363 4.5H4.363v11.772h15.273V8.864z"/></svg> },
];

type ClientPlanningConfig = {
  tkm: number;
  cplMeta: number;
  stages: FunnelStage[];
  simpleMode: boolean;
  invPlaSimple: number;
};

const DEFAULT_CLIENT_PLANNING: ClientPlanningConfig = {
  tkm: 9000,
  cplMeta: 30,
  stages: DEFAULT_STAGES,
  simpleMode: false,
  invPlaSimple: 0,
};

function sanitizePlanningStages(stages: unknown): FunnelStage[] {
  if (!Array.isArray(stages)) return DEFAULT_STAGES;
  const valid = stages
    .map((stage, index) => {
      if (!stage || typeof stage !== 'object') return null;
      const item = stage as Partial<FunnelStage>;
      const conversion = Number(item.conversion ?? 50);
      return {
        id: item.id || `stage-${index + 1}`,
        name: item.name || `${index + 1}º — Etapa`,
        conversion: Math.min(100, Math.max(0, Number.isFinite(conversion) ? conversion : 50)),
      };
    })
    .filter(Boolean) as FunnelStage[];
  return valid.length >= 2 ? valid.slice(0, 7) : DEFAULT_STAGES;
}

type MindMapNode = {
  id: string;
  title: string;
  note: string;
  color: string;
  x: number;
  y: number;
  parentId: string | null;
  image?: string | null;
};

type MindMapEdge = {
  id: string;
  from: string;
  to: string;
};

type MindMapData = {
  nodes: MindMapNode[];
  edges: MindMapEdge[];
};

type MindMapSnapshot = {
  ts: number;
  label: string;
  map: MindMapData;
};

const MIND_MAP_COLORS = ['#55F52F', '#38BDF8', '#A78BFA', '#F59E0B', '#FB7185', '#22C55E', '#F472B6', '#94A3B8'];
const MIND_MAP_STORAGE_KEY = (clientId: string) => `clientMindMap_${clientId}`;
const MIND_MAP_HISTORY_KEY = (clientId: string) => `clientMindMapHistory_${clientId}`;
const MAX_SNAPSHOTS = 10;

function loadMindMapHistory(clientId: string): MindMapSnapshot[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(MIND_MAP_HISTORY_KEY(clientId));
    return raw ? (JSON.parse(raw) as MindMapSnapshot[]) : [];
  } catch { return []; }
}

function pushMindMapSnapshot(clientId: string, map: MindMapData): MindMapSnapshot[] {
  const history = loadMindMapHistory(clientId);
  const now = Date.now();
  const label = new Date(now).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (history[0] && now - history[0].ts < 30_000) {
    history[0] = { ts: now, label, map };
  } else {
    history.unshift({ ts: now, label, map });
  }
  const updated = history.slice(0, MAX_SNAPSHOTS);
  window.localStorage.setItem(MIND_MAP_HISTORY_KEY(clientId), JSON.stringify(updated));
  return updated;
}

function defaultMindMap(clientName: string): MindMapData {
  const root = 'mind-root';
  return {
    nodes: [
      { id: root, title: clientName || 'Cliente', note: 'Perfil central', color: '#55F52F', x: 430, y: 265, parentId: null },
      { id: 'mind-objective', title: 'Objetivos', note: 'Metas, KPIs e prioridades', color: '#38BDF8', x: 650, y: 110, parentId: root },
      { id: 'mind-audience', title: 'Público', note: 'Segmentos, dores e objeções', color: '#A78BFA', x: 170, y: 110, parentId: root },
      { id: 'mind-offer', title: 'Oferta', note: 'Produtos, diferenciais e ticket', color: '#F59E0B', x: 150, y: 405, parentId: root },
      { id: 'mind-channels', title: 'Canais', note: 'Meta, Google, WhatsApp e CRM', color: '#FB7185', x: 665, y: 405, parentId: root },
      { id: 'mind-actions', title: 'Próximas ações', note: 'Tarefas e responsáveis', color: '#22C55E', x: 430, y: 485, parentId: root },
    ],
    edges: [],
  };
}

function sanitizeMindMap(data: unknown, clientName: string): MindMapData {
  if (!data || typeof data !== 'object') return defaultMindMap(clientName);
  const nodes = (data as Partial<MindMapData>).nodes;
  if (!Array.isArray(nodes)) return defaultMindMap(clientName);

  const valid = nodes
    .map((node, index) => {
      if (!node || typeof node !== 'object') return null;
      const item = node as Partial<MindMapNode>;
      const x = Number(item.x);
      const y = Number(item.y);
      return {
        id: item.id || `mind-${index + 1}`,
        title: String(item.title || 'Novo tópico').slice(0, 80),
        note: String(item.note || '').slice(0, 220),
        color: MIND_MAP_COLORS.includes(String(item.color)) ? String(item.color) : MIND_MAP_COLORS[index % MIND_MAP_COLORS.length],
        x: Number.isFinite(x) ? x : 120 + index * 30,
        y: Number.isFinite(y) ? y : 120 + index * 30,
        parentId: item.parentId ? String(item.parentId) : null,
        image: typeof item.image === 'string' ? item.image : null,
      };
    })
    .filter(Boolean) as MindMapNode[];

  if (valid.length === 0) return defaultMindMap(clientName);
  if (!valid.some((node) => node.parentId === null)) valid[0] = { ...valid[0], parentId: null };
  const ids = new Set(valid.map((node) => node.id));
  const cleanNodes = valid.slice(0, 48).map((node) => ({ ...node, parentId: node.parentId && ids.has(node.parentId) ? node.parentId : null }));

  // Sanitize extra edges
  const rawEdges = (data as Partial<MindMapData>).edges;
  const cleanEdges: MindMapEdge[] = Array.isArray(rawEdges)
    ? rawEdges
        .filter((e): e is MindMapEdge => !!e && typeof e === 'object' && typeof (e as MindMapEdge).from === 'string' && typeof (e as MindMapEdge).to === 'string')
        .filter(e => ids.has(e.from) && ids.has(e.to))
        .slice(0, 200)
    : [];

  return { nodes: cleanNodes, edges: cleanEdges };
}

function readSavedMindMap(clientId: string, clientName: string): MindMapData {
  if (typeof window === 'undefined') return defaultMindMap(clientName);
  try {
    const raw = window.localStorage.getItem(MIND_MAP_STORAGE_KEY(clientId));
    return raw ? sanitizeMindMap(JSON.parse(raw), clientName) : defaultMindMap(clientName);
  } catch {
    return defaultMindMap(clientName);
  }
}

function readSavedClientPlanning(clientId: string): ClientPlanningConfig {
  if (typeof window === 'undefined') return DEFAULT_CLIENT_PLANNING;
  try {
    const raw = window.localStorage.getItem(`clientPlanning_${clientId}`);
    if (!raw) return DEFAULT_CLIENT_PLANNING;
    const parsed = JSON.parse(raw) as Partial<ClientPlanningConfig>;
    const tkm = Number(parsed.tkm ?? DEFAULT_CLIENT_PLANNING.tkm);
    const cplMeta = Number(parsed.cplMeta ?? DEFAULT_CLIENT_PLANNING.cplMeta);
    const invPlaSimple = Number(parsed.invPlaSimple ?? 0);
    return {
      tkm: Number.isFinite(tkm) ? tkm : DEFAULT_CLIENT_PLANNING.tkm,
      cplMeta: Number.isFinite(cplMeta) ? cplMeta : DEFAULT_CLIENT_PLANNING.cplMeta,
      stages: sanitizePlanningStages(parsed.stages),
      simpleMode: Boolean(parsed.simpleMode ?? false),
      invPlaSimple: Number.isFinite(invPlaSimple) ? invPlaSimple : 0,
    };
  } catch {
    return DEFAULT_CLIENT_PLANNING;
  }
}

function saveClientPlanning(clientId: string, planning: ClientPlanningConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`clientPlanning_${clientId}`, JSON.stringify(planning));
  fetch(`/api/clients/${clientId}/planning`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tkm: planning.tkm, cplMeta: planning.cplMeta, stages: planning.stages, simpleMode: planning.simpleMode, invPlaSimple: planning.invPlaSimple }),
  }).catch(() => {});
}

// ── Funnel planning tab ────────────────────────────────────────────────────────
function FunnelTab({ clientId, clientName, goalConfig, isAdmin }: { clientId: string; clientName: string; goalConfig: ClientGoalConfig; isAdmin: boolean }) {
  const [planningLoadedFor, setPlanningLoadedFor] = useState(clientId);
  const [tkm, setTkm] = useState(() => readSavedClientPlanning(clientId).tkm);
  const [cplMeta, setCplMeta] = useState(() => readSavedClientPlanning(clientId).cplMeta);
  const [stages, setStages] = useState<FunnelStage[]>(() => readSavedClientPlanning(clientId).stages);
  const [simpleMode, setSimpleMode] = useState(() => readSavedClientPlanning(clientId).simpleMode);
  const [invPlaSimple, setInvPlaSimple] = useState(() => readSavedClientPlanning(clientId).invPlaSimple);
  // Admin: localStorage wins immediately (pushes correct data to DB on first visit).
  // Non-admin: must wait for DB load to prevent localStorage defaults from overwriting DB.
  const planningDbLoaded = useRef(isAdmin);

  useEffect(() => {
    planningDbLoaded.current = isAdmin;
    let cancelled = false;
    const saved = readSavedClientPlanning(clientId);
    setTkm(saved.tkm);
    setCplMeta(saved.cplMeta);
    setStages(saved.stages);
    setSimpleMode(saved.simpleMode);
    setInvPlaSimple(saved.invPlaSimple);
    setPlanningLoadedFor(clientId);
    fetch(`/api/clients/${clientId}/planning`)
      .then(r => r.json())
      .then((dbData: { tkm: number; cplMeta: number; stages: FunnelStage[]; simpleMode?: boolean; invPlaSimple?: number } | null) => {
        if (cancelled) return;
        if (dbData && !isAdmin) {
          // Non-admin: DB is authoritative — load its data into state
          const planning: ClientPlanningConfig = {
            tkm: dbData.tkm || saved.tkm,
            cplMeta: dbData.cplMeta || saved.cplMeta,
            stages: sanitizePlanningStages(dbData.stages),
            simpleMode: dbData.simpleMode ?? saved.simpleMode,
            invPlaSimple: dbData.invPlaSimple ?? saved.invPlaSimple,
          };
          setTkm(planning.tkm);
          setCplMeta(planning.cplMeta);
          setStages(planning.stages);
          setSimpleMode(planning.simpleMode);
          setInvPlaSimple(planning.invPlaSimple);
          window.localStorage.setItem(`clientPlanning_${clientId}`, JSON.stringify(planning));
        }
        planningDbLoaded.current = true;
      })
      .catch(() => { planningDbLoaded.current = true; });
    return () => { cancelled = true; };
  }, [clientId, isAdmin]);

  useEffect(() => {
    if (planningLoadedFor !== clientId) return;
    if (!planningDbLoaded.current) return;
    saveClientPlanning(clientId, { tkm, cplMeta, stages, simpleMode, invPlaSimple });
  }, [clientId, planningLoadedFor, tkm, cplMeta, stages, simpleMode, invPlaSimple]);

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
      {/* Header row: context + simple mode toggle */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {simpleMode
            ? <>Modo simples ativo para <strong className="text-foreground">{clientName}</strong>. Digite diretamente os valores de planejamento.</>
            : <>Configuração do funil de planejamento para <strong className="text-foreground">{clientName}</strong>. A meta principal é <strong className="text-foreground">{goalConfig.label}</strong>; ajuste as taxas de conversão para recalcular o plano.</>
          }
        </p>
        <button
          onClick={() => setSimpleMode(v => !v)}
          className={cn(
            'shrink-0 flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors',
            simpleMode
              ? 'bg-primary/20 border-primary/40 text-primary hover:bg-primary/30'
              : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Layers className="w-3.5 h-3.5" />
          {simpleMode ? 'Modo simples' : 'Modo funil'}
        </button>
      </div>

      {/* ── SIMPLE MODE ─────────────────────────────────────────────────── */}
      {simpleMode && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Meta goal (readonly) */}
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">META ({goalConfig.label})</p>
              <p className="font-heading font-normal text-xl leading-none text-foreground">{goalValue}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Configurada na meta do cliente</p>
            </div>
            {/* TKM */}
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">TKM (Ticket Médio)</p>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-muted-foreground">R$</span>
                <CurrencyInput value={tkm} onChange={setTkm} className={cn('font-heading font-normal text-xl leading-none flex-1 min-w-0 text-foreground', inputCls)} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Valor médio por venda</p>
            </div>
            {/* Inv. Planejado — directly editable */}
            <div className="bg-primary/10 border border-primary/30 rounded-xl p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-primary mb-2">INV. PLANEJADO</p>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-primary/60">R$</span>
                <CurrencyInput value={invPlaSimple} onChange={setInvPlaSimple} className={cn('font-heading font-normal text-xl leading-none flex-1 min-w-0 text-primary', inputCls)} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Investimento planejado direto</p>
            </div>
          </div>

          {/* Simple summary */}
          {invPlaSimple > 0 && tkm > 0 && goalConfig.target > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {goalConfig.type === 'revenue' ? (
                <>
                  <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">VENDAS NECESSÁRIAS</p>
                    <p className="font-heading font-normal text-xl leading-none">
                      {Math.ceil(goalConfig.target / tkm).toLocaleString('pt-BR')}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">{fmtBRL(goalConfig.target)} meta ÷ {fmtBRL(tkm)} TKM</p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">FATURAMENTO META</p>
                    <p className="font-heading font-normal text-xl leading-none text-primary">{fmtBRL(goalConfig.target)}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Meta principal do cliente</p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-4 col-span-2 md:col-span-1">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">ROI ESPERADO</p>
                    {(() => {
                      const roi = goalConfig.target / invPlaSimple;
                      return (
                        <>
                          <p className={cn('font-heading font-normal text-xl leading-none', roi >= 3 ? 'text-primary' : roi >= 1.5 ? 'text-yellow-400' : 'text-red-400')}>
                            {roi.toFixed(1)}x
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-1">{fmtBRL(goalConfig.target)} ÷ {fmtBRL(invPlaSimple)}</p>
                        </>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{goalConfig.label.toUpperCase()} NECESSÁRIAS</p>
                    <p className="font-heading font-normal text-xl leading-none">{goalConfig.target.toLocaleString('pt-BR')}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Meta principal do cliente</p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">FATURAMENTO ESTIMADO</p>
                    <p className="font-heading font-normal text-xl leading-none text-primary">{fmtBRL(goalConfig.target * tkm)}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{goalConfig.target} × {fmtBRL(tkm)} TKM</p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-4 col-span-2 md:col-span-1">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">ROI ESPERADO</p>
                    {(() => {
                      const fat = goalConfig.target * tkm;
                      const roi = invPlaSimple > 0 ? fat / invPlaSimple : 0;
                      return (
                        <>
                          <p className={cn('font-heading font-normal text-xl leading-none', roi >= 3 ? 'text-primary' : roi >= 1.5 ? 'text-yellow-400' : 'text-red-400')}>
                            {roi.toFixed(1)}x
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-1">{fmtBRL(fat)} ÷ {fmtBRL(invPlaSimple)}</p>
                        </>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── FULL FUNNEL MODE ─────────────────────────────────────────────── */}
      {!simpleMode && (
        <>
      {/* Config row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">META ({goalConfig.label})</p>
          <p className="font-heading font-normal text-xl leading-none text-foreground">{goalValue}</p>
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
                className={cn('font-heading font-normal text-xl leading-none flex-1 min-w-0', color, inputCls)}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{desc}</p>
          </div>
        ))}
      </div>

      {/* Funnel + Summary side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">

        {/* LEFT — Funnel stages */}
        <div className="flex h-full flex-col bg-card border border-border rounded-xl p-5">
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
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <input
                          type="text"
                          value={stage.name}
                          onChange={(e) => updateName(idx, e.target.value)}
                          className="min-w-[220px] flex-1 text-sm font-semibold focus:outline-none border-b border-transparent hover:border-border focus:border-primary transition-colors bg-transparent"
                        />
                        <div className="grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border border-border bg-background/70 min-w-[190px]">
                          <div className="px-3 py-2 text-right">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Volume</p>
                            <p className="mt-1 text-xl font-heading font-normal leading-none" style={{ color }}>
                              {vol.toLocaleString('pt-BR')}
                            </p>
                          </div>
                          <div className="border-l border-border px-3 py-2 text-right">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">% do topo</p>
                            <p className="mt-1 text-xl font-heading font-normal leading-none text-foreground">{pct}%</p>
                          </div>
                        </div>
                        {stages.length > 2 && (
                          <button onClick={() => removeStage(idx)} className="text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="relative h-8 rounded-lg bg-muted/30 overflow-hidden">
                        <div
                          className="h-full rounded-lg transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.75 }}
                        />
                        <div className="absolute inset-0 flex items-center justify-between px-3 text-[11px] font-bold">
                          <span className="rounded-md bg-black/25 px-2 py-0.5 text-foreground shadow-sm">
                            {vol.toLocaleString('pt-BR')} planejados
                          </span>
                          <span className="rounded-md bg-black/25 px-2 py-0.5 text-foreground shadow-sm">
                            {pct}% do topo
                          </span>
                        </div>
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
            <p className="text-xl font-heading font-normal text-primary">{fmtBRL(invPla)}</p>
            <p className="text-xs text-muted-foreground mt-2">{topVol} leads × {fmtBRL(cplPlanejado)} CPL planejado</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{lastStageLabel.toUpperCase()} NECESSÁRIAS</p>
              <p className="text-xl font-heading font-normal">{botVol}</p>
              <p className="text-xs text-muted-foreground mt-2">
                {goalConfig.type === 'revenue' ? `${goalValue} ÷ ${fmtBRL(tkm)}` : `Meta principal: ${goalValue}`}
              </p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">CAC</p>
              <p className="text-xl font-heading font-normal">{fmtBRL(cac)}</p>
              <p className="text-xs text-muted-foreground mt-2">Custo por aquisição</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              {goalConfig.type === 'revenue' ? 'ROI ESPERADO' : `CUSTO POR ${goalConfig.label.toUpperCase()}`}
            </p>
            <p className={cn('text-xl font-heading font-normal', goalConfig.type === 'revenue' ? (roi >= 3 ? 'text-primary' : roi >= 1.5 ? 'text-yellow-400' : 'text-red-400') : 'text-primary')}>
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
        </>
      )}
    </div>
  );
}

// ── Mind map tab ──────────────────────────────────────────────────────────────
// ── AI Map Builder Modal ───────────────────────────────────────────────────────

function AIMapBuilderModal({ clientName, onApply, onClose }: {
  clientName: string;
  onApply: (data: MindMapData, merge: boolean) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'text' | 'audio' | 'photo'>('text');
  const [text, setText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [image, setImage] = useState<{ base64: string; type: string; preview: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MindMapData | null>(null);
  const [error, setError] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function generate(inputText: string, img?: { base64: string; type: string }) {
    if (!inputText.trim() && !img) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/ai/mind-map-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: inputText || undefined, imageBase64: img?.base64, imageType: img?.type, clientName }),
      });
      const data = await res.json() as MindMapData & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Erro desconhecido');
      setResult(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function startRecording() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { setError('Reconhecimento de voz não disponível neste browser. Use Chrome ou Edge.'); return; }
    const rec = new SR() as {
      lang: string; continuous: boolean; interimResults: boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onresult: (e: any) => void; onerror: (e: any) => void; onend: () => void;
      start(): void; stop(): void;
    };
    recognitionRef.current = rec;
    rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true;
    let finalText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      setTranscript(finalText + interim);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => { setError(`Erro: ${e.error}`); setRecording(false); };
    rec.onend = () => setRecording(false);
    rec.start();
    setRecording(true);
  }

  function stopRecording() { recognitionRef.current?.stop(); setRecording(false); }

  function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      const type = dataUrl.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
      setImage({ base64, type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  const tabs = [
    { key: 'text' as const, label: 'Texto', icon: '✏️' },
    { key: 'audio' as const, label: 'Áudio', icon: '🎙️' },
    { key: 'photo' as const, label: 'Foto / Câmera', icon: '📷' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]" onPointerDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center text-sm">🧠</div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Criar mapa com IA</h2>
              <p className="text-[11px] text-muted-foreground">Descreva, grave ou envie uma foto — a IA monta o mapa</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="h-4 w-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {tabs.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setError(''); setResult(null); }}
              className={cn('flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors border-b-2',
                tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* TEXT TAB */}
          {tab === 'text' && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground">Descreva o cliente, o negócio, contexto estratégico ou qualquer conteúdo que deve virar mapa mental.</p>
              <div className="relative">
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={`Ex: Restaurante italiano em SP, foco em delivery e salão VIP, público 30-50 anos, forte presença no Instagram, quer aumentar recompra e lançar programa de fidelidade...`}
                  className="w-full h-36 rounded-xl border border-input bg-background px-3 py-2.5 pr-10 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
                />
                <DictateButton className="absolute bottom-2 right-2" onTranscript={(t) => setText(text ? `${text} ${t}` : t)} />
              </div>
              <button onClick={() => generate(text)} disabled={!text.trim() || loading}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors">
                {loading ? <><RefreshCw className="h-4 w-4 animate-spin" /> Gerando mapa...</> : <><Sparkles className="h-4 w-4" /> Gerar mapa mental</>}
              </button>
            </div>
          )}

          {/* AUDIO TAB */}
          {tab === 'audio' && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground">Grave sua voz descrevendo o cliente ou estratégia. A transcrição acontece em tempo real no browser (Chrome/Edge).</p>
              <div className={cn('flex items-center justify-center rounded-xl border-2 border-dashed py-8 transition-colors', recording ? 'border-red-400/60 bg-red-500/5' : 'border-border')}>
                {recording ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex gap-1 items-end h-8">
                      {[1,2,3,4,5].map(i => (
                        <div key={i} className="w-1.5 bg-red-400 rounded-full animate-pulse" style={{ height: `${20 + Math.random() * 12}px`, animationDelay: `${i * 0.1}s` }} />
                      ))}
                    </div>
                    <p className="text-xs text-red-400 font-semibold">Gravando... fale agora</p>
                    <button onClick={stopRecording} className="flex items-center gap-2 rounded-lg bg-red-500/15 border border-red-400/30 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/25 transition-colors">
                      <span className="w-2 h-2 rounded-sm bg-red-400" /> Parar gravação
                    </button>
                  </div>
                ) : (
                  <button onClick={startRecording} className="flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                    <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xl">🎙️</div>
                    <span className="text-xs font-semibold">Clique para gravar</span>
                    <span className="text-[10px] text-muted-foreground">Requer Chrome ou Edge</span>
                  </button>
                )}
              </div>
              {transcript && (
                <div className="space-y-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Transcrição (editável)</label>
                  <textarea value={transcript} onChange={e => setTranscript(e.target.value)}
                    className="w-full h-28 rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary text-foreground" />
                  <button onClick={() => generate(transcript)} disabled={!transcript.trim() || loading}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors">
                    {loading ? <><RefreshCw className="h-4 w-4 animate-spin" /> Gerando mapa...</> : <><Sparkles className="h-4 w-4" /> Gerar mapa com transcrição</>}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PHOTO TAB */}
          {tab === 'photo' && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground">Tire uma foto ou selecione uma imagem (briefing, anotações, lousa, post-it, site do cliente). A IA analisa e cria o mapa.</p>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageFile} />
              {!image ? (
                <button onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border py-10 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/30 transition-colors">
                  <span className="text-3xl">📷</span>
                  <span className="text-sm font-semibold">Abrir câmera ou selecionar imagem</span>
                  <span className="text-[10px]">Camera no celular · Arquivo no desktop</span>
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden border border-border">
                    <img src={image.preview} alt="preview" className="w-full max-h-48 object-contain bg-black/20" />
                    <button onClick={() => setImage(null)}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors">
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                  <button onClick={() => fileInputRef.current?.click()} className="text-xs text-muted-foreground hover:text-foreground underline transition-colors">
                    Trocar imagem
                  </button>
                  <button onClick={() => generate('', image)} disabled={loading}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors">
                    {loading ? <><RefreshCw className="h-4 w-4 animate-spin" /> Analisando imagem...</> : <><Sparkles className="h-4 w-4" /> Analisar e gerar mapa</>}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-400/20 px-3 py-2.5">
              <span className="text-red-400 text-sm mt-0.5">⚠️</span>
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Result preview */}
          {result && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-primary text-lg">✅</span>
                <div>
                  <p className="text-sm font-bold text-foreground">{result.nodes.length} nós gerados</p>
                  <p className="text-[11px] text-muted-foreground">Escolha como aplicar ao mapa atual</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onApply(result, false)}
                  className="flex-1 rounded-xl bg-primary text-primary-foreground py-2 text-xs font-bold hover:bg-primary/90 transition-colors">
                  Substituir mapa
                </button>
                <button onClick={() => onApply(result, true)}
                  className="flex-1 rounded-xl border border-primary/40 text-primary py-2 text-xs font-bold hover:bg-primary/10 transition-colors">
                  Mesclar ao existente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClientMindMapTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [map, setMap] = useState<MindMapData>(() => readSavedMindMap(clientId, clientName));
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [scale, setScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connecting, setConnecting] = useState<{ fromId: string; toX: number; toY: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{
    type: 'node' | 'pan' | 'connect';
    id?: string;
    startClientX: number;
    startClientY: number;
    startNodeX?: number;
    startNodeY?: number;
    startPanX?: number;
    startPanY?: number;
    moved: boolean;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Refs that always hold the latest value — safe to use in window event handlers
  const panRef = useRef(pan);
  const scaleRef = useRef(scale);
  const mapRef = useRef(map);
  const [showHistory, setShowHistory] = useState(false);
  const [showAIBuilder, setShowAIBuilder] = useState(false);
  const [history, setHistory] = useState<MindMapSnapshot[]>(() => loadMindMapHistory(clientId));

  useEffect(() => {
    let cancelled = false;
    const savedMap = readSavedMindMap(clientId, clientName);
    setMap(savedMap);
    setEditingId(null);

    fetch(`/api/clients/${clientId}/mind-map`)
      .then((r) => r.ok ? r.json() : null)
      .then((dbMap: MindMapData | null) => {
        if (cancelled || !dbMap) return;
        const clean = sanitizeMindMap(dbMap, clientName);
        setMap(clean);
        window.localStorage.setItem(MIND_MAP_STORAGE_KEY(clientId), JSON.stringify(clean));
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [clientId, clientName]);

  // Paste image into the editing node
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!editingId) return;
      const imageItem = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
      if (!imageItem) return;
      const blob = imageItem.getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setMap(prev => ({ nodes: prev.nodes.map(n => n.id === editingId ? { ...n, image: reader.result as string } : n), edges: prev.edges }));
          setSaved(false);
        }
      };
      reader.readAsDataURL(blob);
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [editingId]);

  // Keyboard: Esc = clear selection, Delete = remove selected nodes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedIds(new Set()); setEditingId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Wheel zoom (needs passive:false to call preventDefault)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      setPan(prevPan => {
        setScale(prevScale => {
          const worldX = (e.clientX - rect.left - prevPan.x) / prevScale;
          const worldY = (e.clientY - rect.top - prevPan.y) / prevScale;
          // Gentle zoom: ~5% per wheel notch; trackpad produces small deltaY values
          const delta = Math.abs(e.deltaY);
          const step = Math.min(delta / 400, 0.12); // cap at 12% even for fast swipes
          const factor = e.deltaY > 0 ? 1 - step : 1 + step;
          const newScale = Math.min(4, Math.max(0.1, prevScale * factor));
          const newPan = {
            x: e.clientX - rect.left - worldX * newScale,
            y: e.clientY - rect.top - worldY * newScale,
          };
          // Schedule pan update outside this setter
          requestAnimationFrame(() => setPan(newPan));
          return newScale;
        });
        return prevPan;
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Keep refs in sync so window event handlers always see current values
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { mapRef.current = map; }, [map]);

  const editingNode = editingId ? (map.nodes.find(n => n.id === editingId) ?? null) : null;
  const rootId = map.nodes.find(n => n.parentId === null)?.id ?? map.nodes[0]?.id;

  function persist(nextMap = map) {
    const clean = sanitizeMindMap(nextMap, clientName);
    window.localStorage.setItem(MIND_MAP_STORAGE_KEY(clientId), JSON.stringify(clean));
    fetch(`/api/clients/${clientId}/mind-map`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clean),
    }).catch(() => {});
    const updated = pushMindMapSnapshot(clientId, clean);
    setHistory(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function updateNode(id: string, patch: Partial<MindMapNode>) {
    setSaved(false);
    setMap(prev => ({ nodes: prev.nodes.map(n => n.id === id ? { ...n, ...patch } : n), edges: prev.edges }));
  }

  function addNodeAt(x: number, y: number, parentId: string | null) {
    if (map.nodes.length >= 48) return;
    const next: MindMapNode = {
      id: `mind-${Date.now()}`,
      title: 'Novo tópico',
      note: '',
      color: MIND_MAP_COLORS[map.nodes.length % MIND_MAP_COLORS.length],
      x,
      y,
      parentId,
      image: null,
    };
    const nextMap = { nodes: [...map.nodes, next], edges: map.edges };
    setMap(nextMap);
    setEditingId(next.id);
    setSaved(false);
  }

  function addChildOf(parentId: string) {
    const parent = map.nodes.find(n => n.id === parentId);
    if (!parent) return;
    const siblings = map.nodes.filter(n => n.parentId === parentId).length;
    const angle = ((siblings % 8) / 8) * Math.PI * 2;
    addNodeAt(parent.x + Math.cos(angle) * 250, parent.y + Math.sin(angle) * 180, parentId);
  }

  function removeNode(id: string) {
    if (id === rootId || map.nodes.length <= 1) return;
    const toRemove = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of map.nodes) {
        if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) { toRemove.add(n.id); changed = true; }
      }
    }
    setMap({
      nodes: map.nodes.filter(n => !toRemove.has(n.id)),
      edges: map.edges.filter(e => !toRemove.has(e.from) && !toRemove.has(e.to)),
    });
    setEditingId(null);
    setSelectedIds(prev => { const s = new Set(prev); toRemove.forEach(i => s.delete(i)); return s; });
    setSaved(false);
  }

  function duplicateNode(id: string) {
    const src = map.nodes.find(n => n.id === id);
    if (!src) return;
    const newNode: MindMapNode = { ...src, id: `mind-${Date.now()}`, x: src.x + 40, y: src.y + 40, parentId: src.parentId };
    const nextMap = { nodes: [...map.nodes, newNode], edges: map.edges };
    setMap(nextMap);
    setEditingId(newNode.id);
    setSaved(false);
  }

  function duplicateSelected() {
    if (selectedIds.size === 0) return;
    const idMap = new Map<string, string>();
    const newNodes: MindMapNode[] = [];
    for (const id of selectedIds) {
      const src = map.nodes.find(n => n.id === id);
      if (!src) continue;
      const newId = `mind-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      idMap.set(id, newId);
      newNodes.push({ ...src, id: newId, x: src.x + 50, y: src.y + 50 });
    }
    // Preserve connections between duplicated nodes
    const newEdges: MindMapEdge[] = newNodes
      .filter(n => n.parentId && idMap.has(n.parentId))
      .map(n => ({ id: `e-${Date.now()}-${Math.random().toString(36).slice(2)}`, from: idMap.get(n.parentId!)!, to: n.id }));
    const nextMap = { nodes: [...map.nodes, ...newNodes], edges: [...map.edges, ...newEdges] };
    setMap(nextMap);
    setSelectedIds(new Set(newNodes.map(n => n.id)));
    setSaved(false);
  }

  function removeEdge(edgeId: string) {
    setMap(prev => ({ ...prev, edges: prev.edges.filter(e => e.id !== edgeId) }));
    setSaved(false);
  }

  function applyAIMap(aiData: MindMapData, merge: boolean) {
    let nextMap: MindMapData;
    if (merge) {
      // Offset new nodes to avoid overlapping existing nodes
      const offset = 60;
      const shifted = aiData.nodes.map(n => ({ ...n, id: `ai-${n.id}-${Date.now()}`, x: n.x + offset, y: n.y + offset, parentId: n.parentId ? `ai-${n.parentId}-${Date.now()}` : null }));
      // Re-ID edges
      nextMap = { nodes: [...map.nodes, ...shifted], edges: [...map.edges, ...aiData.edges] };
    } else {
      nextMap = aiData;
    }
    setMap(nextMap);
    setEditingId(null);
    setSelectedIds(new Set());
    persist(nextMap);
    setShowAIBuilder(false);
  }

  function zoomBy(factor: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setScale(prev => {
      const newScale = Math.min(3, Math.max(0.15, prev * factor));
      setPan(p => ({
        x: cx - (cx - p.x) / prev * newScale,
        y: cy - (cy - p.y) / prev * newScale,
      }));
      return newScale;
    });
  }

  // Connect handle: use native window listeners to avoid React pointer capture routing issues
  function handleConnectPointerDown(e: PointerEvent<HTMLDivElement>, node: MindMapNode) {
    e.stopPropagation();
    e.preventDefault();
    if (!canvasRef.current) return;
    const canvasEl: HTMLDivElement = canvasRef.current;

    const fromId = node.id;
    dragRef.current = { type: 'connect', id: fromId, startClientX: e.clientX, startClientY: e.clientY, moved: false };
    const rect0 = canvasEl.getBoundingClientRect();
    setConnecting({
      fromId,
      toX: (e.clientX - rect0.left - panRef.current.x) / scaleRef.current,
      toY: (e.clientY - rect0.top - panRef.current.y) / scaleRef.current,
    });

    function onMove(ev: globalThis.PointerEvent) {
      if (dragRef.current?.type !== 'connect') return;
      const r = canvasEl.getBoundingClientRect();
      setConnecting(prev => prev ? {
        ...prev,
        toX: (ev.clientX - r.left - panRef.current.x) / scaleRef.current,
        toY: (ev.clientY - r.top - panRef.current.y) / scaleRef.current,
      } : null);
    }

    function onUp(ev: globalThis.PointerEvent) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragRef.current = null;
      setConnecting(null);

      const r = canvasEl.getBoundingClientRect();
      const toX = (ev.clientX - r.left - panRef.current.x) / scaleRef.current;
      const toY = (ev.clientY - r.top - panRef.current.y) / scaleRef.current;
      const current = mapRef.current;

      const target = current.nodes.find(n =>
        n.id !== fromId &&
        toX >= n.x - 10 && toX <= n.x + 220 &&
        toY >= n.y - 10 && toY <= n.y + 130,
      );
      if (!target) return;

      // Prevent duplicate connection
      const alreadyConnected =
        target.parentId === fromId ||
        current.edges.some(e => e.from === fromId && e.to === target.id);
      if (alreadyConnected) return;

      // Prevent cycles: walk up from fromId
      const ancestors = new Set<string>();
      let cur: string | null = fromId;
      while (cur) { ancestors.add(cur); cur = current.nodes.find(n => n.id === cur)?.parentId ?? null; }
      if (ancestors.has(target.id)) return;

      let newMap: MindMapData;
      if (!target.parentId) {
        // First connection → set as parent (tree edge)
        newMap = { nodes: current.nodes.map(n => n.id === target.id ? { ...n, parentId: fromId } : n), edges: current.edges };
      } else {
        // Already has a parent → add as extra edge
        const newEdge: MindMapEdge = { id: `e-${Date.now()}`, from: fromId, to: target.id };
        newMap = { nodes: current.nodes, edges: [...current.edges, newEdge] };
      }
      setMap(newMap);
      persist(newMap);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Canvas background: pan on drag, add node on click
  function handleCanvasPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setEditingId(null);
    dragRef.current = { type: 'pan', startClientX: e.clientX, startClientY: e.clientY, startPanX: pan.x, startPanY: pan.y, moved: false };
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
  }

  function handleCanvasPointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = canvasRef.current?.getBoundingClientRect();

    if (drag.type === 'pan') {
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
      setPan({ x: drag.startPanX! + dx, y: drag.startPanY! + dy });
    } else if (drag.type === 'connect' && rect) {
      setConnecting(prev => prev ? {
        ...prev,
        toX: (e.clientX - rect.left - pan.x) / scale,
        toY: (e.clientY - rect.top - pan.y) / scale,
      } : null);
    }
  }

  function handleCanvasPointerUp(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = '';
    const rect = canvasRef.current?.getBoundingClientRect();

    if (drag?.type === 'pan') {
      if (!drag.moved && rect) {
        addNodeAt((e.clientX - rect.left - pan.x) / scale - 88, (e.clientY - rect.top - pan.y) / scale - 34, null);
      }
    } else if (drag?.type === 'connect' && rect && drag.id) {
      setConnecting(null);
      const toX = (e.clientX - rect.left - pan.x) / scale;
      const toY = (e.clientY - rect.top - pan.y) / scale;
      const target = map.nodes.find(n =>
        n.id !== drag.id &&
        toX >= n.x - 10 && toX <= n.x + 220 &&
        toY >= n.y - 10 && toY <= n.y + 130
      );
      if (target) {
        const ancestors = new Set<string>();
        let cur: string | null = drag.id;
        while (cur) { ancestors.add(cur); cur = map.nodes.find(n => n.id === cur)?.parentId ?? null; }
        if (!ancestors.has(target.id)) {
          const newNodes = map.nodes.map(n => n.id === target.id ? { ...n, parentId: drag.id! } : n);
          setMap({ nodes: newNodes, edges: map.edges });
          persist({ nodes: newNodes, edges: map.edges });
        }
      }
    }
  }

  // Node: drag to move, click to edit
  function handleNodePointerDown(e: PointerEvent<HTMLButtonElement>, node: MindMapNode) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { type: 'node', id: node.id, startClientX: e.clientX, startClientY: e.clientY, startNodeX: node.x, startNodeY: node.y, moved: false };
  }

  function handleNodePointerMove(e: PointerEvent<HTMLButtonElement>, node: MindMapNode) {
    const drag = dragRef.current;
    if (!drag || drag.type !== 'node' || drag.id !== node.id) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
    updateNode(node.id, { x: drag.startNodeX! + dx / scale, y: drag.startNodeY! + dy / scale });
  }

  function handleNodePointerUp(e: PointerEvent<HTMLButtonElement>, node: MindMapNode) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.type !== 'node') return;
    if (!drag.moved) {
      if (e.ctrlKey || e.metaKey) {
        // Multi-select: toggle node in selection
        setSelectedIds(prev => {
          const s = new Set(prev);
          s.has(node.id) ? s.delete(node.id) : s.add(node.id);
          return s;
        });
        setEditingId(null);
      } else {
        setSelectedIds(new Set()); // clear selection on normal click
        setEditingId(prev => prev === node.id ? null : node.id);
      }
    } else {
      persist();
    }
  }

  // Position floating panel near node, clamped to canvas bounds
  function getPanelPos(node: MindMapNode) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { top: 80, left: 80 };
    const nodeScreenX = node.x * scale + pan.x;
    const nodeScreenY = node.y * scale + pan.y;
    const nodeW = 176 * scale;
    const panelW = 272;
    const panelH = 440;
    let left = nodeScreenX + nodeW + 12;
    let top = nodeScreenY;
    if (left + panelW > rect.width - 8) left = Math.max(8, nodeScreenX - panelW - 12);
    if (top + panelH > rect.height - 8) top = Math.max(8, rect.height - panelH - 8);
    return { top, left };
  }

  const panelPos = editingNode ? getPanelPos(editingNode) : null;

  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card overflow-hidden', isFullscreen && 'fixed inset-0 z-50 rounded-none border-0')} style={isFullscreen ? undefined : { height: '76vh' }}>
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <Brain className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider">Mapa Mental</h3>
            <p className="text-[11px] text-muted-foreground">Clique no canvas para adicionar · Scroll para zoom · Arraste para mover</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* AI Builder button */}
          <button
            onClick={() => setShowAIBuilder(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 text-xs font-semibold text-violet-400 hover:bg-violet-500/20 transition-colors"
            title="Criar mapa com IA (texto, áudio ou foto)"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Criar com IA
          </button>
          <div className="mx-1 h-5 w-px bg-border" />
          <button onClick={() => zoomBy(0.8)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Diminuir zoom">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => { setScale(1); setPan({ x: 60, y: 60 }); }} className="h-8 min-w-[52px] rounded-lg border border-border px-2 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            {Math.round(scale * 100)}%
          </button>
          <button onClick={() => zoomBy(1.25)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Aumentar zoom">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          {/* Multi-select copy button */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground font-semibold">{selectedIds.size} selecionado{selectedIds.size > 1 ? 's' : ''}</span>
              <button
                onClick={duplicateSelected}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                title="Duplicar selecionados"
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors" title="Limpar seleção (Esc)">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="mx-1 h-5 w-px bg-border" />
          {/* History button */}
          <div className="relative">
            <button
              onClick={() => setShowHistory(v => !v)}
              className={cn('flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors', showHistory ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')}
              title="Histórico de sessões"
            >
              <History className="h-3.5 w-3.5" />
              Histórico
              {history.length > 0 && <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/20 px-1 text-[9px] font-bold text-primary">{history.length}</span>}
            </button>
          </div>
          <Button onClick={() => persist()} className="h-8 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 px-3 text-xs font-bold uppercase tracking-wider">
            {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saved ? 'Salvo' : 'Salvar'}
          </Button>
          <button onClick={() => setIsFullscreen(v => !v)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Infinite canvas */}
      <div
        ref={canvasRef}
        className="relative flex-1 overflow-hidden cursor-crosshair bg-[radial-gradient(circle,_#ffffff08_1px,_transparent_1px)] bg-[length:24px_24px]"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={() => { if (dragRef.current?.type === 'connect') setConnecting(null); dragRef.current = null; if (canvasRef.current) canvasRef.current.style.cursor = ''; }}
      >
        {/* Transformed layer */}
        <div style={{ position: 'absolute', transformOrigin: '0 0', transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})`, willChange: 'transform' }}>
          <svg style={{ position: 'absolute', top: -500, left: -500, width: 8000, height: 5000, pointerEvents: 'none', zIndex: 0 }}>
            <defs>
              {/* Arrow marker for each node color */}
              {map.nodes.map(node => (
                <marker key={`arr-${node.id}`} id={`arr-${node.id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill={node.color} opacity="0.8" />
                </marker>
              ))}
              <marker id="arr-preview" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#55F52F" />
              </marker>
            </defs>

            {/* Connection lines — center-to-center bezier, offset +500 to match SVG origin */}
            {map.nodes.map(node => {
              const parent = node.parentId ? map.nodes.find(n => n.id === node.parentId) : null;
              if (!parent) return null;
              const O = 500; // SVG origin offset
              const parentW = parent.parentId === null ? 192 : 176;
              const nodeW = node.parentId === null ? 192 : 176;
              const x1 = parent.x + parentW / 2 + O;
              const y1 = parent.y + 34 + O;
              const x2 = node.x + nodeW / 2 + O;
              const y2 = node.y + 34 + O;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={`${parent.id}-${node.id}`}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={node.color}
                  strokeOpacity="0.9"
                  strokeWidth="2.5"
                  markerEnd={`url(#arr-${node.id})`}
                />
              );
            })}

            {/* Extra edges (multiple connections from/to same node) */}
            {map.edges.map(edge => {
              const from = map.nodes.find(n => n.id === edge.from);
              const to = map.nodes.find(n => n.id === edge.to);
              if (!from || !to) return null;
              const O = 500;
              const fromW = from.parentId === null ? 192 : 176;
              const toW = to.parentId === null ? 192 : 176;
              const x1 = from.x + fromW / 2 + O;
              const y1 = from.y + 34 + O;
              const x2 = to.x + toW / 2 + O;
              const y2 = to.y + 34 + O;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={edge.id}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={from.color}
                  strokeOpacity="0.7"
                  strokeWidth="2"
                  strokeDasharray="6 3"
                  markerEnd={`url(#arr-${from.id})`}
                />
              );
            })}

            {/* Live preview line while dragging to connect */}
            {connecting && (() => {
              const fromNode = map.nodes.find(n => n.id === connecting.fromId);
              if (!fromNode) return null;
              const O = 500;
              const fw = fromNode.parentId === null ? 192 : 176;
              const x1 = fromNode.x + fw / 2 + O;
              const y1 = fromNode.y + 34 + O;
              const tx = connecting.toX + O;
              const ty = connecting.toY + O;
              const mx = (x1 + tx) / 2;
              return (
                <path
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${ty}, ${tx} ${ty}`}
                  fill="none"
                  stroke="#55F52F"
                  strokeWidth="2.5"
                  strokeDasharray="8 4"
                  strokeOpacity="0.95"
                  markerEnd="url(#arr-preview)"
                />
              );
            })()}
          </svg>

          {map.nodes.map(node => {
            const isEditing = node.id === editingId;
            const isSelected = selectedIds.has(node.id);
            const isConnectTarget = connecting && connecting.fromId !== node.id;
            const childCount = map.nodes.filter(n => n.parentId === node.id).length + map.edges.filter(e => e.from === node.id).length;
            const nodeW = node.parentId === null ? 'w-48' : 'w-44';
            return (
              <div key={node.id} className="absolute group/node" style={{ left: node.x, top: node.y }}>
                <button
                  type="button"
                  onPointerDown={e => handleNodePointerDown(e, node)}
                  onPointerMove={e => handleNodePointerMove(e, node)}
                  onPointerUp={e => handleNodePointerUp(e, node)}
                  className={cn('rounded-lg border bg-card px-3 py-2 text-left shadow-sm cursor-grab active:cursor-grabbing select-none transition-shadow hover:shadow-md', nodeW, isConnectTarget && 'ring-2 ring-primary/50')}
                  style={{
                    borderColor: isEditing ? node.color : isSelected ? node.color : undefined,
                    boxShadow: isEditing
                      ? `0 0 0 2px ${node.color}`
                      : isSelected
                        ? `0 0 0 2px ${node.color}, 0 0 12px ${node.color}60`
                        : undefined,
                  }}
                >
                  <span className="mb-1 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: node.color }} />
                    <span className="truncate text-sm font-bold">{node.title}</span>
                  </span>
                  {node.image && <img src={node.image} alt="" className="mb-1.5 w-full rounded-md object-cover" style={{ maxHeight: 80 }} />}
                  <span className="line-clamp-2 block text-[11px] leading-snug text-muted-foreground">{node.note || 'Clique para editar'}</span>
                  {childCount > 0 && <span className="mt-1.5 inline-flex rounded-full border border-border px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{childCount} ligados</span>}
                </button>
                {/* Connect handle — drag to link to another node */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 -right-3 z-10 h-5 w-5 rounded-full border-2 border-primary bg-card flex items-center justify-center cursor-crosshair opacity-0 group-hover/node:opacity-100 hover:bg-primary transition-all"
                  style={{ boxShadow: `0 0 0 3px ${node.color}40` }}
                  title="Arraste para conectar"
                  onPointerDown={e => handleConnectPointerDown(e, node)}
                >
                  <Plus className="h-2.5 w-2.5 text-primary group-hover/node:[.bg-primary_&]:text-primary-foreground" />
                </div>
              </div>
            );
          })}
        </div>

        {/* Floating edit panel */}
        {editingNode && panelPos && (
          <div className="absolute z-20 w-68 rounded-xl border border-border bg-card shadow-2xl" style={{ top: panelPos.top, left: panelPos.left, width: 272 }} onPointerDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: editingNode.color }} />
                Editar tópico
              </span>
              <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground transition-colors"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="space-y-3 p-3">
              <div>
                <Label className="text-[10px] uppercase tracking-wider">Título</Label>
                <Input value={editingNode.title} onChange={e => updateNode(editingNode.id, { title: e.target.value })} className="mt-1 h-7 bg-background text-xs" autoFocus />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider">Notas</Label>
                <div className="relative">
                  <textarea value={editingNode.note} onChange={e => updateNode(editingNode.id, { note: e.target.value })} className="mt-1 min-h-16 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-1.5 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Detalhes, hipóteses, tarefas..." />
                  <DictateButton className="absolute bottom-1.5 right-1.5 h-6 w-6" onTranscript={(t) => updateNode(editingNode.id, { note: editingNode.note ? `${editingNode.note} ${t}` : t })} />
                </div>
              </div>
              <div>
                {editingNode.image ? (
                  <div className="relative">
                    <img src={editingNode.image} alt="" className="w-full rounded-lg object-cover" style={{ maxHeight: 110 }} />
                    <button onClick={() => updateNode(editingNode.id, { image: null })} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"><X className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <button onClick={() => imageInputRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:bg-muted transition-colors">
                    <ImageIcon className="h-3.5 w-3.5" />
                    Imagem (upload ou Ctrl+V)
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MIND_MAP_COLORS.map(color => (
                  <button key={color} type="button" onClick={() => updateNode(editingNode.id, { color })} className={cn('h-5 w-5 rounded border transition-transform hover:scale-110', editingNode.color === color ? 'ring-2 ring-foreground/30 border-foreground' : 'border-border')} style={{ backgroundColor: color }} />
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => addChildOf(editingNode.id)} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-xs font-semibold hover:bg-muted transition-colors">
                  <Plus className="h-3 w-3" /> Filho
                </button>
                <button onClick={() => duplicateNode(editingNode.id)} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-xs font-semibold hover:bg-muted transition-colors" title="Duplicar nó">
                  <Copy className="h-3 w-3" /> Duplicar
                </button>
                {editingNode.parentId && (
                  <button onClick={() => { updateNode(editingNode.id, { parentId: null }); setSaved(false); }} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors">
                    <Unlink className="h-3 w-3" /> Desconectar
                  </button>
                )}
                <button onClick={() => removeNode(editingNode.id)} disabled={editingNode.id === rootId} className="flex items-center justify-center gap-1 rounded-lg border border-red-400/30 px-2.5 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* History panel */}
        {showHistory && (
          <div className="absolute right-3 top-3 z-30 w-64 rounded-xl border border-border bg-card shadow-2xl" onPointerDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">Histórico de sessões</span>
              <button onClick={() => setShowHistory(false)} className="text-muted-foreground hover:text-foreground transition-colors"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {history.length === 0 && (
                <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">Nenhuma sessão salva ainda.</p>
              )}
              {history.map((snap, i) => (
                <div key={snap.ts} className="flex items-center justify-between border-b border-border/50 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                  <div>
                    <p className="text-[11px] font-semibold text-foreground">{snap.label}</p>
                    <p className="text-[10px] text-muted-foreground">{snap.map.nodes.length} nós</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {i === 0 && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">Atual</span>}
                    {i > 0 && (
                      <button
                        onClick={() => {
                          const restored = sanitizeMindMap(snap.map, clientName);
                          setMap(restored);
                          window.localStorage.setItem(MIND_MAP_STORAGE_KEY(clientId), JSON.stringify(restored));
                          setShowHistory(false);
                          setSaved(false);
                        }}
                        className="rounded-lg border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                      >
                        Restaurar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg border border-border bg-card/80 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground backdrop-blur-sm">
          <MousePointer2 className="h-3 w-3" />
          Clique = editar · Ctrl+clique = selecionar · Scroll = zoom · Arraste ponto verde = conectar
        </div>
      </div>

      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={e => {
        const file = e.target.files?.[0];
        if (!file || !editingId) return;
        const reader = new FileReader();
        reader.onload = () => { if (typeof reader.result === 'string') { updateNode(editingId, { image: reader.result }); } };
        reader.readAsDataURL(file);
        e.target.value = '';
      }} />

      {/* AI Map Builder Modal */}
      {showAIBuilder && (
        <AIMapBuilderModal
          clientName={clientName}
          onApply={applyAIMap}
          onClose={() => setShowAIBuilder(false)}
        />
      )}
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
            <p className={cn('font-heading font-normal text-xl leading-none mt-3', tone)}>{fmtBRL(value)}</p>
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

type CrmMetrics = {
  revenue: number;
  sales: number;
  leads: number;
  ticket: number;
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
  fetch(`/api/clients/${clientId}/goal`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(goal),
  }).catch(() => {});
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

function buildTodayProgress(meta: MetaAdsMetrics | null, google: GoogleAdsMetrics | null, crm: CrmMetrics | null): TodayProgress {
  const paid = buildTodayProgressFromPaidMedia(meta, google);
  const crmLeads = crm?.leads ?? 0;
  const sales = crm?.sales ?? 0;

  return {
    ...paid,
    revenue: crm?.revenue ?? 0,
    enrollments: sales,
    ticket: crm?.ticket ?? 0,
    funnel: [
      paid.funnel[0] || crmLeads,
      paid.funnel[1] || Math.round(crmLeads * 0.62),
      paid.funnel[2] || Math.round(crmLeads * 0.35),
      paid.funnel[3] || Math.round(crmLeads * 0.18),
      sales,
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
              <p className="mt-1 font-heading font-normal text-xl leading-none tracking-wide text-foreground">
                {formatGoalValue(goal.realized, goal.format)}
              </p>
            </div>
            <div className="rounded-lg bg-background/80 px-3 py-2 text-right shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur">
              <p className="font-heading font-normal text-xl leading-none" style={{ color }}>{progress}%</p>
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
            <p className="mt-1 font-heading font-normal text-xl leading-none" style={{ color }}>
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
          <span className="mt-1 block font-heading font-normal text-xl leading-none tracking-wide" style={{ color }}>
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
        <p className="mt-2 font-heading font-normal text-xl leading-none tracking-wide" style={{ color }}>
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

type SalesFunnelStageView = {
  label: string;
  value: number;
  color: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
};

function formatFunnelNumber(value: number): string {
  return Math.round(value).toLocaleString('pt-BR');
}

function formatFunnelPercent(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function conversionPercent(current: number, previous: number): number {
  if (previous <= 0) return 0;
  return (current / previous) * 100;
}

function SalesFunnelPerformance({
  dashboardData,
  todayProgress,
}: {
  dashboardData: typeof mockDashboardData;
  todayProgress: TodayProgress;
}) {
  const leads = dashboardData.newLeadsData.reduce((sum, item) => sum + item.facebook + item.instagram, 0);
  const visitors = Math.max(dashboardData.salesTargets.marketing.value, leads);
  const stages: SalesFunnelStageView[] = [
    { label: 'VISITANTES', value: visitors, color: '#14B8FF', Icon: Users },
    { label: 'LEADS', value: leads, color: '#9B5CFF', Icon: UserPlus },
    { label: 'QUALIFICADOS', value: todayProgress.funnel[1] ?? 0, color: '#F03A9C', Icon: CheckCircle2 },
    { label: 'AGENDAMENTOS', value: todayProgress.funnel[2] ?? 0, color: '#FF7A00', Icon: Calendar },
    { label: 'COMPARECIMENTOS', value: todayProgress.funnel[3] ?? 0, color: '#35E84B', Icon: Users },
  ];
  const conversions = stages.map((stage, index) => (
    index === 0 ? 100 : conversionPercent(stage.value, stages[index - 1].value)
  ));
  const transitionConversions = conversions.slice(1);
  const bottleneckIndex = transitionConversions.reduce((lowest, value, index) => (
    value < transitionConversions[lowest] ? index : lowest
  ), 0);
  const bottleneck = `${stages[bottleneckIndex].label[0]}${stages[bottleneckIndex].label.slice(1).toLowerCase()} → ${stages[bottleneckIndex + 1].label[0]}${stages[bottleneckIndex + 1].label.slice(1).toLowerCase()}`;
  const generalConversion = conversionPercent(stages[4].value, stages[0].value);

  return (
    <section className="relative overflow-hidden rounded-[20px] border border-[#55F52F]/45 bg-[#06120f] p-4 shadow-[0_0_0_1px_rgba(85,245,47,0.16),0_0_42px_rgba(85,245,47,0.18)] sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(85,245,47,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_22%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:radial-gradient(circle,rgba(255,255,255,0.38)_1px,transparent_1px)] [background-size:16px_16px]" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-black uppercase tracking-[0.16em] text-white">Funil de Performance</h3>
            <Info className="h-4 w-4 text-white/55" />
          </div>
          <p className="mt-2 text-sm font-semibold text-white/55">Período: <span className="text-white/72">Este mês</span></p>
        </div>
        <button
          type="button"
          className="flex h-12 items-center gap-3 rounded-xl border border-white/10 bg-[#171925] px-4 text-sm font-bold text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
        >
          <span className="text-white/45">Exibir</span>
          Conversão %
          <ChevronDown className="h-4 w-4 text-white/55" />
        </button>
      </div>

      <div className="relative mt-9">
        {stages.map((stage, index) => {
          const Icon = stage.Icon;
          const conversion = conversions[index];
          const nextConversion = conversions[index + 1] ?? 0;

          return (
            <div key={stage.label}>
              <div
                className="relative grid min-h-[118px] grid-cols-[96px_52px_1fr_auto] items-center overflow-hidden rounded-xl border bg-[#0A1218]/82 pr-8 shadow-[inset_0_0_44px_rgba(255,255,255,0.025)] max-sm:grid-cols-[74px_38px_1fr] max-sm:pr-4"
                style={{
                  borderColor: `${stage.color}cc`,
                  boxShadow: `inset 0 0 46px ${stage.color}22, 0 0 18px ${stage.color}26`,
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background: `linear-gradient(90deg, ${stage.color}33 0%, ${stage.color}24 14%, ${stage.color}10 48%, ${stage.color}08 100%)`,
                  }}
                />
                <div
                  className="relative flex h-full min-h-[118px] items-center justify-center border-r bg-black/10"
                  style={{
                    borderColor: `${stage.color}aa`,
                    boxShadow: `inset 0 0 32px ${stage.color}44`,
                  }}
                >
                  <Icon className="h-11 w-11" style={{ color: stage.color }} />
                </div>
                <div className="relative flex justify-center">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-black text-white shadow-[0_0_24px_rgba(255,255,255,0.16)]"
                    style={{ backgroundColor: `${stage.color}aa` }}
                  >
                    {index + 1}
                  </span>
                </div>
                <p className="relative text-xs font-black uppercase tracking-[0.1em] text-white max-sm:text-[10px]">
                  {stage.label}
                </p>
                <div className="relative text-right max-sm:col-span-3 max-sm:pb-4 max-sm:pr-1">
                  <p className="text-4xl font-black leading-none text-white max-sm:text-3xl">{formatFunnelNumber(stage.value)}</p>
                  <p className="mt-3 text-xl font-semibold text-white/65 max-sm:text-base">{formatFunnelPercent(conversion)}</p>
                </div>
              </div>

              {index < stages.length - 1 && (
                <div className="relative flex h-[74px] justify-center">
                  <div
                    className="absolute left-1/2 top-0 h-full border-l-2 border-dotted"
                    style={{ borderColor: `${stage.color}cc` }}
                  />
                  <span
                    className="absolute top-[-6px] h-3 w-3 rounded-full"
                    style={{ backgroundColor: stage.color, boxShadow: `0 0 18px ${stage.color}` }}
                  />
                  <div className="relative z-10 mt-7 flex h-10 items-center gap-5 rounded-lg border border-white/10 bg-[#171B25] px-4 shadow-[0_12px_30px_rgba(0,0,0,0.34)]">
                    <span className="text-xs font-black text-white/58">Taxa de conversão</span>
                    <span className="text-lg font-black" style={{ color: stage.color }}>{formatFunnelPercent(nextConversion)}</span>
                  </div>
                  <ChevronDown
                    className="absolute bottom-2 h-5 w-5"
                    style={{ color: stage.color, filter: `drop-shadow(0 0 8px ${stage.color})` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative mt-8 grid gap-0 overflow-hidden rounded-2xl border border-white/10 bg-[#131923]/86 shadow-[inset_0_0_36px_rgba(255,255,255,0.025)] md:grid-cols-3">
        <div className="flex gap-4 p-6 md:border-r md:border-white/10">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#ff4d61]/25 text-[#ff8a95] shadow-[0_0_22px_rgba(255,77,97,0.25)]">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-black uppercase tracking-[0.12em] text-white/78">Maior Gargalo</p>
            <p className="mt-4 text-lg font-black text-white">{bottleneck}</p>
            <p className="mt-3 text-sm font-semibold text-white/45">Conversão de {formatFunnelPercent(transitionConversions[bottleneckIndex] ?? 0)}</p>
          </div>
        </div>
        <div className="flex gap-4 p-6 md:border-r md:border-white/10">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#35E84B]/18 text-[#67ff76] shadow-[0_0_22px_rgba(53,232,75,0.25)]">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-black uppercase tracking-[0.12em] text-white/78">Conversão Geral</p>
            <p className="mt-4 text-xl font-black text-white">{formatFunnelPercent(generalConversion)}</p>
            <p className="mt-2 text-sm font-semibold text-white/45">{formatFunnelNumber(stages[4].value)} de {formatFunnelNumber(stages[0].value)} visitantes</p>
          </div>
        </div>
        <div className="flex gap-4 p-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#35E84B]/18 text-[#B7FF7A] shadow-[0_0_22px_rgba(53,232,75,0.25)]">
            <Lightbulb className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-black uppercase tracking-[0.12em] text-white/78">Oportunidade</p>
            <p className="mt-4 text-lg font-black text-white">Melhore a qualificação</p>
            <p className="mt-3 text-sm font-semibold text-white/45">Ative automações e nutrições</p>
          </div>
        </div>
      </div>
    </section>
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

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/dna`)
      .then(r => r.json())
      .then((dbMembers: ClientTeamMember[]) => {
        if (cancelled) return;
        if (Array.isArray(dbMembers) && dbMembers.length > 0) {
          setMembers(dbMembers);
          localStorage.setItem(DNA_STORAGE_KEY(clientId), JSON.stringify(dbMembers));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);

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
    fetch(`/api/clients/${clientId}/dna`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(members),
    }).catch(() => {});
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
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-heading font-normal text-sm"
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
              <p className="mt-2 font-heading font-normal text-xl leading-none tracking-wide" style={{ color: metric.color }}>
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
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
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
                <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">2. Visualização</p>
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
                <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">3. Título (opcional)</p>
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
                <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">4. Tamanho</p>
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

      <SalesFunnelPerformance dashboardData={dashboardData} todayProgress={todayProgress} />

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
          <DialogTitle className="font-heading font-normal text-xl uppercase tracking-wider">Configurar Meta Ads</DialogTitle>
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
          <DialogTitle className="font-heading font-normal text-xl uppercase tracking-wider">Configurar Google Ads</DialogTitle>
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

const CLIENT_BILLING_MODE_PREFIX = 'clientAdsBillingMode_';

type AnotaAiStore = {
  id: string;
  storeName: string;
  storeId: string;
  ifoodStoreId: string | null;
  integrationToken: string;
  active: boolean;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  lastTestAt: string | null;
};

const EMPTY_ANOTA_AI_FORM = {
  id: '',
  storeName: '',
  storeId: '',
  ifoodStoreId: '',
  integrationToken: '',
  active: true,
};

function maskToken(token: string) {
  if (!token) return '—';
  if (token.length <= 14) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

function ClientIntegrationsTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { getConnection, getClientAccounts, getClientMetrics } = useMetaAdsConnections();
  const googleAds = useGoogleAds();
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);
  const [googleDialogOpen, setGoogleDialogOpen] = useState(false);
  const [billingMode, setBillingMode] = useState<'prepaid' | 'card'>('prepaid');
  const [anotaStores, setAnotaStores] = useState<AnotaAiStore[]>([]);
  const [anotaForm, setAnotaForm] = useState(EMPTY_ANOTA_AI_FORM);
  const [anotaLoading, setAnotaLoading] = useState(true);
  const [anotaSaving, setAnotaSaving] = useState(false);
  const [anotaError, setAnotaError] = useState('');
  const metaConnection = getConnection(clientId);
  const metaAccounts = getClientAccounts(clientId);
  const metaMetrics = getClientMetrics(clientId);
  const googleConnection = googleAds.getConnection(clientId);
  const googleAccounts = googleAds.getClientAccounts(clientId);
  const googleMetrics = googleAds.getClientMetrics(clientId);

  useEffect(() => {
    const stored = localStorage.getItem(`${CLIENT_BILLING_MODE_PREFIX}${clientId}`);
    setBillingMode(stored === 'card' ? 'card' : 'prepaid');
    let cancelled = false;
    fetch(`/api/clients/${clientId}/billing-mode`)
      .then(r => r.json())
      .then((data: { mode: 'prepaid' | 'card' }) => {
        if (cancelled) return;
        setBillingMode(data.mode);
        localStorage.setItem(`${CLIENT_BILLING_MODE_PREFIX}${clientId}`, data.mode);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);

  useEffect(() => {
    fetch(`/api/clients/${clientId}/anota-ai`)
      .then(r => r.ok ? r.json() as Promise<AnotaAiStore[]> : [])
      .then(rows => setAnotaStores(rows))
      .catch(() => setAnotaStores([]))
      .finally(() => setAnotaLoading(false));
  }, [clientId]);

  function updateBillingMode(next: 'prepaid' | 'card') {
    setBillingMode(next);
    localStorage.setItem(`${CLIENT_BILLING_MODE_PREFIX}${clientId}`, next);
    fetch(`/api/clients/${clientId}/billing-mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    }).catch(() => {});
  }

  async function saveAnotaStore() {
    setAnotaError('');
    if (!anotaForm.storeName.trim() || !anotaForm.storeId.trim() || !anotaForm.integrationToken.trim()) {
      setAnotaError('Preencha nome da loja, ID da loja e token.');
      return;
    }
    setAnotaSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/anota-ai`, {
        method: anotaForm.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(anotaForm),
      });
      const data = await res.json().catch(() => ({})) as AnotaAiStore & { error?: string };
      if (!res.ok || data.error) {
        setAnotaError(data.error ?? 'Erro ao salvar integração.');
        return;
      }
      setAnotaStores(prev => anotaForm.id
        ? prev.map(store => store.id === data.id ? data : store)
        : [...prev, data]
      );
      setAnotaForm(EMPTY_ANOTA_AI_FORM);
    } finally {
      setAnotaSaving(false);
    }
  }

  async function removeAnotaStore(store: AnotaAiStore) {
    if (!window.confirm(`Remover a loja "${store.storeName}" do Anota Aí?`)) return;
    await fetch(`/api/clients/${clientId}/anota-ai?storeId=${store.id}`, { method: 'DELETE' });
    setAnotaStores(prev => prev.filter(item => item.id !== store.id));
    if (anotaForm.id === store.id) setAnotaForm(EMPTY_ANOTA_AI_FORM);
  }

  function editAnotaStore(store: AnotaAiStore) {
    setAnotaError('');
    setAnotaForm({
      id: store.id,
      storeName: store.storeName,
      storeId: store.storeId,
      ifoodStoreId: store.ifoodStoreId ?? '',
      integrationToken: store.integrationToken,
      active: store.active,
    });
  }

  return (
    <>
      <Card className="mb-4 border-border bg-card">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
                <WalletCards className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Forma de cobrança dos anúncios</CardTitle>
                <CardDescription className="mt-1">
                  Use “Cartão/faturado” para clientes em que a Meta/Google cobra direto no cartão. Essas contas não aparecem como saldo crítico em Pagamentos.
                </CardDescription>
              </div>
            </div>
            <div className="flex shrink-0 rounded-xl border border-border bg-background p-1">
              {([
                { value: 'prepaid' as const, label: 'Pré-pago / saldo' },
                { value: 'card' as const, label: 'Cartão / faturado' },
              ]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateBillingMode(option.value)}
                  className={cn(
                    'rounded-lg px-3 py-2 text-xs font-bold transition-all',
                    billingMode === option.value
                      ? 'bg-primary text-black shadow-[0_0_12px_rgba(85,245,47,0.25)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="mb-4 border-border bg-card">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10">
                <Store className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Anota Aí</CardTitle>
                <CardDescription className="mt-1">
                  Cadastre uma ou mais lojas do Anota Aí para este cliente. A coleta de pedidos será conectada depois a partir desses tokens.
                </CardDescription>
              </div>
            </div>
            <span className={cn(
              'shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-widest',
              anotaStores.some(store => store.active)
                ? 'border-primary/30 bg-primary/15 text-primary'
                : 'border-border bg-muted text-muted-foreground',
            )}>
              {anotaStores.some(store => store.active) ? 'Preparado' : 'Não vinculado'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nome da loja</Label>
              <Input
                value={anotaForm.storeName}
                onChange={e => setAnotaForm(prev => ({ ...prev, storeName: e.target.value }))}
                placeholder="Ex: Prochet"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">ID da loja</Label>
              <Input
                value={anotaForm.storeId}
                onChange={e => setAnotaForm(prev => ({ ...prev, storeId: e.target.value }))}
                placeholder="ID Anota Aí"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">ID da loja iFood</Label>
              <Input
                value={anotaForm.ifoodStoreId}
                onChange={e => setAnotaForm(prev => ({ ...prev, ifoodStoreId: e.target.value }))}
                placeholder="Opcional"
              />
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Token de integração</Label>
              <Input
                value={anotaForm.integrationToken}
                onChange={e => setAnotaForm(prev => ({ ...prev, integrationToken: e.target.value }))}
                placeholder="Cole a chave de integração"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => setAnotaForm(prev => ({ ...prev, active: !prev.active }))}
                className={cn(
                  'h-10 rounded-lg border px-3 text-xs font-bold transition-colors',
                  anotaForm.active
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {anotaForm.active ? 'Ativa' : 'Inativa'}
              </button>
              {anotaForm.id && (
                <Button variant="outline" onClick={() => setAnotaForm(EMPTY_ANOTA_AI_FORM)} className="h-10 text-xs">
                  Cancelar
                </Button>
              )}
              <Button onClick={saveAnotaStore} disabled={anotaSaving} className="h-10 text-xs font-bold">
                {anotaSaving ? 'Salvando...' : anotaForm.id ? 'Salvar loja' : 'Adicionar loja'}
              </Button>
            </div>
          </div>
          {anotaError && <p className="text-xs text-red-400">{anotaError}</p>}

          <div className="rounded-xl border border-border bg-background">
            {anotaLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Carregando lojas...</div>
            ) : anotaStores.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Nenhuma loja Anota Aí cadastrada para este cliente.</div>
            ) : (
              <div className="divide-y divide-border">
                {anotaStores.map(store => (
                  <div key={store.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground">{store.storeName}</p>
                        <span className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                          store.active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground',
                        )}>
                          {store.active ? 'Ativa' : 'Inativa'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Loja: {store.storeId}
                        {store.ifoodStoreId ? ` · iFood: ${store.ifoodStoreId}` : ''}
                        {' · '}Token: {maskToken(store.integrationToken)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => editAnotaStore(store)} className="h-8 text-xs">
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => removeAnotaStore(store)} className="h-8 border-red-500/30 text-red-300 hover:text-red-200">
                        Remover
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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
                    'text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border',
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

// ── Google Sheets Results Tab ─────────────────────────────────────────────────
type SheetsTab = { name: string; amount: number; count?: number; source?: string };
type SheetsResult = { tabs: SheetsTab[]; total: number; note?: string };
type CrmSaleRow = {
  id: string;
  normalized_date: string | null;
  normalized_name: string | null;
  normalized_revenue: number;
};

function SheetsResultsTab({ clientId }: { clientId: string }) {
  const [sheetsUrl, setSheetsUrl]       = useState('');
  const [savedUrl, setSavedUrl]         = useState('');
  const [result, setResult]             = useState<SheetsResult | null>(null);
  const [analyzedAt, setAnalyzedAt]     = useState<string | null>(null);
  const [loading, setLoading]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [loadingUrl, setLoadingUrl]     = useState(true);
  const [salesRows, setSalesRows]       = useState<CrmSaleRow[]>([]);
  const [salesLoading, setSalesLoading] = useState(true);
  const [clearingSales, setClearingSales] = useState(false);

  useEffect(() => {
    fetch(`/api/clients/${clientId}/sheets`)
      .then(r => r.ok ? r.json() as Promise<{ sheetsUrl: string | null; sheetsResult: SheetsResult | null; sheetsAnalyzedAt: string | null }> : null)
      .then(d => {
        if (d?.sheetsUrl) { setSavedUrl(d.sheetsUrl); setSheetsUrl(d.sheetsUrl); }
        if (d?.sheetsResult) setResult(d.sheetsResult);
        if (d?.sheetsAnalyzedAt) setAnalyzedAt(d.sheetsAnalyzedAt);
      })
      .finally(() => setLoadingUrl(false));
  }, [clientId]);

  useEffect(() => {
    setSalesLoading(true);
    fetch(`/api/crm?clientId=${encodeURIComponent(clientId)}`)
      .then(r => r.ok ? r.json() as Promise<CrmSaleRow[]> : [])
      .then(rows => {
        setSalesRows(rows
          .map(row => ({ ...row, normalized_revenue: Number(row.normalized_revenue ?? 0) }))
          .filter(row => row.normalized_revenue > 0)
        );
      })
      .catch(() => setSalesRows([]))
      .finally(() => setSalesLoading(false));
  }, [clientId, analyzedAt]);

  async function handleSaveUrl() {
    setSaving(true);
    await fetch(`/api/clients/${clientId}/sheets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetsUrl: sheetsUrl.trim() }),
    });
    setSavedUrl(sheetsUrl.trim());
    setSaving(false);
  }

  async function handleAnalyze() {
    setLoading(true);
    setError('');
    const res = await fetch(`/api/clients/${clientId}/sheets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetsUrl: sheetsUrl.trim() || savedUrl }),
    });
    const data = await res.json() as SheetsResult & { error?: string };
    setLoading(false);
    if (!res.ok || data.error) { setError(data.error ?? 'Erro ao analisar.'); return; }
    setResult(data);
    setAnalyzedAt(new Date().toISOString());
  }

  async function handleClearImportedSales() {
    if (salesRows.length === 0 || clearingSales) return;
    const confirmed = window.confirm('Apagar as vendas importadas deste cliente? Esta ação limpa a importação atual para você enviar outra planilha.');
    if (!confirmed) return;

    setClearingSales(true);
    setError('');
    try {
      const res = await fetch(`/api/crm?clientId=${encodeURIComponent(clientId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? 'Erro ao limpar vendas importadas.');
        return;
      }
      setSalesRows([]);
      setResult(null);
      setAnalyzedAt(null);
    } catch {
      setError('Erro de conexão ao limpar vendas importadas.');
    } finally {
      setClearingSales(false);
    }
  }

  const urlChanged = sheetsUrl.trim() !== savedUrl;
  const importedRevenue = salesRows.reduce((sum, row) => sum + row.normalized_revenue, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Resultados Financeiros</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Cole o link do Google Sheets. A IA analisa todas as abas e extrai os valores de vendas automaticamente.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="space-y-2">
          <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Link do Google Sheets</label>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={loadingUrl ? 'Carregando...' : sheetsUrl}
              disabled={loadingUrl}
              onChange={e => setSheetsUrl(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {urlChanged && (
              <button
                onClick={handleSaveUrl}
                disabled={saving || !sheetsUrl.trim()}
                className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/60">A planilha precisa estar como "qualquer pessoa com o link pode visualizar".</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleAnalyze}
            disabled={loading || (!sheetsUrl.trim() && !savedUrl)}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
            style={{ background: '#7B21D0' }}
          >
            {loading ? (
              <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Analisando...</>
            ) : (
              <><RefreshCw className="w-4 h-4" />Analisar Agora</>
            )}
          </button>
          {analyzedAt && (
            <span className="text-xs text-muted-foreground">
              Última análise: {new Date(analyzedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total de Vendas</p>
              <p className="text-xl font-bold text-primary mt-1">{fmtBRL(result.total)}</p>
              {result.note && <p className="text-xs text-muted-foreground mt-2 max-w-md">{result.note}</p>}
            </div>
          </div>

          {result.tabs.filter(t => t.amount > 0).length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Breakdown por Aba</p>
              </div>
              <div className="divide-y divide-border">
                {result.tabs.filter(t => t.amount > 0).map(tab => (
                  <div key={tab.name} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold">{tab.name}</p>
                      {tab.source && <p className="text-[11px] text-muted-foreground mt-0.5">via {tab.source}{tab.count ? ` · ${tab.count} venda${tab.count !== 1 ? 's' : ''}` : ''}</p>}
                    </div>
                    <p className="text-sm font-bold text-primary">{fmtBRL(tab.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Clientes das vendas importadas</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {salesLoading
                ? 'Carregando vendas...'
                : `${salesRows.length.toLocaleString('pt-BR')} venda${salesRows.length === 1 ? '' : 's'} com faturamento`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-sm font-bold text-primary">{fmtBRL(importedRevenue)}</p>
            {salesRows.length > 0 && (
              <button
                type="button"
                onClick={handleClearImportedSales}
                disabled={clearingSales}
                className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-bold text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
              >
                {clearingSales ? 'Limpando...' : 'Limpar importação'}
              </button>
            )}
          </div>
        </div>
        {salesRows.length > 0 ? (
          <div className="max-h-96 overflow-y-auto divide-y divide-border">
            {salesRows.slice(0, 200).map((sale) => (
              <div key={sale.id} className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{sale.normalized_name || 'Cliente sem nome'}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {sale.normalized_date ? new Date(sale.normalized_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Sem data informada'}
                  </p>
                </div>
                <p className="font-bold tabular-nums text-primary">{fmtBRL(sale.normalized_revenue)}</p>
              </div>
            ))}
            {salesRows.length > 200 && (
              <div className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">
                Mostrando 200 de {salesRows.length.toLocaleString('pt-BR')} vendas.
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {salesLoading ? 'Carregando...' : 'Nenhuma venda importada com faturamento para este cliente.'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
const TABS = ['dashboard', 'planejamento', 'mapa', 'historico', 'integracoes', 'rastreio', 'links', 'pagamentos', 'dna', 'crm'] as const;
type Tab = typeof TABS[number];

function readSavedDashboardBlocks(clientId: string): ClientDashboardWidget[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`clientDashboardBlocks_${clientId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClientDashboardWidget[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { allClients, setClientStatus } = useClients();
  const googleAds = useGoogleAds();
  const baseClient = mockClients.find((c) => c.id === id);
  const storedClient = allClients.find((c) => c.id === id);
  const client = storedClient ?? { name: 'Cliente', segment: '', status: 'Ativo' };
  const isNewClient = !baseClient || !storedClient;
  const onboardingPending = storedClient?.onboarding_completed === false;

  // Cadastro feito pelo wizard obrigatório (/clientes/novo) ainda não foi concluído —
  // volta pra lá em vez de abrir as abas normais. Ver markOnboardingComplete em client-store.ts.
  useEffect(() => {
    if (onboardingPending) router.replace(`/clientes/novo?id=${id}`);
  }, [onboardingPending, id, router]);

  const [realMetrics, setRealMetrics] = useState<MetaAdsMetrics | null>(null);
  const [apiGoogleMetrics, setApiGoogleMetrics] = useState<GoogleAdsMetrics | null>(null);
  const [crmMetrics, setCrmMetrics] = useState<CrmMetrics | null>(null);
  const [metaBalance, setMetaBalance] = useState<number | null>(null);
  const [googleBalance, setGoogleBalance] = useState<number | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/clients/${id}/metrics`)
      .then(res => res.ok ? res.json() as Promise<{ meta: MetaAdsMetrics | null; google: GoogleAdsMetrics | null; crm?: CrmMetrics | null }> : null)
      .then(data => { setRealMetrics(data?.meta ?? null); setApiGoogleMetrics(data?.google ?? null); setCrmMetrics(data?.crm ?? null); })
      .catch(() => { setRealMetrics(null); setApiGoogleMetrics(null); setCrmMetrics(null); });
  }, [id]);

  useEffect(() => {
    setBalancesLoading(true);
    Promise.all([
      fetch('/api/clients/links').then(r => r.ok ? r.json() as Promise<Array<{ clientId: string; platform: string; accountId: string }>> : []),
      fetch('/api/meta/account-balances').then(r => r.ok ? r.json() as Promise<Array<{ id: string; balance: number | null }>> : []),
      fetch('/api/google/account-balances').then(r => r.ok ? r.json() as Promise<Array<{ id: string; balance: number | null }>> : []),
    ]).then(([links, metaBalances, googleBalances]) => {
      const metaIds = new Set(links.filter(l => l.clientId === id && l.platform === 'meta_ads').map(l => l.accountId));
      const googleIds = new Set(links.filter(l => l.clientId === id && l.platform === 'google_ads').map(l => l.accountId));
      const mb = metaBalances.filter(b => metaIds.has(b.id) && b.balance !== null).reduce((s, b) => s + (b.balance ?? 0), 0);
      const gb = googleBalances.filter(b => googleIds.has(b.id) && b.balance !== null).reduce((s, b) => s + (b.balance ?? 0), 0);
      setMetaBalance(metaIds.size > 0 ? mb : null);
      setGoogleBalance(googleIds.size > 0 ? gb : null);
    }).catch(() => {}).finally(() => setBalancesLoading(false));
  }, [id]);

  const googleConnection = googleAds.getConnection(id);
  const googleMetrics: GoogleAdsMetrics | null = apiGoogleMetrics ?? (googleConnection ? googleAds.getClientMetrics(id) : null);

  const isAdmin = getAuthSession()?.role === 'Administrador';

  const [tab, setTab] = useState<Tab>('planejamento');
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<ClientStatus | null>(null);
  const [securityEmail, setSecurityEmail] = useState('');
  const [securityPassword, setSecurityPassword] = useState('');
  const [securityError, setSecurityError] = useState('');
  const [securityLoading, setSecurityLoading] = useState(false);
  const [dashboardEditable, setDashboardEditable] = useState(false);
  const [customBlocks, setCustomBlocks] = useState<ClientDashboardWidget[]>(() => readSavedDashboardBlocks(id));

  const [categories, setCategories] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [clientCategoryId, setClientCategoryId] = useState<string>(storedClient?.category_id ?? '');
  const [clientDashType, setClientDashType] = useState<DashboardType>(storedClient?.dashboard_type ?? 'leads');

  useEffect(() => {
    fetch('/api/clients/categories').then(r => r.ok ? r.json() : []).then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    setClientCategoryId(storedClient?.category_id ?? '');
    setClientDashType(storedClient?.dashboard_type ?? 'leads');
  }, [storedClient?.category_id, storedClient?.dashboard_type]);

  async function patchClient(patch: Record<string, unknown>) {
    await fetch(`/api/clients?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    window.dispatchEvent(new Event('clients-updated'));
  }
  const [clientGoal, setClientGoal] = useState<ClientGoalConfig>(() =>
    readSavedClientGoal(id, isNewClient ? ZERO_CLIENT_GOAL : DEFAULT_CLIENT_GOAL)
  );
  const [clientGoalLoadedFor, setClientGoalLoadedFor] = useState(id);
  // Admin: localStorage wins immediately (pushes correct data to DB on first visit).
  // Non-admin: must wait for DB load to prevent localStorage defaults from overwriting DB.
  const goalDbLoaded = useRef(isAdmin);

  useEffect(() => {
    goalDbLoaded.current = isAdmin;
    let cancelled = false;
    setClientGoal(readSavedClientGoal(id, isNewClient ? ZERO_CLIENT_GOAL : DEFAULT_CLIENT_GOAL));
    setClientGoalLoadedFor(id);
    fetch(`/api/clients/${id}/goal`)
      .then(r => r.json())
      .then((dbData: Partial<ClientGoalConfig> | null) => {
        if (cancelled) return;
        if (dbData?.type && !isAdmin) {
          // Non-admin: DB is authoritative — load its data into state
          const option = GOAL_TYPE_OPTIONS.find(o => o.type === dbData.type);
          if (option) {
            const target = Number(dbData.target ?? 0);
            const goal: ClientGoalConfig = {
              type: option.type, label: option.label, format: option.format,
              target, partial: autoPartial(target), realized: Number(dbData.realized ?? 0),
            };
            setClientGoal(goal);
            window.localStorage.setItem(`clientGoal_${id}`, JSON.stringify(goal));
          }
        }
        goalDbLoaded.current = true;
      })
      .catch(() => { goalDbLoaded.current = true; });
    return () => { cancelled = true; };
  }, [id, isNewClient, isAdmin]);

  useEffect(() => {
    if (clientGoalLoadedFor !== id) return;
    if (!goalDbLoaded.current) return;
    saveClientGoal(id, clientGoal);
  }, [id, clientGoal, clientGoalLoadedFor]);

  useEffect(() => {
    setClientGoal((prev) => ({
      ...prev,
      partial: autoPartial(prev.target),
      realized:
        prev.type === 'leads' ? (realMetrics?.leads ?? prev.realized)
        : prev.type === 'revenue' ? (crmMetrics?.revenue ?? prev.realized)
        : prev.type === 'enrollments' ? (crmMetrics?.sales ?? googleMetrics?.conversions ?? prev.realized)
        : prev.realized,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realMetrics, googleMetrics, crmMetrics]);

  useEffect(() => {
    setSecurityEmail(getAuthSession()?.email ?? '');
  }, []);

  useEffect(() => {
    setCustomBlocks(readSavedDashboardBlocks(id));
    setDashboardEditable(false);
  }, [id]);

  useEffect(() => {
    window.localStorage.setItem(`clientDashboardBlocks_${id}`, JSON.stringify(customBlocks));
  }, [id, customBlocks]);

  const dashboardData = isNewClient
    ? ZERO_DASHBOARD_DATA
    : buildDashboardDataFromPaidMedia(realMetrics, googleMetrics);
  const todayProgress = isNewClient
    ? ZERO_TODAY_PROGRESS
    : buildTodayProgress(realMetrics, googleMetrics, crmMetrics);

  function addCustomBlock(widget: Omit<ClientDashboardWidget, 'id'>) {
    setCustomBlocks(prev => [...prev, { ...widget, id: `widget-${Date.now()}` }]);
  }

  function removeCustomBlock(widgetId: string) {
    setCustomBlocks(prev => prev.filter(widget => widget.id !== widgetId));
  }

  function openStatusDialog(nextStatus: ClientStatus) {
    const session = getAuthSession();
    setPendingStatus(nextStatus);
    setSecurityEmail(session?.email ?? '');
    setSecurityPassword('');
    setSecurityError('');
    setStatusDialogOpen(true);
  }

  async function confirmStatusChange() {
    if (!pendingStatus) return;
    setSecurityLoading(true);
    setSecurityError('');
    try {
      const user = await verifyUserCredentials(securityEmail, securityPassword);
      if (!user || user.role !== 'Administrador') {
        setSecurityError('Usuário ou senha inválidos para administrador.');
        return;
      }

      setClientStatus(id, pendingStatus);
      setStatusDialogOpen(false);
      setPendingStatus(null);
      setSecurityPassword('');
    } finally {
      setSecurityLoading(false);
    }
  }

  const tabLabel: Record<Tab, string> = {
    dashboard:    'Dashboard',
    planejamento: 'Planejamento',
    mapa:         'Mapa Mental',
    historico:    'Histórico',
    integracoes:  'Integrações',
    rastreio:     'Rastreio',
    links:        'Links & Senhas',
    pagamentos:   'Pagamentos',
    dna:          'DNA do Cliente',
    crm:          'CRM',
  };

  if (onboardingPending) {
    return <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">Redirecionando para o cadastro pendente...</div>;
  }

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
            <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">{client.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-sm text-muted-foreground uppercase tracking-wide">
                {storedClient?.category_name ?? storedClient?.segment ?? client.segment}
              </p>
              <span className={cn(
                'text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase',
                clientDashType === 'leads' ? 'text-violet-400 border-violet-500/40 bg-violet-500/10' :
                clientDashType === 'branding' ? 'text-blue-400 border-blue-500/40 bg-blue-500/10' :
                'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
              )}>
                {clientDashType === 'leads' ? 'Leads' : clientDashType === 'branding' ? 'Branding' : 'Conversão'}
              </span>
            </div>
          </div>
          {/* Balance KPIs */}
          <div className="hidden md:flex items-center gap-3 ml-4 pl-4 border-l border-border">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 min-w-[130px]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: '#0668E125' }}>
                <PiggyBank className="h-3.5 w-3.5" style={{ color: '#0668E1' }} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-none mb-0.5">Saldo Meta</p>
                {balancesLoading ? (
                  <div className="h-4 w-16 animate-pulse rounded bg-muted/30 mt-0.5" />
                ) : metaBalance === null ? (
                  <p className="text-xs text-muted-foreground">—</p>
                ) : (
                  <p className="text-sm font-bold">{metaBalance.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 min-w-[130px]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: '#34A85325' }}>
                <Wallet className="h-3.5 w-3.5" style={{ color: '#34A853' }} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-none mb-0.5">Saldo Google</p>
                {balancesLoading ? (
                  <div className="h-4 w-16 animate-pulse rounded bg-muted/30 mt-0.5" />
                ) : googleBalance === null ? (
                  <p className="text-xs text-muted-foreground">—</p>
                ) : (
                  <p className="text-sm font-bold">{googleBalance.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className={cn(
              'border-border h-9 text-xs font-bold uppercase tracking-wider gap-2',
              client.status === 'Inativo' ? 'border-primary/40 text-primary' : 'border-orange-400/40 text-orange-300'
            )}
            onClick={() => openStatusDialog(client.status === 'Inativo' ? 'Ativo' : 'Inativo')}
          >
            {client.status === 'Inativo' ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
            {client.status === 'Inativo' ? 'Ativar Cliente' : 'Desativar Cliente'}
          </Button>
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

      {/* Client settings row — category & dashboard type */}
      <div className="flex items-center gap-3 flex-wrap rounded-xl border border-border bg-card/50 px-4 py-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Configurações do cliente</span>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Categoria:</label>
          <select
            value={clientCategoryId}
            onChange={e => {
              setClientCategoryId(e.target.value);
              void patchClient({ category_id: e.target.value || null });
            }}
            className="h-7 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Sem categoria</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Dashboard:</label>
          <select
            value={clientDashType}
            onChange={e => {
              const v = e.target.value as DashboardType;
              setClientDashType(v);
              void patchClient({ dashboard_type: v });
            }}
            className="h-7 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="leads">Leads</option>
            <option value="branding">Branding</option>
            <option value="conversao">Conversão</option>
          </select>
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
      {tab === 'dashboard' && (
        <ClientDashboardTab
          editable={dashboardEditable}
          goalConfig={clientGoal}
          dashboardData={dashboardData}
          todayProgress={todayProgress}
          customBlocks={customBlocks}
          onAddCustomBlock={addCustomBlock}
          onRemoveCustomBlock={removeCustomBlock}
          onEditToggle={() => setDashboardEditable(prev => !prev)}
        />
      )}

      {tab === 'planejamento' && (
        <div className="space-y-5">
          <ClientGoalSettings goal={clientGoal} onChange={setClientGoal} />
          <FunnelTab clientId={id} clientName={client.name} goalConfig={clientGoal} isAdmin={isAdmin} />
        </div>
      )}

      {tab === 'mapa' && <ClientMindMapTab clientId={id} clientName={client.name} />}

      {tab === 'historico' && <HistoricoTab clientId={id} />}

      {tab === 'integracoes' && <ClientIntegrationsTab clientId={id} clientName={client.name} />}

      {tab === 'rastreio' && <ClientTrackingTab clientId={id} />}

      {tab === 'links' && <VaultTab clientId={id} />}

      {tab === 'dna' && <ClientDnaTab clientId={id} clientName={client.name} />}

      {tab === 'pagamentos' && <InvestmentPaymentsTab clientId={id} clientName={client.name} />}

      {tab === 'crm' && <CrmWorkspace lockedClientId={id} embedded />}


      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingStatus === 'Ativo' ? <Power className="h-5 w-5 text-primary" /> : <PowerOff className="h-5 w-5 text-orange-400" />}
              {pendingStatus === 'Ativo' ? 'Ativar cliente' : 'Desativar cliente'}
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-background/60 p-4 text-sm">
            <p className="font-semibold">
              {pendingStatus === 'Ativo' ? 'Ativar' : 'Desativar'} {client.name}?
            </p>
            <p className="mt-2 text-muted-foreground">
              {pendingStatus === 'Ativo'
                ? 'O cliente volta a aparecer na Dashboard, relatórios, pagamentos e demais áreas do sistema.'
                : 'O cliente fica oculto da Dashboard, relatórios, pagamentos e demais áreas do sistema até ser ativado novamente.'}
            </p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="client-status-email">Usuário do sistema</Label>
              <Input
                id="client-status-email"
                value={securityEmail}
                onChange={(event) => setSecurityEmail(event.target.value)}
                placeholder="email do administrador"
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-status-password">Senha</Label>
              <Input
                id="client-status-password"
                type="password"
                value={securityPassword}
                onChange={(event) => setSecurityPassword(event.target.value)}
                placeholder="senha do administrador"
                className="bg-background"
              />
            </div>
            {securityError && <p className="text-xs font-semibold text-destructive">{securityError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={confirmStatusChange}
              disabled={securityLoading || !securityEmail.trim() || !securityPassword}
              className={pendingStatus === 'Ativo' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-orange-500 text-white hover:bg-orange-500/90'}
            >
              {securityLoading ? 'Validando...' : pendingStatus === 'Ativo' ? 'Ativar cliente' : 'Desativar cliente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LinkAccountsDialog
        clientId={id}
        clientName={client.name}
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
      />
    </div>
  );
}
