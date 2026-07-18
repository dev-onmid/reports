"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, AtSign, Camera, ExternalLink, Eye, EyeOff, Heart, MessageCircle,
  RefreshCw, Search, Users, WifiOff,
} from 'lucide-react';
import { useClients } from '@/lib/client-store';
import { ClientAvatar } from '@/components/client-avatar';
import { ResultsTabs } from '@/components/results-tabs';
import { cn } from '@/lib/utils';

type Snapshot = {
  clientId: string;
  igId: string | null;
  igUsername: string | null;
  profilePicture: string | null;
  followers: number | null;
  lastPostAt: string | null;
  lastPostPermalink: string | null;
  lastPostThumbnail: string | null;
  lastPostCaption: string | null;
  posts30d: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  reach28d: number | null;
  redAfterDays: number;
  monitored: boolean;
  error: string | null;
  fetchedAt: string;
};

type Severity = 'verde' | 'amarelo' | 'vermelho' | 'sem';

const SEV_STYLE: Record<Severity, { badge: string; border: string; label: string }> = {
  verde:    { badge: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300', border: 'border-l-emerald-500', label: 'Em dia' },
  amarelo:  { badge: 'bg-orange-500/15 border-orange-400/30 text-orange-300',    border: 'border-l-orange-400',  label: 'Atenção' },
  vermelho: { badge: 'bg-red-500/15 border-red-400/30 text-red-300',             border: 'border-l-red-500',     label: 'Sem post' },
  sem:      { badge: 'bg-muted/30 border-border text-muted-foreground',          border: 'border-l-border',      label: 'Sem conta' },
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function severityOf(snap: Snapshot | undefined): { sev: Severity; days: number | null } {
  if (!snap || snap.error || !snap.igUsername) return { sev: 'sem', days: null };
  const days = daysSince(snap.lastPostAt);
  if (days === null) return { sev: 'sem', days: null };
  const red = Math.max(1, snap.redAfterDays || 2);
  if (days >= red) return { sev: 'vermelho', days };
  if (days >= red - 1 && days >= 1) return { sev: 'amarelo', days };
  return { sev: 'verde', days };
}

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
function fmt(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return n >= 10000 ? compact.format(n) : n.toLocaleString('pt-BR');
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

function daysBadgeText(days: number | null): string {
  if (days === null) return 'Sem dados';
  if (days === 0) return 'Postou hoje';
  if (days === 1) return '1 dia sem post';
  return `${days} dias sem post`;
}

type SortKey = 'dias' | 'posts' | 'seguidores' | 'alcance' | 'engajamento';

export default function RedesSociaisPage() {
  const { clients } = useClients();
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sevFilter, setSevFilter] = useState<'todos' | Severity>('todos');
  const [catFilter, setCatFilter] = useState('todas');
  const [sortBy, setSortBy] = useState<SortKey>('dias');
  const [showHidden, setShowHidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social-monitor');
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json() as { snapshots: Snapshot[]; lastRunAt: string | null };
      const map: Record<string, Snapshot> = {};
      for (const s of data.snapshots) map[s.clientId] = s;
      setSnapshots(map);
      setLastRunAt(data.lastRunAt);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function refreshAll() {
    setRefreshingAll(true);
    try {
      await fetch('/api/social-monitor/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await load();
    } finally {
      setRefreshingAll(false);
    }
  }

  async function refreshOne(clientId: string) {
    setRefreshingIds(prev => new Set(prev).add(clientId));
    try {
      await fetch('/api/social-monitor/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientIds: [clientId] }),
      });
      await load();
    } finally {
      setRefreshingIds(prev => { const next = new Set(prev); next.delete(clientId); return next; });
    }
  }

  async function saveRuler(clientId: string, value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 90) return;
    setSnapshots(prev => {
      const existing = prev[clientId];
      if (!existing) return prev;
      return { ...prev, [clientId]: { ...existing, redAfterDays: value } };
    });
    await fetch('/api/social-monitor', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, redAfterDays: value }),
    }).catch(() => {});
  }

  // Oculta/reexibe um cliente do monitor (cliente só tráfego — post não é nosso).
  async function saveMonitored(clientId: string, monitored: boolean) {
    setSnapshots(prev => {
      const existing = prev[clientId] ?? {
        clientId, igId: null, igUsername: null, profilePicture: null, followers: null,
        lastPostAt: null, lastPostPermalink: null, lastPostThumbnail: null, lastPostCaption: null,
        posts30d: null, avgLikes: null, avgComments: null, reach28d: null,
        redAfterDays: 2, monitored: true, error: null, fetchedAt: new Date().toISOString(),
      };
      return { ...prev, [clientId]: { ...existing, monitored } };
    });
    await fetch('/api/social-monitor', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, monitored }),
    }).catch(() => {});
  }

  const rows = useMemo(() => clients.map(client => {
    const snap = snapshots[client.id];
    const { sev, days } = severityOf(snap);
    const engaj = snap && snap.avgLikes !== null
      ? (snap.avgLikes ?? 0) + (snap.avgComments ?? 0)
      : null;
    const engajPct = engaj !== null && snap?.followers ? (engaj / snap.followers) * 100 : null;
    return { client, snap, sev, days, engaj, engajPct, monitored: snap?.monitored ?? true };
  }), [clients, snapshots]);

  const categories = useMemo(
    () => [...new Set(clients.map(c => c.category_name).filter((c): c is string => Boolean(c)))].sort(),
    [clients],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter(r => {
      if (r.monitored === showHidden) return false;
      if (q && !r.client.name.toLowerCase().includes(q) && !(r.snap?.igUsername ?? '').toLowerCase().includes(q)) return false;
      if (sevFilter !== 'todos' && r.sev !== sevFilter) return false;
      if (catFilter !== 'todas' && r.client.category_name !== catFilter) return false;
      return true;
    });
    const nul = (v: number | null) => (v === null ? -1 : v);
    list.sort((a, b) => {
      if (sortBy === 'posts')       return nul(b.snap?.posts30d ?? null) - nul(a.snap?.posts30d ?? null);
      if (sortBy === 'seguidores')  return nul(b.snap?.followers ?? null) - nul(a.snap?.followers ?? null);
      if (sortBy === 'alcance')     return nul(b.snap?.reach28d ?? null) - nul(a.snap?.reach28d ?? null);
      if (sortBy === 'engajamento') return nul(b.engaj) - nul(a.engaj);
      // default: mais dias sem post primeiro (o core é achar cliente abandonado); "sem dados" por último
      return nul(b.days) - nul(a.days);
    });
    return list;
  }, [rows, search, sevFilter, catFilter, sortBy, showHidden]);

  // Cards e contagens só consideram clientes visíveis no monitor (não ocultos)
  const activeRows = rows.filter(r => r.monitored);
  const hiddenCount = rows.length - activeRows.length;
  const monitored = activeRows.filter(r => r.sev !== 'sem');
  const reds = activeRows.filter(r => r.sev === 'vermelho');
  const noAccount = activeRows.filter(r => r.sev === 'sem');
  const daysList = monitored.map(r => r.days).filter((d): d is number => d !== null);
  const avgDays = daysList.length ? Math.round(daysList.reduce((s, d) => s + d, 0) / daysList.length * 10) / 10 : null;

  const hasAnySnapshot = Object.keys(snapshots).length > 0;
  const selectClass = 'h-10 rounded-[var(--radius)] border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-primary/60';

  return (
    <div className="space-y-6 pb-8">
      <ResultsTabs />

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">Monitor de Redes Sociais</h1>
          <p className="mt-4 text-lg font-medium text-muted-foreground">
            Quanto tempo faz que não entra post no Instagram de cada cliente — e os insights gerais da conta.
          </p>
        </div>
        <div className="mt-2 flex items-center gap-3">
          {lastRunAt && (
            <span className="text-sm font-semibold text-muted-foreground">Atualizado {relTime(lastRunAt)}</span>
          )}
          <button
            onClick={() => void refreshAll()}
            disabled={refreshingAll}
            className="flex h-11 items-center gap-2 rounded-[var(--radius)] border border-border bg-card px-5 text-sm font-bold text-foreground transition-colors hover:border-primary/50 disabled:opacity-60"
          >
            <RefreshCw className={cn('h-4 w-4', refreshingAll && 'animate-spin')} />
            {refreshingAll ? 'Atualizando…' : 'Atualizar todos'}
          </button>
        </div>
      </div>

      {/* ── Cards de resumo ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {([
          { label: 'Monitorados', value: String(monitored.length), Icon: AtSign, color: '#55f52f' },
          { label: 'Sem post (vermelho)', value: String(reds.length), Icon: AlertTriangle, color: '#ef4444' },
          { label: 'Sem conta / erro', value: String(noAccount.length), Icon: WifiOff, color: '#94a3b8' },
          { label: 'Média de dias sem post', value: avgDays !== null ? String(avgDays).replace('.', ',') : '—', Icon: Camera, color: '#7b2cff' },
        ] as const).map(({ label, value, Icon, color }) => (
          <div key={label} className="rounded-[var(--radius)] border border-border bg-card px-5 py-4">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" style={{ color }} />
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
            </div>
            <p className="mt-2 font-heading text-3xl leading-none tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Filtros ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente ou @username…"
            className="h-10 w-64 rounded-[var(--radius)] border border-border bg-card pl-9 pr-3 text-sm font-semibold outline-none placeholder:text-muted-foreground/50 focus:border-primary/60"
          />
        </div>
        <select value={sevFilter} onChange={e => setSevFilter(e.target.value as typeof sevFilter)} className={selectClass}>
          <option value="todos">Todos os status</option>
          <option value="vermelho">🔴 Sem post</option>
          <option value="amarelo">🟠 Atenção</option>
          <option value="verde">🟢 Em dia</option>
          <option value="sem">⚪ Sem conta / erro</option>
        </select>
        {categories.length > 0 && (
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className={selectClass}>
            <option value="todas">Todas as categorias</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)} className={selectClass}>
          <option value="dias">Mais dias sem post</option>
          <option value="posts">Mais posts (30d)</option>
          <option value="seguidores">Mais seguidores</option>
          <option value="alcance">Maior alcance (28d)</option>
          <option value="engajamento">Maior engajamento</option>
        </select>
        {(hiddenCount > 0 || showHidden) && (
          <button
            onClick={() => setShowHidden(v => !v)}
            className={cn(
              'flex h-10 items-center gap-2 rounded-[var(--radius)] border px-4 text-sm font-bold transition-colors',
              showHidden
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
            title="Clientes ocultos do monitor (só tráfego pago — postagem não é nossa)"
          >
            <EyeOff className="h-4 w-4" />
            {showHidden ? 'Voltar ao monitor' : `Ocultos (${hiddenCount})`}
          </button>
        )}
      </div>

      {showHidden && (
        <p className="text-sm font-semibold text-muted-foreground">
          Clientes ocultos do monitor — só tráfego pago, a postagem não é responsabilidade da agência. Clique no olho para voltar a monitorar.
        </p>
      )}

      {/* ── Empty state / erro ── */}
      {!loading && !hasAnySnapshot && (
        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card px-8 py-12 text-center">
          <AtSign className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-4 text-lg font-bold text-foreground">
            {loadError ? 'Não foi possível carregar o monitor.' : 'Nenhuma coleta feita ainda.'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {loadError
              ? 'Verifique a conexão com o banco e tente novamente.'
              : 'Rode a primeira coleta para buscar o Instagram de todos os clientes.'}
          </p>
          {!loadError && (
            <button
              onClick={() => void refreshAll()}
              disabled={refreshingAll}
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-[var(--radius)] bg-primary px-6 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', refreshingAll && 'animate-spin')} />
              {refreshingAll ? 'Coletando… (pode levar alguns minutos)' : 'Rodar primeira coleta'}
            </button>
          )}
        </div>
      )}

      {/* ── Lista ── */}
      {(loading || hasAnySnapshot) && (
        <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[1150px] w-full">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {['CLIENTE', 'ÚLTIMO POST', 'RÉGUA (DIAS)', 'POSTS 30D', 'SEGUIDORES', 'ALCANCE 28D', 'ENGAJ. MÉDIO/POST', 'PUBLICAÇÃO', ''].map((label, i) => (
                    <th key={i} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {showHidden ? 'Nenhum cliente oculto.' : 'Nenhum cliente encontrado com esses filtros.'}
                  </td></tr>
                )}
                {!loading && filtered.map(({ client, snap, sev, days, engaj, engajPct }) => {
                  const style = SEV_STYLE[sev];
                  const refreshing = refreshingIds.has(client.id);
                  return (
                    <tr key={client.id} className={cn('border-l-[3px] hover:bg-muted/20 transition-colors', style.border)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ClientAvatar clientId={client.id} name={client.name} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-bold truncate">{client.name}</p>
                            {snap?.igUsername ? (
                              <a
                                href={`https://instagram.com/${snap.igUsername}`}
                                target="_blank" rel="noreferrer"
                                className="text-xs text-muted-foreground hover:text-primary transition-colors"
                              >
                                @{snap.igUsername}
                              </a>
                            ) : (
                              <p className="text-xs text-muted-foreground/50">{client.segment}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn('inline-block rounded-full border px-3 py-1 text-xs font-bold', style.badge)}
                          title={snap?.error ?? (snap?.lastPostAt ? new Date(snap.lastPostAt).toLocaleString('pt-BR') : undefined)}
                        >
                          {sev === 'sem' ? (snap?.error ? 'Erro na coleta' : snap ? 'Sem conta IG' : 'Nunca coletado') : daysBadgeText(days)}
                        </span>
                        {snap?.lastPostAt && sev !== 'sem' && (
                          <p className="mt-1 text-[11px] text-muted-foreground/70">
                            {new Date(snap.lastPostAt).toLocaleDateString('pt-BR')}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number" min={1} max={90}
                          defaultValue={snap?.redAfterDays ?? 2}
                          key={`${client.id}-${snap?.redAfterDays ?? 2}`}
                          onBlur={e => void saveRuler(client.id, Number(e.target.value))}
                          title="Dias sem post para o cliente ficar vermelho"
                          className="h-8 w-16 rounded-[var(--radius)] border border-border bg-background px-2 text-center text-sm font-bold outline-none focus:border-primary/60"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-bold tabular-nums">{fmt(snap?.posts30d ?? null)}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-sm font-bold tabular-nums">
                          <Users className="h-3.5 w-3.5 text-muted-foreground/50" />
                          {fmt(snap?.followers ?? null)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-bold tabular-nums">{fmt(snap?.reach28d ?? null)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {engaj !== null ? (
                          <div>
                            <span className="flex items-center gap-2 text-sm font-bold tabular-nums">
                              <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5 text-muted-foreground/50" />{fmt(snap?.avgLikes ?? null)}</span>
                              <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5 text-muted-foreground/50" />{fmt(snap?.avgComments ?? null)}</span>
                            </span>
                            {engajPct !== null && (
                              <p className="mt-0.5 text-[11px] text-muted-foreground/70">{engajPct.toFixed(2).replace('.', ',')}% dos seguidores</p>
                            )}
                          </div>
                        ) : <span className="text-sm text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {snap?.lastPostThumbnail && snap.lastPostPermalink ? (
                          <a href={snap.lastPostPermalink} target="_blank" rel="noreferrer" className="group relative inline-block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={snap.lastPostThumbnail}
                              alt="Último post"
                              className="h-12 w-12 rounded-md object-cover border border-border"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            <ExternalLink className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full bg-card p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </a>
                        ) : snap?.lastPostPermalink ? (
                          <a href={snap.lastPostPermalink} target="_blank" rel="noreferrer" className="text-xs font-semibold text-muted-foreground hover:text-primary transition-colors">
                            Ver post <ExternalLink className="inline h-3 w-3" />
                          </a>
                        ) : <span className="text-sm text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => void refreshOne(client.id)}
                            disabled={refreshing || refreshingAll}
                            title="Atualizar este cliente agora"
                            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
                          >
                            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                          </button>
                          <button
                            onClick={() => void saveMonitored(client.id, showHidden)}
                            title={showHidden
                              ? 'Voltar a monitorar este cliente'
                              : 'Ocultar do monitor (só tráfego pago — postagem não é nossa)'}
                            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                          >
                            {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
