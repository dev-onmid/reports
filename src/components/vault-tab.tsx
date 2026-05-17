"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Plus, Eye, EyeOff, Copy, Check, ExternalLink, Pencil, Trash2,
  Loader2, Link2, KeyRound, User, FileText, Search, Tag, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

export type VaultEntry = {
  id: string;
  client_id?: string;
  client_name?: string;
  title: string;
  url?: string | null;
  login?: string | null;
  password_enc?: string | null;
  category: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

export const VAULT_CATEGORIES = [
  'Meta Ads', 'Google Ads', 'Google Analytics', 'Website / CMS',
  'Instagram', 'Email Marketing', 'Domínio / Hospedagem', 'Outros',
];

export const CATEGORY_COLORS: Record<string, string> = {
  'Meta Ads':              '#0668E1',
  'Google Ads':            '#34A853',
  'Google Analytics':      '#F9AB00',
  'Website / CMS':         '#6366F1',
  'Instagram':             '#E1306C',
  'Email Marketing':       '#06B6D4',
  'Domínio / Hospedagem':  '#8B5CF6',
  'Outros':                '#64748B',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      className={cn('p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors', className)}
      title="Copiar"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ── Entry Card ────────────────────────────────────────────────────────────────

export function VaultCard({
  entry, onEdit, onDelete, compact = false,
}: {
  entry: VaultEntry;
  onEdit?: (e: VaultEntry) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
}) {
  const [showPw, setShowPw] = useState(false);
  const color = CATEGORY_COLORS[entry.category] ?? CATEGORY_COLORS['Outros'];

  return (
    <div className={cn(
      'group rounded-xl border border-slate-800/60 bg-[rgba(8,15,27,0.80)] transition-all hover:border-slate-700/80',
      compact ? 'p-3' : 'p-4'
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `${color}20`, color }}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <p className={cn('font-semibold text-foreground leading-tight truncate', compact ? 'text-sm' : 'text-[15px]')}>
              {entry.title}
            </p>
            <span
              className="inline-block mt-0.5 px-1.5 py-0 rounded text-[10px] font-bold uppercase tracking-wider"
              style={{ background: `${color}20`, color }}
            >
              {entry.category}
            </span>
          </div>
        </div>
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {onEdit && (
              <button
                onClick={() => onEdit(entry)}
                className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(entry.id)}
                className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Fields */}
      <div className="space-y-1.5">
        {entry.url && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/20 px-2.5 py-1.5">
            <Link2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <a
              href={entry.url.startsWith('http') ? entry.url : `https://${entry.url}`}
              target="_blank" rel="noopener noreferrer"
              className="flex-1 text-xs text-primary hover:underline truncate"
            >
              {entry.url}
            </a>
            <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
            <CopyButton value={entry.url} />
          </div>
        )}
        {entry.login && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/20 px-2.5 py-1.5">
            <User className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-xs text-foreground truncate">{entry.login}</span>
            <CopyButton value={entry.login} />
          </div>
        )}
        {entry.password_enc && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/20 px-2.5 py-1.5">
            <KeyRound className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-xs text-foreground font-mono truncate">
              {showPw ? entry.password_enc : '••••••••••••'}
            </span>
            <button
              onClick={() => setShowPw(v => !v)}
              className="p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            <CopyButton value={entry.password_enc} />
          </div>
        )}
        {entry.notes && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/20 px-2.5 py-1.5">
            <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground mt-0.5" />
            <p className="flex-1 text-xs text-muted-foreground leading-relaxed">{entry.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Entry Form Modal ──────────────────────────────────────────────────────────

function VaultModal({
  open, onClose, clientId, initial, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  initial?: VaultEntry;
  onSaved: (e: VaultEntry) => void;
}) {
  const [title, setTitle]       = useState('');
  const [url, setUrl]           = useState('');
  const [login, setLogin]       = useState('');
  const [password, setPassword] = useState('');
  const [category, setCategory] = useState('Outros');
  const [notes, setNotes]       = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? '');
    setUrl(initial?.url ?? '');
    setLogin(initial?.login ?? '');
    setPassword(initial?.password_enc ?? '');
    setCategory(initial?.category ?? 'Outros');
    setNotes(initial?.notes ?? '');
    setShowPw(false);
  }, [open, initial]);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: title.trim(), url: url || undefined,
        login: login || undefined, password_enc: password || undefined,
        category, notes: notes || undefined,
      };
      const url_ = initial
        ? `/api/clients/${clientId}/vault/${initial.id}`
        : `/api/clients/${clientId}/vault`;
      const res = await fetch(url_, {
        method: initial ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json() as VaultEntry;
        onSaved(data);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#0d1117] border-slate-800 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            {initial ? 'Editar credencial' : 'Nova credencial'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Título *</Label>
            <Input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Painel Meta Ads, Hostinger, Conta Google..."
              className="bg-muted/30 border-border text-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Categoria</Label>
            <select
              value={category} onChange={e => setCategory(e.target.value)}
              className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {VAULT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">URL / Link</Label>
            <Input
              value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://..."
              className="bg-muted/30 border-border text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Login / Email</Label>
              <Input
                value={login} onChange={e => setLogin(e.target.value)}
                placeholder="usuario@email.com"
                className="bg-muted/30 border-border text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Senha</Label>
              <div className="relative">
                <Input
                  type={showPw ? 'text' : 'password'}
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="bg-muted/30 border-border text-foreground pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notas / Observações</Label>
            <textarea
              value={notes}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
              rows={2}
              placeholder="Informações adicionais..."
              className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {initial ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab (per-client) ──────────────────────────────────────────────────────────

export function VaultTab({ clientId }: { clientId: string }) {
  const [entries, setEntries]       = useState<VaultEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing]       = useState<VaultEntry | undefined>();
  const [search, setSearch]         = useState('');
  const [catFilter, setCatFilter]   = useState('all');

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/clients/${clientId}/vault`)
      .then(r => r.ok ? r.json() as Promise<VaultEntry[]> : [])
      .then(data => setEntries(Array.isArray(data) ? data : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  function openNew()          { setEditing(undefined); setModalOpen(true); }
  function openEdit(e: VaultEntry) { setEditing(e); setModalOpen(true); }

  async function handleDelete(id: string) {
    if (!confirm('Remover esta credencial?')) return;
    await fetch(`/api/clients/${clientId}/vault/${id}`, { method: 'DELETE' });
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  function handleSaved(entry: VaultEntry) {
    setEntries(prev => {
      const idx = prev.findIndex(e => e.id === entry.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = entry; return n; }
      return [...prev, entry].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    });
  }

  const usedCats = [...new Set(entries.map(e => e.category))].sort();
  const filtered = entries.filter(e => {
    const matchCat = catFilter === 'all' || e.category === catFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || e.title.toLowerCase().includes(q) || (e.url ?? '').toLowerCase().includes(q)
      || (e.login ?? '').toLowerCase().includes(q) || (e.notes ?? '').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0 max-w-sm">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar credenciais..."
              className="pl-9 bg-muted/20 border-border h-9"
            />
          </div>
        </div>
        <Button size="sm" onClick={openNew} className="gap-1.5 h-9">
          <Plus className="w-4 h-4" /> Nova credencial
        </Button>
      </div>

      {/* Category filter pills */}
      {usedCats.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCatFilter('all')}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-bold transition-colors border',
              catFilter === 'all'
                ? 'bg-primary/20 text-primary border-primary/30'
                : 'border-slate-800/60 text-muted-foreground hover:text-foreground'
            )}
          >
            Todos ({entries.length})
          </button>
          {usedCats.map(cat => {
            const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS['Outros'];
            const count = entries.filter(e => e.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setCatFilter(catFilter === cat ? 'all' : cat)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-bold transition-colors border',
                  catFilter === cat ? 'border-transparent' : 'border-slate-800/60 text-muted-foreground hover:text-foreground'
                )}
                style={catFilter === cat ? { background: `${color}25`, color, borderColor: `${color}40` } : {}}
              >
                <Tag className="w-2.5 h-2.5 inline mr-1" />
                {cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 rounded-xl border border-dashed border-slate-800/60 bg-[rgba(8,15,27,0.40)]">
          <ShieldCheck className="w-10 h-10 text-muted-foreground/30" />
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              {search || catFilter !== 'all' ? 'Nenhuma credencial encontrada.' : 'Nenhuma credencial cadastrada ainda.'}
            </p>
            {!search && catFilter === 'all' && (
              <p className="text-xs text-muted-foreground/60 mt-1">
                Centralize links, logins e senhas do cliente aqui.
              </p>
            )}
          </div>
          {!search && catFilter === 'all' && (
            <Button size="sm" variant="outline" onClick={openNew} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Adicionar primeira credencial
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(e => (
            <VaultCard key={e.id} entry={e} onEdit={openEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <VaultModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(undefined); }}
        clientId={clientId}
        initial={editing}
        onSaved={handleSaved}
      />
    </div>
  );
}
