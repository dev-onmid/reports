"use client";

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { VaultCard, VaultEntry, VAULT_CATEGORIES, CATEGORY_COLORS } from '@/components/vault-tab';
import {
  Search, ShieldCheck, Loader2, Users, ChevronRight, Tag, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ClientAvatar } from '@/components/client-avatar';

type GroupedClient = {
  clientId: string;
  clientName: string;
  entries: VaultEntry[];
};

export default function VaultPage() {
  const [allEntries, setAllEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [catFilter, setCatFilter]   = useState('all');

  useEffect(() => {
    fetch('/api/vault')
      .then(r => r.ok ? r.json() as Promise<VaultEntry[]> : [])
      .then(data => setAllEntries(Array.isArray(data) ? data : []))
      .catch(() => setAllEntries([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allEntries.filter(e => {
      const matchCat = catFilter === 'all' || e.category === catFilter;
      const matchSearch = !q
        || e.title.toLowerCase().includes(q)
        || (e.client_name ?? '').toLowerCase().includes(q)
        || (e.url ?? '').toLowerCase().includes(q)
        || (e.login ?? '').toLowerCase().includes(q)
        || (e.notes ?? '').toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [allEntries, search, catFilter]);

  const grouped = useMemo<GroupedClient[]>(() => {
    const map = new Map<string, GroupedClient>();
    for (const e of filtered) {
      const key = e.client_id ?? 'unknown';
      if (!map.has(key)) map.set(key, { clientId: key, clientName: e.client_name ?? 'Cliente', entries: [] });
      map.get(key)!.entries.push(e);
    }
    return [...map.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [filtered]);

  const usedCats = [...new Set(allEntries.map(e => e.category))].sort();
  const totalClients = new Set(allEntries.map(e => e.client_id)).size;

  return (
    <div className="space-y-6 pb-12 relative">
      <div className="absolute top-0 right-0 w-[500px] h-[400px] bg-secondary/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </span>
          <div>
            <h1 className="font-heading font-normal text-3xl uppercase leading-none tracking-wide text-foreground">
              Cofre de Credenciais
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Links, logins e senhas centralizados de todos os clientes
            </p>
          </div>
        </div>
        {!loading && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground shrink-0">
            <span className="flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              {totalClients} cliente{totalClients !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              {allEntries.length} credencial{allEntries.length !== 1 ? 'is' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por título, cliente, URL, login..."
            className="pl-9 bg-muted/20 border-border"
          />
        </div>

        {usedCats.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCatFilter('all')}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-bold transition-colors border flex items-center gap-1',
                catFilter === 'all'
                  ? 'bg-primary/20 text-primary border-primary/30'
                  : 'border-slate-800/60 text-muted-foreground hover:text-foreground'
              )}
            >
              Todos
            </button>
            {usedCats.map(cat => {
              const color = (CATEGORY_COLORS as Record<string, string>)[cat] ?? '#64748B';
              const isActive = catFilter === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setCatFilter(isActive ? 'all' : cat)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-bold transition-colors border flex items-center gap-1',
                    isActive ? 'border-transparent' : 'border-slate-800/60 text-muted-foreground hover:text-foreground'
                  )}
                  style={isActive ? { background: `${color}25`, color, borderColor: `${color}40` } : {}}
                >
                  <Tag className="w-2.5 h-2.5" />
                  {cat}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Carregando credenciais...</span>
        </div>
      ) : allEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-5">
          <ShieldCheck className="w-14 h-14 text-muted-foreground/20" />
          <div className="text-center">
            <p className="text-lg font-semibold text-muted-foreground">Nenhuma credencial cadastrada</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Acesse um cliente e vá até a aba <strong>Links</strong> para adicionar.
            </p>
          </div>
          <Link
            href="/clientes"
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            Ir para Clientes <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Search className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Nenhuma credencial encontrada para &ldquo;{search}&rdquo;</p>
          <button onClick={() => { setSearch(''); setCatFilter('all'); }} className="text-xs text-primary hover:underline flex items-center gap-1">
            <X className="w-3 h-3" /> Limpar filtros
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(group => (
            <section key={group.clientId}>
              {/* Client header */}
              <div className="flex items-center gap-3 mb-4">
                <ClientAvatar clientId={group.clientId} name={group.clientName} size="sm" />
                <div className="flex items-center gap-2">
                  <Link
                    href={`/clientes/${group.clientId}?tab=links`}
                    className="font-bold text-sm uppercase tracking-wider text-foreground hover:text-primary transition-colors"
                  >
                    {group.clientName}
                  </Link>
                  <span className="text-[10px] font-bold text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full">
                    {group.entries.length} credencial{group.entries.length !== 1 ? 'is' : ''}
                  </span>
                </div>
                <div className="flex-1 h-px bg-slate-800/50" />
                <Link
                  href={`/clientes/${group.clientId}`}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                >
                  Ver cliente <ChevronRight className="w-3 h-3" />
                </Link>
              </div>

              {/* Entries grid */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.entries.map(e => (
                  <VaultCard key={e.id} entry={e} compact />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
