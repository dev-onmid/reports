"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Search, MoreVertical, Download, Settings2,
  Users, CalendarDays, HeartHandshake, CircleDollarSign,
  ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal,
  AlignJustify, Trash2, Pencil, Sparkles, Clock3, LayoutGrid, List, ArrowUpDown,
  BarChart3, Plug, UserRound,
} from 'lucide-react';
import { useClients } from '@/lib/client-store';
import { ClientAvatar, fetchClientPicture } from '@/components/client-avatar';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import type { Client } from '@/lib/mock-data';

type CrmLead = {
  id: string; client_id: string; mes: string | null; data: string | null;
  link_criativo: string | null; nome: string | null; numero: string | null;
  canal: string | null; emoji: string | null;
  dia1: boolean; dia2: boolean; dia3: boolean; dia4: boolean;
  status: string | null; data_agendada: string | null;
  video_dra: boolean; compareceu: boolean; observacao: string | null;
  orcamento: number | null; fechou: boolean; valor_rs: number | null;
  pagamento: string | null; analise_credito: boolean;
  data_nasc: string | null; bairro: string | null;
  motivacoes: string | null; dores: string | null;
  created_at: string | null;
};

type Draft = Partial<Omit<CrmLead, 'id' | 'client_id' | 'created_at'>>;

const STATUS_OPTIONS = ['Em Atendimento', 'Agendado', 'Reagendado', 'Não Retorna', 'Distante', 'Sem Interesse', 'Desqualificado'];
const CANAL_OPTIONS  = ['Facebook', 'Instagram', 'Google', 'WHATS PRINCIPAL', 'FACHADA', 'Outro'];
const PAGAMENTO_OPTIONS = ['Boleto', 'Cartão', 'PIX', 'Dinheiro', 'Financiamento'];

const STATUS_BADGE: Record<string, { pill: string; dot: string }> = {
  'Em Atendimento': { pill: 'bg-blue-500/15 text-blue-400 border border-blue-500/25',   dot: 'bg-blue-400' },
  'Agendado':       { pill: 'bg-amber-500/15 text-amber-400 border border-amber-500/25', dot: 'bg-amber-400' },
  'Reagendado':     { pill: 'bg-orange-500/15 text-orange-400 border border-orange-500/25', dot: 'bg-orange-400' },
  'Não Retorna':    { pill: 'bg-gray-500/15 text-gray-400 border border-gray-500/25',    dot: 'bg-gray-400' },
  'Distante':       { pill: 'bg-gray-500/15 text-gray-400 border border-gray-500/25',    dot: 'bg-gray-400' },
  'Sem Interesse':  { pill: 'bg-red-500/15 text-red-400 border border-red-500/25',       dot: 'bg-red-400' },
  'Desqualificado': { pill: 'bg-red-500/15 text-red-400 border border-red-500/25',       dot: 'bg-red-400' },
};

const STATUS_COLOR: Record<string, string> = {
  'Em Atendimento': 'text-blue-400',
  'Agendado':       'text-amber-400',
  'Reagendado':     'text-orange-400',
  'Não Retorna':    'text-gray-400',
  'Distante':       'text-gray-400',
  'Sem Interesse':  'text-red-400',
  'Desqualificado': 'text-red-400',
};

const CANAL_BADGE: Record<string, { bg: string; short: string }> = {
  'Facebook':        { bg: 'bg-[#1877F2]', short: 'fb' },
  'Instagram':       { bg: 'bg-pink-600',  short: 'ig' },
  'Google':          { bg: 'bg-red-500',   short: 'G'  },
  'WHATS PRINCIPAL': { bg: 'bg-green-600', short: 'wp' },
  'FACHADA':         { bg: 'bg-slate-500', short: 'fc' },
  'Outro':           { bg: 'bg-purple-600',short: '?'  },
};

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
function fmtN(v: number | null) { return v ? formatCurrencyBRL(v) : ''; }

const cell    = 'px-2 py-0 h-9 text-xs focus:outline-none focus:bg-primary/10 bg-transparent border-0 w-full text-foreground placeholder:text-muted-foreground/30';
const cellSel = cn(cell, 'cursor-pointer appearance-none');
const cellNew = 'px-2 py-0 h-9 text-xs focus:outline-none focus:bg-primary/10 bg-transparent border-0 w-full text-foreground placeholder:text-muted-foreground/50';

const COLS: [string, string][] = [
  ['Data','w-[110px]'],['Nome','w-36'],['Número','w-28'],['Canal','w-16'],
  ['Status','w-36'],
  ['1D','w-8'],['2D','w-8'],['3D','w-8'],['4D','w-8'],
  ['Data Ag.','w-[110px]'],['Fechou','w-12'],['Valor R$','w-28'],
  ['Pagamento','w-24'],['Orçamento','w-24'],['Observação','w-44'],['Bairro','w-24'],['','w-8'],
];

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

const CLIENT_CARD_THEMES = [
  { accent: '#A855F7', glow: 'rgba(168,85,247,0.28)', bg: 'from-violet-950/70 via-card to-card' },
  { accent: '#22D3EE', glow: 'rgba(34,211,238,0.22)', bg: 'from-cyan-950/55 via-card to-card' },
  { accent: '#55F52F', glow: 'rgba(85,245,47,0.18)', bg: 'from-emerald-950/55 via-card to-card' },
  { accent: '#F59E0B', glow: 'rgba(245,158,11,0.22)', bg: 'from-amber-950/60 via-card to-card' },
  { accent: '#38BDF8', glow: 'rgba(56,189,248,0.20)', bg: 'from-sky-950/55 via-card to-card' },
  { accent: '#EC4899', glow: 'rgba(236,72,153,0.20)', bg: 'from-pink-950/55 via-card to-card' },
];

function clientTheme(clientId: string) {
  let hash = 0;
  for (const c of clientId) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return CLIENT_CARD_THEMES[hash % CLIENT_CARD_THEMES.length];
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
        className="absolute right-0 top-1/2 -translate-y-1/2 h-[120%] w-auto object-cover opacity-[0.09] scale-110"
        onError={() => setImgUrl(null)}
      />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.92) 30%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.25) 100%)' }} />
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
        'group relative overflow-hidden rounded-xl border bg-gradient-to-br p-4 transition-all hover:-translate-y-0.5',
        theme.bg,
      )}
      style={{
        borderColor: `${theme.accent}45`,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.03), 0 22px 70px ${theme.glow}`,
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-80" style={{ background: `radial-gradient(circle at 88% 8%, ${theme.glow}, transparent 34%)` }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(120deg,rgba(255,255,255,0.10),transparent_55%)] opacity-50" />
      <ClientLogoBg clientId={client.id} />
      <div className="relative flex justify-between">
        {recentLabel && (
          <span className="rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider" style={{ borderColor: `${theme.accent}55`, color: theme.accent, background: `${theme.accent}18` }}>
            {recentLabel}
          </span>
        )}
        <button type="button" className="ml-auto rounded-lg p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label="Mais opções">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      <div className="relative mt-12 flex items-center gap-4">
        <div className="rounded-xl border bg-black/25 p-1.5" style={{ borderColor: `${theme.accent}70` }}>
          <ClientAvatar clientId={client.id} name={client.name} size="lg" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-foreground">{client.name}</h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{client.segment}</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-bold text-foreground">
          <span className={cn('h-2 w-2 rounded-full', client.status === 'Ativo' ? 'bg-primary' : 'bg-amber-400')} />
          {client.status}
        </span>
      </div>

      <div className="relative mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition-colors hover:bg-white/5"
          style={{ borderColor: `${theme.accent}80`, color: '#fff' }}
        >
          Abrir CRM
          <ChevronRight className="h-4 w-4" style={{ color: theme.accent }} />
        </button>
        {[
          { icon: UserRound, label: 'Leads' },
          { icon: BarChart3, label: 'Resultados' },
          { icon: Plug, label: 'Integrações' },
          { icon: Pencil, label: 'Editar' },
        ].map(({ icon: Icon, label }) => (
          <button key={label} type="button" className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-muted-foreground transition-colors hover:text-foreground" title={label}>
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
    </article>
  );
}

export default function CrmPage() {
  const { clients } = useClients();
  const activeClients = useMemo(() => clients.filter(c => c.status === 'Ativo'), [clients]);

  const [clientId, setClientId]     = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [segmentChoice, setSegmentChoice] = useState('');
  const [clientSort, setClientSort] = useState<'az' | 'za'>('az');
  const [clientView, setClientView] = useState<'grid' | 'list'>('grid');
  const [recentClientIds, setRecentClientIds] = useState<string[]>([]);
  const [leads, setLeads]           = useState<CrmLead[]>([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(10);
  const [menuId, setMenuId]         = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  function openClientCrm(id: string) {
    setClientId(id);
    setRecentClientIds(prev => {
      const next = [id, ...prev.filter(item => item !== id)].slice(0, 8);
      localStorage.setItem('crm:recent-clients', JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuId(null);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => { setPage(1); }, [statusFilter, search, clientId]);

  useEffect(() => {
    if (!clientId) { setLeads([]); return; }
    setLoading(true);
    fetch(`/api/crm?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<CrmLead[]> : [])
      .then(data => setLeads(data))
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  const filtered = useMemo(() => leads.filter(l => {
    if (statusFilter && l.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return l.nome?.toLowerCase().includes(q) || l.numero?.includes(q) ||
             l.canal?.toLowerCase().includes(q) || l.bairro?.toLowerCase().includes(q) || false;
    }
    return true;
  }), [leads, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);

  const stats = useMemo(() => ({
    total:       leads.length,
    agendados:   leads.filter(l => l.status === 'Agendado' || l.status === 'Reagendado').length,
    fechamentos: leads.filter(l => l.fechou).length,
    faturamento: leads.filter(l => l.fechou).reduce((s, l) => s + (l.valor_rs ?? 0), 0),
  }), [leads]);

  async function saveNew() {
    if (newSavingRef.current) return;
    const data = newDraftRef.current;
    const hasData = data.nome || data.numero || data.observacao || data.canal || data.bairro || data.valor_rs;
    if (!hasData) { focusNew(); return; }
    newSavingRef.current = true; setSaving(true); setSaveError(null);
    try {
      const res = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, ...data }),
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
    if (res.ok) { setLeads(prev => prev.filter(l => l.id !== id)); if (editId === id) setEditId(null); }
  }

  function onNewBairroKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); void saveNew(); }
  }
  function onNewRowKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void saveNew(); }
  }

  function setN<K extends keyof Draft>(k: K, v: Draft[K]) { setNewDraft(prev => ({ ...prev, [k]: v })); }
  function setE<K extends keyof Draft>(k: K, v: Draft[K]) { setEditDraft(prev => ({ ...prev, [k]: v })); }

  return (
    <div className="flex flex-col gap-5 h-full">

      {/* ── PAGE HEADER ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-600/20 border border-violet-500/30">
          {clientId ? <Users className="h-5 w-5 text-violet-400" /> : <Sparkles className="h-5 w-5 text-violet-400" />}
        </div>
        <div>
          <h1 className="text-lg font-bold leading-tight">{clientId ? 'CRM' : 'Escolha um cliente'}</h1>
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
                className="h-12 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              />
            </div>
            <div className="relative">
              <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <select
                value={segmentChoice}
                onChange={e => setSegmentChoice(e.target.value)}
                className="h-12 min-w-56 appearance-none rounded-xl border border-border bg-card pl-10 pr-10 text-sm font-semibold outline-none transition-colors focus:border-primary"
              >
                <option value="">Todos os segmentos</option>
                {clientSegments.map(segment => <option key={segment} value={segment}>{segment}</option>)}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setClientSort(value => value === 'az' ? 'za' : 'az')}
              className="flex h-12 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUpDown className="h-4 w-4" />
              Ordenar: {clientSort === 'az' ? 'A-Z' : 'Z-A'}
            </button>
            <div className="flex h-12 overflow-hidden rounded-xl border border-border bg-card p-1">
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
                  <Clock3 className="h-5 w-5 text-violet-400" />
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
              <LayoutGrid className="h-5 w-5 text-violet-400" />
              Todos os clientes
            </h2>
            {filteredClients.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
                Nenhum cliente encontrado com os filtros atuais.
              </div>
            ) : clientView === 'grid' ? (
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
                {filteredClients.map(client => (
                  <ClientChoiceCard key={client.id} client={client} onOpen={() => openClientCrm(client.id)} />
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
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

        {clientId && (
          <>
            <IconSelect icon={SlidersHorizontal} value={statusFilter} onChange={setStatusFilter}
              placeholder="Todos status" className="min-w-[160px]">
              {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
            </IconSelect>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar leads..."
                className="pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary w-48" />
            </div>

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
      {clientId && !loading && leads.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 shrink-0">
          {([
            { label: 'TOTAL',       sub: 'leads cadastrados',   value: stats.total,       fmt: 'n', Icon: Users,             iconCls: 'text-purple-400',  bgCls: 'bg-purple-500/10',  borderCls: 'border-purple-500/25' },
            { label: 'AGENDADOS',   sub: 'leads agendados',     value: stats.agendados,   fmt: 'n', Icon: CalendarDays,       iconCls: 'text-green-400',   bgCls: 'bg-green-500/10',   borderCls: 'border-green-500/25'  },
            { label: 'FECHAMENTOS', sub: 'negócios fechados',   value: stats.fechamentos, fmt: 'n', Icon: HeartHandshake,     iconCls: 'text-blue-400',    bgCls: 'bg-blue-500/10',    borderCls: 'border-blue-500/25'   },
            { label: 'FATURAMENTO', sub: 'valor total faturado',value: stats.faturamento, fmt: 'c', Icon: CircleDollarSign,   iconCls: 'text-violet-400',  bgCls: 'bg-violet-500/10',  borderCls: 'border-violet-500/25' },
          ] as const).map(({ label, sub, value, fmt, Icon, iconCls, bgCls, borderCls }) => (
            <div key={label} className={cn('rounded-xl border bg-card px-4 py-3 flex items-center gap-3', borderCls)}>
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', bgCls)}>
                <Icon className={cn('h-5 w-5', iconCls)} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className="text-xl font-black leading-tight">{fmt === 'c' ? formatCurrencyBRL(value) : value.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-muted-foreground">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {clientId && loading && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">Carregando...</div>
      )}

      {/* ── TABLE ───────────────────────────────────────────────────── */}
      {clientId && !loading && (
        <div className="flex flex-col flex-1 min-h-0 rounded-xl border border-border bg-card overflow-hidden">

          {/* Table toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <AlignJustify className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Leads</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                <Download className="h-3.5 w-3.5" />
                Exportar
                <ChevronDown className="h-3 w-3" />
              </button>
              <button className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Scrollable table */}
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full border-collapse text-xs" style={{ minWidth: 1280 }}>
              <thead className="sticky top-0 z-10 bg-card border-b border-border">
                <tr>
                  {COLS.map(([h, w], i) => (
                    <th key={i} className={cn('px-2 py-2.5 text-left font-semibold uppercase tracking-wider text-muted-foreground text-[10px]', w)}>
                      {h}
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
                  <Td><input type="date" value={toD(newDraft.data)} onChange={e => setN('data', e.target.value || null)} className={cellNew} /></Td>
                  <Td><input type="text" value={newDraft.nome ?? ''} onChange={e => setN('nome', e.target.value || null)} placeholder="Nome" className={cn(cellNew, 'text-primary placeholder:text-primary/40 font-semibold')} /></Td>
                  <Td><input type="text" value={newDraft.numero ?? ''} onChange={e => setN('numero', e.target.value || null)} placeholder="Número" className={cellNew} /></Td>
                  <Td>
                    <select value={newDraft.canal ?? ''} onChange={e => setN('canal', e.target.value || null)} className={cn(cellNew, 'cursor-pointer appearance-none')}>
                      <option value=""></option>
                      {CANAL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </Td>
                  <Td>
                    <select value={newDraft.status ?? ''} onChange={e => setN('status', e.target.value || null)} className={cn(cellNew, 'cursor-pointer appearance-none', STATUS_COLOR[newDraft.status ?? ''] ?? '')}>
                      {STATUS_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </Td>
                  {(['dia1','dia2','dia3','dia4'] as const).map(k => (
                    <Td key={k} center>
                      <input type="checkbox" checked={!!newDraft[k]} onChange={e => setN(k, e.target.checked)} className="h-3.5 w-3.5 accent-primary cursor-pointer" />
                    </Td>
                  ))}
                  <Td><input type="date" value={toD(newDraft.data_agendada)} onChange={e => setN('data_agendada', e.target.value || null)} className={cellNew} /></Td>
                  <Td center><input type="checkbox" checked={!!newDraft.fechou} onChange={e => setN('fechou', e.target.checked)} className="h-3.5 w-3.5 accent-primary cursor-pointer" /></Td>
                  <Td><input type="number" step="0.01" value={newDraft.valor_rs ?? ''} onChange={e => setN('valor_rs', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cn(cellNew, 'text-primary font-semibold')} /></Td>
                  <Td>
                    <select value={newDraft.pagamento ?? ''} onChange={e => setN('pagamento', e.target.value || null)} className={cn(cellNew, 'cursor-pointer appearance-none')}>
                      <option value=""></option>
                      {PAGAMENTO_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </Td>
                  <Td><input type="number" step="0.01" value={newDraft.orcamento ?? ''} onChange={e => setN('orcamento', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cellNew} /></Td>
                  <Td><input type="text" value={newDraft.observacao ?? ''} onChange={e => setN('observacao', e.target.value || null)} placeholder="Observação" className={cellNew} /></Td>
                  <Td>
                    <input type="text" value={newDraft.bairro ?? ''} onChange={e => setN('bairro', e.target.value || null)} placeholder="Bairro" className={cellNew} onKeyDown={onNewBairroKey} />
                  </Td>
                  <Td center />
                </tr>

                {/* ── SAVED LEADS ── */}
                {paginated.map((lead, idx) => {
                  const isEditing = editId === lead.id;
                  const d = isEditing ? editDraft : lead;
                  const canal = lead.canal ? CANAL_BADGE[lead.canal] : null;
                  const badge = lead.status ? STATUS_BADGE[lead.status] : null;
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
                          : idx % 2 === 0 ? 'hover:bg-muted/30 cursor-pointer' : 'bg-muted/10 hover:bg-muted/30 cursor-pointer'
                      )}
                    >
                      {/* Data + hora */}
                      <Td>
                        {isEditing
                          ? <input type="date" value={toD(d.data)} onChange={e => setE('data', e.target.value || null)} className={cell} />
                          : <div className="px-2 py-1">
                              <div className="text-[11px] font-medium text-foreground">{fmtD(lead.data)}</div>
                              <div className="text-[10px] text-muted-foreground">{fmtTime(lead.created_at)}</div>
                            </div>}
                      </Td>
                      {/* Nome */}
                      <Td>
                        {isEditing
                          ? <input type="text" value={d.nome ?? ''} onChange={e => setE('nome', e.target.value || null)} placeholder="Nome" className={cell} />
                          : <span className="px-2 font-semibold text-primary text-xs truncate block max-w-[140px]">{lead.nome ?? '–'}</span>}
                      </Td>
                      {/* Número */}
                      <Td>
                        {isEditing
                          ? <input type="text" value={d.numero ?? ''} onChange={e => setE('numero', e.target.value || null)} placeholder="Número" className={cell} />
                          : <span className="px-2 text-muted-foreground text-[11px]">{lead.numero ?? '–'}</span>}
                      </Td>
                      {/* Canal */}
                      <Td>
                        {isEditing
                          ? <select value={d.canal ?? ''} onChange={e => setE('canal', e.target.value || null)} className={cellSel}>
                              <option value=""></option>
                              {CANAL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                            </select>
                          : canal
                            ? <div className="px-2 flex items-center">
                                <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white', canal.bg)}>
                                  {canal.short}
                                </span>
                              </div>
                            : <span className="px-2 text-muted-foreground text-[11px]">–</span>}
                      </Td>
                      {/* Status */}
                      <Td>
                        {isEditing
                          ? <select value={d.status ?? ''} onChange={e => setE('status', e.target.value || null)} className={cn(cellSel, STATUS_COLOR[d.status ?? ''] ?? '')}>
                              {STATUS_OPTIONS.map(o => <option key={o}>{o}</option>)}
                            </select>
                          : badge
                            ? <div className="px-1">
                                <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap', badge.pill)}>
                                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', badge.dot)} />
                                  {lead.status}
                                </span>
                              </div>
                            : null}
                      </Td>
                      {/* 1D–4D */}
                      {(['dia1','dia2','dia3','dia4'] as const).map(k => (
                        <Td key={k} center>
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
                      <Td>
                        {isEditing
                          ? <input type="date" value={toD(d.data_agendada)} onChange={e => setE('data_agendada', e.target.value || null)} className={cell} />
                          : <span className="px-2 text-muted-foreground text-[11px]">{fmtD(lead.data_agendada) || '–'}</span>}
                      </Td>
                      {/* Fechou */}
                      <Td center>
                        {isEditing
                          ? <input type="checkbox" checked={!!d.fechou} onChange={e => setE('fechou', e.target.checked)} className="h-3.5 w-3.5 accent-primary cursor-pointer" />
                          : <span
                              onClick={e => { e.stopPropagation(); startEdit(lead); }}
                              className={cn('inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] cursor-pointer font-bold select-none', lead.fechou ? 'bg-green-500 text-white' : 'bg-muted/50 text-muted-foreground/40')}
                            >
                              {lead.fechou ? '✓' : '–'}
                            </span>}
                      </Td>
                      {/* Valor */}
                      <Td>
                        {isEditing
                          ? <input type="number" step="0.01" value={d.valor_rs ?? ''} onChange={e => setE('valor_rs', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cn(cell, 'text-primary font-semibold')} />
                          : <span className="px-2 text-muted-foreground text-[11px]">{fmtN(lead.valor_rs) || '0,00'}</span>}
                      </Td>
                      {/* Pagamento */}
                      <Td>
                        {isEditing
                          ? <select value={d.pagamento ?? ''} onChange={e => setE('pagamento', e.target.value || null)} className={cellSel}>
                              <option value=""></option>
                              {PAGAMENTO_OPTIONS.map(o => <option key={o}>{o}</option>)}
                            </select>
                          : <span className="px-2 text-muted-foreground text-[11px]">{lead.pagamento ?? '–'}</span>}
                      </Td>
                      {/* Orçamento */}
                      <Td>
                        {isEditing
                          ? <input type="number" step="0.01" value={d.orcamento ?? ''} onChange={e => setE('orcamento', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cell} />
                          : <span className="px-2 text-muted-foreground text-[11px]">{fmtN(lead.orcamento) || '0,00'}</span>}
                      </Td>
                      {/* Observação */}
                      <Td>
                        {isEditing
                          ? <input type="text" value={d.observacao ?? ''} onChange={e => setE('observacao', e.target.value || null)} placeholder="Observação" className={cell} />
                          : <span className="px-2 text-muted-foreground text-[11px] truncate block max-w-[170px]">{lead.observacao || 'Observação'}</span>}
                      </Td>
                      {/* Bairro */}
                      <Td>
                        {isEditing
                          ? <input type="text" value={d.bairro ?? ''} onChange={e => setE('bairro', e.target.value || null)} placeholder="Bairro" className={cell} />
                          : <span className="px-2 text-muted-foreground text-[11px]">{lead.bairro || 'Bairro'}</span>}
                      </Td>
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
          </div>

          {/* ── PAGINATION ── */}
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 shrink-0">
            <span className="text-xs text-muted-foreground">
              {filtered.length === 0
                ? 'Nenhum lead'
                : `Mostrando ${(page-1)*pageSize+1} a ${Math.min(page*pageSize, filtered.length)} de ${filtered.length} lead${filtered.length !== 1 ? 's' : ''}`}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                className="flex h-7 w-7 items-center justify-center rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="flex h-7 min-w-[28px] items-center justify-center rounded border border-primary bg-primary/10 px-2.5 text-xs font-bold text-primary">{page}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                className="flex h-7 w-7 items-center justify-center rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <div className="relative ml-2">
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="appearance-none rounded border border-border bg-card pl-2 pr-6 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / página</option>)}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>
        </div>
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
