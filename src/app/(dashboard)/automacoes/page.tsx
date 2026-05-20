"use client";

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  Plus, Copy, Trash2, Check, Zap, RefreshCw, Search,
  ToggleLeft, ToggleRight, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle2, MinusCircle, Globe, MessageCircle, ArrowRight,
  Code2, Camera, Flame, Target, Filter, ArrowUpDown, Grid2X2,
  List, Play, Pause, MoreVertical, Send, Hash, UserRound, MessageSquareReply,
  Pencil, Users,
} from 'lucide-react';
import MultiChannelBuilder, { type GmailAccount, type ZapiClient, type MetaConn } from './MultiChannelBuilder';
import type { Node, Edge } from '@xyflow/react';

type MCAutomation = {
  id: string;
  name: string;
  status: string;
  token: string;
  active_contacts: number;
  total_contacts: number;
  created_at: string;
};

type BuilderState = {
  open: boolean;
  automationId?: string;
  name?: string;
  nodes?: Node[];
  edges?: Edge[];
  webhookToken?: string;
};

type WebhookConfig = {
  id: string;
  name: string;
  token: string;
  description: string | null;
  enabled: boolean;
  created_at: string;
};

type WebhookLog = {
  id: string;
  token: string;
  config_name: string | null;
  event_type: string | null;
  payload: unknown;
  status: 'success' | 'error' | 'ignored';
  result: unknown;
  error_msg: string | null;
  received_at: string;
};

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://reports.onmid.app';

const AUTOMATION_ACCENT = '#55F52F';

function MiniSparkline({ color = AUTOMATION_ACCENT }: { color?: string }) {
  return (
    <svg viewBox="0 0 90 28" className="h-8 w-20" aria-hidden="true">
      <path d="M4 22 C14 16 18 23 28 17 S42 6 52 14 S66 22 86 10" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M4 22 C14 16 18 23 28 17 S42 6 52 14 S66 22 86 10 L86 28 L4 28 Z" fill={color} opacity="0.12" />
    </svg>
  );
}

function AutomationStatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/6 bg-[#111722]/82 p-5 shadow-[0_18px_55px_rgba(0,0,0,0.18)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_0%,rgba(255,255,255,0.05),transparent_38%)]" />
      <div className="relative flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}1f` }}>
          <Icon className="h-6 w-6" style={{ color }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-300">{label}</p>
          <p className="mt-1 text-3xl font-semibold leading-none text-white">{value}</p>
        </div>
        <MiniSparkline color={color} />
      </div>
    </div>
  );
}

const EVENT_DOCS = [
  {
    event: 'client.create',
    desc: 'Cria um novo cliente no sistema.',
    fields: [
      { name: 'name', type: 'string', required: true, desc: 'Nome do cliente' },
      { name: 'segment', type: 'string', required: false, desc: 'Segmento (padrão: "Não informado")' },
      { name: 'status', type: 'string', required: false, desc: '"Ativo" ou "Inativo" (padrão: "Ativo")' },
      { name: 'id', type: 'string', required: false, desc: 'ID customizado (gerado automaticamente se omitido)' },
    ],
    example: { event: 'client.create', data: { name: 'Clínica Sorrir', segment: 'Odontologia' } },
  },
  {
    event: 'lead.create',
    desc: 'Cria um novo lead no CRM.',
    fields: [
      { name: 'client_id', type: 'string', required: false, desc: 'ID do cliente (use client_id ou client_name)' },
      { name: 'client_name', type: 'string', required: false, desc: 'Nome do cliente (busca por nome se não tiver ID)' },
      { name: 'nome', type: 'string', required: false, desc: 'Nome do lead (aliases: name, lead_name)' },
      { name: 'numero', type: 'string', required: false, desc: 'Telefone (aliases: phone, telefone)' },
      { name: 'canal', type: 'string', required: false, desc: 'Canal de origem (aliases: source, origem)' },
      { name: 'observacao', type: 'string', required: false, desc: 'Observações (aliases: obs, notes, mensagem)' },
      { name: 'status', type: 'string', required: false, desc: 'Status inicial (padrão: "Em Atendimento")' },
    ],
    example: { event: 'lead.create', data: { client_name: 'Clínica Sorrir', nome: 'João Silva', numero: '11999999999', canal: 'Google Forms' } },
  },
  {
    event: 'lead.update',
    desc: 'Atualiza um lead existente no CRM.',
    fields: [
      { name: 'lead_id', type: 'string', required: true, desc: 'ID do lead a atualizar (alias: id)' },
      { name: '...', type: 'any', required: false, desc: 'Qualquer campo do lead (nome, numero, status, observacao, etc.)' },
    ],
    example: { event: 'lead.update', data: { lead_id: 'uuid-do-lead', status: 'Fechou', valor_rs: 2500 } },
  },
];

export default function AutomacoesPage() {
  const [configs, setConfigs] = useState<WebhookConfig[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [igConnections, setIgConnections] = useState<{ id: string; userName: string; status: string }[]>([]);
  const [mcAutomations, setMcAutomations] = useState<MCAutomation[]>([]);
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccount[]>([]);
  const [zapiClients, setZapiClients] = useState<ZapiClient[]>([]);
  const [metaConns, setMetaConns] = useState<MetaConn[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [tab, setTab] = useState<'webhooks' | 'multi' | 'logs' | 'docs'>('webhooks');
  const [builder, setBuilder] = useState<BuilderState>({ open: false });

  async function load() {
    setLoading(true);
    const [cfgRes, logRes, igRes, mcRes, gmailRes, zapiRes, metaRes] = await Promise.all([
      fetch('/api/automacoes'),
      fetch('/api/automacoes/logs'),
      fetch('/api/meta/connections'),
      fetch('/api/automations/multi'),
      fetch('/api/email/accounts'),
      fetch('/api/disparos/clients'),
      fetch('/api/meta/connections'),
    ]);
    if (cfgRes.ok) setConfigs(await cfgRes.json());
    if (logRes.ok) setLogs(await logRes.json());
    if (igRes.ok) setIgConnections(await igRes.json() as { id: string; userName: string; status: string }[]);
    if (mcRes.ok) setMcAutomations(await mcRes.json() as MCAutomation[]);
    if (gmailRes.ok) {
      const accounts = await gmailRes.json() as { email: string }[];
      setGmailAccounts(accounts.map((a) => ({ email: a.email })));
    }
    if (zapiRes.ok) {
      const clients = await zapiRes.json() as { id: string; name: string }[];
      setZapiClients(clients);
    }
    if (metaRes.ok) {
      const conns = await metaRes.json() as { id: string; userName?: string; page_name?: string }[];
      setMetaConns(conns.map((c) => ({ id: c.id, display: c.userName ?? c.page_name ?? c.id })));
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch('/api/automacoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
    });
    if (res.ok) {
      const cfg = await res.json() as WebhookConfig;
      setConfigs(prev => [cfg, ...prev]);
      setNewName('');
      setNewDesc('');
      setShowForm(false);
    }
    setCreating(false);
  }

  async function toggle(cfg: WebhookConfig) {
    await fetch(`/api/automacoes/${cfg.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !cfg.enabled }),
    });
    setConfigs(prev => prev.map(c => c.id === cfg.id ? { ...c, enabled: !c.enabled } : c));
  }

  async function remove(id: string) {
    if (!confirm('Excluir este webhook? Isso vai invalidar a URL.')) return;
    await fetch(`/api/automacoes/${id}`, { method: 'DELETE' });
    setConfigs(prev => prev.filter(c => c.id !== id));
  }

  function copyUrl(cfg: WebhookConfig) {
    const url = `${BASE_URL}/api/webhooks/${cfg.token}`;
    void navigator.clipboard.writeText(url);
    setCopiedId(cfg.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function openMcBuilder(mc?: MCAutomation) {
    if (mc) {
      const res = await fetch(`/api/automations/multi/${mc.id}`);
      if (res.ok) {
        const data = await res.json() as { automation: { nodes_json: Node[]; edges_json: Edge[]; name: string }; contacts: unknown[] };
        setBuilder({
          open: true,
          automationId: mc.id,
          name: mc.name,
          nodes: data.automation.nodes_json,
          edges: data.automation.edges_json,
          webhookToken: mc.token,
        });
      }
    } else {
      setBuilder({ open: true });
    }
  }

  async function deleteMcAutomation(id: string) {
    if (!confirm('Excluir esta automação multi-canal?')) return;
    await fetch(`/api/automations/multi/${id}`, { method: 'DELETE' });
    setMcAutomations((prev) => prev.filter((a) => a.id !== id));
  }

  const statusIcon = (s: WebhookLog['status']) => {
    if (s === 'success') return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
    if (s === 'error')   return <AlertCircle  className="h-4 w-4 text-rose-500 shrink-0" />;
    return <MinusCircle className="h-4 w-4 text-zinc-400 shrink-0" />;
  };

  const activeCount = configs.filter(cfg => cfg.enabled).length;
  const successLogs = logs.filter(log => log.status === 'success').length;
  const responseRate = logs.length > 0 ? Math.round((successLogs / logs.length) * 1000) / 10 : null;
  const webhookRows = configs.map(cfg => ({
    id: cfg.id,
    config: cfg,
    name: cfg.name,
    description: cfg.description ?? 'Webhook para integração externa',
    status: cfg.enabled ? 'Ativa' : 'Pausada',
    executions: logs.filter(log => log.token === cfg.token || log.config_name === cfg.name).length,
    last: cfg.enabled ? 'há pouco' : 'pausada',
    date: new Date(cfg.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  }));
  const igConnected = igConnections.some(c => c.status === 'connected');
  const igUserName = igConnections.find(c => c.status === 'connected')?.userName ?? null;

  return (
    <div className="space-y-5 pb-8 text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-violet-500/22 text-violet-400 shadow-[0_18px_40px_rgba(123,44,255,0.18)]">
            <Zap className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">Automações</h1>
            <p className="mt-1 text-base text-slate-400">Integre com Webhooks, ClickUp, Google Forms, Zapier, Make e outros.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowForm(v => !v)}
            className="flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-transparent px-5 text-sm font-semibold text-white transition-colors hover:border-white/25 hover:bg-white/5"
          >
            <Code2 className="h-4 w-4" />
            Novo Webhook
          </button>
          <button
            type="button"
            onClick={() => void openMcBuilder()}
            className="flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-transparent px-5 text-sm font-semibold text-white transition-colors hover:border-white/25 hover:bg-white/5"
          >
            <Plus className="h-4 w-4" />
            Automação multi-canal
          </button>
          <Link
            href="/automacoes/meta"
            className="flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-bold text-black shadow-[0_0_28px_rgba(85,245,47,0.22)] transition-transform hover:-translate-y-0.5"
          >
            <Camera className="h-4 w-4" />
            Nova automação Instagram
          </Link>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <AutomationStatCard icon={Zap} label="Automações ativas" value={String(activeCount)} color="#a855f7" />
        <AutomationStatCard icon={MessageCircle} label="Mensagens respondidas" value={successLogs.toLocaleString('pt-BR')} color={AUTOMATION_ACCENT} />
        <AutomationStatCard icon={Flame} label="Webhooks cadastrados" value={String(configs.length)} color="#f59e0b" />
        <AutomationStatCard icon={Target} label="Taxa de resposta" value={responseRate !== null ? `${responseRate.toLocaleString('pt-BR')}%` : '—'} color="#60a5fa" />
        <div className="relative overflow-hidden rounded-xl border border-white/6 bg-[#111722]/82 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-slate-300">Status do sistema</p>
              <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Todos os sistemas operando
              </p>
              <p className="mt-6 text-xs text-slate-500">Última verificação: agora há pouco</p>
            </div>
            <CheckCircle2 className="h-7 w-7 text-primary" />
          </div>
        </div>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-violet-500/55 bg-[#101621] p-8 shadow-[0_24px_90px_rgba(0,0,0,0.28)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_5%_0%,rgba(236,72,153,0.32),transparent_30%),radial-gradient(circle_at_25%_100%,rgba(249,115,22,0.30),transparent_26%),radial-gradient(circle_at_96%_0%,rgba(123,44,255,0.18),transparent_36%)]" />
        <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border border-white/8" />
        <div className="relative grid gap-8 lg:grid-cols-[1.1fr_1.7fr]">
          <div className="flex items-center gap-8 border-white/8 lg:border-r lg:pr-10">
            <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 via-pink-500 to-fuchsia-600 shadow-[0_24px_70px_rgba(236,72,153,0.32)]">
              <Camera className="h-16 w-16 text-white" />
            </div>
            <div>
              <p className="text-xl text-slate-300">Automações</p>
              <h2 className="text-4xl font-semibold tracking-[-0.04em] text-white">Instagram <span className="rounded-full bg-violet-500/35 px-3 py-1 text-sm font-bold text-violet-200">PRO</span></h2>
              <p className="mt-3 max-w-md text-base leading-relaxed text-slate-300">Conecte seu Instagram e automatize interações, DMs e qualificação de leads com inteligência.</p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {igConnected ? (
                  <span className="rounded-lg bg-primary/18 px-3 py-1.5 text-sm font-semibold text-primary">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full bg-primary" />Conectado
                  </span>
                ) : (
                  <span className="rounded-lg bg-red-500/15 px-3 py-1.5 text-sm font-semibold text-red-400">Não conectado</span>
                )}
                {igUserName && (
                  <span className="rounded-lg bg-white/8 px-3 py-1.5 text-sm font-semibold text-slate-300">{igUserName}</span>
                )}
                <Link href="/automacoes/meta" className="rounded-lg bg-white/8 p-2 text-slate-300 hover:text-white"><ArrowRight className="h-4 w-4 -rotate-45" /></Link>
              </div>
            </div>
          </div>
          <div>
            <p className="mb-8 text-base font-semibold text-white">Principais recursos</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              {[
                [MessageSquareReply, 'Auto-resposta', 'para comentários'],
                [Send, 'Resposta automática', 'em DM'],
                [Hash, 'Palavra-chave /', 'gatilho'],
                [ArrowRight, 'Encaminhamento', 'para atendimento'],
                [UserRound, 'Qualificação', 'de leads'],
              ].map(([Icon, title, sub], index) => {
                const ItemIcon = Icon as React.ElementType;
                return (
                  <div key={String(title)} className={cn('text-center', index > 0 && 'md:border-l md:border-white/10')}>
                    <ItemIcon className="mx-auto h-8 w-8 text-violet-400" />
                    <p className="mt-4 text-sm font-medium text-white">{title as string}</p>
                    <p className="mt-1 text-sm text-slate-400">{sub as string}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="flex gap-8 border-b border-white/10">
        {(['webhooks', 'multi', 'logs', 'docs'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 px-5 py-3 text-base font-semibold transition-colors',
              tab === t ? 'border-primary text-primary' : 'border-transparent text-slate-300 hover:text-white',
            )}
          >
            {t === 'webhooks' ? 'Webhooks' : t === 'multi' ? 'Multi-canal' : t === 'logs' ? 'Logs' : 'Documentação'}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="rounded-2xl border border-white/10 bg-[#111722] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.22)]">
          <p className="text-sm font-semibold text-white">Criar novo webhook</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto]">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome (ex: Google Forms - Leads)" onKeyDown={e => e.key === 'Enter' && void create()} className="h-11 rounded-xl border border-white/10 bg-[#0b1019] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-primary/50" />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Descrição (opcional)" className="h-11 rounded-xl border border-white/10 bg-[#0b1019] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-primary/50" />
            <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-xl border border-white/10 px-5 text-sm font-semibold text-slate-300 hover:text-white">Cancelar</button>
            <button type="button" onClick={() => void create()} disabled={creating || !newName.trim()} className="h-11 rounded-xl bg-primary px-5 text-sm font-bold text-black disabled:opacity-50">{creating ? 'Criando...' : 'Criar'}</button>
          </div>
        </div>
      )}

      {tab === 'webhooks' && (
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f151f]/90">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input placeholder="Buscar webhooks..." className="h-11 w-full rounded-xl border border-white/10 bg-[#090e16] pl-10 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-primary/50" />
            </div>
            <div className="flex items-center gap-3">
              <button className="flex h-11 items-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-semibold text-slate-300"><Filter className="h-4 w-4" />Todos os status <ChevronDown className="h-4 w-4" /></button>
              <button className="flex h-11 items-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-semibold text-slate-300"><ArrowUpDown className="h-4 w-4" />Ordenar: Mais recentes <ChevronDown className="h-4 w-4" /></button>
              <button className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-slate-400"><Grid2X2 className="h-4 w-4" /></button>
              <button className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><List className="h-5 w-5" /></button>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(320px,1fr)_160px_130px_170px_120px] border-b border-white/8 bg-white/[0.025] px-6 py-3 text-xs text-slate-500">
            <span>Webhook</span><span>Status</span><span>Execuções</span><span>Criado em</span><span className="text-right">Ações</span>
          </div>
          <div className="divide-y divide-white/8">
            {loading && <div className="px-6 py-12 text-center text-sm text-slate-500">Carregando...</div>}
            {!loading && webhookRows.length === 0 && (
              <div className="px-6 py-16 text-center">
                <Code2 className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                <p className="text-sm font-semibold text-slate-400">Nenhum webhook cadastrado</p>
                <p className="mt-1 text-xs text-slate-600">Crie seu primeiro webhook usando o botão acima.</p>
              </div>
            )}
            {webhookRows.map(row => {
              const cfg = row.config;
              const copied = copiedId === cfg.id;
              const active = row.status === 'Ativa';
              return (
                <div key={row.id} className="grid grid-cols-[minmax(320px,1fr)_160px_130px_170px_120px] items-center px-6 py-3 transition-colors hover:bg-white/[0.025]">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/8">
                      <Code2 className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-white">{row.name}</p>
                      <p className="truncate text-sm text-slate-400">{row.description}</p>
                    </div>
                  </div>
                  <span className={cn('w-fit rounded-lg px-3 py-1 text-sm font-semibold', active ? 'bg-primary/18 text-primary' : 'bg-amber-500/16 text-amber-400')}>
                    <span className={cn('mr-2 inline-block h-2 w-2 rounded-full', active ? 'bg-primary' : 'bg-amber-400')} />
                    {row.status}
                  </span>
                  <div>
                    <p className="text-base font-semibold text-white">{row.executions}</p>
                    <p className="text-xs text-slate-500">eventos</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-300">{row.date}</p>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => copyUrl(cfg)} title={copied ? 'Copiado' : 'Copiar URL'} className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-primary">
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>
                    <button type="button" onClick={() => toggle(cfg)} title={cfg.enabled ? 'Pausar' : 'Ativar'} className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-primary">
                      {cfg.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button type="button" onClick={() => remove(cfg.id)} title="Excluir" className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'multi' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">{mcAutomations.length} automação(ões) multi-canal</p>
            <button
              type="button"
              onClick={() => void openMcBuilder()}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-black"
            >
              <Plus className="h-4 w-4" />
              Nova automação
            </button>
          </div>
          {loading && <div className="py-12 text-center text-sm text-slate-500">Carregando...</div>}
          {!loading && mcAutomations.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center">
              <Zap className="mx-auto mb-3 h-10 w-10 text-slate-600" />
              <p className="text-sm font-semibold text-slate-400">Nenhuma automação criada</p>
              <p className="mt-1 text-xs text-slate-600">Crie fluxos que combinam E-mail, WhatsApp e Instagram.</p>
              <button
                type="button"
                onClick={() => void openMcBuilder()}
                className="mt-4 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-black"
              >
                Criar primeira automação
              </button>
            </div>
          )}
          {mcAutomations.map((mc) => (
            <div key={mc.id} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-[#111722] p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#55F52F]/10">
                <Zap className="h-5 w-5 text-[#55F52F]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{mc.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <Users className="mr-1 inline h-3 w-3" />
                  {mc.active_contacts} ativos · {mc.total_contacts} total
                </p>
              </div>
              <span className={cn('rounded-lg px-2.5 py-1 text-xs font-semibold', mc.status === 'active' ? 'bg-[#55F52F]/15 text-[#55F52F]' : 'bg-slate-500/15 text-slate-400')}>
                {mc.status === 'active' ? 'Ativa' : 'Pausada'}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void openMcBuilder(mc)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-400 hover:text-white">
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => void deleteMcAutomation(mc.id)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-400 hover:text-rose-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'logs' && (
        <section className="space-y-3">
          {logs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-slate-500">Nenhum evento recebido ainda.</div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="rounded-2xl border border-white/10 bg-[#111722] p-4">
                <div className="flex items-center gap-2">
                  {statusIcon(log.status)}
                  <span className="font-mono text-xs font-semibold text-white">{log.event_type ?? 'desconhecido'}</span>
                  {log.config_name && <span className="text-xs text-slate-500">via {log.config_name}</span>}
                  <span className="ml-auto text-[10px] text-slate-500">{new Date(log.received_at).toLocaleString('pt-BR')}</span>
                  <button type="button" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)} className="text-slate-500 hover:text-white">
                    {expandedLog === log.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {log.error_msg && <p className="pl-6 text-xs text-rose-400">{log.error_msg}</p>}
                {expandedLog === log.id && (
                  <pre className="mt-3 overflow-x-auto rounded-xl bg-black/25 p-3 text-[10px] text-slate-300">{JSON.stringify({ payload: log.payload, result: log.result }, null, 2)}</pre>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {tab === 'docs' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-[#111722] p-5">
            <p className="text-sm font-semibold text-white">Como usar</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">Faça um POST para a URL do webhook com payload JSON. O token já está na URL e funciona com Zapier, Make, n8n, Google Apps Script, ClickUp e outras ferramentas HTTP.</p>
            <div className="mt-4 rounded-xl bg-black/25 p-4 font-mono text-xs text-slate-300">POST {BASE_URL}/api/webhooks/<span className="text-violet-400">SEU_TOKEN</span><br />Content-Type: application/json</div>
          </div>
          {EVENT_DOCS.map(doc => (
            <div key={doc.event} className="overflow-hidden rounded-2xl border border-white/10 bg-[#111722]">
              <button type="button" onClick={() => setExpandedDoc(expandedDoc === doc.event ? null : doc.event)} className="flex w-full items-center justify-between p-5 text-left hover:bg-white/[0.025]">
                <div><code className="font-mono text-sm font-bold text-violet-400">{doc.event}</code><p className="mt-1 text-sm text-slate-500">{doc.desc}</p></div>
                {expandedDoc === doc.event ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
              </button>
              {expandedDoc === doc.event && <pre className="border-t border-white/10 bg-black/20 p-5 text-xs text-slate-300">{JSON.stringify(doc.example, null, 2)}</pre>}
            </div>
          ))}
        </section>
      )}

      {builder.open && (
        <MultiChannelBuilder
          automationId={builder.automationId}
          initialName={builder.name}
          initialNodes={builder.nodes}
          initialEdges={builder.edges}
          webhookToken={builder.webhookToken}
          gmailAccounts={gmailAccounts}
          zapiClients={zapiClients}
          metaConns={metaConns}
          onClose={() => setBuilder({ open: false })}
          onSaved={(id, name) => {
            setBuilder({ open: false });
            setMcAutomations((prev) => {
              const exists = prev.find((a) => a.id === id);
              if (exists) return prev.map((a) => a.id === id ? { ...a, name } : a);
              return [{ id, name, status: 'active', token: '', active_contacts: 0, total_contacts: 0, created_at: new Date().toISOString() }, ...prev];
            });
            void load();
          }}
        />
      )}
    </div>
  );
}
