"use client";

import { useEffect, useState } from 'react';
import { useClients } from '@/lib/client-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import {
  Search, BookMarked, ExternalLink, RefreshCw, ChevronRight, Trash2, X,
} from 'lucide-react';
import type { AdLibraryAd } from '@/app/api/meta/ad-library/route';
import type { SavedAd } from '@/app/api/ad-library/saved/route';

const AD_COUNTRIES = [
  { code: 'BR', label: 'Brasil' },
  { code: 'US', label: 'EUA' },
  { code: 'PT', label: 'Portugal' },
  { code: 'AR', label: 'Argentina' },
  { code: 'MX', label: 'México' },
];

function AdCard({
  ad,
  savedId,
  onSave,
  onRemove,
  saving,
  clients,
}: {
  ad: AdLibraryAd;
  savedId: string | null;
  onSave: (clientId: string) => void;
  onRemove: () => void;
  saving: boolean;
  clients: { id: string; name: string }[];
}) {
  const [showClientPicker, setShowClientPicker] = useState(false);
  const body = ad.creativeBodies[0] ?? '';
  const title = ad.creativeTitles[0] ?? '';
  const platforms = ad.publisherPlatforms.join(', ');
  const dateStart = ad.deliveryStartTime
    ? new Date(ad.deliveryStartTime).toLocaleDateString('pt-BR')
    : null;

  return (
    <div className="relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{ad.pageName}</p>
          {platforms && (
            <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">{platforms}</p>
          )}
        </div>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold border',
          ad.adActiveStatus === 'ACTIVE'
            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
            : 'bg-muted/50 text-muted-foreground border-border'
        )}>
          {ad.adActiveStatus === 'ACTIVE' ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      {title && <p className="text-sm font-semibold text-foreground/90 line-clamp-2">{title}</p>}
      {body && <p className="text-xs text-muted-foreground line-clamp-3">{body}</p>}

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground border-t border-border pt-3 mt-auto">
        {dateStart && <span>Início: {dateStart}</span>}
        {ad.impressions?.lower_bound && (
          <span>Impress.: {Number(ad.impressions.lower_bound).toLocaleString('pt-BR')}+</span>
        )}
        {ad.spend?.lower_bound && ad.currency && (
          <span>Gasto: {ad.currency} {Number(ad.spend.lower_bound).toLocaleString('pt-BR')}+</span>
        )}
      </div>

      <div className="flex gap-2">
        <a
          href={ad.adSnapshotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          Ver anúncio
        </a>

        {savedId ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Remover
          </button>
        ) : (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowClientPicker(v => !v)}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-colors"
            >
              <BookMarked className="h-3 w-3" />
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            {showClientPicker && (
              <div className="absolute right-0 bottom-full mb-1.5 z-50 w-52 rounded-xl border border-border bg-card shadow-xl p-1">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Salvar para cliente</p>
                  <button type="button" onClick={() => setShowClientPicker(false)}>
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {clients.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { onSave(c.id); setShowClientPicker(false); }}
                      className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium hover:bg-muted/50 transition-colors truncate"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BibliotecaPage() {
  const { clients } = useClients();
  const activeClients = clients.filter(c => c.status !== 'Inativo');

  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('BR');
  const [adStatus, setAdStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [results, setResults] = useState<AdLibraryAd[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedMap, setSavedMap] = useState<Record<string, { id: string; clientId: string }>>({});
  const [activeView, setActiveView] = useState<'search' | 'saved'>('search');
  const [allSaved, setAllSaved] = useState<SavedAd[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [filterClientId, setFilterClientId] = useState('');

  // Load all saved ads
  useEffect(() => {
    setSavedLoading(true);
    const url = filterClientId
      ? `/api/ad-library/saved?clientId=${filterClientId}`
      : '/api/ad-library/saved?clientId=__all__';
    fetch(url)
      .then(r => r.ok ? r.json() as Promise<SavedAd[]> : [])
      .then(data => {
        setAllSaved(data);
        const map: Record<string, { id: string; clientId: string }> = {};
        for (const s of data) map[s.adArchiveId] = { id: s.id, clientId: s.clientId };
        setSavedMap(map);
      })
      .catch(() => {})
      .finally(() => setSavedLoading(false));
  }, [filterClientId]);

  async function doSearch(cursor?: string) {
    if (!query.trim()) return;
    if (cursor) setLoadingMore(true);
    else { setSearching(true); setResults([]); setNextCursor(null); }
    setSearchError('');
    try {
      const params = new URLSearchParams({ q: query, country, status: adStatus, limit: '20' });
      if (cursor) params.set('after', cursor);
      const res = await fetch(`/api/meta/ad-library?${params}`);
      const json = await res.json() as { data?: AdLibraryAd[]; paging?: { cursors?: { after?: string }; next?: string }; error?: string };
      if (!res.ok) { setSearchError(json.error ?? 'Erro na busca.'); return; }
      setResults(prev => cursor ? [...prev, ...(json.data ?? [])] : (json.data ?? []));
      setNextCursor(json.paging?.cursors?.after ?? (json.paging?.next ? 'next' : null));
    } catch {
      setSearchError('Erro de conexão.');
    } finally {
      setSearching(false);
      setLoadingMore(false);
    }
  }

  async function saveAd(ad: AdLibraryAd, clientId: string) {
    setSavingId(ad.adArchiveId);
    try {
      const res = await fetch('/api/ad-library/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, ad }),
      });
      if (res.ok) {
        const saved = await res.json() as SavedAd;
        setSavedMap(prev => ({ ...prev, [ad.adArchiveId]: { id: saved.id, clientId } }));
        setAllSaved(prev => [saved, ...prev.filter(s => s.adArchiveId !== ad.adArchiveId)]);
      }
    } finally {
      setSavingId(null);
    }
  }

  async function removeAd(savedId: string, adArchiveId: string) {
    setSavingId(savedId);
    try {
      await fetch(`/api/ad-library/saved/${savedId}`, { method: 'DELETE' });
      setSavedMap(prev => { const n = { ...prev }; delete n[adArchiveId]; return n; });
      setAllSaved(prev => prev.filter(s => s.id !== savedId));
    } finally {
      setSavingId(null);
    }
  }

  const displayedSaved = filterClientId
    ? allSaved.filter(s => s.clientId === filterClientId)
    : allSaved;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-6 px-6 py-3 -mt-6 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-4xl uppercase tracking-wider">Biblioteca de Anúncios</h1>
            <p className="mt-0.5 text-muted-foreground text-sm">Pesquise anúncios no Meta Ad Library e salve por cliente.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView('search')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors',
                activeView === 'search'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
              )}
            >
              <Search className="h-3.5 w-3.5" />
              Buscar
            </button>
            <button
              type="button"
              onClick={() => setActiveView('saved')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors',
                activeView === 'saved'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
              )}
            >
              <BookMarked className="h-3.5 w-3.5" />
              Salvos
              {allSaved.length > 0 && (
                <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-black text-primary">
                  {allSaved.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Search view */}
      {activeView === 'search' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-1 min-w-64 items-center gap-2 rounded-lg border border-border bg-background px-3">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  placeholder="Palavra-chave, produto, marca, nicho..."
                  className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none focus:ring-1 focus:ring-primary"
              >
                {AD_COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
              <select
                value={adStatus}
                onChange={e => setAdStatus(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">Todos</option>
                <option value="ACTIVE">Ativos</option>
                <option value="INACTIVE">Inativos</option>
              </select>
              <button
                type="button"
                onClick={() => doSearch()}
                disabled={searching || !query.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-xs font-bold uppercase tracking-wider text-black hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {searching
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  : <Search className="h-3.5 w-3.5" />}
                Buscar
              </button>
            </div>
          </div>

          {searchError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-2">
              <p className="text-sm font-bold text-red-400">Erro na busca</p>
              <p className="text-xs text-red-400/80">{searchError}</p>
              <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground">Como resolver:</p>
                <p>1. Acesse <strong>developers.facebook.com</strong> → selecione o app usado na integração Meta</p>
                <p>2. Vá em <strong>Produtos → Marketing API → Permissões</strong> e confirme que <code className="rounded bg-red-500/10 px-1">ads_read</code> tem acesso <strong>Standard</strong></p>
                <p>3. Se necessário, solicite acesso à <strong>Ads Library API</strong> em <strong>facebook.com/ads/library/api</strong></p>
                <p>4. Após aprovação, reconecte a integração Meta em <strong>Integrações</strong></p>
              </div>
            </div>
          )}

          {searching && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-64 animate-pulse rounded-xl border border-border bg-card" />
              ))}
            </div>
          )}

          {!searching && results.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{results.length} anúncio{results.length !== 1 ? 's' : ''} encontrado{results.length !== 1 ? 's' : ''}</p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {results.map(ad => {
                  const saved = savedMap[ad.adArchiveId];
                  return (
                    <AdCard
                      key={ad.adArchiveId}
                      ad={ad}
                      savedId={saved?.id ?? null}
                      onSave={(clientId) => saveAd(ad, clientId)}
                      onRemove={() => saved && removeAd(saved.id, ad.adArchiveId)}
                      saving={savingId === ad.adArchiveId || savingId === saved?.id}
                      clients={activeClients}
                    />
                  );
                })}
              </div>
              {nextCursor && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => doSearch(nextCursor)}
                    disabled={loadingMore}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-2.5 text-xs font-bold text-muted-foreground hover:bg-muted/50 transition-colors"
                  >
                    {loadingMore ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {loadingMore ? 'Carregando...' : 'Carregar mais'}
                  </button>
                </div>
              )}
            </>
          )}

          {!searching && results.length === 0 && !searchError && (
            <div className="rounded-xl border border-border bg-card/50 py-16 text-center">
              <Search className="mx-auto h-10 w-10 text-muted-foreground/30 mb-4" />
              <p className="text-sm font-semibold text-muted-foreground">
                {query.trim() ? 'Nenhum anúncio encontrado.' : 'Digite palavras-chave para pesquisar.'}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {query.trim()
                  ? 'Tente outros termos ou mude o filtro de status.'
                  : 'Exemplos: implante dentário, clínica estética, consultório...'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Saved view */}
      {activeView === 'saved' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={filterClientId}
              onChange={e => setFilterClientId(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Todos os clientes</option>
              {activeClients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {savedLoading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {displayedSaved.length === 0 ? (
            <div className="rounded-xl border border-border bg-card/50 py-16 text-center">
              <BookMarked className="mx-auto h-10 w-10 text-muted-foreground/30 mb-4" />
              <p className="text-sm font-semibold text-muted-foreground">Nenhum anúncio salvo.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Busque anúncios e salve para um cliente.</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {displayedSaved.length} anúncio{displayedSaved.length !== 1 ? 's' : ''} salvo{displayedSaved.length !== 1 ? 's' : ''}
                {filterClientId && ` para ${activeClients.find(c => c.id === filterClientId)?.name}`}
              </p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {displayedSaved.map(ad => (
                  <AdCard
                    key={ad.id}
                    ad={ad}
                    savedId={ad.id}
                    onSave={() => {}}
                    onRemove={() => removeAd(ad.id, ad.adArchiveId)}
                    saving={savingId === ad.id}
                    clients={activeClients}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
