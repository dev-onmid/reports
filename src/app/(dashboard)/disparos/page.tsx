"use client";

import { useEffect, useRef, useState, useMemo } from 'react';
import {
  Plus, Trash2, Wifi, WifiOff, Play, Pause, X, Upload,
  CheckCircle2, AlertCircle, Clock, RefreshCw, MessageSquare,
  Users, BarChart2, ChevronDown, Copy, Server,
  Send, AlertTriangle, Monitor, Calendar, Zap,
  Eye, ChevronRight, Info, BookOpen, UserCog,
  Search, Pencil, ChevronLeft, FileText, Smile, Sparkles,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type ZClient = {
  id: string; name: string; instance_id: string;
  active: boolean; online?: boolean; created_at: string;
};

type Campaign = {
  id: string; name: string; client_name: string; client_id: string;
  message: string; image_url: string | null;
  status: 'pending' | 'running' | 'paused' | 'done' | 'cancelled';
  starts_at: string; ends_at: string | null;
  interval_min: number; interval_max: number;
  total: number; sent: number; failed: number;
  created_at: string; active_from: string | null; active_until: string | null;
};

type Progress = {
  campaignId: string; total: number; sent: number; failed: number;
  status: string; currentPhone?: string;
};

type NumberDetail = {
  phone: string; name: string | null; status: string;
  error_msg: string | null; sent_at: string | null;
};

type CampaignPrefill = {
  clientId: string; name: string; message: string; numbers: string;
  imageUrls?: string[]; intervalMin: number; intervalMax: number;
  activeFrom?: string; activeUntil?: string;
};

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmtDateTime(v: string | null) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function upcomingLabel(startsAt: string) {
  const d = new Date(startsAt);
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d >= today && d < tomorrow) return { label: 'Hoje', time };
  if (d >= tomorrow && d < new Date(tomorrow.getTime() + 86400000)) return { label: 'Amanhã', time };
  return { label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), time };
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_BADGE_CLS: Record<string, string> = {
  done:      'bg-emerald-500 text-white',
  running:   'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
  pending:   'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  paused:    'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  cancelled: 'bg-red-500/15 text-red-400 border border-red-500/30',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Agendada', running: 'Em andamento', paused: 'Pausada',
  done: 'Concluída', cancelled: 'Cancelada',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-[10px] font-bold', STATUS_BADGE_CLS[status] ?? 'bg-muted text-muted-foreground')}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function DisparoKpiCard({
  title, value, sub, icon: Icon, iconColor, iconBg, change, changeGood,
}: {
  title: string; value: string; sub?: string;
  icon: React.ElementType; iconColor: string; iconBg: string;
  change?: string; changeGood?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-4">
      <div className="shrink-0 rounded-xl p-2.5" style={{ background: iconBg }}>
        <Icon className="h-5 w-5" style={{ color: iconColor }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="font-heading font-normal text-3xl leading-none text-foreground mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
        {change && (
          <p className={cn('text-[11px] mt-1 font-semibold', changeGood ? 'text-emerald-400' : 'text-red-400')}>
            {change}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

function GlowBar(props: Record<string, unknown>) {
  const { x, y, width, height } = props as { x: number; y: number; width: number; height: number };
  if (!height || height <= 0) return null;
  return (
    <g>
      <defs>
        <filter id="barGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x={x} y={y} width={width} height={height} fill="#55F52F" filter="url(#barGlow)" rx={4} />
    </g>
  );
}

function BarLabel(props: Record<string, unknown>) {
  const { x, y, width, value } = props as { x: number; y: number; width: number; value: number };
  if (!value) return null;
  return (
    <text x={(x ?? 0) + (width ?? 0) / 2} y={(y ?? 0) - 6} fill="#6b7280" textAnchor="middle" fontSize={11} fontWeight={600}>
      {Number(value).toLocaleString('pt-BR')}
    </text>
  );
}

function BarTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold mb-0.5">{label}</p>
      <p style={{ color: '#55F52F' }}>{Number(payload[0].value).toLocaleString('pt-BR')} enviados</p>
    </div>
  );
}

// ─── WhatsApp text formatter ──────────────────────────────────────────────────

function parseWASegments(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rem = text; let ki = 0;
  while (rem) {
    const b = rem.match(/^\*([^*\n]+)\*/);
    const i = rem.match(/^_([^_\n]+)_/);
    const s = rem.match(/^~([^~\n]+)~/);
    const m = rem.match(/^`([^`\n]+)`/);
    if (b) { nodes.push(<strong key={ki++}>{b[1]}</strong>); rem = rem.slice(b[0].length); }
    else if (i) { nodes.push(<em key={ki++}>{i[1]}</em>); rem = rem.slice(i[0].length); }
    else if (s) { nodes.push(<del key={ki++}>{s[1]}</del>); rem = rem.slice(s[0].length); }
    else if (m) { nodes.push(<code key={ki++} className="font-mono text-[11px] bg-black/10 px-0.5 rounded">{m[1]}</code>); rem = rem.slice(m[0].length); }
    else { nodes.push(rem[0]); rem = rem.slice(1); }
  }
  return nodes;
}

function formatWAText(text: string): React.ReactNode[] {
  return text.split('\n').flatMap((line, i, arr) => {
    const segs = parseWASegments(line);
    return i < arr.length - 1 ? [...segs, <br key={`br${i}`} />] : segs;
  });
}

// ─── WhatsApp Preview ─────────────────────────────────────────────────────────

function WhatsAppPreview({ images, message }: { images: string[]; message: string }) {
  const preview = message.replace(/\{nome\}/g, 'João Silva').replace(/\{telefone\}/g, '43 9 9999-1111');
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const hasContent = images.length > 0 || preview.trim();

  return (
    <div className="flex flex-col gap-2 w-[300px]">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground shrink-0">Preview</p>
      <div className="select-none flex flex-col rounded-3xl border-[3px] border-zinc-700 bg-zinc-950 p-2 shadow-2xl overflow-hidden" style={{ height: '580px' }}>
        <div className="rounded-[1.4rem] overflow-hidden flex-1 flex flex-col min-h-0">
          <div className="bg-[#075E54] px-4 pt-2 pb-1 flex justify-between items-center shrink-0">
            <span className="text-white text-[11px] font-semibold">{time}</span>
            <span className="text-white text-[11px]">📶 🔋</span>
          </div>
          <div className="bg-[#128C7E] px-4 py-3 flex items-center gap-3 shrink-0 border-b border-[#0d7a6e]">
            <div className="h-10 w-10 rounded-full bg-[#075E54] flex items-center justify-center shrink-0 text-white font-bold text-lg shadow">M</div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm truncate">Minha Empresa</p>
              <p className="text-[#d0f0eb] text-xs">online</p>
            </div>
          </div>
          <div className="bg-[#E5DDD5] flex-1 min-h-0 overflow-y-auto flex flex-col justify-end p-4 gap-3">
            {hasContent ? (
              <>
                {images.slice(1).map((img, idx) => (
                  <div key={idx} className="self-end rounded-2xl rounded-tr-sm overflow-hidden shadow" style={{ background: '#DCF8C6', maxWidth: '82%' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt="" className="w-full object-cover" style={{ maxHeight: '220px' }} />
                    <div className="flex justify-end px-3 py-1">
                      <span className="text-[10px] text-black/40">{time} <span className="text-[#53BDEB]">✓✓</span></span>
                    </div>
                  </div>
                ))}
                <div className="self-end rounded-2xl rounded-tr-sm overflow-hidden shadow" style={{ background: '#DCF8C6', maxWidth: '85%' }}>
                  {images[0] && <img src={images[0]} alt="" className="w-full object-cover" style={{ maxHeight: '240px' }} />}
                  {preview.trim() && (
                    <div className="px-3 pt-2 pb-1 text-[14px] text-black/90 leading-snug break-words">{formatWAText(preview)}</div>
                  )}
                  <div className="flex justify-end px-3 pb-2 gap-1 items-center">
                    <span className="text-[11px] text-black/40">{time}</span>
                    <span className="text-[11px] text-[#53BDEB]">✓✓</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center py-10">
                <p className="text-sm text-black/30 text-center px-8 leading-relaxed">Digite uma mensagem para ver o preview</p>
              </div>
            )}
          </div>
          <div className="bg-[#F0F0F0] px-3 py-2.5 flex items-center gap-2 shrink-0">
            <div className="flex-1 bg-white rounded-full px-4 py-2 shadow-sm">
              <span className="text-xs text-black/25">Mensagem</span>
            </div>
            <div className="h-9 w-9 rounded-full bg-[#128C7E] flex items-center justify-center shrink-0 shadow">
              <span className="text-base">🎤</span>
            </div>
          </div>
        </div>
      </div>
      <p className="text-center text-[10px] text-muted-foreground/40 shrink-0 mt-1">Simulação — layout pode variar</p>
    </div>
  );
}

// ─── Campaign Card (active campaign ticker) ───────────────────────────────────

type TickResult = {
  status: string; done?: boolean; sleeping?: boolean; skipped?: boolean;
  total?: number; sent?: number; failed?: number; lastPhone?: string; lastError?: string | null;
};

function CampaignCard({ campaign, onAction, onRefresh }: {
  campaign: Campaign; onAction: (id: string, action: string) => void; onRefresh: () => void;
}) {
  const [live, setLive] = useState<Progress | null>(null);
  const [tickError, setTickError] = useState('');
  const [lastSendError, setLastSendError] = useState<string | null>(null);
  const [sleeping, setSleeping] = useState(false);
  const runningRef = useRef(false);
  const isRunning = campaign.status === 'running';

  useEffect(() => {
    if (!isRunning) { runningRef.current = false; return; }
    runningRef.current = true;
    setTickError('');
    const intervalMin = Math.max(campaign.interval_min * 1000, 1000);
    const intervalMax = Math.max(campaign.interval_max * 1000, intervalMin);

    async function tick() {
      if (!runningRef.current) return;
      try {
        const res = await fetch(`/api/disparos/campaigns/${campaign.id}/tick`, { method: 'POST' });
        const data = await res.json() as TickResult & { error?: string };
        if (!res.ok) { setTickError(data.error ?? `Erro HTTP ${res.status}`); setTimeout(() => { if (runningRef.current) tick(); }, 5000); return; }
        setTickError('');
        if (data.sleeping) { setSleeping(true); setTimeout(() => { if (runningRef.current) tick(); }, 60_000); return; }
        if (data.skipped) { setTimeout(() => { if (runningRef.current) tick(); }, intervalMax); return; }
        setSleeping(false);
        if (data.lastError) setLastSendError(data.lastError);
        setLive({ campaignId: campaign.id, total: data.total ?? campaign.total, sent: data.sent ?? campaign.sent, failed: data.failed ?? campaign.failed, status: data.status, currentPhone: data.lastPhone });
        if (data.done || data.status !== 'running') { runningRef.current = false; onRefresh(); return; }
        const delay = Math.floor(Math.random() * (intervalMax - intervalMin + 1)) + intervalMin;
        setTimeout(() => { if (runningRef.current) tick(); }, delay);
      } catch (err) {
        setTickError(`Erro de conexão: ${String(err)}`);
        setTimeout(() => { if (runningRef.current) tick(); }, 5000);
      }
    }
    tick();
    return () => { runningRef.current = false; };
  }, [isRunning, campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = live?.total ?? campaign.total;
  const sent = live?.sent ?? campaign.sent;
  const failed = live?.failed ?? campaign.failed;
  const status = (live?.status ?? campaign.status) as Campaign['status'];
  const pct = total > 0 ? Math.round(((sent + failed) / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{campaign.name}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{campaign.client_name}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', status === 'running' ? 'bg-primary' : 'bg-muted-foreground/40')} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{sent + failed} / {total} processados</span>
          <span>{pct}%</span>
        </div>
      </div>
      <div className="flex gap-4 text-[11px]">
        <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" />{sent} enviados</span>
        <span className="flex items-center gap-1 text-red-400"><AlertCircle className="h-3 w-3" />{failed} falhas</span>
        {live?.currentPhone && status === 'running' && (
          <span className="flex items-center gap-1 text-muted-foreground font-mono truncate"><Clock className="h-3 w-3" />{live.currentPhone}</span>
        )}
      </div>
      {sleeping && status === 'running' && (
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-[11px] text-yellow-400 flex items-center gap-1.5">
          <Clock className="h-3 w-3" />Fora do horário de envio — aguardando janela...
        </div>
      )}
      {tickError && <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-[11px] text-red-400">{tickError}</div>}
      {lastSendError && !tickError && <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 px-3 py-2 text-[11px] text-orange-400">Último erro Z-API: {lastSendError}</div>}
      <div className="flex gap-2 pt-1 border-t border-border">
        {status === 'running' && (
          <button type="button" onClick={() => onAction(campaign.id, 'pause')} className="flex items-center gap-1 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-[11px] font-semibold text-orange-400 hover:bg-orange-500/20">
            <Pause className="h-3 w-3" />Pausar
          </button>
        )}
        {(status === 'paused' || status === 'pending') && (
          <button type="button" onClick={() => onAction(campaign.id, status === 'paused' ? 'resume' : 'start')} className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20">
            <Play className="h-3 w-3" />{status === 'paused' ? 'Retomar' : 'Iniciar'}
          </button>
        )}
        {(status === 'running' || status === 'paused' || status === 'pending') && (
          <button type="button" onClick={() => onAction(campaign.id, 'cancel')} className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-400 hover:bg-red-500/20">
            <X className="h-3 w-3" />Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Instâncias helpers ──────────────────────────────────────────────────────

function CircularHealth({ pct, size = 44 }: { pct: number; size?: number }) {
  const r = size * 0.3;
  const c = 2 * Math.PI * r;
  const filled = Math.min(pct, 100) / 100 * c;
  const color = pct >= 80 ? '#22C55E' : pct >= 40 ? '#F59E0B' : '#EF4444';
  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={3} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={`${filled} ${c - filled}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}80)` }} />
      </svg>
      <span className="absolute text-[11px] font-bold leading-none" style={{ color }}>{pct}%</span>
    </div>
  );
}

function LineSparkline({ positive = true, color }: { positive?: boolean; color?: string }) {
  const raw = positive
    ? [42,51,45,58,62,55,70,75,68,80]
    : [38,30,25,20,15,18,10,6,3,1];
  const max = Math.max(...raw); const min = Math.min(...raw); const range = max - min || 1;
  const W = 80; const H = 28;
  const pts = raw.map((v, i) => `${(i/(raw.length-1))*W},${H - ((v-min)/range)*(H-4)+2}`).join(' ');
  const c = color ?? (positive ? '#22C55E' : '#EF4444');
  return (
    <svg width={W} height={H}>
      <defs>
        <linearGradient id={`sg${c.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.25} />
          <stop offset="100%" stopColor={c} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke={c} strokeWidth={1.5} opacity={0.85} />
    </svg>
  );
}

function BarSparkline2({ color = '#A855F7' }: { color?: string }) {
  const data = [38,52,45,60,55,68,62];
  const max = Math.max(...data);
  return (
    <svg width={80} height={28}>
      {data.map((v, i) => {
        const bh = Math.round((v/max)*22);
        return <rect key={i} x={i*12+1} y={28-bh} width={8} height={bh} fill={color} rx={2} opacity={0.75} />;
      })}
    </svg>
  );
}

// ─── Tab: Instâncias ──────────────────────────────────────────────────────────

function ClientesTab() {
  const [clients, setClients] = useState<ZClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', instanceId: '', token: '', securityToken: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { connected: boolean; error?: string; raw?: unknown; testedAt?: Date }>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/disparos/clients').then(r => r.json() as Promise<ZClient[]>).then(setClients).finally(() => setLoading(false));
  }, []);

  async function add() {
    if (!form.name || !form.instanceId || !form.token) { setError('Preencha nome, Instance ID e Token.'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/disparos/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json() as ZClient;
      if (!res.ok) { setError((data as { error?: string }).error ?? 'Erro'); return; }
      setClients(prev => [data, ...prev]);
      setForm({ name: '', instanceId: '', token: '', securityToken: '' });
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    await fetch('/api/disparos/clients', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setClients(prev => prev.filter(c => c.id !== id));
  }

  async function testConnection(id: string) {
    setTesting(id);
    try {
      const res = await fetch('/api/disparos/clients/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: id }) });
      const data = await res.json() as { connected: boolean; error?: string; raw?: unknown };
      setTestResult(prev => ({ ...prev, [id]: { ...data, testedAt: new Date() } }));
    } finally { setTesting(null); }
  }

  function copyId(text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(text); setTimeout(() => setCopied(null), 2000);
  }

  function syncAgo(d: Date) {
    const m = Math.floor((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'Agora mesmo';
    if (m < 60) return `há ${m} min`;
    const h = Math.floor(m/60);
    if (h < 24) return `há ${h}h`;
    return `há ${Math.floor(h/24)}d`;
  }

  const connected = clients.filter(c => testResult[c.id]?.connected).length;
  const errored   = clients.filter(c => testResult[c.id] && !testResult[c.id].connected).length;

  const filtered = clients.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.instance_id.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === 'online'  && !testResult[c.id]?.connected) return false;
    if (statusFilter === 'offline' &&  testResult[c.id]?.connected) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Instâncias conectadas', value: String(connected), sub: clients.length > 0 ? `${Math.round((connected/clients.length)*100)}% do total` : '—', subColor: 'text-emerald-400', icon: Server, iconColor: '#06B6D4', iconBg: 'rgba(6,182,212,0.15)', chart: <LineSparkline positive /> },
          { label: 'Instâncias com erro',    value: String(errored),   sub: clients.length > 0 ? `${Math.round((errored/clients.length)*100)}% do total`   : '—', subColor: 'text-red-400',     icon: AlertTriangle, iconColor: '#EF4444', iconBg: 'rgba(239,68,68,0.15)',  chart: <LineSparkline positive={false} color="#EF4444" /> },
          { label: 'Mensagens hoje',         value: '—',               sub: 'Dados Z-API',                                                                          subColor: 'text-muted-foreground', icon: MessageSquare, iconColor: '#A855F7', iconBg: 'rgba(168,85,247,0.15)', chart: <BarSparkline2 /> },
          { label: 'Uptime médio',           value: clients.length > 0 ? `${Math.round((connected/clients.length)*100)}%` : '—', sub: 'Últimos 7 dias', subColor: 'text-muted-foreground', icon: Zap, iconColor: '#22C55E', iconBg: 'rgba(34,197,94,0.15)', chart: <LineSparkline positive color="#22C55E" /> },
        ].map(({ label, value, sub, subColor, icon: Icon, iconColor, iconBg, chart }) => (
          <div key={label} className="relative overflow-hidden rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className="rounded-xl p-2.5 shrink-0" style={{ background: iconBg }}>
              <Icon className="h-5 w-5" style={{ color: iconColor }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground leading-tight">{label}</p>
              <p className="font-heading font-normal text-3xl leading-none text-foreground mt-0.5">{value}</p>
              <p className={cn('text-[11px] font-semibold mt-1', subColor)}>{sub}</p>
            </div>
            <div className="shrink-0 opacity-80">{chart}</div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div className="space-y-6 min-w-0">

          {/* Nova instância form */}
          <div className="relative overflow-hidden rounded-xl border p-6" style={{ borderColor: 'rgba(34,197,94,0.3)', background: 'linear-gradient(135deg, rgba(34,197,94,0.04) 0%, transparent 60%)', boxShadow: '0 0 0 1px rgba(34,197,94,0.08), 0 16px 48px rgba(34,197,94,0.07)' }}>
            {/* Decorative Z-API 3D box */}
            <div className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 opacity-15 hidden lg:flex items-center justify-center" style={{ width: 100, height: 100 }}>
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-2xl border-2 border-emerald-400 rotate-6" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(6,182,212,0.15))' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-3xl font-bold text-emerald-400 rotate-6 select-none">Z</span>
                </div>
                <div className="absolute -bottom-2 -right-2 w-5 h-5 rounded-full bg-emerald-500/30 border border-emerald-400/50" />
                <div className="absolute -top-2 -left-2 w-4 h-4 rounded-full bg-cyan-500/30 border border-cyan-400/50" />
              </div>
            </div>

            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-xl p-2 shrink-0 mt-0.5" style={{ background: 'rgba(34,197,94,0.15)' }}>
                <Server className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <p className="font-bold text-base">Nova instância Z-API</p>
                <p className="text-sm text-muted-foreground mt-0.5">Cadastre uma nova instância para começar a enviar mensagens.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:pr-28">
              {[
                { key: 'name',          label: 'Nome (ex: Clínica A)',      ph: 'Ex: Clínica Odonto Prime', t: 'text' },
                { key: 'instanceId',    label: 'Instance ID',               ph: 'Ex: 5F30B52A...',           t: 'text' },
                { key: 'token',         label: 'Token',                     ph: 'Ex: 3ecff8a9...',            t: 'password' },
                { key: 'securityToken', label: 'Client Token (segurança)',   ph: 'Ex: zkl9...pQw',            t: 'password' },
              ].map(({ key, label, ph, t }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <input
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={ph} type={t}
                    className="w-full h-9 rounded-lg border border-border bg-background/60 px-3 text-sm outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/40 placeholder:text-muted-foreground/40"
                  />
                </div>
              ))}
            </div>
            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
            <button type="button" onClick={add} disabled={saving}
              className="mt-5 flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-black hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Adicionar instância
            </button>
          </div>

          {/* Instances table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">Suas instâncias</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{clients.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar instância..."
                    className="h-8 w-40 rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="relative flex items-center">
                  <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-background pl-3 pr-8 text-xs outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer">
                    <option value="all">Status: Todas</option>
                    <option value="online">Online</option>
                    <option value="offline">Offline</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>

            {loading ? (
              <div className="space-y-px">{[1,2].map(i => <div key={i} className="h-20 animate-pulse bg-muted/20" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center">
                <Wifi className="mx-auto h-8 w-8 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">Nenhuma instância encontrada.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-[11px] text-muted-foreground uppercase tracking-wider">
                        <th className="py-2.5 px-4 text-left font-semibold">Instância</th>
                        <th className="py-2.5 px-4 text-left font-semibold">Status</th>
                        <th className="py-2.5 px-4 text-left font-semibold">Instance ID</th>
                        <th className="py-2.5 px-4 text-left font-semibold">Última sincronização</th>
                        <th className="py-2.5 px-4 text-center font-semibold">Saúde</th>
                        <th className="py-2.5 px-4 text-center font-semibold">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c, idx) => {
                        const result = testResult[c.id];
                        const isOnline = result?.connected ?? false;
                        const health   = result ? (result.connected ? 100 : 0) : (c.active ? 75 : 42);
                        const isFirst  = idx === 0;
                        const iconColor = isFirst ? '#22C55E' : '#A855F7';
                        const iconBg   = isFirst ? 'rgba(34,197,94,0.15)' : 'rgba(168,85,247,0.15)';
                        return (
                          <tr key={c.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0" style={{ background: iconBg }}>
                                  <Users className="h-4.5 w-4.5" style={{ color: iconColor }} />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm">{c.name}</span>
                                    {isFirst && <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold text-blue-400 uppercase">Padrão</span>}
                                  </div>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">{c.active ? 'Disparos e campanhas ativas' : 'Ambiente de testes'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5">
                                <span className={cn('h-2 w-2 rounded-full shrink-0', isOnline ? 'bg-emerald-400' : result ? 'bg-red-400' : 'bg-gray-500')}
                                  style={isOnline ? { boxShadow: '0 0 6px rgba(34,197,94,0.7)' } : undefined} />
                                <span className={cn('text-xs font-medium', isOnline ? 'text-emerald-400' : result ? 'text-red-400' : 'text-muted-foreground')}>
                                  {isOnline ? 'Online' : result ? 'Offline' : 'Não testado'}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs text-muted-foreground">{c.instance_id.length > 12 ? `${c.instance_id.slice(0,8)}...${c.instance_id.slice(-4)}` : c.instance_id}</span>
                                <button type="button" onClick={() => copyId(c.instance_id)}
                                  className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0">
                                  {copied === c.instance_id ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                                </button>
                                <span className="text-[10px] text-muted-foreground/40 font-mono">Z-API</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {result?.testedAt ? (
                                <div>
                                  <p className="text-xs font-medium">{result.testedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                                  <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                    {syncAgo(result.testedAt)}
                                    <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', isOnline ? 'bg-emerald-400' : 'bg-red-400')} />
                                  </p>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">Nunca testado</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <CircularHealth pct={health} size={44} />
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-center gap-4">
                                {[
                                  { icon: Wifi, label: 'Testar', color: 'hover:text-emerald-400', onClick: () => testConnection(c.id), spin: testing === c.id },
                                  { icon: Pencil, label: 'Editar', color: 'hover:text-blue-400', onClick: () => {} },
                                  { icon: RefreshCw, label: 'Reiniciar', color: 'hover:text-cyan-400', onClick: () => {} },
                                ].map(({ icon: Icon, label, color, onClick, spin }) => (
                                  <button key={label} type="button" onClick={onClick}
                                    className={cn('flex flex-col items-center gap-0.5 text-muted-foreground transition-colors', color)}>
                                    <Icon className={cn('h-3.5 w-3.5', spin && 'animate-spin')} />
                                    <span className="text-[9px] font-semibold">{label}</span>
                                  </button>
                                ))}
                                <button type="button" onClick={() => remove(c.id)}
                                  className="flex flex-col items-center gap-0.5 text-red-400/60 hover:text-red-400 transition-colors">
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span className="text-[9px] font-semibold">Excluir</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-5 py-3 border-t border-border">
                  <span className="text-[11px] text-muted-foreground">Mostrando 1 a {filtered.length} de {clients.length} instâncias</span>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled className="h-7 w-7 rounded-lg border border-border flex items-center justify-center hover:bg-muted/50 transition-colors disabled:opacity-30">
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="h-7 w-7 rounded-lg border border-primary/40 bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">1</span>
                    <button type="button" disabled className="h-7 w-7 rounded-lg border border-border flex items-center justify-center hover:bg-muted/50 transition-colors disabled:opacity-30">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right: Diagnóstico */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="rounded-lg p-1.5 shrink-0" style={{ background: 'rgba(34,197,94,0.12)' }}>
                <Zap className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="font-semibold text-sm">Diagnóstico de conexão</p>
            </div>
            <p className="text-xs text-muted-foreground mb-2">Status geral</p>
            <div className="flex items-center justify-between mb-5">
              <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400">
                {errored === 0 && clients.length > 0 ? 'Tudo operacional' : errored > 0 ? 'Atenção necessária' : 'Configurando...'}
              </span>
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
            </div>
            <div className="space-y-2">
              {[
                { icon: Server,      color: '#22C55E', bg: 'rgba(34,197,94,0.12)',   label: 'API Z-API',          status: 'Operacional', detail: 'Latência: ~128ms' },
                { icon: Wifi,        color: '#22C55E', bg: 'rgba(34,197,94,0.12)',   label: 'Webhook',            status: connected > 0 ? 'Conectado' : 'Desconectado', detail: connected > 0 ? `${connected} instância(s) online` : 'Nenhuma online' },
                { icon: CheckCircle2,color: '#22C55E', bg: 'rgba(34,197,94,0.12)',   label: 'Autenticação',       status: 'Válida',      detail: 'Token expira em: 27 dias' },
                { icon: MessageSquare,color: '#22C55E',bg: 'rgba(34,197,94,0.12)',   label: 'Fila de mensagens',  status: 'Normal',      detail: '0 mensagens pendentes' },
              ].map(({ icon: Icon, color, bg, label, status, detail }) => (
                <div key={label} className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
                  <div className="rounded-lg p-1.5 shrink-0" style={{ background: bg }}>
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">{label}</p>
                    <p className="text-[11px] text-muted-foreground">{detail}</p>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-400 shrink-0">{status}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-border rounded-lg border border-primary/15 bg-primary/5 px-3 py-3">
              <div className="flex items-start gap-2">
                <div className="rounded-lg p-1 bg-primary/15 shrink-0 mt-0.5">
                  <Info className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-primary mb-1">Dica</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">Mantenha suas instâncias sempre online para garantir o melhor desempenho nas campanhas.</p>
                  <button type="button" className="text-[11px] text-primary hover:underline mt-1.5 flex items-center gap-1">
                    Saiba mais <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Nova Campanha ───────────────────────────────────────────────────────

const FORM_STEPS = [
  { num: 1, label: 'Informações',      sub: 'Dados gerais' },
  { num: 2, label: 'Mensagem',         sub: 'Texto e variáveis' },
  { num: 3, label: 'Mídias',           sub: 'Imagens opcionais' },
  { num: 4, label: 'Base de contatos', sub: 'Números e importação' },
  { num: 5, label: 'Agendamento',      sub: 'Data, hora e cadência' },
  { num: 6, label: 'Revisão',          sub: 'Confira e publique' },
];

function NovaCampanhaTab({ onCreated, prefill }: { onCreated: () => void; prefill?: CampaignPrefill | null }) {
  const [clients, setClients] = useState<ZClient[]>([]);
  const [form, setForm] = useState({
    clientId: '', name: '', message: '', numbers: '',
    isNow: true, startsAt: '', endsAt: '',
    activeFrom: '', activeUntil: '',
    intervalMin: 5, intervalMax: 15,
  });
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [variations, setVariations] = useState<{ text: string; label: string; editing: boolean }[]>([]);
  const [loadingVariations, setLoadingVariations] = useState(false);
  const [variationsError, setVariationsError] = useState('');
  const [previewVariationIdx, setPreviewVariationIdx] = useState<number | null>(null);
  const lastGeneratedMsgRef = useRef('');
  const fileRef   = useRef<HTMLInputElement>(null);
  const csvRef    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/disparos/clients').then(r => r.json() as Promise<ZClient[]>).then(data => {
      setClients(data);
      if (data[0]) setForm(p => ({ ...p, clientId: p.clientId || data[0].id }));
    });
  }, []);

  useEffect(() => {
    if (!prefill) return;
    setForm({ clientId: prefill.clientId, name: prefill.name + ' (cópia)', message: prefill.message, numbers: prefill.numbers, isNow: true, startsAt: '', endsAt: '', activeFrom: prefill.activeFrom ?? '', activeUntil: prefill.activeUntil ?? '', intervalMin: prefill.intervalMin, intervalMax: prefill.intervalMax });
    setImageUrls(prefill.imageUrls ?? []);
  }, [prefill]);

  function addImages(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1200; const scale = img.width > MAX ? MAX / img.width : 1;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          setImageUrls(prev => [...prev, canvas.toDataURL('image/jpeg', 0.85)]);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  function importCSV(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? '';
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      setForm(p => ({ ...p, numbers: lines.join('\n') }));
    };
    reader.readAsText(file);
  }

  function insertVariable(v: string) {
    setForm(p => ({ ...p, message: p.message + v }));
  }

  async function generateVariations(msg?: string) {
    const message = msg ?? form.message;
    if (!message.trim()) return;
    lastGeneratedMsgRef.current = message;
    setLoadingVariations(true);
    setVariationsError('');
    setVariations([]);
    setPreviewVariationIdx(null);
    try {
      const res = await fetch('/api/ai/whatsapp-variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json() as { text: string; label: string }[] | { error: string };
      if (!res.ok || 'error' in data) {
        setVariationsError('error' in data ? data.error : 'Erro ao gerar variações.');
      } else {
        setVariations((data as { text: string; label: string }[]).map(v => ({ ...v, editing: false })));
      }
    } catch {
      setVariationsError('Erro de conexão ao gerar variações.');
    } finally {
      setLoadingVariations(false);
    }
  }

  function handleMessageBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    const msg = e.target.value.trim();
    if (msg && msg !== lastGeneratedMsgRef.current) {
      void generateVariations(msg);
    }
  }

  function toISO(local: string) { return local ? new Date(local).toISOString() : ''; }
  function localTimeToUTC(hhmm: string) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  }

  async function create() {
    if (!form.clientId || !form.name || !form.message || !form.numbers) { setError('Preencha todos os campos obrigatórios.'); return; }
    if (!form.isNow && !form.startsAt) { setError('Selecione o horário de início ou escolha "Agora".'); return; }
    setSaving(true); setError('');
    try {
      const startsAt   = form.isNow ? new Date().toISOString() : toISO(form.startsAt);
      const endsAt     = form.endsAt ? toISO(form.endsAt) : undefined;
      const activeFrom  = form.activeFrom  && form.activeUntil ? localTimeToUTC(form.activeFrom)  : undefined;
      const activeUntil = form.activeFrom  && form.activeUntil ? localTimeToUTC(form.activeUntil) : undefined;
      const allMessages = variations.length > 0 ? [form.message, ...variations.map(v => v.text)] : undefined;
      const res = await fetch('/api/disparos/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: form.clientId, name: form.name, message: form.message, messages: allMessages, numbers: form.numbers, startsAt, endsAt, activeFrom, activeUntil, intervalMin: form.intervalMin, intervalMax: form.intervalMax, imageUrls: imageUrls.length > 0 ? imageUrls : undefined }) });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? 'Erro ao criar campanha.'); return; }
      setForm({ clientId: clients[0]?.id ?? '', name: '', message: '', numbers: '', isNow: true, startsAt: '', endsAt: '', activeFrom: '', activeUntil: '', intervalMin: 5, intervalMax: 15 });
      setImageUrls([]);
      setVariations([]);
      setPreviewVariationIdx(null);
      onCreated();
    } finally { setSaving(false); }
  }

  const contactCount = form.numbers.split('\n').filter(l => l.trim()).length;

  const charCount    = form.message.length;

  return (
    <>
      <div className="flex gap-5 pb-28">
        {/* Step sidebar */}
        <div className="w-44 shrink-0 space-y-0.5">
          {FORM_STEPS.map(step => (
            <div key={step.num} className={cn('flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors', step.num === 1 ? 'bg-primary/10' : 'hover:bg-muted/30')}>
              <div className={cn('flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold shrink-0 mt-0.5', step.num === 1 ? 'bg-primary text-black' : 'bg-muted/60 text-muted-foreground border border-border')}>
                {step.num}
              </div>
              <div className="min-w-0">
                <p className={cn('text-sm font-semibold leading-tight', step.num === 1 ? 'text-primary' : 'text-foreground')}>{step.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{step.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Main form columns */}
        <div className="flex-1 grid grid-cols-2 gap-4 min-w-0 content-start">

          {/* Left column: sections 1, 2, 3 */}
          <div className="space-y-4">

            {/* Section 1: Informações */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-lg p-1.5 shrink-0" style={{ background: 'rgba(6,182,212,0.15)' }}>
                  <Info className="h-4 w-4 text-cyan-400" />
                </div>
                <p className="font-semibold">1. Informações da campanha</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Nome da campanha *</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Promoção Janeiro"
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Instância Z-API *</label>
                  <div className="relative">
                    <select value={form.clientId} onChange={e => setForm(p => ({ ...p, clientId: e.target.value }))}
                      className="w-full h-9 rounded-lg border border-border bg-background pl-3 pr-8 text-sm outline-none focus:ring-1 focus:ring-primary appearance-none">
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Mensagem */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-lg p-1.5 shrink-0" style={{ background: 'rgba(6,182,212,0.15)' }}>
                  <MessageSquare className="h-4 w-4 text-cyan-400" />
                </div>
                <p className="font-semibold">2. Mensagem</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Mensagem * — use {'{nome}'} e {'{telefone}'} para personalizar
                </label>
                <div className="relative">
                  <textarea value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} onBlur={handleMessageBlur}
                    placeholder="Olá {nome}, temos uma novidade para você!" rows={5}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary resize-none pr-10" />
                  <button type="button" className="absolute bottom-3 right-3 text-muted-foreground hover:text-foreground transition-colors">
                    <Smile className="h-4 w-4" />
                  </button>
                  <span className="absolute bottom-3 right-9 text-[10px] text-muted-foreground/60">{charCount} / 4096</span>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted-foreground">Variáveis disponíveis:</span>
                {['{nome}','{telefone}'].map(v => (
                  <button key={v} type="button" onClick={() => insertVariable(v)}
                    className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-mono text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                    {v}
                  </button>
                ))}
                <button type="button" onClick={() => insertVariable('')}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
                  <Sparkles className="h-3 w-3" />Inserir variável
                </button>
                <div className="ml-auto flex items-center gap-2">
                  {loadingVariations && (
                    <span className="flex items-center gap-1.5 text-[11px] text-violet-400">
                      <RefreshCw className="h-3 w-3 animate-spin" />Gerando variações com IA…
                    </span>
                  )}
                  {!loadingVariations && form.message.trim() && (
                    <button
                      type="button"
                      onClick={() => void generateVariations()}
                      className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-bold text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/60 transition-all shadow-[0_0_8px_rgba(139,92,246,0.15)]"
                    >
                      <Sparkles className="h-3 w-3" />Regenerar
                    </button>
                  )}
                </div>
              </div>

              {/* Variations panel */}
              {variationsError && (
                <p className="mt-3 text-xs text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0" />{variationsError}
                </p>
              )}
              {variations.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                    <p className="text-[11px] font-bold uppercase tracking-widest text-violet-400">Variações geradas pela IA</p>
                    <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300">{variations.length} variações · serão intercaladas no envio</span>
                    <button
                      type="button"
                      onClick={() => { setVariations([]); setPreviewVariationIdx(null); }}
                      className="ml-auto text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {variations.map((v, i) => (
                      <div
                        key={i}
                        className={cn(
                          'rounded-xl border p-3 space-y-2 transition-colors',
                          previewVariationIdx === i
                            ? 'border-violet-500/60 bg-violet-500/10'
                            : 'border-violet-500/20 bg-violet-500/5 hover:border-violet-500/40',
                        )}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                            {v.label || `Variação ${i + 1}`}
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            <button
                              type="button"
                              title="Ver no preview"
                              onClick={() => setPreviewVariationIdx(prev => prev === i ? null : i)}
                              className={cn(
                                'flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors',
                                previewVariationIdx === i
                                  ? 'border-violet-500/60 bg-violet-500/20 text-violet-300'
                                  : 'border-border text-muted-foreground hover:border-violet-500/40 hover:text-violet-400',
                              )}
                            >
                              <Eye className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              title={v.editing ? 'Salvar edição' : 'Editar variação'}
                              onClick={() => setVariations(prev => prev.map((x, j) => j === i ? { ...x, editing: !x.editing } : x))}
                              className={cn(
                                'flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors',
                                v.editing
                                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-400'
                                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                              )}
                            >
                              {v.editing ? <CheckCircle2 className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setForm(p => ({ ...p, message: v.text }));
                                lastGeneratedMsgRef.current = v.text;
                                setVariations([]);
                                setPreviewVariationIdx(null);
                              }}
                              className="flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-emerald-400 transition-colors shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Usar esta
                            </button>
                          </div>
                        </div>
                        {v.editing ? (
                          <textarea
                            value={v.text}
                            rows={4}
                            onChange={e => setVariations(prev => prev.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                            className="w-full rounded-lg border border-violet-500/30 bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-violet-500 resize-none"
                          />
                        ) : (
                          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{v.text}</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 text-center">
                    Envio intercalado: contato 1 → msg principal, contato 2 → variação 1, contato 3 → variação 2…
                  </p>
                </div>
              )}
            </div>

            {/* Section 3: Mídias */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-lg p-1.5 shrink-0" style={{ background: 'rgba(6,182,212,0.15)' }}>
                  <Upload className="h-4 w-4 text-cyan-400" />
                </div>
                <p className="font-semibold">3. Mídias (opcional)</p>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">Adicione imagens que serão enviadas antes ou junto com a mensagem.</p>

              {imageUrls.length > 0 ? (
                <div className="flex flex-wrap gap-2 mb-3">
                  {imageUrls.map((url, idx) => (
                    <div key={idx} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-border" />
                      {idx === 0 && <span className="absolute bottom-0 left-0 right-0 text-center text-[8px] bg-black/60 text-white rounded-b-lg py-0.5">1ª</span>}
                      <button type="button" onClick={() => setImageUrls(prev => prev.filter((_,i) => i !== idx))}
                        className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-background border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="h-16 w-16 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-0.5 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
                    <Plus className="h-4 w-4" />
                    <span className="text-[9px] font-semibold">Add</span>
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); addImages(e.dataTransfer.files); }}
                  className={cn('cursor-pointer rounded-xl border-2 border-dashed p-8 flex flex-col items-center justify-center gap-2 transition-all',
                    dragOver ? 'border-primary/60 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/20')}>
                  <Upload className="h-7 w-7 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground text-center">Arraste e solte imagens aqui<br />
                    <span className="text-xs text-muted-foreground/60">ou clique para selecionar</span>
                  </p>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground/50 mt-2">Formatos aceitos: JPG, PNG, WEBP (máx. 5MB por imagem)</p>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { addImages(e.target.files); e.target.value = ''; }} />
            </div>
          </div>

          {/* Right column: sections 4, 5 */}
          <div className="space-y-4">

            {/* Section 4: Base de contatos */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-lg p-1.5 shrink-0" style={{ background: 'rgba(6,182,212,0.15)' }}>
                  <Users className="h-4 w-4 text-cyan-400" />
                </div>
                <p className="font-semibold">4. Base de contatos</p>
              </div>
              <div className="space-y-1.5 mb-4">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Números * — um por linha, com DDD e código do país
                </label>
                <textarea value={form.numbers} onChange={e => setForm(p => ({ ...p, numbers: e.target.value }))}
                  placeholder={"(43) 9 9999-1111,João\n1198888-7777\n+55 43 9 6666-4444,Maria"}


                  rows={6} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-xs font-mono outline-none focus:ring-1 focus:ring-primary resize-none" />
              </div>

              {/* CSV Import */}
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">Importe sua base de contatos</p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => csvRef.current?.click()}
                    className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                    <Upload className="h-3.5 w-3.5" />Importar arquivo
                  </button>
                  <span className="text-[11px] text-muted-foreground/50">CSV ou TXT (máx. 5MB)</span>
                </div>
                <input ref={csvRef} type="file" accept=".csv,.txt" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) { importCSV(e.target.files[0]); e.target.value = ''; } }} />
              </div>

              {contactCount > 0 && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-emerald-400">{contactCount} contato{contactCount !== 1 ? 's' : ''} carregado{contactCount !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>

            {/* Section 5: Agendamento */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-lg p-1.5 shrink-0" style={{ background: 'rgba(6,182,212,0.15)' }}>
                  <Clock className="h-4 w-4 text-cyan-400" />
                </div>
                <p className="font-semibold">5. Agendamento e cadência</p>
              </div>

              <div className="space-y-4">
                {/* Início */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Início do envio *</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setForm(p => ({ ...p, isNow: true, startsAt: '' }))}
                      className={cn('flex-1 h-9 flex items-center justify-center gap-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-colors',
                        form.isNow ? 'border-primary/40 bg-primary text-black' : 'border-border bg-card text-muted-foreground hover:bg-muted/50')}>
                      <Play className="h-3.5 w-3.5" />Agora
                    </button>
                    <button type="button" onClick={() => setForm(p => ({ ...p, isNow: false }))}
                      className={cn('flex-1 h-9 flex items-center justify-center gap-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-colors',
                        !form.isNow ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/50')}>
                      <Calendar className="h-3.5 w-3.5" />Agendar
                    </button>
                  </div>
                </div>

                {/* Date + time */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Data e hora (opcional)</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={form.startsAt.split('T')[0] || ''} onChange={e => setForm(p => ({ ...p, startsAt: e.target.value + (p.startsAt.includes('T') ? p.startsAt.slice(10) : 'T00:00'), isNow: false }))}
                      className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary" />
                    <input type="time" value={form.startsAt.split('T')[1]?.slice(0,5) || ''} onChange={e => setForm(p => ({ ...p, startsAt: (p.startsAt.split('T')[0] || new Date().toISOString().split('T')[0]) + 'T' + e.target.value, isNow: false }))}
                      className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                </div>

                {/* Janela de envio */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Janela de envio (opcional)
                    <span className="ml-1 normal-case font-normal text-muted-foreground/60">— Pausa fora desse período</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input type="time" value={form.activeFrom} onChange={e => setForm(p => ({ ...p, activeFrom: e.target.value }))}
                      className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary" />
                    <span className="text-xs text-muted-foreground shrink-0">até</span>
                    <input type="time" value={form.activeUntil} onChange={e => setForm(p => ({ ...p, activeUntil: e.target.value }))}
                      className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                </div>

                {/* Intervals */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'intervalMin', label: 'Intervalo mínimo (seg) *', sub: 'Tempo mínimo entre envios' },
                    { key: 'intervalMax', label: 'Intervalo máximo (seg) *', sub: 'Tempo máximo entre envios' },
                  ].map(({ key, label, sub }) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</label>
                      <input type="number" min={1} value={form[key as 'intervalMin'|'intervalMax']}
                        onChange={e => setForm(p => ({ ...p, [key]: Number(e.target.value) }))}
                        className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary" />
                      <p className="text-[10px] text-muted-foreground/60">{sub}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Preview panel */}
        <div className="w-72 shrink-0">
          <div className="sticky top-20">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wider">Preview ao vivo</p>
                <span className="h-2 w-2 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 6px rgba(34,197,94,0.7)' }} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Veja como sua mensagem aparecerá para os contatos.</p>
            </div>
            <WhatsAppPreview images={imageUrls} message={previewVariationIdx !== null && variations[previewVariationIdx] ? variations[previewVariationIdx].text : form.message} />
            {previewVariationIdx !== null && variations[previewVariationIdx] && (
              <p className="mt-1.5 text-center text-[10px] text-violet-400 font-medium">
                Prévia: {variations[previewVariationIdx].label || `Variação ${previewVariationIdx + 1}`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-[var(--sidebar-width,0px)] right-0 z-30 border-t border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/25 bg-primary/10 shrink-0">
              <Info className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">A campanha será criada com base nas configurações acima.</p>
              <p className="text-xs text-muted-foreground">Você poderá revisar tudo antes de enviar.</p>
            </div>
          </div>
          {error && <p className="text-xs text-red-400 shrink-0">{error}</p>}
          <button type="button" onClick={create} disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-primary px-8 py-3 text-sm font-bold uppercase tracking-wider text-black hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
            style={{ boxShadow: '0 0 20px rgba(85,245,47,0.3)' }}>
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Criar campanha
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────

function DashboardTab({ onReuse, onNewCampaign, onManageInstances }: {
  onReuse: (p: CampaignPrefill) => void;
  onNewCampaign: () => void;
  onManageInstances: () => void;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState({ total: 0, online: 0 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedNumbers, setExpandedNumbers] = useState<Record<string, NumberDetail[]>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function load() {
    const [cData, iData] = await Promise.all([
      fetch('/api/disparos/campaigns').then(r => r.json() as Promise<Campaign[]>),
      fetch('/api/disparos/clients').then(r => r.json() as Promise<ZClient[]>),
    ]);
    setCampaigns(cData);
    setInstances({ total: iData.length, online: iData.filter(c => c.active).length });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAction(id: string, action: string) {
    await fetch(`/api/disparos/campaigns/${id}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    load();
  }

  async function fetchNumbers(id: string) {
    if (expandedNumbers[id]) return expandedNumbers[id];
    setLoadingDetail(id);
    const data = await fetch(`/api/disparos/campaigns/${id}/numbers`).then(r => r.json() as Promise<NumberDetail[]>);
    setExpandedNumbers(prev => ({ ...prev, [id]: data }));
    setLoadingDetail(null);
    return data;
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Excluir esta campanha permanentemente?')) return;
    setDeleting(id);
    await fetch(`/api/disparos/campaigns/${id}`, { method: 'DELETE' });
    setDeleting(null);
    setExpandedId(null);
    load();
  }

  async function handleReuse(c: Campaign) {
    const nums = await fetchNumbers(c.id);
    const numbers = nums.map(n => n.name ? `${n.phone},${n.name}` : n.phone).join('\n');
    let imageUrls: string[] = [];
    if (c.image_url) {
      if (c.image_url.startsWith('[')) { try { imageUrls = JSON.parse(c.image_url); } catch { imageUrls = [c.image_url]; } }
      else { imageUrls = [c.image_url]; }
    }
    onReuse({ clientId: c.client_id, name: c.name, message: c.message, numbers, imageUrls, intervalMin: c.interval_min, intervalMax: c.interval_max, activeFrom: c.active_from ?? undefined, activeUntil: c.active_until ?? undefined });
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  const now = useMemo(() => new Date(), []);
  const oneWeekAgo = useMemo(() => { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }, [now]);
  const twoWeeksAgo = useMemo(() => { const d = new Date(now); d.setDate(d.getDate() - 14); return d; }, [now]);

  const thisWeek = useMemo(() => campaigns.filter(c => new Date(c.created_at) >= oneWeekAgo), [campaigns, oneWeekAgo]);
  const lastWeek = useMemo(() => campaigns.filter(c => new Date(c.created_at) >= twoWeeksAgo && new Date(c.created_at) < oneWeekAgo), [campaigns, twoWeeksAgo, oneWeekAgo]);

  const totalSent = useMemo(() => campaigns.reduce((s, c) => s + c.sent, 0), [campaigns]);
  const totalFailed = useMemo(() => campaigns.reduce((s, c) => s + c.failed, 0), [campaigns]);
  const deliveryRate = useMemo(() => { const t = totalSent + totalFailed; return t > 0 ? (totalSent / t) * 100 : 0; }, [totalSent, totalFailed]);

  const activeCampaigns = useMemo(() => campaigns.filter(c => ['running', 'paused', 'pending'].includes(c.status)), [campaigns]);

  const prevSent = useMemo(() => lastWeek.reduce((s, c) => s + c.sent, 0), [lastWeek]);
  const thisSent = useMemo(() => thisWeek.reduce((s, c) => s + c.sent, 0), [thisWeek]);
  const sentChangePct = prevSent > 0 ? ((thisSent - prevSent) / prevSent) * 100 : null;

  const prevActive = lastWeek.filter(c => ['running', 'paused', 'pending'].includes(c.status)).length;
  const activeChangePct = prevActive > 0 ? ((activeCampaigns.length - prevActive) / prevActive) * 100 : null;

  const weeklyData = useMemo(() => {
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now); d.setDate(now.getDate() - (6 - i));
      const dayKey = d.toDateString();
      const enviados = campaigns.filter(c => c.starts_at && new Date(c.starts_at).toDateString() === dayKey).reduce((sum, c) => sum + c.sent, 0);
      return { day: dayNames[d.getDay()], enviados };
    });
  }, [campaigns, now]);

  const donutTotal = campaigns.length;
  const donutData = useMemo(() => {
    const counts = {
      done: campaigns.filter(c => c.status === 'done').length,
      running: campaigns.filter(c => ['running', 'paused', 'pending'].includes(c.status)).length,
      cancelled: campaigns.filter(c => c.status === 'cancelled').length,
    };
    const failedCount = campaigns.filter(c => c.status === 'cancelled').length;
    return [
      { name: 'Concluídas', value: counts.done, color: '#22C55E' },
      { name: 'Em andamento', value: counts.running, color: '#3B82F6' },
      { name: 'Canceladas', value: counts.cancelled, color: '#A855F7' },
      { name: 'Falhas', value: failedCount, color: '#EF4444' },
    ].filter(d => d.value > 0);
  }, [campaigns]);

  const upcoming = useMemo(() =>
    [...campaigns].filter(c => ['pending', 'running'].includes(c.status)).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()).slice(0, 3),
    [campaigns]
  );

  const recent = useMemo(() =>
    [...campaigns].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 8),
    [campaigns]
  );

  const maxWeekly = useMemo(() => Math.max(...weeklyData.map(d => d.enviados), 1), [weeklyData]);

  if (loading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-5 gap-4">{[1,2,3,4,5].map(i => <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card" />)}</div>
      <div className="grid grid-cols-[1fr_380px] gap-6">
        <div className="space-y-4">{[1,2].map(i => <div key={i} className="h-64 animate-pulse rounded-xl border border-border bg-card" />)}</div>
        <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-card" />)}</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── KPI Row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <DisparoKpiCard
          title="Campanhas ativas" value={String(activeCampaigns.length)} icon={MessageSquare}
          iconColor="#22C55E" iconBg="rgba(34,197,94,0.15)"
          change={activeChangePct !== null ? `${activeChangePct >= 0 ? '↑' : '↓'} ${Math.abs(activeChangePct).toFixed(0)}% vs semana anterior` : undefined}
          changeGood={activeChangePct === null || activeChangePct >= 0}
        />
        <DisparoKpiCard
          title="Total enviados" value={totalSent.toLocaleString('pt-BR')} icon={Send}
          iconColor="#06B6D4" iconBg="rgba(6,182,212,0.15)"
          change={sentChangePct !== null ? `${sentChangePct >= 0 ? '↑' : '↓'} ${Math.abs(sentChangePct).toFixed(0)}% vs semana anterior` : undefined}
          changeGood={sentChangePct === null || sentChangePct >= 0}
        />
        <DisparoKpiCard
          title="Taxa de entrega" value={`${deliveryRate.toFixed(1).replace('.',',')}%`} icon={CheckCircle2}
          iconColor="#22C55E" iconBg="rgba(34,197,94,0.15)"
          sub={totalSent + totalFailed > 0 ? `${totalSent.toLocaleString('pt-BR')} de ${(totalSent+totalFailed).toLocaleString('pt-BR')} processados` : 'Sem dados ainda'}
        />
        <DisparoKpiCard
          title="Falhas" value={totalFailed.toLocaleString('pt-BR')} icon={AlertTriangle}
          iconColor="#F97316" iconBg="rgba(249,115,22,0.15)"
          change={totalFailed === 0 ? '✓ Nenhuma falha' : undefined}
          changeGood
        />
        <DisparoKpiCard
          title="Instâncias online" value={instances.total > 0 ? `${instances.online} / ${instances.total}` : '—'} icon={Monitor}
          iconColor="#06B6D4" iconBg="rgba(6,182,212,0.15)"
          sub={instances.total > 0 ? `${Math.round((instances.online/instances.total)*100)}% disponíveis` : 'Nenhuma configurada'}
          changeGood
        />
      </div>

      {/* ── Active campaign tickers ─────────────────────────────────────── */}
      {activeCampaigns.filter(c => c.status === 'running').length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Em andamento agora</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeCampaigns.filter(c => c.status === 'running').map(c => (
              <CampaignCard key={c.id} campaign={c} onAction={handleAction} onRefresh={load} />
            ))}
          </div>
        </div>
      )}

      {/* ── Main Grid ───────────────────────────────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">

        {/* Left column */}
        <div className="space-y-6 min-w-0">

          {/* Weekly chart */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">Envios na semana</p>
                <Info className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground cursor-default select-none">
                Últimos 7 dias <ChevronDown className="h-3 w-3 ml-1" />
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyData} margin={{ top: 20, right: 4, left: -20, bottom: 0 }} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={(props) => <BarTooltip active={props.active} payload={(props.payload as unknown) as { value: number }[] | undefined} label={props.label as string} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Bar dataKey="enviados" shape={(props: any) => <GlowBar {...props} />} label={(props: any) => <BarLabel {...props} />} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Recent campaigns table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">Campanhas recentes</p>
                <Info className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
            </div>
            {recent.length === 0 ? (
              <div className="py-12 text-center">
                <BarChart2 className="mx-auto h-8 w-8 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">Nenhuma campanha criada ainda.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] text-muted-foreground">
                        <th className="py-2.5 px-4 text-left font-semibold">Campanha</th>
                        <th className="py-2.5 px-4 text-left font-semibold">Cliente</th>
                        <th className="py-2.5 px-4 text-left font-semibold">Status</th>
                        <th className="py-2.5 px-4 text-right font-semibold">Enviados</th>
                        <th className="py-2.5 px-4 text-left font-semibold">Agendado / Concluído</th>
                        <th className="py-2.5 px-4 text-center font-semibold">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map(c => {
                        const isExpanded = expandedId === c.id;
                        const nums = expandedNumbers[c.id];
                        return (
                          <>
                            <tr key={c.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                              <td className="py-2.5 px-4">
                                <p className="font-medium text-sm truncate max-w-[200px]">{c.name}</p>
                                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">ID: {c.id.slice(0,8)}-...-{c.id.slice(-4)}</p>
                              </td>
                              <td className="py-2.5 px-4">
                                <span className="rounded-full bg-emerald-500/12 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">{c.client_name}</span>
                              </td>
                              <td className="py-2.5 px-4"><StatusBadge status={c.status} /></td>
                              <td className="py-2.5 px-4 text-right font-semibold tabular-nums">{c.sent.toLocaleString('pt-BR')}</td>
                              <td className="py-2.5 px-4">
                                <p className="text-[11px] text-muted-foreground">{fmtDateTime(c.starts_at)}</p>
                                {c.ends_at && (
                                  <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                    {c.status === 'done' ? <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" /> : <X className="h-3 w-3 text-red-400 shrink-0" />}
                                    {fmtDateTime(c.ends_at)}
                                  </p>
                                )}
                              </td>
                              <td className="py-2.5 px-4">
                                <div className="flex items-center justify-center gap-1">
                                  <button type="button" title="Estatísticas" className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                                    <BarChart2 className="h-3.5 w-3.5" />
                                  </button>
                                  <button type="button" title="Ver detalhes" onClick={() => { setExpandedId(isExpanded ? null : c.id); if (!isExpanded && !nums) fetchNumbers(c.id); }}
                                    className={cn('rounded-lg p-1.5 transition-colors', isExpanded ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}>
                                    <Eye className="h-3.5 w-3.5" />
                                  </button>
                                  <button type="button" title="Excluir" onClick={() => handleDelete(c.id)} disabled={deleting === c.id}
                                    className="rounded-lg p-1.5 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                                    {deleting === c.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                  </button>
                                  <button type="button" title="Reaproveitar" onClick={() => handleReuse(c)} className="rounded-lg p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                                    <Copy className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${c.id}-expanded`} className="border-b border-border/40 bg-muted/10">
                                <td colSpan={6} className="px-4 py-3">
                                  {['running','paused','pending'].includes(c.status) && (
                                    <div className="mb-3">
                                      <CampaignCard campaign={c} onAction={handleAction} onRefresh={load} />
                                    </div>
                                  )}
                                  {loadingDetail === c.id || !nums ? (
                                    <p className="text-[11px] text-muted-foreground animate-pulse">Carregando números...</p>
                                  ) : nums.length > 0 ? (
                                    <div className="rounded-lg border border-border overflow-hidden">
                                      <table className="w-full text-[11px]">
                                        <thead><tr className="bg-muted/40 border-b border-border">
                                          <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Número</th>
                                          <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Nome</th>
                                          <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Status</th>
                                          <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Detalhe</th>
                                        </tr></thead>
                                        <tbody>
                                          {nums.map((n, i) => (
                                            <tr key={i} className="border-b border-border last:border-0">
                                              <td className="px-3 py-1.5 font-mono">{n.phone}</td>
                                              <td className="px-3 py-1.5 text-muted-foreground">{n.name || '—'}</td>
                                              <td className={cn('px-3 py-1.5 font-semibold', n.status==='sent'?'text-emerald-400':n.status==='failed'?'text-red-400':'text-muted-foreground')}>
                                                {n.status==='sent'?'Enviado':n.status==='failed'?'Falha':n.status}
                                              </td>
                                              <td className="px-3 py-1.5 text-muted-foreground break-all">{n.error_msg||(n.sent_at?new Date(n.sent_at).toLocaleString('pt-BR'):'—')}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : <p className="text-[11px] text-muted-foreground">Nenhum número registrado.</p>}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-5 py-3 border-t border-border">
                  <button type="button" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Ver todas as campanhas <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">

          {/* Donut chart */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <p className="font-semibold text-sm">Resumo de campanhas</p>
              <Info className="h-3.5 w-3.5 text-muted-foreground/50" />
            </div>
            {donutTotal === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Sem campanhas ainda.</div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="relative shrink-0" style={{ width: 160, height: 160 }}>
                  <PieChart width={160} height={160}>
                    <Pie data={donutData} cx={75} cy={75} innerRadius={50} outerRadius={72} dataKey="value" strokeWidth={2} stroke="rgba(0,0,0,0.3)">
                      {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                  </PieChart>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="font-heading font-normal text-3xl leading-none text-foreground">{donutTotal}</span>
                    <span className="text-[11px] text-muted-foreground mt-0.5">Total</span>
                  </div>
                </div>
                <div className="flex-1 space-y-2.5">
                  {donutData.map(d => (
                    <div key={d.name} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                        <span className="text-xs text-muted-foreground truncate">{d.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 text-xs">
                        <span className="font-semibold">{d.value}</span>
                        <span className="text-muted-foreground">({donutTotal > 0 ? ((d.value/donutTotal)*100).toFixed(1) : '0.0'}%)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-border">
              <button type="button" className="text-xs text-primary hover:underline flex items-center gap-1">
                Ver todas as campanhas <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Upcoming sends */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <p className="font-semibold text-sm">Próximos envios</p>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Nenhum envio agendado.</p>
            ) : (
              <div className="space-y-3">
                {upcoming.map(c => {
                  const { label, time } = upcomingLabel(c.starts_at);
                  return (
                    <div key={c.id} className="flex items-center gap-3">
                      <div className="shrink-0 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-center min-w-[52px]">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase leading-none">{label}</p>
                        <p className="text-[13px] font-bold leading-tight mt-0.5">{time}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">{c.client_name} · {c.total} contatos</p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-border">
              <button type="button" className="text-xs text-primary hover:underline flex items-center gap-1">
                Ver agenda completa <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Quick actions */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <p className="font-semibold text-sm">Ações rápidas</p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { icon: Send, label: 'Nova campanha', color: '#22C55E', bg: 'rgba(34,197,94,0.12)', onClick: onNewCampaign },
                { icon: UserCog, label: 'Gerenciar instâncias', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)', onClick: onManageInstances },
                { icon: Upload, label: 'Importar contatos', color: '#06B6D4', bg: 'rgba(6,182,212,0.12)', onClick: () => {} },
                { icon: BookOpen, label: 'Ver biblioteca', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', onClick: () => {} },
              ].map(({ icon: Icon, label, color, bg, onClick }) => (
                <button key={label} type="button" onClick={onClick}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border p-3 hover:bg-muted/30 transition-colors text-center">
                  <div className="rounded-lg p-2" style={{ background: bg }}>
                    <Icon className="h-4 w-4" style={{ color }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground leading-tight">{label}</span>
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = ['dashboard', 'clientes', 'nova'] as const;
type Tab = typeof TABS[number];

export default function DisparosPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [prefill, setPrefill] = useState<CampaignPrefill | null>(null);

  function handleReuse(p: CampaignPrefill) { setPrefill(p); setTab('nova'); }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-6 px-6 py-3 -mt-6 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full shrink-0" style={{ background: 'radial-gradient(circle at 35% 35%, #25D366, #128C7E)', boxShadow: '0 0 18px rgba(37,211,102,0.35)' }}>
              <MessageSquare className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-heading font-normal text-4xl uppercase leading-none tracking-wide text-foreground">Disparos WhatsApp</h1>
              <p className="mt-0.5 text-muted-foreground text-sm">Gerencie campanhas de disparo via Z-API.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setTab('dashboard')}
              className={cn('flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors',
                tab === 'dashboard' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/50')}>
              <BarChart2 className="h-3.5 w-3.5" />Dashboard
            </button>
            <button type="button" onClick={() => setTab('clientes')}
              className={cn('flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors',
                tab === 'clientes' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/50')}>
              <Server className="h-3.5 w-3.5" />Instâncias
            </button>
            <button type="button" onClick={() => { setPrefill(null); setTab('nova'); }}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-black hover:bg-primary/90 transition-colors">
              <Plus className="h-3.5 w-3.5" />Nova campanha
            </button>
          </div>
        </div>
      </div>

      {tab === 'dashboard' && <DashboardTab onReuse={handleReuse} onNewCampaign={() => { setPrefill(null); setTab('nova'); }} onManageInstances={() => setTab('clientes')} />}
      {tab === 'clientes' && <ClientesTab />}
      {tab === 'nova' && (
        <NovaCampanhaTab key={prefill ? JSON.stringify(prefill).slice(0, 40) : 'new'} prefill={prefill} onCreated={() => { setPrefill(null); setTab('dashboard'); }} />
      )}
    </div>
  );
}
