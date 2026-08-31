"use client";

import { use, useEffect, useRef, useState, type ComponentType, type CSSProperties, type PointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { mockDashboardData, mockClients, type ClientStatus, type DashboardType } from '@/lib/mock-data';
import { useClients } from '@/lib/client-store';
import { normalizeClientName } from '@/lib/client-name';
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
  Store, Settings, Pencil,
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
import { ClientSwitcher } from '@/components/client-switcher';
import { HistoricoTab } from '@/components/historico-tab';
import { VaultTab } from '@/components/vault-tab';
import CrmWorkspace from '@/app/(dashboard)/crm/page';
import { ClientTrackingTab } from './tracking-tab';
import { ClientDemandasTab } from './demandas-tab';
import { ClientReunioesTab } from './reunioes-tab';
import { ClientFidelidadeTab } from './fidelidade-tab';

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

/** Data de HOJE em ISO — o antigo makeDate devolvia maio/2026 fixo (sobra de
 * desenvolvimento) e travava o calendário inteiro naquele mês. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  // Mesma regra da meta: o BANCO manda pra todo mundo — a exceção de admin
  // sobrescrevia o planejamento real com defaults de navegador novo.
  const planningDbLoaded = useRef(false);

  useEffect(() => {
    planningDbLoaded.current = false;
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
        if (dbData) {
          // Banco tem dado → ele manda (admin incluso)
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

  // Redes sociais tem planejamento PRÓPRIO. O bloco padrão é todo construído em
  // cima de venda — TKM, faturamento estimado, ROI, funil de conversão — e nada
  // disso se aplica a uma meta de seguidor e alcance. Mostrar aqueles cards com
  // meta social só produzia frase sem sentido ("Redes sociais necessárias").
  if (goalConfig.type === 'social') {
    const metaSeguidores = goalConfig.target;
    const metaAlcance = goalConfig.targetAlcance ?? 0;
    // ⚠️ Sem denominador o custo é DESCONHECIDO, não zero — vira "—".
    const custoPorSeguidor = metaSeguidores > 0 && invPlaSimple > 0 ? invPlaSimple / metaSeguidores : null;
    const cpmAlcance = metaAlcance > 0 && invPlaSimple > 0 ? invPlaSimple / (metaAlcance / 1000) : null;
    const card = 'bg-card border border-border rounded-xl p-4';
    const rotulo = 'text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2';
    const valor = 'font-heading font-normal text-xl leading-none';

    return (
      <div className="space-y-4 pt-2">
        <p className="text-sm text-muted-foreground">
          Planejamento de <strong className="text-foreground">redes sociais</strong> para{' '}
          <strong className="text-foreground">{clientName}</strong>. As metas ficam nos campos
          acima; aqui entra quanto será investido para alcançá-las.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className={card}>
            <p className={rotulo}>Meta de novos seguidores</p>
            <p className={cn(valor, 'text-foreground')}>
              {metaSeguidores > 0 ? metaSeguidores.toLocaleString('pt-BR') : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {metaSeguidores > 0 ? 'Ganho líquido no período' : 'Sem meta de seguidores'}
            </p>
          </div>
          <div className={card}>
            <p className={rotulo}>Meta de alcance</p>
            <p className={cn(valor, 'text-foreground')}>
              {metaAlcance > 0 ? metaAlcance.toLocaleString('pt-BR') : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {metaAlcance > 0 ? 'Contas alcançadas no período' : 'Sem meta de alcance'}
            </p>
          </div>
          <div className="bg-primary/10 border border-primary/30 rounded-xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-primary mb-2">Inv. planejado</p>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold text-primary/60">R$</span>
              <CurrencyInput
                value={invPlaSimple}
                onChange={setInvPlaSimple}
                className={cn(valor, 'flex-1 min-w-0 text-primary', inputCls)}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Impulsionamento no período</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className={card}>
            <p className={rotulo}>Custo por novo seguidor</p>
            <p className={cn(valor, custoPorSeguidor === null ? 'text-muted-foreground/40' : 'text-primary')}>
              {custoPorSeguidor === null ? '—' : fmtBRL(custoPorSeguidor)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {custoPorSeguidor === null
                ? 'Preencha meta de seguidores e investimento'
                : `${fmtBRL(invPlaSimple)} ÷ ${metaSeguidores.toLocaleString('pt-BR')} seguidores`}
            </p>
          </div>
          <div className={card}>
            <p className={rotulo}>Custo por mil alcançados</p>
            <p className={cn(valor, cpmAlcance === null ? 'text-muted-foreground/40' : 'text-primary')}>
              {cpmAlcance === null ? '—' : fmtBRL(cpmAlcance)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {cpmAlcance === null
                ? 'Preencha meta de alcance e investimento'
                : `${fmtBRL(invPlaSimple)} ÷ ${(metaAlcance / 1000).toLocaleString('pt-BR')} mil`}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground/80">
          O realizado vem do Instagram do cliente pelo Monitor de Redes Sociais e aparece
          no Radar ao lado destas metas.
        </p>
      </div>
    );
  }

  // Sem meta: o planejamento inteiro é derivado da meta, então mostrá-lo aqui
  // renderia "META (SEM META) 0" e "CUSTO POR SEM META" — números que não
  // querem dizer nada. O que sobra a dizer é o que fica valendo.
  if (goalConfig.type === 'none') {
    return (
      <div className="space-y-3 pt-2">
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{clientName}</strong> está marcado como
          {' '}<strong className="text-foreground">sem meta</strong>. Não há planejamento a
          preencher — ele sai do Radar e não é cobrado por nenhum número.
        </p>
        <p className="text-xs text-muted-foreground/80">
          As integrações continuam coletando normalmente: dashboard, CRM, relatórios e
          Monitor de Redes Sociais seguem funcionando. Escolha outro tipo de meta acima
          para voltar a acompanhá-lo no Radar.
        </p>
      </div>
    );
  }

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
              <p className="text-[11px] text-muted-foreground mt-1">
                {tkm > 0 ? 'Valor médio por venda' : 'Sem meta — sai do Radar, fica só como performance'}
              </p>
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
          // Deixar em 0 é uma resposta válida: significa "sem meta". O Radar então
          // para de julgar essa métrica e mostra só o número de performance.

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
            <p className="text-[11px] text-muted-foreground mt-1">
              {value > 0 ? desc : 'Sem meta — sai do Radar, fica só como performance'}
            </p>
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
  // Só LEITURA — a forma de cobrança é editada no modal "Configurar" (fonte única de verdade).
  const [billingMode, setBillingMode] = useState<'prepaid' | 'card'>('prepaid');
  useEffect(() => {
    const stored = localStorage.getItem(`${CLIENT_BILLING_MODE_PREFIX}${clientId}`);
    if (stored === 'card' || stored === 'prepaid') setBillingMode(stored);
    let cancelled = false;
    fetch(`/api/clients/${clientId}/billing-mode`)
      .then(r => r.json())
      .then((data: { mode: 'prepaid' | 'card' }) => { if (!cancelled) setBillingMode(data.mode); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);
  const [newPayment, setNewPayment] = useState<Omit<InvestmentPayment, 'id'>>({
    clientId,
    clientName,
    date: todayISO(),
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
  // Mês NAVEGÁVEL (era fixo em maio/2026 — qualquer Pix fora de maio ficava
  // invisível). Abre no mês atual; ‹ › andam pelo calendário.
  const [calRef, setCalRef] = useState(() => { const d = new Date(); return { ano: d.getFullYear(), mes: d.getMonth() }; });
  const mudarMes = (delta: number) => setCalRef(prev => {
    const d = new Date(prev.ano, prev.mes + delta, 1);
    return { ano: d.getFullYear(), mes: d.getMonth() };
  });
  const tituloMes = new Date(calRef.ano, calRef.mes, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const weeks = getBusinessWeeks(calRef.ano, calRef.mes);

  function addPayment() {
    if (!newPayment.destination.trim() || newPayment.amount <= 0) return;

    addSharedPayment({ ...newPayment, destination: newPayment.destination.trim() });
    setNewPayment((prev) => ({ ...prev, destination: `${clientName} - Novo investimento`, amount: 500 }));
  }

  return (
    <div className="space-y-5 pt-1">
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-border bg-card/50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <WalletCards className="w-4 h-4 text-primary" />
          <span>Forma de cobrança dos anúncios:</span>
          <span className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            billingMode === 'card'
              ? 'border-secondary/40 bg-secondary/10 text-secondary'
              : 'border-primary/30 bg-primary/10 text-primary',
          )}>
            {billingMode === 'card' ? 'Cartão / faturado' : 'Pré-pago / saldo'}
          </span>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/80">
          <Settings className="w-3 h-3" /> Editar em Configurar
        </span>
      </div>

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
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card px-1 py-0.5">
              <button type="button" onClick={() => mudarMes(-1)} className="rounded-md px-2 py-1 text-xs font-bold text-muted-foreground hover:text-foreground" aria-label="Mês anterior">‹</button>
              <span className="min-w-[130px] text-center text-xs font-bold capitalize">{tituloMes}</span>
              <button type="button" onClick={() => mudarMes(1)} className="rounded-md px-2 py-1 text-xs font-bold text-muted-foreground hover:text-foreground" aria-label="Próximo mês">›</button>
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

// 'social'  → meta de redes sociais: `target` = novos seguidores, `targetAlcance` = alcance.
// 'none'    → o cliente declaradamente NÃO tem meta; sai do Radar por inteiro.
type ClientGoalType = 'revenue' | 'leads' | 'enrollments' | 'social' | 'none';
type ClientGoalConfig = {
  type: ClientGoalType;
  label: string;
  target: number;
  partial: number;
  realized: number;
  format: 'currency' | 'number';
  /** Só usado em `type: 'social'` — a meta de alcance no período. */
  targetAlcance?: number;
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
  { type: 'social', label: 'Redes sociais', format: 'number' },
  { type: 'none', label: 'Sem meta', format: 'number' },
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
      targetAlcance: Number(parsed.targetAlcance ?? 0) || 0,
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

function ClientGoalSettings({ goal, onChange }: {
  goal: ClientGoalConfig;
  onChange: (goal: ClientGoalConfig) => void;
}) {
  function handleTypeChange(type: ClientGoalType) {
    const option = GOAL_TYPE_OPTIONS.find((o) => o.type === type)!;
    // "Sem meta" zera os alvos — deixar número parado atrás do botão faria o
    // cliente voltar cobrado ao trocar de tipo, sem ninguém ter digitado nada.
    const target = type === 'none' ? 0 : goal.target;
    const targetAlcance = type === 'none' ? 0 : goal.targetAlcance;
    onChange({ ...goal, type, label: option.label, format: option.format, target, targetAlcance, partial: autoPartial(target) });
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
      {goal.type === 'none' ? (
        <p className="pb-2 text-xs text-muted-foreground">
          Sem meta — este cliente sai do Radar.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {goal.type === 'social' ? 'Novos seguidores' : 'Meta'}
            </Label>
            <Input
              type="number"
              value={goal.target || ''}
              onChange={(e) => handleTargetChange(Number(e.target.value))}
              className="bg-background w-44"
              placeholder="0"
            />
          </div>
          {/* Redes sociais é a única meta com DOIS números — seguidores e alcance
              medem coisas diferentes e nenhum dos dois é derivável do outro. */}
          {goal.type === 'social' && (
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Alcance</Label>
              <Input
                type="number"
                value={goal.targetAlcance || ''}
                onChange={(e) => onChange({ ...goal, targetAlcance: Number(e.target.value) })}
                className="bg-background w-44"
                placeholder="0"
              />
            </div>
          )}
        </>
      )}
      {goal.type === 'social' && (
        <p className="w-full text-[11px] text-muted-foreground">
          Medido no Instagram do cliente pelo Monitor de Redes Sociais (janela de 28 dias).
          Deixe um dos dois em branco para não cobrar aquele número.
        </p>
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

function ClientIntegrationsTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { getConnection, getClientAccounts, getClientMetrics } = useMetaAdsConnections();
  const googleAds = useGoogleAds();
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);
  const [googleDialogOpen, setGoogleDialogOpen] = useState(false);
  const [billingMode, setBillingMode] = useState<'prepaid' | 'card'>('prepaid');
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

  function updateBillingMode(next: 'prepaid' | 'card') {
    setBillingMode(next);
    localStorage.setItem(`${CLIENT_BILLING_MODE_PREFIX}${clientId}`, next);
    fetch(`/api/clients/${clientId}/billing-mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    }).catch(() => {});
  }

  return (
    <>
      <Card className="mb-4 border-border bg-card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
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
            <div className="flex shrink-0 self-start rounded-xl border border-border bg-background p-1">
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

// Modal único de configuração do cliente — junta tudo que é setup (conexões, cobrança,
// e Links & Senhas). O Anota Aí saiu daqui (2026-08-21): delivery configura-se na
// aba Integrações → Delivery, um lugar só.
function ClientConfigModal({ open, onClose, clientId, clientName }: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            Configurar cliente
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {clientName} — conexões, forma de cobrança e senhas. Delivery (Cardápio Web/Anota Aí) configura-se na aba Integrações.
          </p>
        </DialogHeader>
        {open && (
          <div className="space-y-6 pt-2">
            <ClientIntegrationsTab clientId={clientId} clientName={clientName} />
            <div>
              <div className="mb-3 flex items-center gap-2">
                <BookMarked className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Links &amp; Senhas</h3>
              </div>
              <VaultTab clientId={clientId} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

// ── Page ───────────────────────────────────────────────────────────────────────
const TABS = ['planejamento', 'demandas', 'reunioes', 'crm', 'rastreio', 'pagamentos', 'fidelidade', 'historico'] as const;
type Tab = typeof TABS[number];
// Todas as abas visíveis direto na barra — o menu "Mais" morreu em 2026-08-21
// (pedido do Matheus): Landing Pages virou "Mapa de Calor" dentro da aba
// Integrações, DNA e Mapa Mental saíram, e Histórico subiu pra barra.
// `fidelidade` entra condicionalmente (só cliente com o interruptor ligado).
const PRIMARY_TABS: Tab[] = ['planejamento', 'demandas', 'reunioes', 'crm', 'rastreio', 'pagamentos'];

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

  // Deep-link `?tab=` (ex.: o card de delivery do dashboard aponta pra
  // /clientes/{id}?tab=delivery). Lido uma vez no mount; inválido → default.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'planejamento';
    const t = new URLSearchParams(window.location.search).get('tab');
    // Delivery e Landing Pages viraram sub-abas da Integrações (2026-08-21) —
    // links antigos caem no lugar novo, não no default.
    if (t === 'delivery' || t === 'lps') return 'rastreio';
    return TABS.includes(t as Tab) ? (t as Tab) : 'planejamento';
  });
  const [configOpen, setConfigOpen] = useState(false);
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
  const [clientFonteTopo, setClientFonteTopo] = useState<'auto' | 'crm' | 'anuncios'>(storedClient?.funil_fonte_topo ?? 'auto');
  // Opt-in: ausente = desligada. A aba Fidelidade só existe na barra quando
  // ligada, e o servidor confere de novo (esconder aqui é só apresentação).
  const [clientFidelidade, setClientFidelidade] = useState<boolean>(storedClient?.fidelidade_ativa === true);
  const [editingName, setEditingName]     = useState(false);
  const [nameDraft, setNameDraft]         = useState('');
  const [nameError, setNameError]         = useState('');
  const [savingName, setSavingName]       = useState(false);
  // Sobrescreve o nome exibido assim que salva, sem esperar o refetch de
  // /api/clients (mesmo padrão otimista do clientCategoryId acima).
  const [nameOverride, setNameOverride]   = useState<string | null>(null);
  const displayName = nameOverride ?? client.name;

  useEffect(() => {
    fetch('/api/clients/categories').then(r => r.ok ? r.json() : []).then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    setClientCategoryId(storedClient?.category_id ?? '');
    setClientDashType(storedClient?.dashboard_type ?? 'leads');
    setClientFonteTopo(storedClient?.funil_fonte_topo ?? 'auto');
    setClientFidelidade(storedClient?.fidelidade_ativa === true);
  }, [storedClient?.category_id, storedClient?.dashboard_type, storedClient?.funil_fonte_topo,
      storedClient?.fidelidade_ativa]);


  async function patchClient(patch: Record<string, unknown>) {
    await fetch(`/api/clients?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    window.dispatchEvent(new Event('clients-updated'));
  }

  function startEditingName() {
    setNameDraft(displayName);
    setNameError('');
    setEditingName(true);
  }

  function cancelEditingName() {
    setEditingName(false);
    setNameError('');
  }

  async function saveClientName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) { setNameError('O nome não pode ficar vazio.'); return; }
    if (trimmed === displayName) { setEditingName(false); return; }

    const alvo = normalizeClientName(trimmed);
    const colide = allClients.some(c => c.id !== id && normalizeClientName(c.name) === alvo);
    if (colide) {
      setNameError('Já existe outro cliente com esse nome (ou muito parecido) — a automação de reuniões via ClickUp não consegue distinguir os dois.');
      return;
    }

    setSavingName(true);
    try {
      await patchClient({ name: trimmed });
      setNameOverride(trimmed);
      setEditingName(false);
    } finally {
      setSavingName(false);
    }
  }

  const [clientGoal, setClientGoal] = useState<ClientGoalConfig>(() =>
    readSavedClientGoal(id, isNewClient ? ZERO_CLIENT_GOAL : DEFAULT_CLIENT_GOAL)
  );
  const [clientGoalLoadedFor, setClientGoalLoadedFor] = useState(id);
  // ⚠️ O BANCO é a autoridade para TODO MUNDO. A regra antiga ("admin:
  // localStorage vence") fazia um admin em navegador novo (localStorage vazio)
  // empurrar o DEFAULT por cima da meta real do banco — sem nenhum clique.
  // localStorage só vale enquanto o GET não respondeu, ou quando o banco está
  // vazio (primeiro cadastro).
  const goalDbLoaded = useRef(false);

  useEffect(() => {
    goalDbLoaded.current = false;
    let cancelled = false;
    setClientGoal(readSavedClientGoal(id, isNewClient ? ZERO_CLIENT_GOAL : DEFAULT_CLIENT_GOAL));
    setClientGoalLoadedFor(id);
    fetch(`/api/clients/${id}/goal`)
      .then(r => r.json())
      .then((dbData: Partial<ClientGoalConfig> | null) => {
        if (cancelled) return;
        if (dbData?.type) {
          // Banco tem dado → ele manda (admin incluso)
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
    planejamento: 'Planejamento',
    demandas:     'Demandas',
    reunioes:     'Reuniões',
    historico:    'Histórico',
    rastreio:     'Integrações',
    pagamentos:   'Pagamentos',
    crm:          'CRM',
    fidelidade:   'Fidelidade',
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
          <ClientSwitcher currentId={id} currentName={displayName} tab={tab} />
          <div>
            <div className="px-2 py-0.5 rounded text-[10px] font-bold tracking-widest bg-primary/20 text-primary border border-primary/30 uppercase w-fit mb-2">
              {client.status}
            </div>
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={e => { setNameDraft(e.target.value); if (nameError) setNameError(''); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void saveClientName();
                    if (e.key === 'Escape') cancelEditingName();
                  }}
                  disabled={savingName}
                  className="max-w-[260px] rounded border border-primary/50 bg-background px-2 py-0.5 font-heading text-xl font-normal uppercase leading-none tracking-wide text-foreground outline-none focus:border-primary disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void saveClientName()}
                  disabled={savingName}
                  title="Salvar"
                  className="rounded p-1 text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={cancelEditingName}
                  disabled={savingName}
                  title="Cancelar"
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="group flex items-center gap-1.5">
                <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">{displayName}</h1>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={startEditingName}
                    title="Editar nome do cliente"
                    className="rounded p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            {nameError && <p className="mt-1 max-w-xs text-xs text-red-400">{nameError}</p>}
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
          <Button
            variant="outline"
            className="border-border h-9 text-xs font-bold uppercase tracking-wider gap-2"
            onClick={() => setConfigOpen(true)}
          >
            <Settings className="w-4 h-4 text-primary" />
            Configurar
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
                <option value="food">Food / Delivery</option>
                <option value="clinicas">Clínicas</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground" title="O que conta como Contatos no topo do Funil de Performance do dashboard">
            Topo do funil:
          </label>
          <select
            value={clientFonteTopo}
            onChange={e => {
              const v = e.target.value as 'auto' | 'crm' | 'anuncios';
              setClientFonteTopo(v);
              void patchClient({ funil_fonte_topo: v });
            }}
            className="h-7 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="auto">Automático (CRM se houver)</option>
            <option value="crm">Sempre CRM/planilha</option>
            <option value="anuncios">Sempre anúncios</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label
            className="text-xs text-muted-foreground"
            title="Campanhas automáticas de recompra pelo WhatsApp do cliente. Deixe desativada quando o cardápio digital dele já faz isso por dentro."
          >
            Fidelidade:
          </label>
          <button
            onClick={() => {
              const v = !clientFidelidade;
              setClientFidelidade(v);
              void patchClient({ fidelidade_ativa: v });
              // Desligar com a aba aberta deixaria a tela pendurada num cliente
              // que não tem mais Fidelidade — volta pro planejamento.
              if (!v && tab === 'fidelidade') setTab('planejamento');
            }}
            className={cn(
              'h-7 rounded-lg border px-2 text-xs font-bold uppercase tracking-wider transition-colors',
              clientFidelidade
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {clientFidelidade ? 'Ativa' : 'Desativada'}
          </button>
        </div>
      </div>

      {/* Tabs nav */}
      <div className="flex gap-1 bg-card border border-border p-1 rounded-xl w-fit flex-wrap">
        {[...PRIMARY_TABS, ...(clientFidelidade ? (['fidelidade'] as Tab[]) : []), 'historico' as Tab].map((t) => (
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
          <FunnelTab clientId={id} clientName={client.name} goalConfig={clientGoal} isAdmin={isAdmin} />
        </div>
      )}

      {tab === 'demandas' && <ClientDemandasTab clientId={id} />}
      {tab === 'reunioes' && <ClientReunioesTab clientId={id} />}
      {tab === 'fidelidade' && <ClientFidelidadeTab clientId={id} />}

      {tab === 'historico' && <HistoricoTab clientId={id} />}

      {tab === 'rastreio' && <ClientTrackingTab clientId={id} />}

      {tab === 'pagamentos' && <InvestmentPaymentsTab clientId={id} clientName={client.name} />}

      {tab === 'crm' && <CrmWorkspace lockedClientId={id} embedded />}

      <ClientConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        clientId={id}
        clientName={client.name}
      />


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
