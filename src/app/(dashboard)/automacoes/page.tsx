"use client";

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Plus, Copy, Trash2, Check, Zap, RefreshCw,
  ToggleLeft, ToggleRight, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle2, MinusCircle, Globe,
} from 'lucide-react';

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
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [tab, setTab] = useState<'webhooks' | 'logs' | 'docs'>('webhooks');

  async function load() {
    setLoading(true);
    const [cfgRes, logRes] = await Promise.all([
      fetch('/api/automacoes'),
      fetch('/api/automacoes/logs'),
    ]);
    if (cfgRes.ok) setConfigs(await cfgRes.json());
    if (logRes.ok) setLogs(await logRes.json());
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

  const statusIcon = (s: WebhookLog['status']) => {
    if (s === 'success') return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
    if (s === 'error')   return <AlertCircle  className="h-4 w-4 text-rose-500 shrink-0" />;
    return <MinusCircle className="h-4 w-4 text-zinc-400 shrink-0" />;
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Automações</h1>
            <p className="text-sm text-muted-foreground">Webhooks para integrar com ClickUp, Google Forms, Zapier, Make e outros.</p>
          </div>
        </div>
        <button type="button" onClick={load} className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['webhooks', 'logs', 'docs'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'webhooks' ? 'Webhooks' : t === 'logs' ? 'Logs' : 'Documentação'}
          </button>
        ))}
      </div>

      {/* ── Webhooks tab ── */}
      {tab === 'webhooks' && (
        <div className="space-y-4">
          {/* Create button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowForm(v => !v)}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Novo Webhook
            </button>
          </div>

          {/* Create form */}
          {showForm && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Criar novo webhook</p>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Nome (ex: Google Forms – Leads)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                onKeyDown={e => e.key === 'Enter' && void create()}
              />
              <input
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Descrição (opcional)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
                <button type="button" onClick={() => void create()} disabled={creating || !newName.trim()} className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {creating ? 'Criando...' : 'Criar'}
                </button>
              </div>
            </div>
          )}

          {/* Webhook list */}
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : configs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center space-y-2">
              <Zap className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nenhum webhook criado ainda.</p>
              <p className="text-xs text-muted-foreground/60">Clique em "Novo Webhook" para começar.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {configs.map(cfg => {
                const url = `${BASE_URL}/api/webhooks/${cfg.token}`;
                const copied = copiedId === cfg.id;
                return (
                  <div key={cfg.id} className={cn('rounded-xl border bg-card p-4 space-y-3 transition-opacity', !cfg.enabled && 'opacity-60')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground truncate">{cfg.name}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', cfg.enabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-zinc-500')}>
                            {cfg.enabled ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                        {cfg.description && <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>}
                        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                          Criado em {new Date(cfg.created_at).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button type="button" onClick={() => toggle(cfg)} title={cfg.enabled ? 'Desativar' : 'Ativar'} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                          {cfg.enabled ? <ToggleRight className="h-4 w-4 text-emerald-500" /> : <ToggleLeft className="h-4 w-4" />}
                        </button>
                        <button type="button" onClick={() => remove(cfg.id)} title="Excluir" className="rounded-lg p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* URL */}
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <code className="flex-1 truncate text-xs text-foreground font-mono">{url}</code>
                      <button
                        type="button"
                        onClick={() => copyUrl(cfg)}
                        className={cn('flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors', copied ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground hover:text-foreground')}
                      >
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied ? 'Copiado!' : 'Copiar'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Logs tab ── */}
      {tab === 'logs' && (
        <div className="space-y-3">
          {logs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center space-y-2">
              <p className="text-sm text-muted-foreground">Nenhum evento recebido ainda.</p>
            </div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="rounded-xl border border-border bg-card p-3 space-y-1">
                <div className="flex items-center gap-2">
                  {statusIcon(log.status)}
                  <span className="text-xs font-semibold text-foreground font-mono">{log.event_type ?? 'desconhecido'}</span>
                  {log.config_name && <span className="text-xs text-muted-foreground">via {log.config_name}</span>}
                  <span className="ml-auto text-[10px] text-muted-foreground/60">
                    {new Date(log.received_at).toLocaleString('pt-BR')}
                  </span>
                  <button type="button" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)} className="text-muted-foreground hover:text-foreground">
                    {expandedLog === log.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {log.error_msg && <p className="text-xs text-rose-400 pl-6">{log.error_msg}</p>}
                {expandedLog === log.id && (
                  <div className="pt-2 space-y-2 pl-6">
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground mb-1">Payload recebido</p>
                      <pre className="text-[10px] text-foreground bg-muted/50 rounded-lg p-2 overflow-x-auto">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </div>
                    {!!log.result && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground mb-1">Resultado</p>
                        <pre className="text-[10px] text-foreground bg-muted/50 rounded-lg p-2 overflow-x-auto">
                          {JSON.stringify(log.result, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Docs tab ── */}
      {tab === 'docs' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <p className="text-sm font-semibold text-foreground">Como usar</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Faça um <code className="bg-muted px-1 rounded text-foreground font-mono">POST</code> para a URL do webhook com o payload JSON abaixo.
              Não precisa de header de autenticação — o token já está na URL.
              Qualquer ferramenta que faça requisições HTTP funciona: Zapier, Make, n8n, Google Apps Script, ClickUp, etc.
            </p>
            <div className="rounded-lg bg-muted/50 p-3 font-mono text-xs text-foreground">
              POST {BASE_URL}/api/webhooks/<span className="text-violet-400">SEU_TOKEN</span><br />
              Content-Type: application/json
            </div>
          </div>

          {EVENT_DOCS.map(doc => (
            <div key={doc.event} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedDoc(expandedDoc === doc.event ? null : doc.event)}
                className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
              >
                <div>
                  <code className="text-sm font-mono font-bold text-violet-500">{doc.event}</code>
                  <p className="text-xs text-muted-foreground mt-0.5">{doc.desc}</p>
                </div>
                {expandedDoc === doc.event ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>

              {expandedDoc === doc.event && (
                <div className="border-t border-border p-4 space-y-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="pb-2 font-semibold pr-4">Campo</th>
                        <th className="pb-2 font-semibold pr-4">Tipo</th>
                        <th className="pb-2 font-semibold pr-4">Obrigatório</th>
                        <th className="pb-2 font-semibold">Descrição</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {doc.fields.map(f => (
                        <tr key={f.name}>
                          <td className="py-2 pr-4 font-mono text-foreground">{f.name}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{f.type}</td>
                          <td className="py-2 pr-4">
                            {f.required
                              ? <span className="text-rose-400 font-semibold">sim</span>
                              : <span className="text-muted-foreground">não</span>}
                          </td>
                          <td className="py-2 text-muted-foreground">{f.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Exemplo de payload</p>
                    <pre className="text-xs text-foreground bg-muted/50 rounded-lg p-3 overflow-x-auto">
                      {JSON.stringify(doc.example, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
