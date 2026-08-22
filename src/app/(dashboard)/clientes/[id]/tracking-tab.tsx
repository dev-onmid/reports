'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Copy, Check, Trash2, Plus, RefreshCw, Eye, EyeOff,
  Settings2, MessageCircle, ShoppingCart, X, TrendingUp, Wifi, WifiOff, QrCode,
  HelpCircle, Zap, AlertCircle, Globe, BarChart3, Search, Webhook,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConversaoTile, GuideStepModal } from './conversao-guias';
import { DatalyticsCard } from './datalytics-card';
import { AgendorCard } from './agendor-card';
import { ClientDeliveryTab } from './delivery-tab';
import { LandingPagesTab } from './landing-pages-tab';

// ── Types ────────────────────────────────────────────────────────────────────

type WhatsAppProvider = 'zapi' | 'evolution';

type TrackingConfig = {
  pixel_id: string;
  meta_token: string;
  gatilho_compra: string;
  eventos_ativos: { lead: boolean; purchase: boolean };
  whatsapp_provider: WhatsAppProvider;
};

type Instance = {
  id: string;
  nome: string;
  instance_id: string;
  token: string;
  ativo: boolean;
  provider: WhatsAppProvider;
  created_at: string;
};

// Lead com atribuição rica (crm_leads via /api/tracking/leads) — substitui a
// leitura da tabela legada whatsapp_leads (que só tinha Source ID). O status de
// envio de conversão (Lead/Purchase) vive na sub-aba Log (conversion_log).
type WaLead = {
  id: string;
  nome: string | null;
  numero: string | null;
  origin: string | null;
  canal: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  keyword: string | null;
  placement: string | null;
  regiao_uf: string | null;
  regiao_cidade: string | null;
  regiao_fonte: string | null;
  has_ctwa: boolean;
  has_gclid: boolean;
  click_code: string | null;
  created_at: string;
};

type ConnState = 'open' | 'close' | 'connecting' | 'unknown' | 'n/a';

type LeadPeriod = '7d' | '30d' | '90d';

type ConversionConfig = {
  meta_pixel_id: string;
  meta_access_token: string;
  meta_test_event_code: string;
  meta_page_id: string;
  meta_ativo: boolean;
  google_customer_id: string;
  google_conversion_label_lead: string;
  google_conversion_label_contact: string;
  google_conversion_label_purchase: string;
  google_api_secret: string;
  google_measurement_id: string;
  google_ativo: boolean;
};

type EventoCustom = {
  id: string;
  status_gatilho: string;
  meta_event_name: string;
  google_conversion_label: string;
  ativo: boolean;
};

type ConversionLog = {
  id: string;
  lead_id: string | null;
  plataforma: 'meta' | 'google';
  event_name: string;
  event_id: string;
  telefone_hash: string | null;
  valor: number | null;
  status_resposta: number | null;
  resposta_body: string | null;
  enviado_em: string;
  sucesso: boolean;
};

// ── Shared helpers ────────────────────────────────────────────────────────────

const BASE = typeof window !== 'undefined' ? window.location.origin : '';

function maskPhone(phone: string): string {
  if (phone.length >= 10) return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ****-${phone.slice(-4)}`;
  return `****${phone.slice(-4)}`;
}

function toSlug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }
  return (
    <button onClick={copy} className="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-semibold transition-colors hover:bg-muted">
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {label ?? (copied ? 'Copiado!' : 'Copiar')}
    </button>
  );
}

function StateBadge({ state }: { state: ConnState }) {
  if (state === 'n/a') return null;
  const map: Record<ConnState, { label: string; className: string; dot: string }> = {
    open:       { label: 'Conectado',    className: 'bg-emerald-500/15 text-emerald-400', dot: 'bg-emerald-400' },
    connecting: { label: 'Aguardando',   className: 'bg-yellow-500/15 text-yellow-400',   dot: 'bg-yellow-400' },
    close:      { label: 'Desconectado', className: 'bg-muted text-muted-foreground',      dot: 'bg-muted-foreground' },
    unknown:    { label: 'Desconectado', className: 'bg-muted text-muted-foreground',      dot: 'bg-muted-foreground' },
    'n/a':      { label: '',             className: '',                                    dot: '' },
  };
  const s = map[state] ?? map.unknown;
  return (
    <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', s.className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <span className="absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-[11px] leading-relaxed text-muted-foreground shadow-xl whitespace-pre-line">
          {text}
        </span>
      )}
    </span>
  );
}

function HelpBtn({ text }: { text: string }) {
  return (
    <Tooltip text={text}>
      <HelpCircle className="ml-1 h-3.5 w-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
    </Tooltip>
  );
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-9 text-sm font-mono outline-none focus:border-primary" />
      <button type="button" onClick={() => setShow(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <div onClick={() => onChange(!value)} className={cn('relative h-5 w-9 rounded-full transition-colors cursor-pointer', value ? 'bg-primary' : 'bg-muted')}>
        <div className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', value ? 'translate-x-4' : 'translate-x-0.5')} />
      </div>
      <span className="text-xs font-medium">{label}</span>
    </label>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle, color = 'text-muted-foreground', action }: {
  icon: React.ElementType; title: string; subtitle?: string; color?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4 shrink-0', color)} />
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
        </div>
        {subtitle && <p className="pl-6 text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ClientTrackingTab({ clientId }: { clientId: string }) {

  // ── Sub-tab ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'whatsapp' | 'conversoes' | 'datalytics' | 'agendor' | 'delivery' | 'heatmap' | 'log'>('whatsapp');

  // ── Legacy tracking ────────────────────────────────────────────────────
  const [config, setConfig] = useState<TrackingConfig>({
    pixel_id: '', meta_token: '', gatilho_compra: 'compra aprovada',
    eventos_ativos: { lead: true, purchase: true }, whatsapp_provider: 'zapi',
  });
  const [saving, setSaving]       = useState(false);
  /** Qual guia de conversão está aberto (grade de botões → modal passo a passo). */
  const [guia, setGuia] = useState<'pixel' | 'capi' | 'google' | 'eventos' | null>(null);

  // ── Instances ──────────────────────────────────────────────────────────
  const [instances, setInstances]       = useState<Instance[]>([]);
  const [statuses, setStatuses]         = useState<Record<string, ConnState>>({});
  const statusTimer                     = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showModal, setShowModal]       = useState(false);
  const [instMode, setInstMode]         = useState<'create' | 'attach'>('create');
  const [instProvider, setInstProvider] = useState<WhatsAppProvider>('zapi');
  const [instForm, setInstForm]         = useState({ nome: '', instance_id: '', token: '' });
  const [instError, setInstError]       = useState('');
  const [adding, setAdding]             = useState(false);
  // Attach an existing (e.g. Disparos) instance to this client
  type AvailableInstance = { id: string; name: string; instance_id: string; provider: string; linked_client_id: string | null; linked_client_name: string | null };
  const [availableInsts, setAvailableInsts] = useState<AvailableInstance[]>([]);
  const [attachSearch, setAttachSearch]     = useState('');

  // ── QR ─────────────────────────────────────────────────────────────────
  const [qrInst, setQrInst]   = useState<Instance | null>(null);
  const [qrData, setQrData]   = useState<{ base64?: string; code?: string } | null>(null);
  // Fases do modal: aguardando leitura → sucesso/erro (fechamento automático)
  const [qrPhase, setQrPhase] = useState<'loading' | 'qr' | 'success' | 'error'>('loading');
  const [qrSeconds, setQrSeconds] = useState(40);

  // ── Leads ──────────────────────────────────────────────────────────────
  const [leads, setLeads]   = useState<WaLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState<LeadPeriod>('30d');
  const periodDays = { '7d': 7, '30d': 30, '90d': 90 } as const;

  // ── Conversion config ──────────────────────────────────────────────────
  const [convConfig, setConvConfig] = useState<ConversionConfig>({
    meta_pixel_id: '', meta_access_token: '', meta_test_event_code: '', meta_page_id: '', meta_ativo: false,
    google_customer_id: '', google_conversion_label_lead: '', google_conversion_label_contact: '',
    google_conversion_label_purchase: '', google_api_secret: '', google_measurement_id: '', google_ativo: false,
  });
  const [savingConv, setSavingConv]       = useState(false);
  const [testingMeta, setTestingMeta]     = useState(false);
  const [testingGoogle, setTestingGoogle] = useState(false);
  const [testResult, setTestResult]       = useState<{ platform: string; sucesso: boolean; body: string } | null>(null);
  const [eventosCustom, setEventosCustom] = useState<EventoCustom[]>([]);
  const [newEvento, setNewEvento]         = useState({ status_gatilho: '', meta_event_name: '', google_conversion_label: '' });
  // Etapas reais do funil do CRM — viram um <select> no guia de Eventos por
  // Status (digitar o nome da etapa na mão era a maior fonte de evento morto:
  // "proposta" ≠ "Proposta" e o disparo nunca casava).
  const [stageOptions, setStageOptions] = useState<string[]>([]);

  useEffect(() => {
    if (guia !== 'eventos' || stageOptions.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const funnels = await fetch(`/api/crm/funnels?clientId=${encodeURIComponent(clientId)}`)
          .then(r => r.ok ? r.json() as Promise<{ id: string }[]> : []);
        const perFunnel = await Promise.all(funnels.map(f =>
          fetch(`/api/crm/funnels/${f.id}/stages`)
            .then(r => r.ok ? r.json() as Promise<{ label: string }[]> : [])
            .catch(() => [] as { label: string }[]),
        ));
        if (cancelled) return;
        const labels = [...new Set(perFunnel.flat().map(s => s.label).filter(Boolean))];
        setStageOptions(labels);
      } catch { /* sem etapas → o campo vira texto livre, como antes */ }
    })();
    return () => { cancelled = true; };
  }, [guia, clientId, stageOptions.length]);
  const [addingEvento, setAddingEvento]   = useState(false);

  // ── Conversion log ─────────────────────────────────────────────────────
  const [convLog, setConvLog]           = useState<ConversionLog[]>([]);
  const [convLogFilter, setConvLogFilter] = useState<'all' | 'meta' | 'google'>('all');
  const [logModal, setLogModal]           = useState<ConversionLog | null>(null);

  // ── Polling ────────────────────────────────────────────────────────────

  const fetchStatuses = useCallback((insts: Instance[]) => {
    insts.filter(i => i.provider === 'evolution').forEach(inst => {
      fetch(`/api/clients/${clientId}/tracking/instances/${inst.id}/status`)
        .then(r => r.ok ? r.json() as Promise<{ state: string }> : null)
        .then(d => { if (d?.state) setStatuses(prev => ({ ...prev, [inst.id]: d.state as ConnState })); })
        .catch(() => {});
    });
  }, [clientId]);

  useEffect(() => {
    if (statusTimer.current) clearInterval(statusTimer.current);
    fetchStatuses(instances);
    if (instances.some(i => i.provider === 'evolution')) {
      statusTimer.current = setInterval(() => fetchStatuses(instances), 30_000);
    }
    return () => { if (statusTimer.current) clearInterval(statusTimer.current); };
  }, [instances, fetchStatuses]);

  // ── Initial load ───────────────────────────────────────────────────────

  const loadLeads = useCallback((p: LeadPeriod) => {
    fetch(`/api/tracking/leads?clientId=${encodeURIComponent(clientId)}&days=${periodDays[p]}`)
      .then(r => r.ok ? r.json() as Promise<{ leads: WaLead[] }> : null)
      .then(d => setLeads(d?.leads ?? [])).catch(() => setLeads([]));
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/clients/${clientId}/tracking`).then(r => r.ok ? r.json() as Promise<TrackingConfig> : null),
      fetch(`/api/clients/${clientId}/tracking/instances`).then(r => r.ok ? r.json() as Promise<Instance[]> : []),
      fetch(`/api/tracking/leads?clientId=${encodeURIComponent(clientId)}&days=30`)
        .then(r => r.ok ? r.json() as Promise<{ leads: WaLead[] }> : null)
        .then(d => d?.leads ?? []),
      fetch(`/api/clients/${clientId}/conversions`).then(r => r.ok ? r.json() as Promise<Partial<ConversionConfig>> : null),
      fetch(`/api/clients/${clientId}/conversions/eventos-custom`).then(r => r.ok ? r.json() as Promise<EventoCustom[]> : []),
      fetch(`/api/clients/${clientId}/conversions/log?days=30&limit=100`).then(r => r.ok ? r.json() as Promise<ConversionLog[]> : []),
    ]).then(([cfg, insts, ls, convCfg, eventos, log]) => {
      if (cfg) setConfig(cfg);
      setInstances(insts ?? []);
      setLeads(ls ?? []);
      if (convCfg) setConvConfig(prev => ({ ...prev, ...convCfg }));
      setEventosCustom(eventos ?? []);
      setConvLog(log ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { if (!loading) loadLeads(period); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────────────────

  async function saveConfig() {
    setSaving(true);
    try { await fetch(`/api/clients/${clientId}/tracking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }); }
    finally { setSaving(false); }
  }

  async function saveConvConfig() {
    setSavingConv(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/conversions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(convConfig) });
      if (res.ok) setConvConfig(await res.json() as ConversionConfig);
    } finally { setSavingConv(false); }
  }

  async function testConversion(platform: 'meta' | 'google') {
    // Pré-checagens no estado da tela — evitam o teste "mudo" (o envio real tem
    // gate por ativo/config e sai sem logar nada, o que virava um "Erro" seco).
    if (platform === 'meta' && !convConfig.meta_ativo) {
      setTestResult({ platform, sucesso: false, body: 'O Meta CAPI está DESATIVADO — ligue o interruptor no passo "Ativar" e clique em Salvar antes de testar.' });
      return;
    }
    if (platform === 'google' && !convConfig.google_ativo) {
      setTestResult({ platform, sucesso: false, body: 'As conversões Google estão DESATIVADAS — ligue o interruptor no passo "Ativar" e clique em Salvar antes de testar.' });
      return;
    }
    platform === 'meta' ? setTestingMeta(true) : setTestingGoogle(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/conversions/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform }) });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; resultado?: { sucesso: boolean; resposta_body: string } | null };
      const body = data.resultado?.resposta_body
        ?? data.error
        ?? (res.ok
          ? 'Nada foi enviado — salve a configuração primeiro (o teste usa a config já GRAVADA, não o que está digitado na tela).'
          : 'Erro ao executar o teste.');
      setTestResult({ platform, sucesso: data.resultado?.sucesso ?? false, body });
    } finally { platform === 'meta' ? setTestingMeta(false) : setTestingGoogle(false); }
  }

  async function addEvento() {
    if (!newEvento.status_gatilho) return;
    setAddingEvento(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/conversions/eventos-custom`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newEvento, ativo: true }) });
      if (res.ok) {
        const row = await res.json() as EventoCustom;
        setEventosCustom(prev => { const idx = prev.findIndex(e => e.id === row.id); return idx >= 0 ? prev.map((e, i) => i === idx ? row : e) : [...prev, row]; });
        setNewEvento({ status_gatilho: '', meta_event_name: '', google_conversion_label: '' });
      }
    } finally { setAddingEvento(false); }
  }

  async function removeEvento(eventoId: string) {
    await fetch(`/api/clients/${clientId}/conversions/eventos-custom?eventoId=${eventoId}`, { method: 'DELETE' });
    setEventosCustom(prev => prev.filter(e => e.id !== eventoId));
  }

  async function toggleEvento(evento: EventoCustom) {
    const res = await fetch(`/api/clients/${clientId}/conversions/eventos-custom`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...evento, ativo: !evento.ativo }) });
    if (res.ok) { const row = await res.json() as EventoCustom; setEventosCustom(prev => prev.map(e => e.id === row.id ? row : e)); }
  }

  async function refreshConvLog() {
    const filter = convLogFilter !== 'all' ? `&plataforma=${convLogFilter}` : '';
    const rows = await fetch(`/api/clients/${clientId}/conversions/log?days=30&limit=100${filter}`).then(r => r.ok ? r.json() as Promise<ConversionLog[]> : []);
    setConvLog(rows);
  }

  function openAddModal() { setInstForm({ nome: '', instance_id: '', token: '' }); setInstProvider('zapi'); setInstError(''); setInstMode('create'); setAttachSearch(''); setShowModal(true); }

  async function loadAvailableInstances() {
    try {
      const res = await fetch(`/api/clients/${clientId}/tracking/instances/available`);
      if (res.ok) setAvailableInsts(await res.json() as AvailableInstance[]);
    } catch { /* ignore */ }
  }

  async function attachInstance(sourceId: string) {
    setInstError('');
    setAdding(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/tracking/instances/attach`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId }),
      });
      const data = await res.json() as Instance & { error?: string };
      if (!res.ok) { setInstError(data.error ?? 'Erro ao vincular instância.'); return; }
      setInstances(prev => prev.some(i => i.id === data.id) ? prev.map(i => i.id === data.id ? data : i) : [...prev, data]);
      setShowModal(false);
    } finally { setAdding(false); }
  }

  async function addInstance() {
    setInstError('');
    if (!instForm.nome) { setInstError('Nome é obrigatório.'); return; }
    if (instProvider === 'zapi' && (!instForm.instance_id || !instForm.token)) { setInstError('Instance ID e Token são obrigatórios para Z-API.'); return; }
    if (instProvider === 'evolution' && !instForm.instance_id) { setInstError('Nome da instância Evolution API é obrigatório.'); return; }
    if (instProvider === 'evolution' && /\s/.test(instForm.instance_id)) { setInstError('O nome da instância não pode ter espaços. Use hífens: ex. celular-matheus'); return; }
    setAdding(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/tracking/instances`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...instForm, provider: instProvider }) });
      const data = await res.json() as Instance & { error?: string };
      if (!res.ok) { setInstError(data.error ?? 'Erro ao salvar instância.'); return; }
      setInstances(prev => [...prev, data]);
      setShowModal(false);
    } finally { setAdding(false); }
  }

  async function removeInstance(inst: Instance) {
    const label = inst.provider === 'evolution' ? 'Remover instância e deletar na Evolution API? Leads não serão apagados.' : 'Remover esta instância? Leads vinculados não serão apagados.';
    if (!confirm(label)) return;
    await fetch(`/api/clients/${clientId}/tracking/instances/${inst.id}`, { method: 'DELETE' });
    setInstances(prev => prev.filter(i => i.id !== inst.id));
    setStatuses(prev => { const n = { ...prev }; delete n[inst.id]; return n; });
  }

  async function toggleInstance(inst: Instance) {
    await fetch(`/api/clients/${clientId}/tracking/instances/${inst.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: !inst.ativo }) });
    setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, ativo: !i.ativo } : i));
  }

  async function fetchQr(inst: Instance) {
    setQrPhase('loading'); setQrData(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/tracking/instances/${inst.id}/connect`);
      const data = res.ok ? await res.json() as { base64?: string; code?: string } : null;
      setQrData(data);
      if (data?.base64) { setQrSeconds(40); setQrPhase('qr'); }
      else if (statuses[inst.id] === 'open') setQrPhase('success');
      else setQrPhase('error');
    } catch {
      setQrPhase('error');
    }
  }

  function openQr(inst: Instance) {
    setQrInst(inst);
    void fetchQr(inst);
  }

  function refreshQr() {
    if (qrInst) void fetchQr(qrInst);
  }

  function closeQr() {
    setQrInst(null); setQrData(null); setQrPhase('loading');
  }

  // Enquanto o QR está na tela: poll de status a cada 3s (detecta a leitura),
  // countdown que renova o QR antes de expirar; sucesso/erro fecham sozinhos.
  useEffect(() => {
    if (!qrInst) return;

    if (qrPhase === 'qr') {
      const instId = qrInst.id;
      const poll = setInterval(() => {
        fetch(`/api/clients/${clientId}/tracking/instances/${instId}/status`)
          .then(r => r.ok ? r.json() as Promise<{ state: string }> : null)
          .then(d => {
            if (d?.state) setStatuses(prev => ({ ...prev, [instId]: d.state as ConnState }));
            if (d?.state === 'open') setQrPhase('success');
          })
          .catch(() => { /* rede instável não derruba o modal */ });
      }, 3000);
      const tick = setInterval(() => {
        setQrSeconds(s => {
          if (s <= 1) { refreshQr(); return 40; }
          return s - 1;
        });
      }, 1000);
      return () => { clearInterval(poll); clearInterval(tick); };
    }

    if (qrPhase === 'success') {
      const t = setTimeout(closeQr, 2500);
      return () => clearTimeout(t);
    }

    if (qrPhase === 'error') {
      const t = setTimeout(closeQr, 5000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrInst, qrPhase]);

  // ── Stats ──────────────────────────────────────────────────────────────
  const totalLeads = leads.length;
  const totalConv  = leads.filter(l => l.has_ctwa || l.has_gclid || l.campaign_name || l.click_code).length;
  const taxaConv   = totalLeads > 0 ? `${Math.round((totalConv / totalLeads) * 100)}%` : '—';

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4 pt-2">
        {[1, 2, 3].map(i => <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-muted/30" />)}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 pt-2">

      {/* Sub-tab navigation */}
      <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card p-1 w-fit">
        {([
          { id: 'whatsapp'  as const, label: 'WhatsApp',   icon: Wifi },
          { id: 'conversoes' as const, label: 'Conversões', icon: Zap },
          { id: 'datalytics' as const, label: 'Datalytics', icon: Webhook },
          { id: 'agendor' as const, label: 'Agendor', icon: Webhook },
          { id: 'delivery' as const, label: 'Delivery', icon: Webhook },
          { id: 'heatmap' as const, label: 'Mapa de Calor', icon: Webhook },
          { id: 'log'       as const, label: 'Log',         icon: BarChart3 },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)} className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all',
            activeTab === id ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}>
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ══════════ TAB: WhatsApp ══════════ */}
      {activeTab === 'whatsapp' && (
        <div className="space-y-6">

          {/* Instâncias */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <SectionHeader icon={Wifi} title="Instâncias WhatsApp" subtitle="Cada instância gera uma URL de webhook única para receber mensagens." />
              <button onClick={openAddModal} className="flex items-center gap-1 rounded-lg bg-primary/10 border border-primary/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Adicionar instância
              </button>
            </div>

            {instances.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <Wifi className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">Nenhuma instância cadastrada.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {instances.map(inst => {
                  const webhookUrl = `${BASE}/api/webhook/whatsapp/${inst.id}`;
                  const state: ConnState = statuses[inst.id] ?? 'unknown';
                  const isEvolution = inst.provider === 'evolution';
                  return (
                    <div key={inst.id} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">{inst.nome}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', isEvolution ? 'bg-violet-500/15 text-violet-400' : 'bg-blue-500/15 text-blue-400')}>
                            {isEvolution ? 'Evolution API' : 'Z-API'}
                          </span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', inst.ativo ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground')}>
                            {inst.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                          {isEvolution && <StateBadge state={state} />}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-[10px] text-primary font-mono truncate max-w-xs">{webhookUrl}</code>
                          <CopyBtn text={webhookUrl} label="URL" />
                        </div>
                        <p className="text-[10px] text-muted-foreground">{isEvolution ? 'Instância Evolution' : 'ID Z-API'}: {inst.instance_id}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                        {isEvolution && state !== 'open' && (
                          <button onClick={() => openQr(inst)} className="flex items-center gap-1 rounded-lg border border-violet-400/30 px-2 py-1 text-xs font-semibold text-violet-400 hover:bg-violet-500/10 transition-colors">
                            <QrCode className="h-3.5 w-3.5" /> Conectar
                          </button>
                        )}
                        <button onClick={() => toggleInstance(inst)} className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                          {inst.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                        <button onClick={() => removeInstance(inst)} className="rounded-lg border border-red-400/30 p-1.5 text-red-400 hover:bg-red-500/10 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Leads */}
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Leads capturados', value: totalLeads, icon: MessageCircle, color: '#55F52F' },
                { label: 'Com atribuição',   value: totalConv,  icon: ShoppingCart,  color: '#3b82f6' },
                { label: 'Taxa de rastreio', value: taxaConv,   icon: TrendingUp,    color: '#a855f7' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="relative overflow-hidden rounded-xl border bg-card p-4" style={{ borderColor: `${color}44` }}>
                  <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 85% 15%, ${color}22, transparent 50%)` }} />
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
                    <Icon className="h-4 w-4" style={{ color }} />
                  </div>
                  <p className="mt-2 text-base font-bold tabular-nums" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  {totalLeads} lead{totalLeads !== 1 ? 's' : ''} capturado{totalLeads !== 1 ? 's' : ''}
                </p>
                <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
                  {(['7d', '30d', '90d'] as LeadPeriod[]).map(p => (
                    <button key={p} onClick={() => setPeriod(p)} className={cn('rounded-md px-3 py-1 text-xs font-semibold transition-all', period === p ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground')}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              {leads.length === 0 ? (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border">
                  <p className="text-xs text-muted-foreground">Nenhum lead no período.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        {['Lead', 'Origem', 'Campanha › Conjunto › Anúncio', 'Keyword / Posição', 'Região', 'Data'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px] last:text-right">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((lead, i) => {
                        const hierarchy = [lead.campaign_name, lead.adset_name, lead.ad_name].filter(Boolean).join(' › ')
                          || [lead.utm_campaign, lead.utm_content].filter(Boolean).join(' › ');
                        const kw = lead.keyword ?? lead.placement ?? null;
                        const regiao = lead.regiao_cidade
                          ? `${lead.regiao_cidade}${lead.regiao_uf ? ` · ${lead.regiao_uf}` : ''}`
                          : lead.regiao_uf ?? null;
                        return (
                          <tr key={lead.id} className={cn('border-b border-border/40 last:border-0', i % 2 === 1 ? 'bg-muted/10' : '')}>
                            <td className="px-3 py-2 max-w-[150px]">
                              <p className="truncate font-medium">{lead.nome ?? '—'}</p>
                              {lead.numero && <p className="font-mono text-[10px] text-muted-foreground">{maskPhone(lead.numero)}</p>}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-bold">{lead.origin ?? '—'}</span>
                                {lead.has_ctwa && <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold text-blue-400" title="Click-to-WhatsApp Ad">CTWA</span>}
                                {lead.has_gclid && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-400" title="Google click id">gclid</span>}
                                {lead.click_code && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400" title={`Clique casado pelo código ${lead.click_code}`}>link</span>}
                              </div>
                            </td>
                            <td className="px-3 py-2 max-w-[220px]">
                              {hierarchy
                                ? <span className="text-[11px] leading-tight" title={hierarchy}>{hierarchy.length > 60 ? `${hierarchy.slice(0, 60)}…` : hierarchy}</span>
                                : <span className="text-muted-foreground/50">—</span>}
                            </td>
                            <td className="px-3 py-2 max-w-[130px] truncate text-muted-foreground" title={kw ?? undefined}>{kw ?? '—'}</td>
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{regiao ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground tabular-nums whitespace-nowrap">{new Date(lead.created_at).toLocaleDateString('pt-BR')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ══════════ TAB: Conversões ══════════ */}
      {activeTab === 'conversoes' && (
        <div className="space-y-5">
          <p className="text-xs text-muted-foreground">
            Escolha o que configurar — cada item abre um passo a passo com o guia de onde achar cada valor.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <ConversaoTile
              icon={BarChart3} iconColor="text-blue-400"
              title="Rastreio por Pixel"
              description="Eventos via Pixel quando o lead chega de anúncio Meta (ctwa_clid) ou o atendente digita o gatilho de compra."
              status={
                config.pixel_id && config.meta_token ? { label: 'Configurado', tone: 'on' }
                  : config.pixel_id || config.meta_token ? { label: 'Incompleto', tone: 'partial' }
                  : { label: 'Não configurado', tone: 'off' }
              }
              onClick={() => setGuia('pixel')}
            />
            <ConversaoTile
              icon={Zap} iconColor="text-blue-400"
              title="Conversão via API (Meta CAPI)"
              description="Envio direto do servidor. Funciona para todos os leads, independente da origem do clique."
              status={
                convConfig.meta_ativo ? { label: 'Ativo', tone: 'on' }
                  : convConfig.meta_pixel_id ? { label: 'Desativado', tone: 'partial' }
                  : { label: 'Não configurado', tone: 'off' }
              }
              onClick={() => setGuia('capi')}
            />
            <ConversaoTile
              icon={Globe} iconColor="text-yellow-400"
              title="Google — Conversões"
              description="Lead com gclid vira conversão offline no Google Ads (atribui campanha e palavra-chave). Sem gclid, cai no GA4."
              status={
                convConfig.google_ativo ? { label: 'Ativo', tone: 'on' }
                  : convConfig.google_conversion_label_lead ? { label: 'Desativado', tone: 'partial' }
                  : { label: 'Não configurado', tone: 'off' }
              }
              onClick={() => setGuia('google')}
            />
            <ConversaoTile
              icon={Settings2}
              title="Eventos por Status"
              description="Dispara evento Meta e/ou Google quando o lead muda de status no CRM."
              status={
                eventosCustom.length > 0
                  ? { label: `${eventosCustom.length} evento${eventosCustom.length === 1 ? '' : 's'}`, tone: 'on' }
                  : { label: 'Nenhum', tone: 'off' }
              }
              onClick={() => setGuia('eventos')}
            />
          </div>

          {/* ── Guia 1: Rastreio por Pixel ─────────────────────────────────── */}
          <GuideStepModal
            open={guia === 'pixel'} onClose={() => setGuia(null)}
            icon={BarChart3} iconColor="text-blue-400"
            title="Rastreio por Pixel"
            subtitle="Eventos via Pixel para leads vindos de anúncio Meta."
            finishing={saving}
            onFinish={async () => { await saveConfig(); setGuia(null); }}
            steps={[
              {
                label: 'Pixel ID',
                guide: 'É o MESMO número usado no guia "Conversão via API" — se já configurou lá, copie de lá.\n1. business.facebook.com → "Gerenciador de Eventos"\n2. Selecione o conjunto de dados do cliente\n3. Copie a "Identificação do conjunto de dados" (coluna da direita da Visão geral, ex: 1234567890123456)',
                body: (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">Pixel ID</label>
                    <input value={config.pixel_id} onChange={e => setConfig(p => ({ ...p, pixel_id: e.target.value }))} placeholder="Ex: 1234567890123456" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                  </div>
                ),
              },
              {
                label: 'Token',
                guide: 'Pode usar o MESMO token do guia "Conversão via API".\n1. No Gerenciador de Eventos, clique no conjunto de dados\n2. Aba "Configurações"\n3. Role até "API de Conversões" → "Gerar token de acesso"\n⚠️ Nunca compartilhe este token.',
                body: (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">Token da API de Conversões</label>
                    <SecretInput value={config.meta_token} onChange={v => setConfig(p => ({ ...p, meta_token: v }))} placeholder="EAAxxxxxxx..." />
                  </div>
                ),
              },
              {
                label: 'Gatilho',
                guide: 'Combina com o atendente do cliente: quando fechar uma venda, ele digita o gatilho + valor NA PRÓPRIA CONVERSA do WhatsApp.\nEx.: gatilho "compra aprovada" → o atendente digita "compra aprovada 297" → o sistema dispara o Purchase de R$ 297 pra campanha na hora.\nDica: use um texto que o atendente não digitaria sem querer.',
                body: (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">Gatilho de compra</label>
                      <input value={config.gatilho_compra} onChange={e => setConfig(p => ({ ...p, gatilho_compra: e.target.value }))} placeholder="compra aprovada" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-semibold text-muted-foreground">Eventos ativos</p>
                      {([
                        { key: 'lead' as const, label: 'Lead', icon: MessageCircle },
                        { key: 'purchase' as const, label: 'Compra (Purchase)', icon: ShoppingCart },
                      ] as const).map(({ key, label, icon: Icon }) => (
                        <label key={key} className="flex cursor-pointer items-center gap-3">
                          <div onClick={() => setConfig(p => ({ ...p, eventos_ativos: { ...p.eventos_ativos, [key]: !p.eventos_ativos[key] } }))} className={cn('relative h-5 w-9 rounded-full transition-colors cursor-pointer', config.eventos_ativos[key] ? 'bg-primary' : 'bg-muted')}>
                            <div className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', config.eventos_ativos[key] ? 'translate-x-4' : 'translate-x-0.5')} />
                          </div>
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ),
              },
            ]}
          />

          {/* ── Guia 2: Meta CAPI ──────────────────────────────────────────── */}
          <GuideStepModal
            open={guia === 'capi'} onClose={() => setGuia(null)}
            icon={Zap} iconColor="text-blue-400"
            title="Conversão via API (Meta CAPI)"
            subtitle="Envio server-side — funciona para todos os leads."
            finishing={savingConv}
            onFinish={async () => { await saveConvConfig(); setGuia(null); }}
            footerExtra={
              <button onClick={() => testConversion('meta')} disabled={testingMeta} className="flex items-center justify-center gap-1.5 rounded-lg border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-xs font-bold text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 transition-colors">
                {testingMeta ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Testar conexão
              </button>
            }
            steps={[
              {
                label: 'Ativar',
                guide: 'Ligue o interruptor abaixo (sem ele, NADA é enviado — mesmo com tudo preenchido).\n1. business.facebook.com → "Gerenciador de Eventos" → "Conjuntos de dados"\n2. Selecione o conjunto do cliente\n3. Na Visão geral, coluna da direita: copie a "Identificação do conjunto de dados" (ex: 221663293188760) — esse é o Pixel ID',
                body: (
                  <div className="space-y-4">
                    <Toggle value={convConfig.meta_ativo} onChange={v => setConvConfig(p => ({ ...p, meta_ativo: v }))} label="Ativar Meta CAPI" />
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">Pixel ID</label>
                      <input value={convConfig.meta_pixel_id} onChange={e => setConvConfig(p => ({ ...p, meta_pixel_id: e.target.value }))} placeholder="Ex: 1234567890123456" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                    </div>
                  </div>
                ),
              },
              {
                label: 'Token',
                guide: '1. No Gerenciador de Eventos, clique no Pixel\n2. Aba "Configurações"\n3. Role até "API de Conversões"\n4. "Gerar token de acesso"\n⚠️ Nunca compartilhe este token.',
                body: (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">Token da API</label>
                    <SecretInput value={convConfig.meta_access_token} onChange={v => setConvConfig(p => ({ ...p, meta_access_token: v }))} placeholder="EAAxxxxxxx..." />
                  </div>
                ),
              },
              {
                label: 'Page ID',
                guide: '1. Gerenciador de Eventos → clique no Pixel de Mensagem\n2. Aba "Configurações" → "Dados Vinculados"\n3. Copie o ID que aparece embaixo da Página conectada\n⚠️ Sem isso, os eventos são aceitos pela Meta (200 OK) mas NÃO aparecem atribuídos na campanha — falha silenciosa.',
                body: (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">Page ID (obrigatório p/ WhatsApp)</label>
                    <input value={convConfig.meta_page_id} onChange={e => setConvConfig(p => ({ ...p, meta_page_id: e.target.value }))} placeholder="Ex: 1029384756" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                  </div>
                ),
              },
              {
                label: 'Teste',
                optional: true,
                guide: 'Opcional — valida que Pixel, Token e Page ID estão certos.\n1. Gerenciador de Eventos → aba "Testar eventos" → canal "Mensagem" → "WhatsApp" → copie o código (ex: TEST12345)\n2. Cole aqui e clique em SALVAR (o teste usa a config gravada, não a digitada)\n3. Reabra este guia e clique em "Testar conexão"\n4. Se a resposta falar "ctwa_clid ausente", está TUDO CERTO — o lead fictício do teste não veio de anúncio; leads reais de anúncio trazem esse código e passam\n⚠️ Depois de confirmar, APAGUE o código e salve de novo. Se ficar preenchido, TODA conversão real vira "teste": a Meta aceita (200 OK) mas a campanha nunca recebe nada.',
                body: (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">Código de Teste</label>
                      <input value={convConfig.meta_test_event_code} onChange={e => setConvConfig(p => ({ ...p, meta_test_event_code: e.target.value }))} placeholder="TEST12345 (opcional)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                    </div>
                    {testResult?.platform === 'meta' && (
                      <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs', testResult.sucesso ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-400' : 'border-red-400/30 bg-red-500/10 text-red-400')}>
                        {testResult.sucesso ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        <span className="font-mono break-all">{testResult.body.slice(0, 200)}</span>
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Dica: salve antes de testar — o teste usa a configuração já gravada.
                    </p>
                  </div>
                ),
              },
            ]}
          />

          {/* ── Guia 3: Google Conversões ──────────────────────────────────── */}
          <GuideStepModal
            open={guia === 'google'} onClose={() => setGuia(null)}
            icon={Globe} iconColor="text-yellow-400"
            title="Google — Conversões"
            subtitle="Conversão offline via gclid, com fallback GA4."
            finishing={savingConv}
            onFinish={async () => { await saveConvConfig(); setGuia(null); }}
            footerExtra={
              <button onClick={() => testConversion('google')} disabled={testingGoogle} className="flex items-center justify-center gap-1.5 rounded-lg border border-yellow-400/30 bg-yellow-500/10 px-4 py-2 text-xs font-bold text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-50 transition-colors">
                {testingGoogle ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Testar conexão
              </button>
            }
            steps={[
              {
                label: 'Ativar',
                optional: true,
                guide: 'Ligue o interruptor e avance — na maioria dos casos NÃO precisa preencher nada aqui.\nO Customer ID (ex: 123-456-7890, canto superior direito do painel Google Ads) só é necessário se o cliente NÃO estiver com a conta Google vinculada em Vincular Contas.',
                body: (
                  <div className="space-y-4">
                    <Toggle value={convConfig.google_ativo} onChange={v => setConvConfig(p => ({ ...p, google_ativo: v }))} label="Ativar conversões Google" />
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">Customer ID (opcional)</label>
                      <input value={convConfig.google_customer_id} onChange={e => setConvConfig(p => ({ ...p, google_customer_id: e.target.value }))} placeholder="123-456-7890" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                    </div>
                  </div>
                ),
              },
              {
                label: 'Ações de conversão',
                guide: 'No painel do Google Ads: Metas → Conversões → Resumo.\nJÁ EXISTE a ação? Copie o NOME dela exatamente como aparece na lista (ex.: "Lead WhatsApp") e cole abaixo.\nNÃO existe? Crie: "+ Nova ação de conversão" → Importar → "CRMs, arquivos ou outras fontes de dados" → Cliques → dê um nome (ex.: "Lead WhatsApp") → Salvar. Depois copie esse nome aqui.\nPreencha só as que o cliente usa — pode deixar as outras vazias.\n⚠️ NÃO é o rótulo do gtag (aquele código tipo AbC-D12...). É o NOME (ou ID numérico) da ação — com o rótulo, o envio falha.',
                body: (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">Ação de conversão — Lead</label>
                      <input value={convConfig.google_conversion_label_lead} onChange={e => setConvConfig(p => ({ ...p, google_conversion_label_lead: e.target.value }))} placeholder="Lead WhatsApp" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">Ação de conversão — Engajamento</label>
                      <input value={convConfig.google_conversion_label_contact} onChange={e => setConvConfig(p => ({ ...p, google_conversion_label_contact: e.target.value }))} placeholder="Contato WhatsApp" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">Ação de conversão — Purchase</label>
                      <input value={convConfig.google_conversion_label_purchase} onChange={e => setConvConfig(p => ({ ...p, google_conversion_label_purchase: e.target.value }))} placeholder="Compra WhatsApp" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                    </div>
                  </div>
                ),
              },
              {
                label: 'Fallback GA4',
                optional: true,
                guide: 'Opcional — só pro fallback GA4 de leads SEM gclid.\n1. analytics.google.com\n2. Administrador → Fluxos de dados\n3. Measurement ID começa com G-\n4. Na mesma tela, "Measurement Protocol API secrets" → Criar',
                body: (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">Measurement ID</label>
                      <input value={convConfig.google_measurement_id} onChange={e => setConvConfig(p => ({ ...p, google_measurement_id: e.target.value }))} placeholder="G-XXXXXXXXXX" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">API Secret</label>
                      <SecretInput value={convConfig.google_api_secret} onChange={v => setConvConfig(p => ({ ...p, google_api_secret: v }))} placeholder="API Secret" />
                    </div>
                    {testResult?.platform === 'google' && (
                      <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs', testResult.sucesso ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-400' : 'border-red-400/30 bg-red-500/10 text-red-400')}>
                        {testResult.sucesso ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        <span className="font-mono break-all">{testResult.body.slice(0, 200)}</span>
                      </div>
                    )}
                  </div>
                ),
              },
            ]}
          />

          {/* ── Guia 4: Eventos por Status ─────────────────────────────────── */}
          {/* Passo único de propósito: é gestão de lista (cada linha grava na hora
              pelos próprios endpoints), não um formulário linear como os outros. */}
          <GuideStepModal
            open={guia === 'eventos'} onClose={() => setGuia(null)}
            icon={Settings2}
            title="Eventos por Status"
            subtitle="Dispara evento quando o lead muda de status no CRM."
            finishLabel="Concluir"
            onFinish={() => setGuia(null)}
            steps={[{
              label: 'Eventos',
              guide: 'Receita: quando o lead for arrastado pra etapa X no CRM, o sistema avisa a Meta/Google sozinho.\n1. Escolha a etapa do funil (a lista já mostra as etapas reais deste cliente)\n2. Evento Meta: use "LeadSubmitted" pra lead e "Purchase" pra venda\n3. Label Google: só se também quiser contar no Google Ads (nome da ação de conversão) — senão deixe vazio\n4. Clique em Adicionar — a linha já fica valendo na hora\nExemplos prontos: etapa "Agendou" → LeadSubmitted · etapa "Fechou" → Purchase.\n⚠️ No WhatsApp o evento de lead é "LeadSubmitted" — não "Lead", que é do pixel de site.',
              body: (
                <div className="space-y-4">
            {eventosCustom.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      {['Status', 'Evento Meta', 'Label Google', 'Ativo', ''].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {eventosCustom.map(ev => (
                      <tr key={ev.id} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                        <td className="px-3 py-2 font-mono font-medium">{ev.status_gatilho}</td>
                        <td className="px-3 py-2 text-muted-foreground">{ev.meta_event_name || '—'}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground text-[11px]">{ev.google_conversion_label || '—'}</td>
                        <td className="px-3 py-2">
                          <div onClick={() => toggleEvento(ev)} className={cn('relative h-4 w-7 rounded-full cursor-pointer transition-colors', ev.ativo ? 'bg-primary' : 'bg-muted')}>
                            <div className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform', ev.ativo ? 'translate-x-3.5' : 'translate-x-0.5')} />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => removeEvento(ev.id)} className="rounded p-1 text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-end">
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground uppercase">Etapa do funil</label>
                {stageOptions.length > 0 ? (
                  <select
                    value={newEvento.status_gatilho}
                    onChange={e => setNewEvento(p => ({ ...p, status_gatilho: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
                  >
                    <option value="">Selecione a etapa...</option>
                    {stageOptions.map(label => <option key={label} value={label}>{label}</option>)}
                  </select>
                ) : (
                  <input value={newEvento.status_gatilho} onChange={e => setNewEvento(p => ({ ...p, status_gatilho: e.target.value }))} placeholder="Ex: Proposta" className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary" />
                )}
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground uppercase">Evento Meta</label>
                <input list="meta-event-sugestoes" value={newEvento.meta_event_name} onChange={e => setNewEvento(p => ({ ...p, meta_event_name: e.target.value }))} placeholder="Ex: LeadSubmitted" className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono outline-none focus:border-primary" />
                <datalist id="meta-event-sugestoes">
                  <option value="LeadSubmitted">Lead (WhatsApp — use este, não &quot;Lead&quot;)</option>
                  <option value="Purchase">Compra</option>
                </datalist>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground uppercase">Label Google</label>
                <input value={newEvento.google_conversion_label} onChange={e => setNewEvento(p => ({ ...p, google_conversion_label: e.target.value }))} placeholder="XXXXXXXXXXXXXX" className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono outline-none focus:border-primary" />
              </div>
              <button onClick={addEvento} disabled={addingEvento || !newEvento.status_gatilho} className="flex items-center gap-1 rounded-lg bg-primary/10 border border-primary/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors">
                {addingEvento ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Adicionar
              </button>
            </div>
                </div>
              ),
            }]}
          />

        </div>
      )}

      {/* ══════════ TAB: Datalytics ══════════ */}
      {activeTab === 'datalytics' && <DatalyticsCard clientId={clientId} />}

      {activeTab === 'agendor' && <AgendorCard clientId={clientId} />}

      {activeTab === 'delivery' && <ClientDeliveryTab clientId={clientId} />}

      {activeTab === 'heatmap' && <LandingPagesTab clientId={clientId} />}

      {/* ══════════ TAB: Log ══════════ */}
      {activeTab === 'log' && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <SectionHeader
              icon={BarChart3}
              title="Log de Conversões"
              subtitle="Histórico de eventos enviados. Clique em uma linha para ver a resposta completa."
            />
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
                {(['all', 'meta', 'google'] as const).map(f => (
                  <button key={f} onClick={() => { setConvLogFilter(f); setTimeout(refreshConvLog, 0); }}
                    className={cn('rounded-md px-3 py-1 text-xs font-semibold transition-all', convLogFilter === f ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground')}>
                    {f === 'all' ? 'Todos' : f === 'meta' ? 'Meta' : 'Google'}
                  </button>
                ))}
              </div>
              <button onClick={refreshConvLog} title="Atualizar" className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {convLog.length === 0 ? (
            <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border">
              <p className="text-xs text-muted-foreground">Nenhuma conversão registrada no período.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Data', 'Plataforma', 'Evento', 'Valor', 'HTTP', 'Resultado'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {convLog.map(entry => (
                    <tr key={entry.id} onClick={() => setLogModal(entry)} className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">{new Date(entry.enviado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-3 py-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', entry.plataforma === 'meta' ? 'bg-blue-500/15 text-blue-400' : 'bg-yellow-500/15 text-yellow-400')}>
                          {entry.plataforma === 'meta' ? 'Meta' : 'Google'}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">{entry.event_name}</td>
                      <td className="px-3 py-2 tabular-nums font-bold">{entry.valor != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(entry.valor) : '—'}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{entry.status_resposta ?? '—'}</td>
                      <td className="px-3 py-2">
                        {entry.sucesso
                          ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">✓ Sucesso</span>
                          : <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">✗ Erro</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Log detail modal ─────────────────────────────────────────────── */}
      {logModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setLogModal(null)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm">{logModal.event_name}</h3>
                <p className="text-xs text-muted-foreground">{logModal.plataforma === 'meta' ? 'Meta CAPI' : 'Google Enhanced'} · {new Date(logModal.enviado_em).toLocaleString('pt-BR')}</p>
              </div>
              <button onClick={() => setLogModal(null)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'Status HTTP', value: String(logModal.status_resposta ?? '—') },
                { label: 'Resultado',   value: logModal.sucesso ? '✓ Sucesso' : '✗ Erro' },
                { label: 'Valor',       value: logModal.valor != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(logModal.valor) : '—' },
                { label: 'Event ID',    value: logModal.event_id.slice(0, 8) + '...' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border bg-background/60 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="mt-0.5 font-mono font-bold">{value}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Resposta</p>
              <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-background p-3 text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
                {logModal.resposta_body || '(sem corpo)'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Instance Modal ──────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Instância WhatsApp</h3>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
              {([{ value: 'create' as const, label: 'Criar nova' }, { value: 'attach' as const, label: 'Vincular existente' }]).map(({ value, label }) => (
                <button key={value} type="button"
                  onClick={() => { setInstMode(value); setInstError(''); if (value === 'attach') void loadAvailableInstances(); }}
                  className={cn('flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all', instMode === value ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground')}>
                  {label}
                </button>
              ))}
            </div>

            {instMode === 'attach' ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Use uma instância já criada (ex: no Disparos). A mesma conexão passa a alimentar o CRM e a IA deste cliente.
                </p>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input value={attachSearch} onChange={e => setAttachSearch(e.target.value)} placeholder="Buscar instância..."
                    className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus:border-primary" />
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {availableInsts
                    .filter(a => a.name.toLowerCase().includes(attachSearch.toLowerCase()) || a.instance_id.toLowerCase().includes(attachSearch.toLowerCase()))
                    .map(a => {
                      const here = a.linked_client_id === clientId;
                      return (
                        <button key={a.id} type="button" disabled={adding || here} onClick={() => void attachInstance(a.id)}
                          className={cn('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60',
                            here ? 'border-primary/40 bg-primary/10' : 'border-border hover:bg-muted/40')}>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{a.name}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {a.provider === 'evolution' ? 'Evolution' : 'Z-API'} · {a.instance_id}
                              {a.linked_client_id && !here && <span className="text-amber-400"> · vinculada a {a.linked_client_name ?? 'outro cliente'}</span>}
                            </p>
                          </div>
                          {here ? <span className="shrink-0 text-[11px] font-bold text-primary">Vinculada aqui</span> : <span className="shrink-0 text-[11px] font-semibold text-primary">Vincular</span>}
                        </button>
                      );
                    })}
                  {availableInsts.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma instância disponível. Crie uma no Disparos primeiro.</p>}
                </div>
                {instError && <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{instError}</p>}
                <button onClick={() => setShowModal(false)} className="w-full rounded-lg border border-border py-2 text-sm font-semibold hover:bg-muted/50 transition-colors">Fechar</button>
              </div>
            ) : (
            <>
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Provedor</p>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5 w-fit">
                {([{ value: 'zapi' as WhatsAppProvider, label: 'Z-API' }, { value: 'evolution' as WhatsAppProvider, label: 'Evolution API' }]).map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => { setInstProvider(value); setInstError(''); }}
                    className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition-all', instProvider === value ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground')}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Apelido da instância *</label>
                <input value={instForm.nome} onChange={e => {
                  const nome = e.target.value;
                  setInstForm(p => ({ ...p, nome, instance_id: instProvider === 'evolution' && !p.instance_id ? toSlug(nome) : p.instance_id }));
                }} placeholder="Ex: Vendas, Suporte, Atendimento" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  {instProvider === 'evolution' ? 'Nome da instância (Evolution API) *' : 'Instance ID (Z-API) *'}
                </label>
                <input value={instForm.instance_id} onChange={e => { const val = instProvider === 'evolution' ? e.target.value.replace(/\s+/g, '-').toLowerCase() : e.target.value; setInstForm(p => ({ ...p, instance_id: val })); }}
                  placeholder={instProvider === 'evolution' ? 'Ex: vendas-cliente' : 'Ex: 3D8A1B2C...'} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                {instProvider === 'evolution' && <p className="mt-1 text-[10px] text-muted-foreground">Apenas letras minúsculas, números e hífens.</p>}
              </div>
              {instProvider === 'zapi' && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">Token da instância *</label>
                  <input value={instForm.token} onChange={e => setInstForm(p => ({ ...p, token: e.target.value }))} placeholder="Token Z-API" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
                </div>
              )}
              {instError && <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{instError}</p>}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowModal(false)} className="flex-1 rounded-lg border border-border py-2 text-sm font-semibold hover:bg-muted/50 transition-colors">Cancelar</button>
              <button onClick={addInstance} disabled={adding} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-60 transition-colors">
                {adding && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {instProvider === 'evolution' ? 'Criar na Evolution API' : 'Adicionar'}
              </button>
            </div>
            </>
            )}
          </div>
        </div>
      )}

      {/* ── QR Code Modal ────────────────────────────────────────────────── */}
      {qrInst && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4" onClick={closeQr}>
          <div
            className="w-full max-w-sm overflow-hidden rounded-[var(--radius)] border border-border bg-card shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header — faixa verde do design system */}
            <div className="relative border-b border-border px-5 py-4">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-primary" />
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] bg-primary/15">
                    <QrCode className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-heading font-normal text-2xl uppercase leading-none tracking-wide text-foreground">Conectar WhatsApp</h3>
                    <p className="text-[11px] text-muted-foreground mt-1 truncate">{qrInst.nome} · {qrInst.instance_id}</p>
                  </div>
                </div>
                <button onClick={closeQr} className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="px-5 py-5">
              {qrPhase === 'success' ? (
                /* ── Sucesso: confirmação + fechamento automático ── */
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 ring-4 ring-primary/20">
                    <Wifi className="h-8 w-8 text-primary" />
                  </div>
                  <p className="font-heading text-3xl uppercase leading-none tracking-wide text-foreground">Conectado!</p>
                  <p className="text-xs text-muted-foreground max-w-[240px]">
                    O WhatsApp de <span className="font-semibold text-foreground">{qrInst.nome}</span> está pronto pra uso.
                  </p>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mt-2">Fechando automaticamente…</p>
                </div>
              ) : qrPhase === 'error' ? (
                /* ── Erro: mensagem clara + fechamento automático ── */
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15 ring-4 ring-red-500/20">
                    <WifiOff className="h-8 w-8 text-red-400" />
                  </div>
                  <p className="font-heading text-3xl uppercase leading-none tracking-wide text-foreground">Não foi possível</p>
                  <p className="text-xs text-muted-foreground max-w-[260px]">
                    O QR Code não veio da Evolution. Verifique se a VPS está no ar e tente de novo.
                  </p>
                  <button
                    onClick={refreshQr}
                    className="mt-2 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Tentar de novo
                  </button>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Fechando automaticamente…</p>
                </div>
              ) : (
                /* ── QR na tela (ou carregando) ── */
                <div className="flex flex-col items-center gap-4">
                  <div className="relative p-3">
                    <span className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-primary" />
                    <span className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-primary" />
                    <span className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-primary" />
                    <span className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-primary" />
                    {qrPhase === 'loading' ? (
                      <div className="flex h-[228px] w-[228px] items-center justify-center bg-muted/20">
                        <RefreshCw className="h-9 w-9 animate-spin text-primary/50" />
                      </div>
                    ) : (
                      <div className="bg-white p-2.5">
                        <img src={qrData?.base64} alt="QR Code WhatsApp" className="h-[208px] w-[208px] object-contain" />
                      </div>
                    )}
                  </div>

                  {/* Status ao vivo */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {qrPhase === 'loading' ? (
                      <span>Gerando QR Code…</span>
                    ) : (
                      <>
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                        </span>
                        <span>Aguardando leitura · renova em <span className="font-semibold tabular-nums text-foreground">{qrSeconds}s</span></span>
                      </>
                    )}
                  </div>

                  {/* Passo a passo */}
                  <div className="w-full space-y-1.5 rounded-[var(--radius)] border border-border bg-muted/10 px-4 py-3">
                    {[
                      <>Abra o <span className="font-semibold text-foreground">WhatsApp</span> no celular</>,
                      <>Toque em <span className="font-semibold text-foreground">Aparelhos conectados</span></>,
                      <>Toque em <span className="font-semibold text-foreground">Conectar aparelho</span> e aponte pra tela</>,
                    ].map((step, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{i + 1}</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>

                  <p className="text-[10px] text-muted-foreground/60">A tela fecha sozinha assim que a conexão for confirmada.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
