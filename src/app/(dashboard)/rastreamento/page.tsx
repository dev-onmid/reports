'use client';

import { useEffect, useState } from 'react';
import {
  Copy, Check, Trash2, Plus, ExternalLink, RefreshCw,
  Link2, MousePointerClick, ChevronDown, ChevronUp, X, Pencil,
} from 'lucide-react';
import { useClients } from '@/lib/client-store';
import { cn } from '@/lib/utils';

type Redirect = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  name: string;
  slug: string;
  whatsapp: string;
  message: string;
  clicks: number;
  last_click: string | null;
  created_at: string;
};

type ClickBreakdown = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  clicks: number;
};

const BASE = typeof window !== 'undefined' ? window.location.origin : '';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      title="Copiar link"
      className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 py-1 text-xs font-semibold transition-colors hover:bg-muted"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  );
}

function BreakdownRow({ row }: { row: ClickBreakdown }) {
  const parts = [
    row.utm_source && `src: ${row.utm_source}`,
    row.utm_medium && `mid: ${row.utm_medium}`,
    row.utm_campaign && `camp: ${row.utm_campaign}`,
    row.utm_content && `cont: ${row.utm_content}`,
    row.utm_term && `term: ${row.utm_term}`,
  ].filter(Boolean);

  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs border-b border-border/50 last:border-0">
      <span className="text-muted-foreground truncate max-w-xs">
        {parts.length > 0 ? parts.join(' · ') : <span className="italic">sem UTMs</span>}
      </span>
      <span className="shrink-0 font-bold tabular-nums text-foreground">{row.clicks}x</span>
    </div>
  );
}

export default function RastreamentoPage() {
  const { clients } = useClients();
  const [links, setLinks] = useState<Redirect[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, ClickBreakdown[]>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    clientId: '', name: '', slug: '', whatsapp: '', message: 'Olá, vim pelo anúncio!',
  });

  function loadLinks() {
    setLoading(true);
    fetch('/api/link-redirects')
      .then(r => r.ok ? r.json() as Promise<Redirect[]> : [])
      .then(setLinks)
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadLinks(); }, []);

  async function save() {
    setError('');
    if (!form.name || !form.whatsapp) { setError('Nome e WhatsApp são obrigatórios.'); return; }
    setSaving(true);
    try {
      const isEdit = !!editingId;
      const url = isEdit ? `/api/link-redirects/${editingId}` : '/api/link-redirects';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: form.clientId || undefined,
          name: form.name,
          slug: form.slug || undefined,
          whatsapp: form.whatsapp,
          message: form.message,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? 'Erro ao salvar.');
        return;
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ clientId: '', name: '', slug: '', whatsapp: '', message: 'Olá, vim pelo anúncio!' });
      loadLinks();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Remover este link e todos os seus cliques?')) return;
    await fetch(`/api/link-redirects/${id}`, { method: 'DELETE' });
    setLinks(prev => prev.filter(l => l.id !== id));
  }

  function openEdit(link: Redirect) {
    setForm({
      clientId: link.client_id ?? '',
      name: link.name,
      slug: link.slug,
      whatsapp: link.whatsapp,
      message: link.message,
    });
    setEditingId(link.id);
    setShowForm(true);
  }

  async function toggleBreakdown(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!breakdown[id]) {
      const rows = await fetch(`/api/link-redirects/${id}`)
        .then(r => r.ok ? r.json() as Promise<ClickBreakdown[]> : [])
        .catch(() => [] as ClickBreakdown[]);
      setBreakdown(prev => ({ ...prev, [id]: rows }));
    }
  }

  const totalClicks = links.reduce((s, l) => s + l.clicks, 0);

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Rastreamento de Links</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Crie links que capturam UTMs antes de redirecionar para o WhatsApp.
          </p>
        </div>
        <button
          onClick={() => { setEditingId(null); setForm({ clientId: '', name: '', slug: '', whatsapp: '', message: 'Olá, vim pelo anúncio!' }); setShowForm(true); }}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black shadow-[0_0_16px_rgba(85,245,47,0.35)] hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Novo Link
        </button>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Total de links', value: links.length, icon: Link2, color: '#22c55e' },
          { label: 'Total de cliques', value: totalClicks, icon: MousePointerClick, color: '#3b82f6' },
          { label: 'Cliques hoje', value: links.reduce((s, l) => s + (l.last_click && new Date(l.last_click).toDateString() === new Date().toDateString() ? 1 : 0), 0), icon: RefreshCw, color: '#a855f7' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="relative overflow-hidden rounded-xl border bg-card p-4" style={{ borderColor: `${color}44` }}>
            <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 85% 15%, ${color}22, transparent 50%)` }} />
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
              <Icon className="h-4 w-4" style={{ color }} />
            </div>
            <p className="mt-2 text-2xl font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-bold text-lg">{editingId ? 'Editar Link' : 'Novo Link de Rastreamento'}</h2>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Nome do link *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Ex: Facebook - Campanha Novembro"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Cliente</label>
                <select
                  value={form.clientId}
                  onChange={e => setForm(p => ({ ...p, clientId: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  <option value="">— Sem cliente —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Número WhatsApp * <span className="text-muted-foreground/60">(somente números, com DDD e DDI)</span>
                </label>
                <input
                  value={form.whatsapp}
                  onChange={e => setForm(p => ({ ...p, whatsapp: e.target.value }))}
                  placeholder="5511999999999"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Mensagem de abertura</label>
                <textarea
                  value={form.message}
                  onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Slug personalizado <span className="text-muted-foreground/60">(deixe vazio para gerar automático)</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground">/r/</span>
                  <input
                    value={form.slug}
                    onChange={e => setForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    placeholder="minha-campanha"
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>

              {error && <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-border py-2 text-sm font-semibold hover:bg-muted/50 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-60 transition-colors"
                >
                  {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  {editingId ? 'Salvar alterações' : 'Criar link'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Links list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-muted/30" />)}
        </div>
      ) : links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Link2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="font-semibold text-muted-foreground">Nenhum link criado ainda.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Clique em "Novo Link" para criar o primeiro.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {links.map(link => {
            const url = `${BASE}/r/${link.slug}`;
            const isExpanded = expandedId === link.id;
            const rows = breakdown[link.id];
            return (
              <div key={link.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  {/* Name + URL */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{link.name}</p>
                      {link.client_name && (
                        <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{link.client_name}</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="text-xs text-primary font-mono truncate max-w-xs">{url}</code>
                      <a href={url} target="_blank" rel="noreferrer" title="Abrir link">
                        <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </a>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                      WhatsApp: {link.whatsapp} · &quot;{link.message}&quot;
                    </p>
                  </div>

                  {/* Clicks */}
                  <div className="text-center shrink-0">
                    <p className="text-xl font-bold text-primary">{link.clicks}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">cliques</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <CopyButton text={url} />
                    <button
                      onClick={() => toggleBreakdown(link.id)}
                      title="Ver breakdown UTMs"
                      className={cn('flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold transition-colors hover:bg-muted/50', isExpanded && 'bg-muted/50')}
                    >
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      UTMs
                    </button>
                    <button onClick={() => openEdit(link)} title="Editar" className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(link.id)} title="Remover" className="rounded-lg border border-red-400/30 p-1.5 text-red-400 transition-colors hover:bg-red-500/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Breakdown */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 px-4 py-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Breakdown por UTMs</p>
                    {!rows ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <RefreshCw className="h-3 w-3 animate-spin" /> Carregando...
                      </div>
                    ) : rows.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum clique registrado ainda.</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto">
                        {rows.map((row, i) => <BreakdownRow key={i} row={row} />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
