"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  DndContext, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useSortable, SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import {
  Plus, Search, MoreVertical, Download, Settings2,
  Users, CalendarDays, HeartHandshake, CircleDollarSign,
  ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal,
  AlignJustify, Trash2, Pencil, Sparkles, Clock3, LayoutGrid, List, ArrowUpDown,
  BarChart3, Plug, UserRound, MessageCircle, X, Send, GripVertical, Layers, WifiOff,
} from 'lucide-react';
import { ChatView } from './chat-view';
import { FollowupTab, useActiveFollowups, FollowupBadge } from './followup-tab';
import { useClients } from '@/lib/client-store';
import { ClientAvatar, fetchClientPicture } from '@/components/client-avatar';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import type { Client } from '@/lib/mock-data';

type CrmLead = {
  id: string; client_id: string; mes: string | null; data: string | null;
  link_criativo: string | null; nome: string | null; numero: string | null;
  canal: string | null; origin?: string | null; emoji: string | null;
  dia1: boolean; dia2: boolean; dia3: boolean; dia4: boolean;
  status: string | null; data_agendada: string | null;
  video_dra: boolean; compareceu: boolean; observacao: string | null;
  orcamento: number | string | null; fechou: boolean; valor_rs: number | string | null;
  pagamento: string | null; analise_credito: boolean;
  data_nasc: string | null; bairro: string | null;
  motivacoes: string | null; dores: string | null;
  temperatura?: 'quente' | 'morno' | 'frio' | null;
  temperatura_atualizada_em?: string | null;
  ia_ultimo_analise?: string | null;
  ia_confianca_ultimo?: number | null;
  time_interno?: boolean;
  last_contact_at?: string | null;
  whatsapp_last_message_at?: string | null;
  whatsapp_last_message_text?: string | null;
  whatsapp_last_direction?: 'in' | 'out' | null;
  updated_at?: string | null;
  created_at: string | null;
};

type Draft = Partial<Omit<CrmLead, 'id' | 'client_id' | 'created_at'>>;

type CrmFunnel = { id: string; name: string; created_at: string };
type CrmStage  = { id: string; label: string; color: string; position: number };
type LocalStage = CrmStage & { _isNew?: boolean };

const STAGE_COLORS = [
  '#0ea5e9', '#3b82f6', '#7dd3fc', '#10b981', '#34d399',
  '#a1a1aa', '#71717a', '#f97316', '#ef4444', '#dc2626',
  '#8b5cf6', '#ec4899', '#f59e0b', '#84cc16',
];

const STATUS_OPTIONS = ['Em Atendimento', 'Agendado', 'Reagendado', 'Fechado', 'Comprou', 'Paciente', 'Não Retorna', 'Distante', 'Sem Interesse', 'Desqualificado'];
const CANAL_OPTIONS  = ['Whatsapp', 'Facebook', 'Instagram', 'Google', 'WHATS PRINCIPAL', 'FACHADA', 'Indicação', 'Site', 'TikTok', 'YouTube', 'Outro'];
const PAGAMENTO_OPTIONS = ['Boleto', 'Cartão', 'PIX', 'Dinheiro', 'Financiamento'];

const STATUS_BADGE: Record<string, string> = {
  'Em Atendimento': 'bg-sky-100 text-sky-900',
  'Agendado':       'bg-blue-700 text-white',
  'Reagendado':     'bg-sky-200 text-blue-800',
  'Fechado':         'bg-emerald-700 text-white',
  'Comprou':         'bg-emerald-700 text-white',
  'Paciente':        'bg-zinc-200 text-zinc-800',
  'Não Retorna':    'bg-zinc-700 text-white',
  'Distante':       'bg-orange-500 text-black',
  'Sem Interesse':  'bg-red-700 text-white',
  'Desqualificado': 'bg-red-700 text-white',
};

const STATUS_COLOR: Record<string, string> = {
  'Em Atendimento': 'text-sky-300',
  'Agendado':       'text-blue-400',
  'Reagendado':     'text-sky-300',
  'Fechado':         'text-emerald-400',
  'Comprou':         'text-emerald-400',
  'Paciente':        'text-zinc-300',
  'Não Retorna':    'text-zinc-300',
  'Distante':       'text-orange-400',
  'Sem Interesse':  'text-red-400',
  'Desqualificado': 'text-red-400',
};

const STATUS_KANBAN_COLOR: Record<string, string> = {
  'Em Atendimento': '#0ea5e9',
  'Agendado':       '#3b82f6',
  'Reagendado':     '#7dd3fc',
  'Fechado':        '#10b981',
  'Comprou':        '#34d399',
  'Paciente':       '#a1a1aa',
  'Não Retorna':    '#71717a',
  'Distante':       '#f97316',
  'Sem Interesse':  '#ef4444',
  'Desqualificado': '#dc2626',
};

const TEMPERATURE_LABEL: Record<string, string> = {
  quente: 'Quente',
  morno: 'Morno',
  frio: 'Frio',
};

const TEMPERATURE_BADGE: Record<string, string> = {
  quente: 'border-red-500/30 bg-red-500/15 text-red-300',
  morno: 'border-orange-500/30 bg-orange-500/15 text-orange-300',
  frio: 'border-blue-500/30 bg-blue-500/15 text-blue-300',
};

type ChannelMatch = {
  id: string;
  label: string;
  bg: string;
  icon: React.ReactNode;
  keywords: string[];
};

function IconWhatsapp() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <path fill="currentColor" d="M10 2.4A7.2 7.2 0 0 0 3.8 13.2l-.9 3.3 3.4-.9A7.2 7.2 0 1 0 10 2.4Zm3.9 10.4c-.2.5-1.1.9-1.5 1-.4.1-.9.2-2.8-.6-2.3-1-3.8-3.4-3.9-3.6-.1-.1-.9-1.2-.9-2.3s.6-1.7.8-1.9c.2-.2.4-.3.6-.3h.4c.1 0 .3 0 .4.3.1.3.5 1.3.6 1.4 0 .1.1.3 0 .5l-.3.4c-.1.1-.2.3-.1.4.1.2.5.9 1.1 1.4.8.7 1.4.9 1.6 1 .1.1.3.1.4 0 .1-.2.5-.6.6-.8.2-.2.3-.2.5-.1l1.4.7c.3.1.4.2.5.3.1 0 .1.6-.1 1.1Z" />
    </svg>
  );
}

function IconFacebook() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <path fill="currentColor" d="M11 5H9.6C8.7 5 8 5.7 8 6.6V8H6v2.5h2V17h3v-6.5h2.4L14 8h-3V6.8c0-.4.2-.6.6-.6H14V5h-3Z" />
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="3.2" y="3.2" width="13.6" height="13.6" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14.2" cy="5.8" r="1" fill="currentColor" />
    </svg>
  );
}

function IconGoogleChannel() {
  return <span className="text-[12px] font-black leading-none">G</span>;
}

function IconText({ value }: { value: string }) {
  return <span className="text-[9px] font-black uppercase leading-none">{value}</span>;
}

const CHANNEL_MATCHES: ChannelMatch[] = [
  { id: 'whatsapp',  label: 'WhatsApp',  bg: 'bg-[#25D366]', icon: <IconWhatsapp />,      keywords: ['whatsapp', 'whats', 'zap', 'wpp', 'whats principal'] },
  { id: 'facebook',  label: 'Facebook',  bg: 'bg-[#1877F2]', icon: <IconFacebook />,      keywords: ['facebook', 'face', 'fb'] },
  { id: 'instagram', label: 'Instagram', bg: 'bg-[#E1306C]', icon: <IconInstagram />,     keywords: ['instagram', 'insta', 'ig'] },
  { id: 'google',    label: 'Google',    bg: 'bg-[#4285F4]', icon: <IconGoogleChannel />, keywords: ['google', 'adwords', 'pesquisa', 'gmb', 'google ads'] },
  { id: 'fachada',   label: 'Fachada',   bg: 'bg-slate-500', icon: <IconText value="fc" />, keywords: ['fachada', 'passou em frente', 'frente', 'placa', 'loja'] },
  { id: 'indicacao', label: 'Indicação', bg: 'bg-violet-600', icon: <IconText value="in" />, keywords: ['indicacao', 'indicação', 'indicado', 'recomendacao', 'recomendação'] },
  { id: 'site',      label: 'Site',      bg: 'bg-cyan-600',  icon: <IconText value="www" />, keywords: ['site', 'website', 'landing', 'lp'] },
  { id: 'tiktok',    label: 'TikTok',    bg: 'bg-zinc-900',  icon: <IconText value="tk" />, keywords: ['tiktok', 'tik tok'] },
  { id: 'youtube',   label: 'YouTube',   bg: 'bg-red-600',   icon: <IconText value="yt" />, keywords: ['youtube', 'you tube'] },
];

function freshDraft(): Draft {
  return {
    data: new Date().toISOString().split('T')[0],
    status: 'Em Atendimento',
    dia1: false, dia2: false, dia3: false, dia4: false,
    video_dra: false, compareceu: false, fechou: false, analise_credito: false,
  };
}

function toD(v: string | null | undefined) { return v ? String(v).split('T')[0] : ''; }
function fmtD(v: string | null) {
  const s = toD(v); if (!s) return '';
  const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`;
}
function fmtTime(v: string | null) {
  if (!v) return '';
  try { return new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function toMoneyNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = value
    .trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
function fmtN(v: number | string | null) {
  const value = toMoneyNumber(v);
  return value ? formatCurrencyBRL(value) : '';
}
function plain(v: unknown) { return String(v ?? '').toLowerCase(); }
function normalizeChannelText(v: string) {
  return v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
function detectChannels(value: string | null | undefined) {
  const normalized = normalizeChannelText(value ?? '');
  if (!normalized.trim()) return [];
  return CHANNEL_MATCHES.filter(channel => (
    channel.keywords.some(keyword => normalized.includes(normalizeChannelText(keyword)))
  ));
}
function originLabel(value: string | null | undefined) {
  const normalized = normalizeChannelText(value ?? '');
  if (!normalized) return null;
  if (normalized.includes('meta')) return 'Facebook';
  if (normalized.includes('google')) return 'Google';
  if (normalized.includes('instagram')) return 'Instagram';
  if (normalized.includes('tiktok')) return 'TikTok';
  if (normalized.includes('youtube')) return 'YouTube';
  if (normalized.includes('indicacao')) return 'Indicação';
  if (normalized.includes('organic')) return 'WhatsApp orgânico';
  if (normalized.includes('cliente')) return 'WhatsApp';
  return value;
}
function leadOriginPreview(lead: CrmLead) {
  const sourceText = [lead.canal, originLabel(lead.origin)].filter(Boolean).join(' ');
  const channels = detectChannels(sourceText);
  return {
    label: channels[0]?.label ?? lead.canal ?? originLabel(lead.origin) ?? 'Origem indefinida',
    channels,
  };
}
function inferLeadAiTag(lead: CrmLead) {
  const value = toMoneyNumber(lead.valor_rs);
  const text = normalizeChannelText([
    lead.observacao,
    lead.motivacoes,
    lead.dores,
    lead.pagamento,
    lead.bairro,
  ].filter(Boolean).join(' '));

  if (lead.fechou) return 'Convertido';
  if (value > 0) return 'Orçamento enviado';
  if (lead.data_agendada) return 'Agendamento ativo';
  if (/preco|valor|quanto|orcamento|orçamento|parcel/.test(text)) return 'Sensível a preço';
  if (/dor|incomoda|problema|urgente|preciso|necessito/.test(text)) return 'Dor mapeada';
  if (lead.dia1 || lead.dia2 || lead.dia3 || lead.dia4) return 'Em nutrição';
  if (lead.analise_credito) return 'Análise de crédito';
  return 'IA: qualificar';
}
function dateText(v: string | null) {
  const shortDate = fmtD(v);
  const rawDate = toD(v);
  return `${shortDate} ${rawDate}`.toLowerCase();
}
function moneyText(v: number | string | null) {
  return `${v ?? ''} ${fmtN(v)}`.toLowerCase();
}
function temperatureBadgeClass(value: string | null | undefined) {
  return value ? TEMPERATURE_BADGE[value] ?? 'border-border bg-muted text-muted-foreground' : 'border-border bg-muted text-muted-foreground';
}
function relativeAnalysisTime(iso: string | null | undefined) {
  if (!iso) return 'Nunca analisado';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return 'Nunca analisado';
  const mins = Math.max(0, Math.floor(diff / 60_000));
  if (mins < 1) return 'Última análise agora';
  if (mins < 60) return `Última análise há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Última análise há ${hours}h`;
  return `Última análise há ${Math.floor(hours / 24)}d`;
}

function columnValueText(lead: CrmLead, key: ColumnKey) {
  switch (key) {
    case 'select':
    case 'actions':
      return '';
    case 'data':
    case 'last_contact_at':
    case 'data_agendada':
      return dateText(lead[key] ?? null);
    case 'valor_rs':
    case 'orcamento':
      return moneyText(lead[key]);
    case 'dia1':
    case 'dia2':
    case 'dia3':
    case 'dia4':
    case 'fechou':
      return lead[key] ? 'sim true fechado marcado' : 'nao não false';
    default:
      return plain(lead[key]);
  }
}

function passesColumnFilter(lead: CrmLead, key: ColumnKey, value: string) {
  if (!value) return true;
  if (key === 'temperatura') {
    return value === 'sem' ? !lead.temperatura : lead.temperatura === value;
  }
  if (['dia1', 'dia2', 'dia3', 'dia4', 'fechou'].includes(key)) {
    return value === 'yes' ? Boolean(lead[key as 'fechou']) : !lead[key as 'fechou'];
  }
  return columnValueText(lead, key).includes(value.toLowerCase());
}

function sortValue(lead: CrmLead, key: SortableColumnKey): string | number | boolean | null {
  if (key === 'data' || key === 'data_agendada' || key === 'last_contact_at') {
    const raw = lead[key];
    if (!raw) return null;
    const time = new Date(raw).getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (key === 'valor_rs' || key === 'orcamento') return toMoneyNumber(lead[key]);
  if (key === 'dia1' || key === 'dia2' || key === 'dia3' || key === 'dia4' || key === 'fechou') return Boolean(lead[key]);
  if (key === 'temperatura') {
    const order: Record<string, number> = { quente: 0, morno: 1, frio: 2 };
    return lead.temperatura ? order[lead.temperatura] ?? 3 : 4;
  }
  return columnValueText(lead, key);
}

function compareSortValues(a: string | number | boolean | null, b: string | number | boolean | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

const cell    = 'px-2 py-0 h-9 text-xs focus:outline-none focus:bg-primary/10 bg-transparent border-0 w-full text-foreground placeholder:text-muted-foreground/30';
const cellSel = cn(cell, 'cursor-pointer appearance-none');
const cellNew = 'px-2 py-0 h-9 text-xs focus:outline-none focus:bg-primary/10 bg-transparent border-0 w-full text-foreground placeholder:text-muted-foreground/50';

const COLS = [
  { key: 'select', label: '', width: 44, min: 40, filter: 'none' },
  { key: 'data', label: 'Data', width: 110, min: 96, filter: 'text' },
  { key: 'nome', label: 'Nome', width: 170, min: 120, filter: 'text' },
  { key: 'numero', label: 'Número', width: 120, min: 96, filter: 'text' },
  { key: 'last_contact_at', label: 'Últ. contato', width: 125, min: 110, filter: 'text' },
  { key: 'canal', label: 'Canal', width: 120, min: 90, filter: 'text' },
  { key: 'status', label: 'Status', width: 150, min: 120, filter: 'select' },
  { key: 'temperatura', label: 'Temp.', width: 115, min: 94, filter: 'select' },
  { key: 'dia1', label: '1D', width: 46, min: 40, filter: 'boolean' },
  { key: 'dia2', label: '2D', width: 46, min: 40, filter: 'boolean' },
  { key: 'dia3', label: '3D', width: 46, min: 40, filter: 'boolean' },
  { key: 'dia4', label: '4D', width: 46, min: 40, filter: 'boolean' },
  { key: 'data_agendada', label: 'Data Ag.', width: 110, min: 96, filter: 'text' },
  { key: 'fechou', label: 'Fechou', width: 70, min: 56, filter: 'boolean' },
  { key: 'valor_rs', label: 'Valor R$', width: 130, min: 110, filter: 'text' },
  { key: 'pagamento', label: 'Pagamento', width: 120, min: 100, filter: 'select' },
  { key: 'orcamento', label: 'Orçamento', width: 130, min: 110, filter: 'text' },
  { key: 'observacao', label: 'Observação', width: 240, min: 150, filter: 'text' },
  { key: 'bairro', label: 'Bairro', width: 130, min: 100, filter: 'text' },
  { key: 'actions', label: '', width: 48, min: 44, filter: 'none' },
] as const;
type ColumnKey = typeof COLS[number]['key'];
type ColumnFilterKind = typeof COLS[number]['filter'];
type SortableColumnKey = Exclude<ColumnKey, 'select' | 'actions'>;
type SortDirection = 'asc' | 'desc';

const DEFAULT_COL_WIDTHS = COLS.reduce<Record<ColumnKey, number>>((acc, col) => {
  acc[col.key] = col.width;
  return acc;
}, {} as Record<ColumnKey, number>);
const LOCKED_COLUMNS: ColumnKey[] = ['select', 'data', 'nome', 'numero', 'last_contact_at', 'actions'];
const DEFAULT_VISIBLE_COLUMNS = COLS.map(col => col.key);

// ── Styled select with icon ──────────────────────────────────────────────
function IconSelect({ icon: Icon, value, onChange, placeholder, children, className }: {
  icon: React.ElementType; value: string; onChange: (v: string) => void;
  placeholder?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-8 pr-8 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary w-full"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {children}
      </select>
    </div>
  );
}

const ONMID_GREEN = '#55F52F';

function clientTheme(clientId: string) {
  void clientId;
  return {
    accent: ONMID_GREEN,
    glow: 'rgba(85,245,47,0.14)',
    bg: 'from-emerald-950/35 via-card to-card',
  };
}

// ── Quick Edit Modal (Kanban) ────────────────────────────────────────────────
function QuickEditModal({
  lead, onSave, onClose, onDelete, statusOptions,
}: {
  lead: CrmLead;
  onSave: (data: Draft) => Promise<void>;
  onClose: () => void;
  onDelete: () => void;
  statusOptions: string[];
}) {
  const [draft, setDraft] = useState<Draft>({ ...lead });
  const [saving, setSaving] = useState(false);
  const [aiInfo, setAiInfo] = useState<{ motivo?: string; created_at?: string; confianca?: number } | null>(null);
  const [, setNowTick] = useState(0);
  function set<K extends keyof Draft>(k: K, v: Draft[K]) { setDraft(prev => ({ ...prev, [k]: v })); }

  useEffect(() => {
    fetch(`/api/crm/ai/lead/${lead.id}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { last?: { motivo_ia?: string; created_at?: string; confianca?: number } } | null) => {
        if (data?.last) setAiInfo({
          motivo: data.last.motivo_ia,
          created_at: data.last.created_at,
          confianca: data.last.confianca,
        });
      })
      .catch(() => {});
  }, [lead.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(v => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleSave() {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold">Editar Lead</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nome</span>
              <input type="text" value={draft.nome ?? ''} onChange={e => set('nome', e.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Número</span>
              <input type="text" value={draft.numero ?? ''} onChange={e => set('numero', e.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Canal</span>
              <select value={draft.canal ?? ''} onChange={e => set('canal', e.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">—</option>
                {CANAL_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</span>
              <select value={draft.status ?? ''} onChange={e => set('status', e.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                {statusOptions.map(o => <option key={o}>{o}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Valor (R$)</span>
              <input type="number" step="0.01" value={draft.valor_rs ?? ''}
                onChange={e => set('valor_rs', e.target.value ? parseFloat(e.target.value) : null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Data</span>
              <input type="date" value={toD(draft.data)} onChange={e => set('data', e.target.value || null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
          </div>
          <label className="flex items-center gap-3 cursor-pointer py-1">
            <input type="checkbox" checked={!!draft.fechou} onChange={e => set('fechou', e.target.checked)} className="h-4 w-4 accent-primary" />
            <span className="text-sm font-semibold">Fechou negócio</span>
          </label>
          <div className="rounded-lg border border-border bg-background/50 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Inteligência IA</p>
                <p className="mt-1 text-xs text-muted-foreground">{relativeAnalysisTime(draft.ia_ultimo_analise ?? aiInfo?.created_at)}</p>
              </div>
              <span className={cn('rounded-full border px-2 py-1 text-[10px] font-bold', temperatureBadgeClass(draft.temperatura))}>
                {draft.temperatura ? TEMPERATURE_LABEL[draft.temperatura] : 'Sem classificação'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border/60 bg-card px-2 py-1.5">
                <span className="text-muted-foreground">Confiança</span>
                <p className="font-semibold">{draft.ia_confianca_ultimo ?? aiInfo?.confianca ?? 0}%</p>
              </div>
              <div className="rounded border border-border/60 bg-card px-2 py-1.5">
                <span className="text-muted-foreground">Temperatura</span>
                <p className="font-semibold">{draft.temperatura ? TEMPERATURE_LABEL[draft.temperatura] : 'Não definida'}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Motivo:</span> {aiInfo?.motivo ?? 'Aguardando próxima análise automática.'}
            </p>
            <label className="flex items-start gap-3 rounded border border-border/60 bg-card p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!!draft.time_interno}
                onChange={e => {
                  if (e.target.checked) {
                    const ok = window.confirm('Ao marcar como Time Interno, nenhuma automação será executada para este contato. Tem certeza?');
                    if (!ok) return;
                  }
                  set('time_interno', e.target.checked);
                }}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                <span className="block text-sm font-semibold">Time Interno</span>
                <span className="block text-xs text-muted-foreground">Todas as automações ficam desativadas para este contato</span>
              </span>
            </label>
          </div>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Observação</span>
            <textarea value={draft.observacao ?? ''} onChange={e => set('observacao', e.target.value || null)} rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onDelete} className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Kanban Card (draggable) ──────────────────────────────────────────────────
function KanbanCard({
  lead, onEdit, onDelete, onToggleInternal, isDragOverlay, hasActiveFollowup,
}: {
  lead: CrmLead;
  onEdit: (lead: CrmLead) => void;
  onDelete: (id: string) => void;
  onToggleInternal: (lead: CrmLead) => void;
  isDragOverlay?: boolean;
  hasActiveFollowup?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const channels = detectChannels(lead.canal);
  const origin = leadOriginPreview(lead);
  const aiTag = inferLeadAiTag(lead);
  const value = toMoneyNumber(lead.valor_rs);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={isDragOverlay ? undefined : style}
      {...(isDragOverlay ? {} : { ...attributes, ...listeners })}
      onClick={() => !isDragging && onEdit(lead)}
      className={cn(
        "group relative rounded-lg border border-border bg-card p-3 shadow-sm hover:border-primary/40 hover:shadow-md transition-all cursor-grab select-none",
        isDragging && "opacity-30",
        isDragOverlay && "cursor-grabbing shadow-2xl ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground truncate">{lead.nome ?? '—'}</p>
          {lead.numero && <p className="text-[10px] text-muted-foreground mt-0.5">{lead.numero}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title={lead.time_interno ? 'Remover de time interno' : 'Marcar como time interno'}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onToggleInternal(lead); }}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md border transition-all',
              lead.time_interno
                ? 'border-zinc-400/30 bg-zinc-500/20 text-zinc-200'
                : 'border-transparent text-muted-foreground opacity-0 hover:border-border hover:bg-muted hover:text-foreground group-hover:opacity-100',
            )}
          >
            <UserRound className="h-3.5 w-3.5" />
          </button>
          <div className="relative" ref={menuRef}>
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
              className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-all"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-6 z-50 min-w-[130px] rounded-lg border border-border bg-popover shadow-xl py-1">
                <button onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(lead); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors">
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </button>
                <button onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(lead.id); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-2.5">
        {channels.slice(0, 3).map(ch => (
          <span key={ch.id} className={cn('inline-flex h-5 w-5 items-center justify-center rounded-full text-white ring-1 ring-white/10', ch.bg)}>
            {ch.icon}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          {lead.time_interno && (
            <span className="rounded-full bg-zinc-500/15 px-1.5 py-0.5 text-[9px] font-bold text-zinc-300">Time Interno</span>
          )}
          {lead.temperatura && (
            <span className={cn('rounded-full border px-1.5 py-0.5 text-[9px] font-bold', temperatureBadgeClass(lead.temperatura))}>
              {TEMPERATURE_LABEL[lead.temperatura]}
            </span>
          )}
          <FollowupBadge active={!!hasActiveFollowup} />
          {lead.fechou && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">Fechou</span>
          )}
          {value > 0 && (
            <span className="text-[10px] font-bold text-primary">{fmtN(lead.valor_rs)}</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
        <span className="text-[10px] text-muted-foreground">{fmtD(lead.data ?? lead.created_at)}</span>
        <div className="ml-2 flex min-w-0 flex-wrap items-center justify-end gap-1">
          <span
            className="inline-flex max-w-[110px] items-center gap-1 truncate rounded-full border border-border bg-muted/30 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground"
            title={origin.label}
          >
            {origin.channels[0] && (
              <span className={cn('inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-white', origin.channels[0].bg)}>
                {origin.channels[0].icon}
              </span>
            )}
            <span className="truncate">{origin.label}</span>
          </span>
          <span className="inline-flex max-w-[115px] items-center gap-1 truncate rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary" title={aiTag}>
            <Sparkles className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{aiTag}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Kanban Column (droppable) ────────────────────────────────────────────────
function KanbanColumn({
  status, color, leads, onEdit, onDelete, onToggleInternal, activeLead, activeFollowupIds,
}: {
  status: string;
  color: string;
  leads: CrmLead[];
  onEdit: (lead: CrmLead) => void;
  onDelete: (id: string) => void;
  onToggleInternal: (lead: CrmLead) => void;
  activeLead: CrmLead | null;
  activeFollowupIds: Set<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const total = leads.reduce((s, l) => s + toMoneyNumber(l.valor_rs), 0);

  return (
    <div className="flex flex-col w-[255px] shrink-0">
      <div className="rounded-t-xl border border-b-0 border-border bg-card px-3 py-2.5" style={{ borderTop: `3px solid ${color}` }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-foreground leading-tight">{status}</span>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold leading-none" style={{ background: `${color}25`, color }}>
            {leads.length}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">{total > 0 ? formatCurrencyBRL(total) : 'R$ 0'}</p>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col gap-2 rounded-b-xl border border-t-0 border-border bg-muted/10 p-2 overflow-y-auto transition-colors",
          isOver && "bg-primary/5 border-primary/30",
        )}
        style={{ maxHeight: 'calc(100vh - 400px)', minHeight: 100 }}
      >
        {leads.map(lead => (
          <KanbanCard
            key={lead.id}
            lead={lead}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleInternal={onToggleInternal}
            hasActiveFollowup={activeFollowupIds.has(lead.id)}
          />
        ))}
        {leads.length === 0 && (
          <div className="flex items-center justify-center py-6">
            <p className="text-[10px] text-muted-foreground/40 italic">
              {isOver && activeLead ? 'Soltar aqui' : 'Vazio'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Kanban View ──────────────────────────────────────────────────────────────
function KanbanView({
  leads, stages, onEdit, onDelete, onStatusChange, onToggleInternal, activeFollowupIds,
}: {
  leads: CrmLead[];
  stages: CrmStage[];
  onEdit: (lead: CrmLead) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onToggleInternal: (lead: CrmLead) => void;
  activeFollowupIds: Set<string>;
}) {
  const [activeLead, setActiveLead] = useState<CrmLead | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const statusOptions = stages.map(s => s.label);

  const grouped = useMemo(() => {
    const map = new Map<string, CrmLead[]>();
    stages.forEach(s => map.set(s.label, []));
    leads.forEach(lead => {
      const s = lead.status ?? stages[0]?.label ?? 'Em Atendimento';
      if (map.has(s)) map.get(s)!.push(lead);
      else map.set(s, [lead]);
    });
    return map;
  }, [leads, stages]);

  function handleDragStart(event: DragStartEvent) {
    const lead = leads.find(l => l.id === event.active.id);
    setActiveLead(lead ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const targetStatus = String(over.id);
    if (statusOptions.includes(targetStatus)) {
      onStatusChange(String(active.id), targetStatus);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4 min-h-0 flex-1" style={{ alignItems: 'flex-start' }}>
        {stages.map(stage => (
          <KanbanColumn
            key={stage.label}
            status={stage.label}
            color={stage.color}
            leads={grouped.get(stage.label) ?? []}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleInternal={onToggleInternal}
            activeLead={activeLead}
            activeFollowupIds={activeFollowupIds}
          />
        ))}
      </div>
      <DragOverlay>
        {activeLead && (
          <KanbanCard
            lead={activeLead}
            onEdit={() => {}}
            onDelete={() => {}}
            onToggleInternal={() => {}}
            isDragOverlay
            hasActiveFollowup={activeFollowupIds.has(activeLead.id)}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ── Funnel Editor ────────────────────────────────────────────────────────────

function SortableStageRow({
  stage, onChange, onDelete,
}: {
  stage: LocalStage;
  onChange: (updates: Partial<CrmStage>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const [showColors, setShowColors] = useState(false);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2 py-1.5">
      <button type="button" {...attributes} {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5 shrink-0">
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="relative shrink-0">
        <button type="button" onClick={() => setShowColors(v => !v)}
          className="h-5 w-5 rounded-full border border-border/50 transition-transform hover:scale-110 shrink-0"
          style={{ background: stage.color }} />
        {showColors && (
          <div className="absolute left-0 top-7 z-50 flex flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-xl w-36">
            {STAGE_COLORS.map(c => (
              <button key={c} type="button"
                onClick={() => { onChange({ color: c }); setShowColors(false); }}
                className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 shrink-0"
                style={{ background: c, borderColor: c === stage.color ? 'white' : 'transparent' }}
              />
            ))}
          </div>
        )}
      </div>

      <input
        value={stage.label}
        onChange={e => onChange({ label: e.target.value })}
        className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none focus:bg-primary/5 rounded px-1 py-0.5"
      />

      <button type="button" onClick={onDelete}
        className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors p-0.5">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FunnelEditorModal({
  funnel, stages: initialStages, clientId, funnelCount,
  onSaved, onClose, onDeleteFunnel, onNewFunnel,
}: {
  funnel: CrmFunnel;
  stages: CrmStage[];
  clientId: string;
  funnelCount: number;
  onSaved: (funnel: CrmFunnel, stages: CrmStage[]) => void;
  onClose: () => void;
  onDeleteFunnel: () => void;
  onNewFunnel: () => void;
}) {
  const [name, setName] = useState(funnel.name);
  const [localStages, setLocalStages] = useState<LocalStage[]>(initialStages.map(s => ({ ...s })));
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const editorSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function addStage() {
    setLocalStages(prev => [...prev, {
      id: `_new_${Date.now()}`,
      label: 'Nova Etapa',
      color: '#71717a',
      position: prev.length,
      _isNew: true,
    }]);
  }

  function deleteStage(id: string) {
    if (!id.startsWith('_new_')) setDeletedIds(prev => [...prev, id]);
    setLocalStages(prev => prev.filter(s => s.id !== id));
  }

  function updateStage(id: string, updates: Partial<CrmStage>) {
    setLocalStages(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }

  function handleStageDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = localStages.findIndex(s => s.id === active.id);
    const newIdx = localStages.findIndex(s => s.id === over.id);
    if (oldIdx !== -1 && newIdx !== -1) setLocalStages(prev => arrayMove(prev, oldIdx, newIdx));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const funnelRes = await fetch(`/api/crm/funnels/${funnel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, clientId }),
      });
      const savedFunnel: CrmFunnel = funnelRes.ok ? await funnelRes.json() as CrmFunnel : { ...funnel, name };

      await Promise.all(deletedIds.map(id => fetch(`/api/crm/stages/${id}`, { method: 'DELETE' })));

      const savedStages: CrmStage[] = [];
      for (let i = 0; i < localStages.length; i++) {
        const s = localStages[i];
        if (s._isNew) {
          const res = await fetch(`/api/crm/funnels/${funnel.id}/stages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: s.label, color: s.color, clientId }),
          });
          if (res.ok) savedStages.push(await res.json() as CrmStage);
        } else {
          const res = await fetch(`/api/crm/stages/${s.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: s.label, color: s.color, position: i }),
          });
          savedStages.push(res.ok ? await res.json() as CrmStage : { ...s, position: i });
        }
      }

      onSaved(savedFunnel, savedStages);
    } finally {
      setSaving(false);
    }
  }

  const stageIds = localStages.map(s => s.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Configurar Funil</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nome do funil</span>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapas ({localStages.length})</span>
              <button onClick={addStage}
                className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Adicionar etapa
              </button>
            </div>

            <DndContext sensors={editorSensors} onDragEnd={handleStageDragEnd}>
              <SortableContext items={stageIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {localStages.map(stage => (
                    <SortableStageRow key={stage.id} stage={stage}
                      onChange={u => updateStage(stage.id, u)}
                      onDelete={() => deleteStage(stage.id)} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {localStages.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-6">Nenhuma etapa. Clique em "Adicionar etapa".</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
          <div className="flex gap-2">
            {funnelCount > 1 && (
              <button onClick={onDeleteFunnel}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors">
                <Trash2 className="h-3.5 w-3.5" /> Excluir funil
              </button>
            )}
            <button onClick={onNewFunnel}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
              <Plus className="h-3.5 w-3.5" /> Novo funil
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type TemperatureCriteria = Partial<Record<'quente' | 'morno' | 'frio', string>>;

function AiCriteriaModal({
  clientId,
  onClose,
}: {
  clientId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [useDefault, setUseDefault] = useState(true);
  const [defaults, setDefaults] = useState<TemperatureCriteria>({});
  const [criteria, setCriteria] = useState<TemperatureCriteria>({});

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/ai/criteria?clientId=${encodeURIComponent(clientId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { useDefault?: boolean; defaults?: TemperatureCriteria; custom?: TemperatureCriteria; effective?: TemperatureCriteria } | null) => {
        setUseDefault(data?.useDefault ?? true);
        setDefaults(data?.defaults ?? {});
        setCriteria(data?.useDefault ? data?.effective ?? {} : data?.custom ?? data?.effective ?? {});
      })
      .catch(() => {
        setDefaults({});
        setCriteria({});
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/crm/ai/criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, useDefault, criterios: criteria }),
      });
      if (res.ok) onClose();
    } finally {
      setSaving(false);
    }
  }

  function setCriterion(key: 'quente' | 'morno' | 'frio', value: string) {
    setCriteria(prev => ({ ...prev, [key]: value }));
  }

  const source = useDefault ? defaults : criteria;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Critérios da IA</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <label className="flex items-start gap-3 rounded-lg border border-border bg-background/50 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={useDefault}
              onChange={e => {
                setUseDefault(e.target.checked);
                if (e.target.checked) setCriteria(defaults);
              }}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              <span className="block text-sm font-semibold">Usar critérios globais</span>
              <span className="block text-xs text-muted-foreground">Desmarque para definir a régua de temperatura deste cliente.</span>
            </span>
          </label>

          {loading ? (
            <div className="rounded-lg border border-border bg-background/50 p-6 text-center text-sm text-muted-foreground">Carregando critérios...</div>
          ) : (
            (['quente', 'morno', 'frio'] as const).map(temp => (
              <label key={temp} className="block space-y-1.5">
                <span className={cn('inline-flex rounded-full border px-2 py-1 text-[10px] font-bold', temperatureBadgeClass(temp))}>
                  {TEMPERATURE_LABEL[temp]}
                </span>
                <textarea
                  value={source[temp] ?? ''}
                  onChange={e => setCriterion(temp, e.target.value)}
                  disabled={useDefault}
                  rows={4}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:opacity-70"
                />
              </label>
            ))
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || loading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? 'Salvando...' : 'Salvar critérios'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientLogoBg({ clientId }: { clientId: string }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  useEffect(() => { void fetchClientPicture(clientId).then(setImgUrl); }, [clientId]);
  if (!imgUrl) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
      <img
        src={imgUrl}
        alt=""
        className="absolute right-0 top-1/2 -translate-y-1/2 h-[115%] w-auto object-cover opacity-[0.07] scale-105"
        onError={() => setImgUrl(null)}
      />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.9) 34%, rgba(0,0,0,0.58) 68%, rgba(0,0,0,0.34) 100%)' }} />
    </div>
  );
}

function ClientChoiceCard({
  client,
  recentLabel,
  onOpen,
}: {
  client: Client;
  recentLabel?: string;
  onOpen: () => void;
}) {
  const theme = clientTheme(client.id);
  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-gradient-to-br p-3 transition-all hover:-translate-y-0.5',
        theme.bg,
      )}
      style={{
        borderColor: `${theme.accent}38`,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.025), 0 14px 42px ${theme.glow}`,
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(circle at 88% 8%, ${theme.glow}, transparent 30%)` }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[linear-gradient(120deg,rgba(85,245,47,0.08),transparent_55%)] opacity-60" />
      <ClientLogoBg clientId={client.id} />
      <div className="relative flex justify-between">
        {recentLabel && (
          <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ borderColor: `${theme.accent}55`, color: theme.accent, background: `${theme.accent}14` }}>
            {recentLabel}
          </span>
        )}
        <button type="button" className="ml-auto rounded-lg p-0.5 text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label="Mais opções">
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative mt-8 flex items-center gap-3">
        <div className="rounded-lg border bg-black/25 p-1" style={{ borderColor: `${theme.accent}60` }}>
          <ClientAvatar clientId={client.id} name={client.name} size="md" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-foreground">{client.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{client.segment}</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-bold text-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full', client.status === 'Ativo' ? 'bg-primary' : 'bg-amber-400')} />
          {client.status}
        </span>
      </div>

      <div className="relative mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors hover:bg-white/5"
          style={{ borderColor: `${theme.accent}80`, color: '#fff' }}
        >
          Abrir CRM
          <ChevronRight className="h-3.5 w-3.5" style={{ color: theme.accent }} />
        </button>
        {[
          { icon: UserRound, label: 'Leads' },
          { icon: BarChart3, label: 'Resultados' },
          { icon: Plug, label: 'Integrações' },
          { icon: Pencil, label: 'Editar' },
        ].map(({ icon: Icon, label }) => (
          <button key={label} type="button" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-muted-foreground transition-colors hover:text-foreground" title={label}>
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </article>
  );
}

export default function CrmPage() {
  const { clients } = useClients();
  const activeClients = useMemo(() => clients.filter(c => c.status === 'Ativo'), [clients]);

  const [clientId, setClientId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('crm:last-client') ?? '';
  });
  const [clientSearch, setClientSearch] = useState('');
  const [segmentChoice, setSegmentChoice] = useState('');
  const [clientSort, setClientSort] = useState<'az' | 'za'>('az');
  const [clientView, setClientView] = useState<'grid' | 'list'>('grid');
  const [recentClientIds, setRecentClientIds] = useState<string[]>([]);
  const [chatInstanceStatus, setChatInstanceStatus] = useState<'connected' | 'disconnected' | 'unknown' | 'no_instance' | null>(null);

  // ── Funnels & Stages ──────────────────────────────────────────────────
  const [funnels, setFunnels] = useState<CrmFunnel[]>([]);
  const [selectedFunnelId, setSelectedFunnelId] = useState('');
  const [stages, setStages] = useState<CrmStage[]>([]);
  const [showFunnelEditor, setShowFunnelEditor] = useState(false);
  const [showAiCriteria, setShowAiCriteria] = useState(false);

  const [leads, setLeads]           = useState<CrmLead[]>([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [temperatureFilter, setTemperatureFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColumnKey, string>>>({});
  const [colWidths, setColWidths] = useState<Record<ColumnKey, number>>(DEFAULT_COL_WIDTHS);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<ColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: SortableColumnKey; direction: SortDirection }>({ key: 'data', direction: 'desc' });
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(0);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [menuId, setMenuId]         = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>(() => {
    if (typeof window === 'undefined') return 'kanban';
    return (localStorage.getItem('crm:view-mode') as 'list' | 'kanban' | null) ?? 'kanban';
  });
  const [crmView, setCrmView] = useState<'leads' | 'chat' | 'followup'>(() => {
    if (typeof window === 'undefined') return 'leads';
    const v = localStorage.getItem('crm:tab');
    return (v === 'leads' || v === 'chat' || v === 'followup') ? v : 'leads';
  });
  const [kanbanEditLead, setKanbanEditLead] = useState<CrmLead | null>(null);

  // ── NEW ROW ──────────────────────────────────────────────────────────
  const [newDraft, setNewDraft] = useState<Draft>(freshDraft());
  const newDraftRef = useRef<Draft>(newDraft);
  newDraftRef.current = newDraft;
  const newRowRef   = useRef<HTMLTableRowElement | null>(null);
  const newSavingRef = useRef(false);
  const newPendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── EXISTING EDITING ─────────────────────────────────────────────────
  const [editId, setEditId]     = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>({});
  const editDraftRef = useRef<Draft>(editDraft);
  editDraftRef.current = editDraft;
  const editPendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clientSegments = useMemo(() => (
    Array.from(new Set(activeClients.map(client => client.segment).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  ), [activeClients]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return activeClients
      .filter(client => !segmentChoice || client.segment === segmentChoice)
      .filter(client => !q || client.name.toLowerCase().includes(q) || client.segment.toLowerCase().includes(q))
      .sort((a, b) => clientSort === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
  }, [activeClients, clientSearch, clientSort, segmentChoice]);

  const recentClients = useMemo(() => (
    recentClientIds
      .map(id => activeClients.find(client => client.id === id))
      .filter((client): client is Client => Boolean(client))
      .slice(0, 4)
  ), [activeClients, recentClientIds]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('crm:recent-clients');
      if (stored) setRecentClientIds(JSON.parse(stored) as string[]);
    } catch {
      setRecentClientIds([]);
    }
  }, []);

  // Poll instance status for the Chat tab dot indicator
  useEffect(() => {
    if (!clientId) { setChatInstanceStatus(null); return; }
    function check() {
      fetch(`/api/crm/instance-status?clientId=${clientId}`)
        .then(r => r.json())
        .then((data: { status: string }) => {
          setChatInstanceStatus(data.status as 'connected' | 'disconnected' | 'unknown' | 'no_instance');
        })
        .catch(() => setChatInstanceStatus('unknown'));
    }
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [clientId]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('crm:column-widths');
      if (stored) setColWidths(prev => ({ ...prev, ...(JSON.parse(stored) as Partial<Record<ColumnKey, number>>) }));
    } catch {
      setColWidths(DEFAULT_COL_WIDTHS);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('crm:column-widths', JSON.stringify(colWidths));
    } catch {
      // Browser storage can be unavailable in private mode.
    }
  }, [colWidths]);

  useEffect(() => {
    if (!clientId) {
      setVisibleColumnKeys(DEFAULT_VISIBLE_COLUMNS);
      return;
    }
    try {
      const stored = localStorage.getItem(`crm:visible-columns:${clientId}`);
      if (!stored) {
        setVisibleColumnKeys(DEFAULT_VISIBLE_COLUMNS);
        return;
      }
      const parsed = JSON.parse(stored) as ColumnKey[];
      const allowed = new Set(COLS.map(col => col.key));
      const next = parsed.filter(key => allowed.has(key));
      LOCKED_COLUMNS.forEach(key => {
        if (!next.includes(key)) next.push(key);
      });
      setVisibleColumnKeys(next.length > 0 ? next : DEFAULT_VISIBLE_COLUMNS);
    } catch {
      setVisibleColumnKeys(DEFAULT_VISIBLE_COLUMNS);
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    try {
      localStorage.setItem(`crm:visible-columns:${clientId}`, JSON.stringify(visibleColumnKeys));
    } catch {
      // Browser storage can be unavailable in private mode.
    }
  }, [clientId, visibleColumnKeys]);

  useEffect(() => {
    try { localStorage.setItem('crm:view-mode', viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  useEffect(() => {
    try { if (clientId) localStorage.setItem('crm:last-client', clientId); } catch { /* ignore */ }
  }, [clientId]);

  useEffect(() => {
    try { localStorage.setItem('crm:tab', crmView); } catch { /* ignore */ }
  }, [crmView]);

  function openClientCrm(id: string) {
    setClientId(id);
    try { localStorage.setItem('crm:last-client', id); } catch { /* ignore */ }
    setRecentClientIds(prev => {
      const next = [id, ...prev.filter(item => item !== id)].slice(0, 8);
      localStorage.setItem('crm:recent-clients', JSON.stringify(next));
      return next;
    });
  }

  function refreshLeads(options?: { silent?: boolean }) {
    if (!clientId || !selectedFunnelId) {
      setLeads([]);
      return;
    }
    if (!options?.silent) setLoading(true);
    fetch(`/api/crm?clientId=${clientId}&funnelId=${selectedFunnelId}`)
      .then(r => r.ok ? r.json() as Promise<CrmLead[]> : [])
      .then(data => setLeads(data))
      .catch(() => setLeads([]))
      .finally(() => {
        if (!options?.silent) setLoading(false);
      });
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuId(null);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => { setPage(1); }, [statusFilter, temperatureFilter, search, clientId, columnFilters]);

  useEffect(() => {
    if (!clientId) { setFunnels([]); setSelectedFunnelId(''); setStages([]); return; }
    fetch(`/api/crm/funnels?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<CrmFunnel[]> : [])
      .then(data => { setFunnels(data); if (data[0]) setSelectedFunnelId(data[0].id); })
      .catch(() => setFunnels([]));
  }, [clientId]);

  useEffect(() => {
    if (!selectedFunnelId) { setStages([]); return; }
    fetch(`/api/crm/funnels/${selectedFunnelId}/stages`)
      .then(r => r.ok ? r.json() as Promise<CrmStage[]> : [])
      .then(setStages)
      .catch(() => setStages([]));
  }, [selectedFunnelId]);

  useEffect(() => {
    refreshLeads();
  }, [clientId, selectedFunnelId]);

  useEffect(() => {
    if (crmView !== 'leads') return;
    refreshLeads({ silent: true });
  }, [crmView]);

  useEffect(() => {
    if (!clientId || !selectedFunnelId) return;
    const timer = window.setInterval(() => refreshLeads({ silent: true }), 8_000);
    function onFocus() { refreshLeads({ silent: true }); }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [clientId, selectedFunnelId]);

  function toggleSort(key: ColumnKey) {
    if (key === 'select' || key === 'actions') return;
    setSortConfig(prev => (
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    ));
  }

  function isColumnVisible(key: ColumnKey) {
    return visibleColumnKeys.includes(key);
  }

  function toggleColumnVisibility(key: ColumnKey) {
    if (LOCKED_COLUMNS.includes(key)) return;
    setVisibleColumnKeys(prev => {
      const next = prev.includes(key)
        ? prev.filter(item => item !== key)
        : [...prev, key].sort((a, b) => COLS.findIndex(col => col.key === a) - COLS.findIndex(col => col.key === b));
      setColumnFilters(filters => {
        if (next.includes(key)) return filters;
        const copy = { ...filters };
        delete copy[key];
        return copy;
      });
      return next;
    });
  }

  const visibleCols = useMemo(
    () => COLS.filter(col => visibleColumnKeys.includes(col.key)),
    [visibleColumnKeys],
  );

  const filtered = useMemo(() => leads.filter(l => {
    if (statusFilter && l.status !== statusFilter) return false;
    if (temperatureFilter) {
      if (temperatureFilter === 'sem' && l.temperatura) return false;
      if (temperatureFilter !== 'sem' && l.temperatura !== temperatureFilter) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const found = l.nome?.toLowerCase().includes(q) || l.numero?.includes(q) ||
             l.canal?.toLowerCase().includes(q) || l.bairro?.toLowerCase().includes(q) ||
             l.observacao?.toLowerCase().includes(q) || false;
      if (!found) return false;
    }
    for (const [key, value] of Object.entries(columnFilters) as [ColumnKey, string][]) {
      if (!passesColumnFilter(l, key, value)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (a.time_interno !== b.time_interno) return a.time_interno ? 1 : -1;
    const result = compareSortValues(sortValue(a, sortConfig.key), sortValue(b, sortConfig.key));
    return sortConfig.direction === 'asc' ? result : -result;
  }), [leads, search, statusFilter, temperatureFilter, columnFilters, sortConfig]);

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectedLeads = useMemo(
    () => leads.filter(lead => selectedLeadIds.has(lead.id)),
    [leads, selectedLeadIds],
  );
  const selectedVisibleCount = paginated.filter(lead => selectedLeadIds.has(lead.id)).length;
  const allVisibleSelected = paginated.length > 0 && selectedVisibleCount === paginated.length;
  const kanbanLeads = useMemo(
    () => filtered.filter(lead => lead.time_interno !== true),
    [filtered],
  );
  const tableMinWidth = useMemo(() => visibleCols.reduce((sum, col) => sum + colWidths[col.key], 0), [colWidths, visibleCols]);
  const filteredTotals = useMemo(() => ({
    faturamento: filtered.reduce((sum, lead) => sum + toMoneyNumber(lead.valor_rs), 0),
    orcamento: filtered.reduce((sum, lead) => sum + toMoneyNumber(lead.orcamento), 0),
  }), [filtered]);

  const stats = useMemo(() => ({
    total:       leads.length,
    agendados:   leads.filter(l => l.status === 'Agendado' || l.status === 'Reagendado').length,
    fechamentos: leads.filter(l => l.fechou).length,
    faturamento: leads.filter(l => l.fechou).reduce((s, l) => s + toMoneyNumber(l.valor_rs), 0),
    quentes: leads.filter(l => l.temperatura === 'quente').length,
    mornos: leads.filter(l => l.temperatura === 'morno').length,
    frios: leads.filter(l => l.temperatura === 'frio').length,
    semClassificacao: leads.filter(l => !l.temperatura).length,
  }), [leads]);

  const statusOptions = useMemo(
    () => stages.length > 0 ? stages.map(s => s.label) : STATUS_OPTIONS,
    [stages],
  );

  const selectedFunnel = funnels.find(f => f.id === selectedFunnelId) ?? null;
  const activeFollowupLeadIds = useActiveFollowups(clientId, crmView === 'leads');

  async function handleFunnelSaved(updatedFunnel: CrmFunnel, updatedStages: CrmStage[]) {
    setFunnels(prev => prev.map(f => f.id === updatedFunnel.id ? updatedFunnel : f));
    setStages(updatedStages);
    setShowFunnelEditor(false);
  }

  async function handleNewFunnel() {
    const name = window.prompt('Nome do novo funil:')?.trim();
    if (!name) return;
    const res = await fetch('/api/crm/funnels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name }),
    });
    if (res.ok) {
      const newFunnel = await res.json() as CrmFunnel;
      setFunnels(prev => [...prev, newFunnel]);
      setSelectedFunnelId(newFunnel.id);
      setShowFunnelEditor(false);
    }
  }

  async function handleDeleteFunnel() {
    if (!selectedFunnelId || !window.confirm('Excluir este funil? Os leads serão movidos para o próximo funil.')) return;
    const res = await fetch(`/api/crm/funnels/${selectedFunnelId}`, { method: 'DELETE' });
    if (res.ok) {
      const remaining = funnels.filter(f => f.id !== selectedFunnelId);
      setFunnels(remaining);
      setSelectedFunnelId(remaining[0]?.id ?? '');
      setShowFunnelEditor(false);
    } else {
      const body = await res.json().catch(() => ({})) as { error?: string };
      alert(body.error ?? 'Erro ao excluir funil');
    }
  }

  async function saveNew() {
    if (newSavingRef.current) return;
    const data = newDraftRef.current;
    const hasData = data.nome || data.numero || data.observacao || data.canal || data.bairro || data.valor_rs;
    if (!hasData) { focusNew(); return; }
    newSavingRef.current = true; setSaving(true); setSaveError(null);
    try {
      const res = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, funnel_id: selectedFunnelId || null, ...data }),
      });
      if (res.ok) {
        const saved = await res.json() as CrmLead;
        setLeads(prev => [saved, ...prev]);
        setNewDraft(freshDraft());
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSaveError(body.error ?? `Erro ${res.status}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erro de rede');
    } finally { newSavingRef.current = false; setSaving(false); focusNew(); }
  }

  function handleNewBlur(e: React.FocusEvent<HTMLTableRowElement>) {
    if (newPendingRef.current) clearTimeout(newPendingRef.current);
    newPendingRef.current = setTimeout(() => {
      if (e.currentTarget && !e.currentTarget.contains(document.activeElement)) void saveNew();
    }, 150);
  }
  function handleNewFocus() { if (newPendingRef.current) clearTimeout(newPendingRef.current); }
  function focusNew() {
    setTimeout(() => newRowRef.current?.querySelector<HTMLElement>('input[type="date"]')?.focus(), 30);
  }

  async function saveExisting(id: string) {
    const data = editDraftRef.current; setSaving(true);
    try {
      const res = await fetch(`/api/crm/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const saved = await res.json() as CrmLead;
        setLeads(prev => prev.map(l => l.id === id ? saved : l));
        setEditId(null);
      }
    } finally { setSaving(false); }
  }

  function startEdit(lead: CrmLead) {
    if (editId === lead.id) return;
    if (editId) void saveExisting(editId);
    setEditId(lead.id);
    setEditDraft({ ...lead } as Draft);
  }

  function handleExistingBlur(e: React.FocusEvent<HTMLTableRowElement>, id: string) {
    if (editPendingRef.current) clearTimeout(editPendingRef.current);
    editPendingRef.current = setTimeout(() => {
      if (e.currentTarget && !e.currentTarget.contains(document.activeElement)) void saveExisting(id);
    }, 150);
  }
  function handleExistingFocus() { if (editPendingRef.current) clearTimeout(editPendingRef.current); }

  async function deleteRow(id: string) {
    setMenuId(null);
    const res = await fetch(`/api/crm/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setLeads(prev => prev.filter(l => l.id !== id));
      setSelectedLeadIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (editId === id) setEditId(null);
    }
  }

  async function changeLeadStatus(id: string, status: string) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
    await fetch(`/api/crm/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  }

  function toggleLeadSelection(id: string) {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleVisibleSelection() {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        paginated.forEach(lead => next.delete(lead.id));
      } else {
        paginated.forEach(lead => next.add(lead.id));
      }
      return next;
    });
  }

  function clearLeadSelection() {
    setSelectedLeadIds(new Set());
  }

  async function bulkUpdateSelected(patch: Draft) {
    const targets = selectedLeads;
    if (targets.length === 0) return;
    setLeads(prev => prev.map(lead => selectedLeadIds.has(lead.id) ? { ...lead, ...patch } : lead));

    const results = await Promise.all(
      targets.map(lead =>
        fetch(`/api/crm/${lead.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then(async res => (res.ok ? await res.json() as CrmLead : null)).catch(() => null),
      ),
    );

    const savedById = new Map(results.filter(Boolean).map(lead => [lead!.id, lead!]));
    if (savedById.size > 0) {
      setLeads(prev => prev.map(lead => savedById.get(lead.id) ?? lead));
    }
  }

  async function bulkChangeStatus(status: string) {
    if (!status) return;
    await bulkUpdateSelected({ status });
  }

  async function bulkToggleInternal(nextTimeInterno: boolean) {
    if (nextTimeInterno) {
      const ok = window.confirm('Ao marcar como Time Interno, nenhuma automação será executada para estes contatos. Tem certeza?');
      if (!ok) return;
    }
    await bulkUpdateSelected({ time_interno: nextTimeInterno });
  }

  async function bulkDeleteSelected() {
    const ids = [...selectedLeadIds];
    if (ids.length === 0) return;
    const ok = window.confirm(`Excluir ${ids.length} lead${ids.length !== 1 ? 's' : ''} selecionado${ids.length !== 1 ? 's' : ''}?`);
    if (!ok) return;
    await Promise.all(ids.map(id => fetch(`/api/crm/${id}`, { method: 'DELETE' }).catch(() => null)));
    setLeads(prev => prev.filter(lead => !selectedLeadIds.has(lead.id)));
    setSelectedLeadIds(new Set());
    if (editId && selectedLeadIds.has(editId)) setEditId(null);
  }

  async function toggleLeadInternal(lead: CrmLead) {
    const nextTimeInterno = !lead.time_interno;
    if (nextTimeInterno) {
      const ok = window.confirm('Ao marcar como Time Interno, nenhuma automação será executada para este contato. Tem certeza?');
      if (!ok) return;
    }

    const leadPhone = String(lead.numero ?? '').replace(/\D/g, '');
    const isSameLead = (item: CrmLead) => {
      const itemPhone = String(item.numero ?? '').replace(/\D/g, '');
      return item.id === lead.id || (!!leadPhone && itemPhone === leadPhone);
    };

    setLeads(prev => prev.map(l => isSameLead(l) ? { ...l, time_interno: nextTimeInterno } : l));
    const res = await fetch(`/api/crm/${lead.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_interno: nextTimeInterno }),
    });
    if (res.ok) {
      const saved = await res.json() as CrmLead;
      setLeads(prev => prev.map(l => isSameLead(l) ? { ...l, time_interno: saved.time_interno } : l));
    } else {
      setLeads(prev => prev.map(l => isSameLead(l) ? { ...l, time_interno: lead.time_interno } : l));
    }
  }

  async function saveKanbanEdit(data: Draft) {
    if (!kanbanEditLead) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/${kanbanEditLead.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (res.ok) {
        const saved = await res.json() as CrmLead;
        setLeads(prev => prev.map(l => l.id === kanbanEditLead.id ? saved : l));
        setKanbanEditLead(null);
      }
    } finally { setSaving(false); }
  }

  function onNewBairroKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); void saveNew(); }
  }
  function onNewRowKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void saveNew(); }
  }

  function setN<K extends keyof Draft>(k: K, v: Draft[K]) { setNewDraft(prev => ({ ...prev, [k]: v })); }
  function setE<K extends keyof Draft>(k: K, v: Draft[K]) { setEditDraft(prev => ({ ...prev, [k]: v })); }
  function setColumnFilter(key: ColumnKey, value: string) {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }
  function clearColumnFilters() { setColumnFilters({}); }
  function startColumnResize(key: ColumnKey, min: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[key];
    const onMove = (event: MouseEvent) => {
      const nextWidth = Math.max(min, startWidth + event.clientX - startX);
      setColWidths(prev => ({ ...prev, [key]: nextWidth }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div className="flex flex-col gap-5 h-full overflow-hidden">

      {/* ── PAGE HEADER ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-600/20 border border-violet-500/30">
          {clientId ? <Users className="h-5 w-5 text-violet-400" /> : <Sparkles className="h-5 w-5 text-violet-400" />}
        </div>
        <div>
          <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">
            {clientId ? 'CRM' : 'Escolha um cliente'}
          </h1>
          <p className="text-xs text-muted-foreground">
            {clientId ? 'Gestão de leads e funil de vendas por cliente.' : 'Acesse leads, funil e histórico comercial de forma rápida e organizada.'}
          </p>
        </div>
        {saving    && <span className="ml-2 text-xs font-medium text-amber-400 animate-pulse">Salvando…</span>}
        {saveError && <span className="ml-2 text-xs font-medium text-red-400">Erro: {saveError}</span>}
      </div>

      {!clientId && (
        <div className="space-y-7">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Buscar cliente ou segmento..."
                className="h-12 w-full rounded-[var(--radius)] border border-border bg-card pl-11 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              />
            </div>
            <div className="relative">
              <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <select
                value={segmentChoice}
                onChange={e => setSegmentChoice(e.target.value)}
                className="h-12 min-w-56 appearance-none rounded-[var(--radius)] border border-border bg-card pl-10 pr-10 text-sm font-semibold outline-none transition-colors focus:border-primary"
              >
                <option value="">Todos os segmentos</option>
                {clientSegments.map(segment => <option key={segment} value={segment}>{segment}</option>)}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setClientSort(value => value === 'az' ? 'za' : 'az')}
              className="flex h-12 items-center gap-2 rounded-[var(--radius)] border border-border bg-card px-4 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUpDown className="h-4 w-4" />
              Ordenar: {clientSort === 'az' ? 'A-Z' : 'Z-A'}
            </button>
            <div className="flex h-12 overflow-hidden rounded-[var(--radius)] border border-border bg-card p-1">
              <button
                type="button"
                onClick={() => setClientView('grid')}
                className={cn('flex h-10 w-10 items-center justify-center rounded-lg transition-colors', clientView === 'grid' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setClientView('list')}
                className={cn('flex h-10 w-10 items-center justify-center rounded-lg transition-colors', clientView === 'list' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          {recentClients.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-base font-bold">
                  <Clock3 className="h-5 w-5 text-primary" />
                  Acessados recentemente
                </h2>
                <button type="button" onClick={() => setRecentClientIds([])} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Limpar</button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
                {recentClients.map((client, index) => (
                  <ClientChoiceCard
                    key={client.id}
                    client={client}
                    recentLabel={index === 0 ? 'Acessado agora' : index === 1 ? 'Recente' : 'Histórico'}
                    onOpen={() => openClientCrm(client.id)}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <LayoutGrid className="h-5 w-5 text-primary" />
              Todos os clientes
            </h2>
            {filteredClients.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-border bg-card p-12 text-center text-sm text-muted-foreground">
                Nenhum cliente encontrado com os filtros atuais.
              </div>
            ) : clientView === 'grid' ? (
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
                {filteredClients.map(client => (
                  <ClientChoiceCard key={client.id} client={client} onOpen={() => openClientCrm(client.id)} />
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
                {filteredClients.map(client => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => openClientCrm(client.id)}
                    className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                  >
                    <ClientAvatar clientId={client.id} name={client.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{client.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{client.segment}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-background px-2 py-1 text-[10px] font-bold">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      {client.status}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── FILTERS BAR ─────────────────────────────────────────────── */}
      {clientId && (
      <div className="flex flex-wrap items-center gap-2">
        <IconSelect icon={Users} value={clientId} onChange={openClientCrm}
          placeholder="Selecionar cliente..." className="min-w-[180px]">
          {activeClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </IconSelect>

        {/* Funnel selector */}
        {funnels.length > 0 && (
          <div className="flex items-center gap-1">
            <div className="relative flex items-center">
              <Layers className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
              <select
                value={selectedFunnelId}
                onChange={e => setSelectedFunnelId(e.target.value)}
                className="appearance-none pl-8 pr-8 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setShowFunnelEditor(true)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar funil
            </button>
          </div>
        )}

        {/* Leads / Chat / Follow up toggle */}
        <div className="flex overflow-hidden rounded-lg border border-border bg-card p-0.5">
          <button type="button" onClick={() => setCrmView('leads')}
            className={cn('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              crmView === 'leads' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <Users className="h-3.5 w-3.5" /> Leads
          </button>
          <button type="button" onClick={() => setCrmView('chat')}
            className={cn('relative flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              crmView === 'chat' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <MessageCircle className="h-3.5 w-3.5" /> Chat
            {/* Instance status dot */}
            {clientId && chatInstanceStatus && chatInstanceStatus !== 'connected' && (
              <span
                className={cn(
                  'absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-card',
                  chatInstanceStatus === 'disconnected' || chatInstanceStatus === 'no_instance'
                    ? 'bg-red-500 animate-pulse'
                    : 'bg-amber-400',
                )}
                title={chatInstanceStatus === 'no_instance' ? 'Sem instância configurada' : 'WhatsApp desconectado'}
              />
            )}
            {clientId && chatInstanceStatus === 'connected' && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border border-card" />
            )}
          </button>
          <button type="button" onClick={() => setCrmView('followup')}
            className={cn('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              crmView === 'followup' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <Send className="h-3.5 w-3.5" /> Follow up
          </button>
        </div>

        {clientId && crmView === 'leads' && (
          <>
            <IconSelect icon={SlidersHorizontal} value={statusFilter} onChange={setStatusFilter}
              placeholder="Todos status" className="min-w-[160px]">
              {statusOptions.map(s => <option key={s}>{s}</option>)}
            </IconSelect>

            <IconSelect icon={Sparkles} value={temperatureFilter} onChange={setTemperatureFilter}
              placeholder="Temperatura" className="min-w-[150px]">
              <option value="quente">Quente</option>
              <option value="morno">Morno</option>
              <option value="frio">Frio</option>
              <option value="sem">Sem classificação</option>
            </IconSelect>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar leads..."
                className="pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary w-48" />
            </div>

            <button
              type="button"
              onClick={() => setShowAiCriteria(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Sparkles className="h-4 w-4" /> Critérios IA
            </button>

            <button onClick={() => void saveNew()}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> Novo Lead
            </button>
          </>
        )}
      </div>
      )}

      {/* ── STATS ───────────────────────────────────────────────────── */}
      {clientId && !loading && leads.length > 0 && crmView === 'leads' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8 shrink-0">
          {([
            { label: 'TOTAL',       sub: 'leads cadastrados',   value: stats.total,       fmt: 'n', Icon: Users,             iconCls: 'text-purple-400',  bgCls: 'bg-purple-500/10',  borderCls: 'border-purple-500/25' },
            { label: 'AGENDADOS',   sub: 'leads agendados',     value: stats.agendados,   fmt: 'n', Icon: CalendarDays,       iconCls: 'text-green-400',   bgCls: 'bg-green-500/10',   borderCls: 'border-green-500/25'  },
            { label: 'FECHAMENTOS', sub: 'negócios fechados',   value: stats.fechamentos, fmt: 'n', Icon: HeartHandshake,     iconCls: 'text-blue-400',    bgCls: 'bg-blue-500/10',    borderCls: 'border-blue-500/25'   },
            { label: 'FATURAMENTO', sub: 'valor total faturado',value: stats.faturamento, fmt: 'c', Icon: CircleDollarSign,   iconCls: 'text-violet-400',  bgCls: 'bg-violet-500/10',  borderCls: 'border-violet-500/25' },
            { label: 'QUENTES',     sub: 'alta intenção',       value: stats.quentes,     fmt: 'n', Icon: Sparkles,          iconCls: 'text-red-300',     bgCls: 'bg-red-500/10',     borderCls: 'border-red-500/25'    },
            { label: 'MORNOS',      sub: 'interesse ativo',     value: stats.mornos,      fmt: 'n', Icon: Sparkles,          iconCls: 'text-orange-300',  bgCls: 'bg-orange-500/10',  borderCls: 'border-orange-500/25' },
            { label: 'FRIOS',       sub: 'baixa resposta',      value: stats.frios,       fmt: 'n', Icon: Sparkles,          iconCls: 'text-blue-300',    bgCls: 'bg-blue-500/10',    borderCls: 'border-blue-500/25'   },
            { label: 'SEM IA',      sub: 'sem classificação',   value: stats.semClassificacao, fmt: 'n', Icon: Sparkles,     iconCls: 'text-zinc-300',    bgCls: 'bg-zinc-500/10',    borderCls: 'border-zinc-500/25'   },
          ] as const).map(({ label, sub, value, fmt, Icon, iconCls, bgCls, borderCls }) => (
            <div key={label} className={cn('rounded-xl border bg-card px-4 py-3 flex items-center gap-3', borderCls)}>
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', bgCls)}>
                <Icon className={cn('h-5 w-5', iconCls)} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className="font-heading font-normal text-xl leading-none">{fmt === 'c' ? formatCurrencyBRL(value) : value.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-muted-foreground">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {clientId && loading && crmView === 'leads' && (
        <div className="rounded-[var(--radius)] border border-border bg-card p-12 text-center text-sm text-muted-foreground">Carregando...</div>
      )}

      {/* ── CHAT VIEW ───────────────────────────────────────────────── */}
      {clientId && crmView === 'chat' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatView clientId={clientId} statusOptions={statusOptions} />
        </div>
      )}

      {/* ── FOLLOW UP ───────────────────────────────────────────────── */}
      {clientId && crmView === 'followup' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <FollowupTab clientId={clientId} statusOptions={statusOptions} />
        </div>
      )}

      {/* ── TABLE / KANBAN ──────────────────────────────────────────── */}
      {clientId && !loading && crmView === 'leads' && (
        <div className="flex flex-col flex-1 min-h-0 rounded-[var(--radius)] border border-border bg-card overflow-hidden">

          {/* Table toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              {viewMode === 'list' ? <AlignJustify className="h-4 w-4 text-primary" /> : <LayoutGrid className="h-4 w-4 text-primary" />}
              <span className="text-sm font-semibold">Leads</span>
            </div>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex overflow-hidden rounded-lg border border-border bg-background/60 p-0.5">
                <button type="button" onClick={() => setViewMode('kanban')} title="Kanban"
                  className={cn('flex h-6 w-6 items-center justify-center rounded-md transition-colors', viewMode === 'kanban' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setViewMode('list')} title="Lista"
                  className={cn('flex h-6 w-6 items-center justify-center rounded-md transition-colors', viewMode === 'list' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
              {viewMode === 'list' && (
                <>
                  {Object.keys(columnFilters).length > 0 && (
                    <button type="button" onClick={clearColumnFilters}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                      Limpar filtros
                    </button>
                  )}
                  <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                    <Download className="h-3.5 w-3.5" /> Exportar <ChevronDown className="h-3 w-3" />
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setColumnMenuOpen(open => !open)}
                      title="Editar colunas"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </button>
                    {columnMenuOpen && (
                      <div className="absolute right-0 top-9 z-50 w-64 rounded-xl border border-border bg-popover p-2 shadow-2xl">
                        <div className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Colunas da lista
                        </div>
                        <div className="max-h-72 overflow-y-auto pr-1">
                          {COLS.filter(col => col.key !== 'select' && col.key !== 'actions').map(col => {
                            const locked = LOCKED_COLUMNS.includes(col.key);
                            return (
                              <label key={col.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/60">
                                <input
                                  type="checkbox"
                                  checked={visibleColumnKeys.includes(col.key)}
                                  disabled={locked}
                                  onChange={() => toggleColumnVisibility(col.key)}
                                  className="h-3.5 w-3.5 accent-primary disabled:opacity-50"
                                />
                                <span className={cn('font-medium', locked ? 'text-muted-foreground' : 'text-foreground')}>{col.label}</span>
                                {locked && <span className="ml-auto text-[9px] text-muted-foreground">fixa</span>}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {viewMode === 'list' && selectedLeadIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-primary">
                  {selectedLeadIds.size} selecionado{selectedLeadIds.size !== 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  onClick={clearLeadSelection}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Limpar
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  defaultValue=""
                  onChange={event => {
                    const value = event.target.value;
                    event.target.value = '';
                    if (value) void bulkChangeStatus(value);
                  }}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-semibold text-foreground outline-none focus:border-primary"
                >
                  <option value="">Mudar status</option>
                  {statusOptions.map(status => <option key={status} value={status}>{status}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => void bulkToggleInternal(true)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  Time interno
                </button>
                <button
                  type="button"
                  onClick={() => void bulkToggleInternal(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  Remover interno
                </button>
                <button
                  type="button"
                  onClick={() => void bulkDeleteSelected()}
                  className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"
                >
                  Excluir
                </button>
              </div>
            </div>
          )}

          {/* Kanban view */}
          {viewMode === 'kanban' && (
            <div className="overflow-auto flex-1 min-h-0 p-3">
              <KanbanView
                leads={kanbanLeads}
                stages={stages}
                onEdit={setKanbanEditLead}
                onDelete={id => void deleteRow(id)}
                onStatusChange={(id, status) => void changeLeadStatus(id, status)}
                onToggleInternal={lead => void toggleLeadInternal(lead)}
                activeFollowupIds={activeFollowupLeadIds}
              />
            </div>
          )}

          {/* Scrollable table */}
          {viewMode === 'list' && <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full table-fixed border-collapse text-xs" style={{ minWidth: tableMinWidth }}>
              <colgroup>
                {visibleCols.map(col => (
                  <col key={col.key} style={{ width: colWidths[col.key] }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-card border-b border-border">
                <tr>
                  {visibleCols.map(col => (
                    <th
                      key={col.key}
                      className="relative px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                      style={{ width: colWidths[col.key] }}
                    >
                      {col.key === 'select' ? (
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          disabled={paginated.length === 0}
                          onChange={toggleVisibleSelection}
                          className="h-3.5 w-3.5 accent-primary disabled:opacity-40"
                          title="Selecionar visíveis"
                        />
                      ) : col.key === 'actions' ? null : (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className="inline-flex max-w-full items-center gap-1 text-left font-semibold uppercase tracking-wider hover:text-foreground"
                        >
                          <span className="truncate">{col.label}</span>
                          <ArrowUpDown className={cn(
                            'h-3 w-3 shrink-0',
                            sortConfig.key === col.key ? 'text-primary' : 'text-muted-foreground/45',
                          )} />
                          {sortConfig.key === col.key && (
                            <span className="text-[9px] text-primary">
                              {sortConfig.direction === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </button>
                      )}
                      {col.key !== 'actions' && col.key !== 'select' && (
                        <button
                          type="button"
                          onMouseDown={e => startColumnResize(col.key, col.min, e)}
                          className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none border-r border-transparent transition-colors hover:border-primary/70"
                          aria-label={`Redimensionar coluna ${col.label}`}
                        />
                      )}
                    </th>
                  ))}
                </tr>
                <tr className="border-t border-border/40 bg-card/95">
                  {visibleCols.map(col => (
                    <th key={`${col.key}-filter`} className="px-1.5 pb-2 text-left" style={{ width: colWidths[col.key] }}>
                      <ColumnFilter
                        kind={col.filter}
                        columnKey={col.key}
                        value={columnFilters[col.key] ?? ''}
                        onChange={setColumnFilter}
                        statusOptions={statusOptions}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>

                {/* ── NEW ROW ── */}
                <tr
                  ref={newRowRef}
                  onKeyDown={onNewRowKey}
                  onBlur={handleNewBlur}
                  onFocus={handleNewFocus}
                  className="border-b border-primary/20 bg-primary/5 ring-1 ring-inset ring-primary/20"
                >
                  <Td center />
                  {isColumnVisible('data') && <Td><input type="date" value={toD(newDraft.data)} onChange={e => setN('data', e.target.value || null)} className={cellNew} /></Td>}
                  {isColumnVisible('nome') && <Td><input type="text" value={newDraft.nome ?? ''} onChange={e => setN('nome', e.target.value || null)} placeholder="Nome" className={cn(cellNew, 'text-primary placeholder:text-primary/40 font-semibold')} /></Td>}
                  {isColumnVisible('numero') && <Td><input type="text" value={newDraft.numero ?? ''} onChange={e => setN('numero', e.target.value || null)} placeholder="Número" className={cellNew} /></Td>}
                  {isColumnVisible('last_contact_at') && <Td><span className="px-2 text-[11px] text-muted-foreground">Automático</span></Td>}
                  {isColumnVisible('canal') && <Td>
                    <select value={newDraft.canal ?? ''} onChange={e => setN('canal', e.target.value || null)} className={cn(cellNew, 'cursor-pointer appearance-none')}>
                      <option value=""></option>
                      {CANAL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </Td>}
                  {isColumnVisible('status') && <Td>
                    <select value={newDraft.status ?? ''} onChange={e => setN('status', e.target.value || null)} className={cn(cellNew, 'cursor-pointer appearance-none', STATUS_COLOR[newDraft.status ?? ''] ?? '')}>
                      {statusOptions.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </Td>}
                  {isColumnVisible('temperatura') && <Td>
                    <select value={newDraft.temperatura ?? ''} onChange={e => setN('temperatura', (e.target.value || null) as Draft['temperatura'])} className={cn(cellNew, 'cursor-pointer appearance-none')}>
                      <option value=""></option>
                      <option value="quente">Quente</option>
                      <option value="morno">Morno</option>
                      <option value="frio">Frio</option>
                    </select>
                  </Td>}
                  {(['dia1','dia2','dia3','dia4'] as const).map(k => (
                    isColumnVisible(k) && <Td key={k} center>
                      <input type="checkbox" checked={!!newDraft[k]} onChange={e => setN(k, e.target.checked)} className="h-3.5 w-3.5 accent-primary cursor-pointer" />
                    </Td>
                  ))}
                  {isColumnVisible('data_agendada') && <Td><input type="date" value={toD(newDraft.data_agendada)} onChange={e => setN('data_agendada', e.target.value || null)} className={cellNew} /></Td>}
                  {isColumnVisible('fechou') && <Td center><input type="checkbox" checked={!!newDraft.fechou} onChange={e => setN('fechou', e.target.checked)} className="h-3.5 w-3.5 accent-primary cursor-pointer" /></Td>}
                  {isColumnVisible('valor_rs') && <Td><input type="number" step="0.01" value={newDraft.valor_rs ?? ''} onChange={e => setN('valor_rs', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cn(cellNew, 'text-primary font-semibold')} /></Td>}
                  {isColumnVisible('pagamento') && <Td>
                    <select value={newDraft.pagamento ?? ''} onChange={e => setN('pagamento', e.target.value || null)} className={cn(cellNew, 'cursor-pointer appearance-none')}>
                      <option value=""></option>
                      {PAGAMENTO_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </Td>}
                  {isColumnVisible('orcamento') && <Td><input type="number" step="0.01" value={newDraft.orcamento ?? ''} onChange={e => setN('orcamento', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cellNew} /></Td>}
                  {isColumnVisible('observacao') && <Td><input type="text" value={newDraft.observacao ?? ''} onChange={e => setN('observacao', e.target.value || null)} placeholder="Observação" className={cellNew} /></Td>}
                  {isColumnVisible('bairro') && <Td>
                    <input type="text" value={newDraft.bairro ?? ''} onChange={e => setN('bairro', e.target.value || null)} placeholder="Bairro" className={cellNew} onKeyDown={onNewBairroKey} />
                  </Td>}
                  <Td center />
                </tr>

                {/* ── SAVED LEADS ── */}
                {paginated.map((lead, idx) => {
                  const isEditing = editId === lead.id;
                  const d = isEditing ? editDraft : lead;
                  const channels = detectChannels(lead.canal);
                  const statusBadge = lead.status ? STATUS_BADGE[lead.status] ?? 'bg-zinc-600 text-white' : null;
                  const isSelected = selectedLeadIds.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      tabIndex={-1}
                      onClick={() => !isEditing && startEdit(lead)}
                      onBlur={isEditing ? e => handleExistingBlur(e, lead.id) : undefined}
                      onFocus={isEditing ? handleExistingFocus : undefined}
                      className={cn(
                        'border-b border-border/30 transition-colors group',
                        isEditing
                          ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-500/25'
                          : isSelected
                            ? 'bg-primary/10 ring-1 ring-inset ring-primary/20 hover:bg-primary/15 cursor-pointer'
                            : idx % 2 === 0 ? 'hover:bg-muted/30 cursor-pointer' : 'bg-muted/10 hover:bg-muted/30 cursor-pointer'
                      )}
                    >
                      {/* Seleção */}
                      <Td center>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={e => e.stopPropagation()}
                          onChange={() => toggleLeadSelection(lead.id)}
                          className="h-3.5 w-3.5 accent-primary cursor-pointer"
                        />
                      </Td>
                      {/* Data + hora */}
                      {isColumnVisible('data') && <Td>
                        {isEditing
                          ? <input type="date" value={toD(d.data)} onChange={e => setE('data', e.target.value || null)} className={cell} />
                          : <div className="px-2 py-1">
                              <div className="text-[11px] font-medium text-foreground">{fmtD(lead.data)}</div>
                              <div className="text-[10px] text-muted-foreground">{fmtTime(lead.created_at)}</div>
                            </div>}
                      </Td>}
                      {/* Nome */}
                      {isColumnVisible('nome') && <Td>
                        {isEditing
                          ? <input type="text" value={d.nome ?? ''} onChange={e => setE('nome', e.target.value || null)} placeholder="Nome" className={cell} />
                          : <span className="block truncate px-2 text-xs font-semibold text-primary" title={lead.nome ?? undefined}>{lead.nome ?? '–'}</span>}
                      </Td>}
                      {/* Número */}
                      {isColumnVisible('numero') && <Td>
                        {isEditing
                          ? <input type="text" value={d.numero ?? ''} onChange={e => setE('numero', e.target.value || null)} placeholder="Número" className={cell} />
                          : <span className="px-2 text-muted-foreground text-[11px]">{lead.numero ?? '–'}</span>}
                      </Td>}
                      {/* Último contato */}
                      {isColumnVisible('last_contact_at') && <Td>
                        <div className="px-2 py-1">
                          <div className="text-[11px] font-medium text-foreground">{fmtD(lead.last_contact_at ?? lead.whatsapp_last_message_at ?? lead.updated_at ?? lead.created_at)}</div>
                          <div className="text-[10px] text-muted-foreground">{fmtTime(lead.last_contact_at ?? lead.whatsapp_last_message_at ?? lead.updated_at ?? lead.created_at)}</div>
                        </div>
                      </Td>}
                      {/* Canal */}
                      {isColumnVisible('canal') && <Td>
                        {isEditing
                          ? <select value={d.canal ?? ''} onChange={e => setE('canal', e.target.value || null)} className={cellSel}>
                              <option value=""></option>
                              {d.canal && !CANAL_OPTIONS.includes(String(d.canal)) && <option>{d.canal}</option>}
                              {CANAL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                            </select>
                          : channels.length > 0
                            ? <div className="flex items-center gap-1 px-2" title={lead.canal ?? undefined}>
                                {channels.slice(0, 3).map(channel => (
                                  <span
                                    key={channel.id}
                                    className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white shadow-sm ring-1 ring-white/10', channel.bg)}
                                    title={channel.label}
                                    aria-label={channel.label}
                                  >
                                    {channel.icon}
                                  </span>
                                ))}
                                {channels.length > 3 && (
                                  <span className="text-[10px] font-bold text-muted-foreground">+{channels.length - 3}</span>
                                )}
                              </div>
                            : lead.canal
                              ? <span className="block truncate px-2 text-[11px] font-semibold text-primary" title={lead.canal}>{lead.canal}</span>
                              : <span className="px-2 text-muted-foreground text-[11px]">–</span>}
                      </Td>}
                      {/* Status */}
                      {isColumnVisible('status') && <Td>
                        {isEditing
                          ? <select value={d.status ?? ''} onChange={e => setE('status', e.target.value || null)} className={cn(cellSel, STATUS_COLOR[d.status ?? ''] ?? '')}>
                              {statusOptions.map(o => <option key={o}>{o}</option>)}
                            </select>
                          : statusBadge
                            ? <div className="px-1">
                                <span className={cn('inline-flex items-center rounded-lg px-2.5 py-1 text-[10px] font-bold leading-none shadow-sm whitespace-nowrap', statusBadge)}>
                                  {lead.status}
                                </span>
                              </div>
                            : null}
                      </Td>}
                      {/* Temperatura */}
                      {isColumnVisible('temperatura') && <Td>
                        {isEditing
                          ? <select value={d.temperatura ?? ''} onChange={e => setE('temperatura', (e.target.value || null) as Draft['temperatura'])} className={cellSel}>
                              <option value=""></option>
                              <option value="quente">Quente</option>
                              <option value="morno">Morno</option>
                              <option value="frio">Frio</option>
                            </select>
                          : <div className="flex items-center gap-1 px-1">
                              {lead.temperatura ? (
                                <span className={cn('inline-flex rounded-lg border px-2 py-1 text-[10px] font-bold leading-none whitespace-nowrap', temperatureBadgeClass(lead.temperatura))}>
                                  {TEMPERATURE_LABEL[lead.temperatura]}
                                </span>
                              ) : (
                                <span className="px-1 text-[11px] text-muted-foreground">–</span>
                              )}
                              {lead.time_interno && (
                                <span className="inline-flex rounded-lg border border-zinc-500/25 bg-zinc-500/10 px-1.5 py-1 text-[9px] font-bold leading-none text-zinc-300">
                                  Interno
                                </span>
                              )}
                            </div>}
                      </Td>}
                      {/* 1D–4D */}
                      {(['dia1','dia2','dia3','dia4'] as const).map(k => (
                        isColumnVisible(k) && <Td key={k} center>
                          {isEditing
                            ? <input type="checkbox" checked={!!d[k]} onChange={e => setE(k, e.target.checked)} className="h-3.5 w-3.5 accent-primary cursor-pointer" />
                            : <span
                                onClick={e => { e.stopPropagation(); startEdit(lead); }}
                                className={cn('inline-flex h-4 w-4 items-center justify-center rounded text-[10px] cursor-pointer select-none', lead[k] ? 'bg-primary/20 text-primary font-bold' : 'text-muted-foreground/30')}
                              >
                                {lead[k] ? '✓' : '–'}
                              </span>}
                        </Td>
                      ))}
                      {/* Data Ag. */}
                      {isColumnVisible('data_agendada') && <Td>
                        {isEditing
                          ? <input type="date" value={toD(d.data_agendada)} onChange={e => setE('data_agendada', e.target.value || null)} className={cell} />
                          : <span className="px-2 text-muted-foreground text-[11px]">{fmtD(lead.data_agendada) || '–'}</span>}
                      </Td>}
                      {/* Fechou */}
                      {isColumnVisible('fechou') && <Td center>
                        {isEditing
                          ? <input type="checkbox" checked={!!d.fechou} onChange={e => setE('fechou', e.target.checked)} className="h-3.5 w-3.5 accent-primary cursor-pointer" />
                          : <span
                              onClick={e => { e.stopPropagation(); startEdit(lead); }}
                              className={cn('inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] cursor-pointer font-bold select-none', lead.fechou ? 'bg-green-500 text-white' : 'bg-muted/50 text-muted-foreground/40')}
                            >
                              {lead.fechou ? '✓' : '–'}
                            </span>}
                      </Td>}
                      {/* Valor */}
                      {isColumnVisible('valor_rs') && <Td>
                        {isEditing
                          ? <input type="number" step="0.01" value={d.valor_rs ?? ''} onChange={e => setE('valor_rs', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cn(cell, 'text-primary font-semibold')} />
                          : <span className="px-2 text-muted-foreground text-[11px]">{fmtN(lead.valor_rs) || '0,00'}</span>}
                      </Td>}
                      {/* Pagamento */}
                      {isColumnVisible('pagamento') && <Td>
                        {isEditing
                          ? <select value={d.pagamento ?? ''} onChange={e => setE('pagamento', e.target.value || null)} className={cellSel}>
                              <option value=""></option>
                              {PAGAMENTO_OPTIONS.map(o => <option key={o}>{o}</option>)}
                            </select>
                          : <span className="block truncate px-2 text-[11px] text-muted-foreground" title={lead.pagamento ?? undefined}>{lead.pagamento ?? '–'}</span>}
                      </Td>}
                      {/* Orçamento */}
                      {isColumnVisible('orcamento') && <Td>
                        {isEditing
                          ? <input type="number" step="0.01" value={d.orcamento ?? ''} onChange={e => setE('orcamento', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cell} />
                          : <span className="px-2 text-muted-foreground text-[11px]">{fmtN(lead.orcamento) || '0,00'}</span>}
                      </Td>}
                      {/* Observação */}
                      {isColumnVisible('observacao') && <Td>
                        {isEditing
                          ? <input type="text" value={d.observacao ?? ''} onChange={e => setE('observacao', e.target.value || null)} placeholder="Observação" className={cell} />
                          : <span className="block truncate px-2 text-[11px] text-muted-foreground" title={lead.observacao ?? undefined}>{lead.observacao || 'Observação'}</span>}
                      </Td>}
                      {/* Bairro */}
                      {isColumnVisible('bairro') && <Td>
                        {isEditing
                          ? <input type="text" value={d.bairro ?? ''} onChange={e => setE('bairro', e.target.value || null)} placeholder="Bairro" className={cell} />
                          : <span className="block truncate px-2 text-[11px] text-muted-foreground" title={lead.bairro ?? undefined}>{lead.bairro || 'Bairro'}</span>}
                      </Td>}
                      {/* ⋮ Menu */}
                      <Td center>
                        <div className="relative" ref={menuId === lead.id ? menuRef : undefined}>
                          <button
                            onClick={e => { e.stopPropagation(); setMenuId(menuId === lead.id ? null : lead.id); }}
                            className="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {menuId === lead.id && (
                            <div className="absolute right-0 top-7 z-50 min-w-[130px] rounded-lg border border-border bg-popover shadow-xl py-1">
                              <button
                                onClick={e => { e.stopPropagation(); startEdit(lead); setMenuId(null); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors"
                              >
                                <Pencil className="h-3.5 w-3.5" /> Editar
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); void deleteRow(lead.id); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Excluir
                              </button>
                            </div>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}

          {/* ── PAGINATION ── */}
          {viewMode === 'list' && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-2.5 shrink-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {filtered.length === 0
                  ? 'Nenhum lead'
                  : pageSize === 0
                    ? `Mostrando todos os ${filtered.length} lead${filtered.length !== 1 ? 's' : ''}`
                    : `Mostrando ${(page-1)*pageSize+1} a ${Math.min(page*pageSize, filtered.length)} de ${filtered.length} lead${filtered.length !== 1 ? 's' : ''}`}
              </span>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total faturamento</span>
                <span className="text-xs font-bold text-primary">{formatCurrencyBRL(filteredTotals.faturamento)}</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total orçamento</span>
                <span className="text-xs font-bold text-foreground">{formatCurrencyBRL(filteredTotals.orcamento)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {pageSize !== 0 && (
                <>
                  <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                    className="flex h-7 w-7 items-center justify-center rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="flex h-7 min-w-[28px] items-center justify-center rounded border border-primary bg-primary/10 px-2.5 text-xs font-bold text-primary">{page}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                    className="flex h-7 w-7 items-center justify-center rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
              <div className="relative ml-2">
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="appearance-none rounded border border-border bg-card pl-2 pr-6 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                  <option value={0}>Todos</option>
                  {[25, 50, 100, 250].map(n => <option key={n} value={n}>{n} / página</option>)}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>}
        </div>
      )}

      {kanbanEditLead && (
        <QuickEditModal
          lead={kanbanEditLead}
          onSave={saveKanbanEdit}
          onClose={() => setKanbanEditLead(null)}
          onDelete={() => { void deleteRow(kanbanEditLead.id); setKanbanEditLead(null); }}
          statusOptions={statusOptions}
        />
      )}

      {showFunnelEditor && selectedFunnel && (
        <FunnelEditorModal
          funnel={selectedFunnel}
          stages={stages}
          clientId={clientId}
          funnelCount={funnels.length}
          onSaved={handleFunnelSaved}
          onClose={() => setShowFunnelEditor(false)}
          onDeleteFunnel={handleDeleteFunnel}
          onNewFunnel={handleNewFunnel}
        />
      )}

      {showAiCriteria && clientId && (
        <AiCriteriaModal
          clientId={clientId}
          onClose={() => setShowAiCriteria(false)}
        />
      )}
    </div>
  );
}

function Td({ children, center }: { children?: React.ReactNode; center?: boolean }) {
  return (
    <td className={cn('border-r border-border/20 last:border-0 overflow-hidden', center && 'text-center')}>
      {children}
    </td>
  );
}

function ColumnFilter({
  kind,
  columnKey,
  value,
  onChange,
  statusOptions,
}: {
  kind: ColumnFilterKind;
  columnKey: ColumnKey;
  value: string;
  onChange: (key: ColumnKey, value: string) => void;
  statusOptions: string[];
}) {
  const baseClass = 'h-7 w-full rounded-md border border-border/70 bg-background/70 px-2 text-[10px] font-medium normal-case tracking-normal text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary';

  if (kind === 'none') return <div className="h-7" />;
  if (kind === 'boolean') {
    return (
      <select value={value} onChange={e => onChange(columnKey, e.target.value)} className={cn(baseClass, 'appearance-none')}>
        <option value="">Todos</option>
        <option value="yes">Sim</option>
        <option value="no">Não</option>
      </select>
    );
  }
  if (columnKey === 'status') {
    return (
      <select value={value} onChange={e => onChange(columnKey, e.target.value)} className={cn(baseClass, 'appearance-none')}>
        <option value="">Todos</option>
        {statusOptions.map(option => <option key={option}>{option}</option>)}
      </select>
    );
  }
  if (columnKey === 'temperatura') {
    return (
      <select value={value} onChange={e => onChange(columnKey, e.target.value)} className={cn(baseClass, 'appearance-none')}>
        <option value="">Todos</option>
        <option value="quente">Quente</option>
        <option value="morno">Morno</option>
        <option value="frio">Frio</option>
        <option value="sem">Sem IA</option>
      </select>
    );
  }
  if (columnKey === 'canal') {
    return (
      <select value={value} onChange={e => onChange(columnKey, e.target.value)} className={cn(baseClass, 'appearance-none')}>
        <option value="">Todos</option>
        {CANAL_OPTIONS.map(option => <option key={option}>{option}</option>)}
      </select>
    );
  }
  if (columnKey === 'pagamento') {
    return (
      <select value={value} onChange={e => onChange(columnKey, e.target.value)} className={cn(baseClass, 'appearance-none')}>
        <option value="">Todos</option>
        {PAGAMENTO_OPTIONS.map(option => <option key={option}>{option}</option>)}
      </select>
    );
  }
  return (
    <input
      value={value}
      onChange={e => onChange(columnKey, e.target.value)}
      placeholder="Filtrar"
      className={baseClass}
    />
  );
}
