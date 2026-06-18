'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import {
  Search, ChevronDown, ChevronUp, MessageCircle, RefreshCw, Plus,
  MousePointerClick, BarChart3, Settings2, ExternalLink,
} from 'lucide-react';
import { ClientTrackingTab } from './tracking-tab';
import { CaptureLinksTab } from './capture-links-tab';

type CrmLead = {
  id: string;
  nome: string | null;
  numero: string | null;
  link_criativo?: string | null;
  canal: string | null;
  origin: string | null;
  ctwa_clid?: string | null;
  source_id?: string | null;
  source_url?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  campaign_name?: string | null;
  adset_name?: string | null;
  ad_name?: string | null;
  creative_name?: string | null;
  first_origin_at?: string | null;
  status: string | null;
  fechou: boolean;
  valor_rs: number | null;
  data: string | null;
  created_at: string;
};

type CrmMessage = {
  id: string;
  direction: 'in' | 'out';
  text: string;
  created_at: string;
};

const CANAL_STYLES: Record<string, string> = {
  'Facebook':   'bg-blue-500/20 text-blue-300 border-blue-400/30',
  'Google':     'bg-red-500/20 text-red-300 border-red-400/30',
  'Instagram':  'bg-purple-500/20 text-purple-300 border-purple-400/30',
  'TikTok':     'bg-foreground/10 text-foreground border-border',
  'YouTube':    'bg-red-600/20 text-red-400 border-red-500/30',
  'Indicação':  'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
  'Whatsapp':   'bg-primary/20 text-primary border-primary/30',
};

const STATUS_STYLES: Record<string, string> = {
  'Em Atendimento': 'bg-sky-500/20 text-sky-300 border-sky-400/30',
  'Agendado':       'bg-blue-500/20 text-blue-300 border-blue-400/30',
  'Reagendado':     'bg-blue-400/20 text-blue-200 border-blue-300/30',
  'Fechado':        'bg-primary/20 text-primary border-primary/30',
  'Comprou':        'bg-primary/20 text-primary border-primary/30',
  'Não Retorna':    'bg-muted/40 text-muted-foreground border-border/50',
  'Sem Interesse':  'bg-red-500/20 text-red-300 border-red-400/30',
  'Desqualificado': 'bg-red-500/20 text-red-300 border-red-400/30',
};

const STATUS_OPTIONS = ['Em Atendimento', 'Agendado', 'Reagendado', 'Fechado', 'Comprou', 'Paciente', 'Não Retorna', 'Distante', 'Sem Interesse', 'Desqualificado'];

function canalStyle(canal: string | null) {
  return CANAL_STYLES[canal ?? ''] ?? 'bg-muted/40 text-muted-foreground border-border/50';
}

function statusStyle(status: string | null) {
  return STATUS_STYLES[status ?? ''] ?? 'bg-muted/40 text-muted-foreground border-border/50';
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function shortValue(value: string | null | undefined, max = 42) {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function hasTrackingData(lead: CrmLead) {
  return Boolean(
    lead.ctwa_clid || lead.source_id || lead.source_url || lead.utm_source || lead.utm_campaign ||
    lead.campaign_name || lead.adset_name || lead.ad_name || lead.creative_name || lead.link_criativo,
  );
}

function OriginDetails({ lead }: { lead: CrmLead }) {
  const rows = [
    { label: 'Origem', value: lead.origin || lead.canal },
    { label: 'Campanha', value: lead.campaign_name || lead.utm_campaign },
    { label: 'Conjunto', value: lead.adset_name },
    { label: 'Anúncio / criativo', value: lead.ad_name || lead.creative_name || lead.link_criativo },
    { label: 'UTM source', value: lead.utm_source },
    { label: 'UTM medium', value: lead.utm_medium },
    { label: 'UTM content', value: lead.utm_content },
    { label: 'UTM term', value: lead.utm_term },
    { label: 'Click ID Meta', value: lead.ctwa_clid },
    { label: 'Source ID', value: lead.source_id },
    { label: 'Primeira origem', value: lead.first_origin_at ? new Date(lead.first_origin_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null },
  ].filter(row => row.value);

  return (
    <div className="border-t border-border/30 bg-background/30 px-4 py-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        <MousePointerClick className="h-3.5 w-3.5 text-primary" />
        Origem do lead
      </div>
      {!hasTrackingData(lead) ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
          Ainda sem dados de rastreio para este contato. Leads orgânicos ou mensagens sem Click ID/UTM aparecem assim.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(row => (
            <div key={row.label} className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{row.label}</p>
              <p className="mt-1 break-words text-xs font-semibold text-foreground" title={String(row.value)}>
                {shortValue(String(row.value), 58)}
              </p>
            </div>
          ))}
          {lead.source_url && (
            <a
              href={lead.source_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/15"
            >
              Abrir URL de origem
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function TrackingInstructions() {
  return (
    <div className="space-y-4 pt-1">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
            <Settings2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Como o rastreio entra no CRM</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Quando a pessoa vem de anúncio de WhatsApp, a Meta pode enviar o Click ID no webhook. Quando ela vem por um link rastreado, o sistema usa as UTMs do link. O CRM salva esses dados no contato e usa isso para enviar eventos de volta para a Meta/Google.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            title: 'Meta Ads para WhatsApp',
            text: 'Use anúncios de clique para WhatsApp e mantenha o webhook Evolution ativo. O Click ID vem automático quando a plataforma envia esse dado.',
          },
          {
            title: 'Links com UTM',
            text: 'Para links externos, use UTMs: utm_source, utm_medium, utm_campaign e utm_content. Assim o CRM identifica campanha, origem e criativo.',
          },
          {
            title: 'Conversões de resposta',
            text: 'Na aba Rastreio de Campanhas, ative Meta Conversions API. O evento Lead sai na primeira mensagem; Contact sai quando a pessoa responde novamente.',
          },
        ].map(item => (
          <div key={item.title} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">{item.title}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.text}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm leading-relaxed text-blue-100">
        <p className="font-bold">Resposta curta sobre UTM:</p>
        <p className="mt-1">
          Para campanhas de WhatsApp da Meta, o Click ID pode vir automático. Mesmo assim, eu recomendo usar UTMs nos links sempre que tiver URL, porque elas deixam o relatório mais legível: campanha, conjunto, criativo e variação.
        </p>
      </div>
    </div>
  );
}

function StatusDropdown({ leadId, value, onChange }: {
  leadId: string;
  value: string | null;
  onChange: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = value ?? 'Em Atendimento';

  async function pick(s: string) {
    setOpen(false);
    onChange(s);
    await fetch(`/api/crm/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: s }),
    });
  }

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={cn('h-6 rounded-md border px-2 text-[10px] font-bold whitespace-nowrap transition-colors', statusStyle(current))}
      >
        {current}
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-20 min-w-[160px] rounded-lg border border-border bg-card shadow-lg" onClick={e => e.stopPropagation()}>
          {STATUS_OPTIONS.filter(s => s !== current).map(s => (
            <button key={s} onClick={() => pick(s)}
              className="w-full px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors first:rounded-t-lg last:rounded-b-lg">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessagePanel({ leadId }: { leadId: string }) {
  const [messages, setMessages] = useState<CrmMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/crm/${leadId}/messages`)
      .then(r => r.json())
      .then((d: { messages: CrmMessage[] }) => setMessages(d.messages ?? []))
      .finally(() => setLoading(false));
  }, [leadId]);

  if (loading) return <div className="px-4 py-3 text-xs text-muted-foreground">Carregando...</div>;
  if (!messages.length) return <div className="px-4 py-3 text-xs text-muted-foreground italic">Nenhuma mensagem registrada.</div>;

  return (
    <div className="max-h-64 overflow-y-auto px-4 py-3 space-y-2 bg-background/40">
      {messages.map(m => (
        <div key={m.id} className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
          <div className={cn(
            'max-w-[75%] rounded-lg px-3 py-2 text-xs leading-relaxed',
            m.direction === 'out'
              ? 'bg-primary/20 text-primary rounded-br-none'
              : 'bg-muted text-foreground rounded-bl-none',
          )}>
            <p>{m.text}</p>
            <p className="mt-1 text-[10px] opacity-60 text-right">
              {new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ClientCrmTab({ clientId }: { clientId: string }) {
  const [activeTab, setActiveTab] = useState<'leads' | 'capture' | 'tracking' | 'guide'>('leads');
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCanal, setFilterCanal] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true);
    fetch(`/api/crm?clientId=${clientId}`)
      .then(r => r.json())
      .then((rows: CrmLead[]) => setLeads(Array.isArray(rows) ? rows : []))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    fetch(`/api/crm?clientId=${clientId}`)
      .then(r => r.json())
      .then((rows: CrmLead[]) => setLeads(Array.isArray(rows) ? rows : []))
      .finally(() => setLoading(false));
  }, [clientId]);

  const filtered = leads.filter(l => {
    if (filterStatus && l.status !== filterStatus) return false;
    if (filterCanal && l.canal !== filterCanal) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(l.nome ?? '').toLowerCase().includes(q) && !(l.numero ?? '').includes(q)) return false;
    }
    return true;
  });

  const canais = [...new Set(leads.map(l => l.canal).filter(Boolean))] as string[];
  const total = leads.length;
  const convertidos = leads.filter(l => l.fechou).length;
  const faturamento = leads.reduce((s, l) => s + (l.valor_rs ?? 0), 0);
  const emAtendimento = leads.filter(l => l.status === 'Em Atendimento').length;

  function updateStatus(leadId: string, status: string) {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
  }

  return (
    <div className="space-y-4 pt-1">
      <div className="flex w-fit flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1">
        {([
          { id: 'leads' as const, label: 'Leads', icon: MessageCircle },
          { id: 'capture' as const, label: 'Fontes de Captura', icon: MousePointerClick },
          { id: 'tracking' as const, label: 'Rastreio de Campanhas', icon: BarChart3 },
          { id: 'guide' as const, label: 'Como Configurar', icon: Settings2 },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors',
              activeTab === id ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'capture' && <CaptureLinksTab clientId={clientId} />}
      {activeTab === 'tracking' && <ClientTrackingTab clientId={clientId} />}
      {activeTab === 'guide' && <TrackingInstructions />}

      {activeTab === 'leads' && (
        <>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total de Leads', value: total, cls: 'text-foreground' },
          { label: 'Em Atendimento', value: emAtendimento, cls: 'text-sky-300' },
          { label: 'Convertidos', value: convertidos, cls: 'text-primary' },
          { label: 'Faturamento', value: formatCurrencyBRL(faturamento), cls: 'text-primary' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className={cn('font-heading font-normal text-xl leading-none mt-2', cls)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text" placeholder="Buscar nome ou número..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select value={filterCanal} onChange={e => setFilterCanal(e.target.value)}
          className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary">
          <option value="">Todos os canais</option>
          {canais.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary">
          <option value="">Todos os status</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => load()}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <a href="/crm" className="h-8 flex items-center gap-1.5 px-3 rounded-lg border border-border bg-card text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
          <Plus className="w-3.5 h-3.5" /> Novo lead
        </a>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhum lead encontrado.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Mensagens recebidas via WhatsApp aparecem aqui automaticamente.</p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 px-4 py-2 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Contato</span>
              <span>Canal</span>
              <span>Status</span>
              <span>Fechou</span>
              <span>Valor</span>
              <span>Data</span>
            </div>

            {filtered.map(lead => (
              <div key={lead.id} className="border-b border-border/50 last:border-0">
                <button
                  onClick={() => setExpanded(expanded === lead.id ? null : lead.id)}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 w-full px-4 py-3 items-center text-left hover:bg-muted/20 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{lead.nome ?? '—'}</p>
                    {lead.numero && <p className="text-[11px] text-muted-foreground">{lead.numero}</p>}
                  </div>

                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap', canalStyle(lead.canal))}>
                    {lead.canal ?? '—'}
                  </span>

                  <div onClick={e => e.stopPropagation()}>
                    <StatusDropdown leadId={lead.id} value={lead.status} onChange={s => updateStatus(lead.id, s)} />
                  </div>

                  <span className={cn('text-xs font-bold', lead.fechou ? 'text-primary' : 'text-muted-foreground')}>
                    {lead.fechou ? 'Sim' : 'Não'}
                  </span>

                  <span className="text-xs font-semibold text-primary whitespace-nowrap">
                    {lead.valor_rs ? formatCurrencyBRL(lead.valor_rs) : '—'}
                  </span>

                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{formatDate(lead.data ?? lead.created_at)}</span>
                    {expanded === lead.id
                      ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                      : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                </button>

                {expanded === lead.id && (
                  <div className="border-t border-border/30">
                    <OriginDetails lead={lead} />
                    <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground bg-muted/10">
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Histórico de mensagens WhatsApp</span>
                    </div>
                    <MessagePanel leadId={lead.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
