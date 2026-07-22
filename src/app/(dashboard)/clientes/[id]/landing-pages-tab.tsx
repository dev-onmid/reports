'use client';

// ── Radar de LP: aba "Landing Pages" do cliente ──────────────────────────────
// Cadastro de LPs + snippet do script de coleta + painel de comportamento
// agregado (funil de scroll, onde clicam, device, campanha, série diária).
// Coleta é ANÔNIMA/agregada — sem visão individual por lead (decisão do Matheus).

import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Check, Copy, ExternalLink, Flame, Globe2, Monitor, MousePointerClick,
  Plus, RefreshCw, Smartphone, Tablet, Trash2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Lp = {
  id: string;
  name: string;
  url: string;
  tracking_key: string;
  active: boolean;
  created_at: string;
  sessions_30d: number;
  last_session_at: string | null;
};

type LpStats = {
  total: number;
  avgDurationMs: number | null;
  avgScrollPct: number | null;
  scrollFunnel: { reach25: number; reach50: number; reach75: number; reach100: number };
  topClicks: { el: string; txt: string; clicks: number; sessions: number }[];
  porDevice: { label: string; count: number }[];
  porCampanha: { label: string; count: number }[];
  porOrigem: { label: string; count: number }[];
  porDia: { day: string; count: number }[];
};

function publicBase() {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function copyToClipboard(text: string, onDone: () => void) {
  navigator.clipboard.writeText(text).then(() => {
    onDone();
    setTimeout(onDone, 1600);
  });
}

function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => copyToClipboard(text, () => setCopied(v => !v))}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copiado' : label}
    </button>
  );
}

function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '–';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function relativeAge(iso: string | null): { label: string; fresh: boolean } {
  if (!iso) return { label: 'Nunca coletou', fresh: false };
  const diffH = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (diffH < 1) return { label: 'Coletando agora', fresh: true };
  if (diffH < 24) return { label: `Última visita há ${Math.round(diffH)}h`, fresh: true };
  return { label: `Sem sinal há ${Math.round(diffH / 24)}d`, fresh: false };
}

const DEVICE_META: Record<string, { label: string; icon: React.ElementType }> = {
  mobile: { label: 'Celular', icon: Smartphone },
  tablet: { label: 'Tablet', icon: Tablet },
  desktop: { label: 'Computador', icon: Monitor },
};

// Barra horizontal simples (lista de contagem, padrão do repo)
function CountBars({ items, total }: { items: { label: string; count: number }[]; total: number }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">Sem dados no período.</p>;
  const max = Math.max(...items.map(i => i.count), 1);
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="w-36 truncate text-xs text-muted-foreground" title={item.label}>{item.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-sm bg-muted/40">
            <div className="h-full bg-primary/70" style={{ width: `${(item.count / max) * 100}%` }} />
          </div>
          <span className="w-14 text-right text-xs font-bold text-foreground">
            {item.count}
            {total > 0 && <span className="ml-1 font-normal text-muted-foreground">({Math.round((item.count / total) * 100)}%)</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Funil de scroll (visualização-herói): termômetro vertical ────────────────
function ScrollFunnel({ stats }: { stats: LpStats }) {
  const total = stats.total || 1;
  const faixas = [
    { label: 'Topo da página', pct: 100, hint: 'Todo mundo que entrou' },
    { label: 'Chegou a 25%', pct: Math.round((stats.scrollFunnel.reach25 / total) * 100), hint: `${stats.scrollFunnel.reach25} visitas` },
    { label: 'Chegou à metade', pct: Math.round((stats.scrollFunnel.reach50 / total) * 100), hint: `${stats.scrollFunnel.reach50} visitas` },
    { label: 'Chegou a 75%', pct: Math.round((stats.scrollFunnel.reach75 / total) * 100), hint: `${stats.scrollFunnel.reach75} visitas` },
    { label: 'Chegou ao fim', pct: Math.round((stats.scrollFunnel.reach100 / total) * 100), hint: `${stats.scrollFunnel.reach100} visitas` },
  ];
  return (
    <div className="space-y-1.5">
      {faixas.map((f, i) => (
        <div key={f.label} className="flex items-center gap-3" title={f.hint}>
          <span className="w-28 shrink-0 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{f.label}</span>
          <div className="relative h-9 flex-1 overflow-hidden rounded-sm bg-muted/30">
            <div
              className={cn('h-full transition-all', i === 0 ? 'bg-primary/80' : i <= 2 ? 'bg-primary/55' : 'bg-primary/35')}
              style={{ width: `${Math.max(f.pct, 2)}%` }}
            />
            <span className="absolute inset-y-0 right-2 flex items-center font-heading text-xl uppercase leading-none tracking-wide text-foreground">
              {f.pct}%
            </span>
          </div>
        </div>
      ))}
      <p className="pt-1 text-[11px] text-muted-foreground">
        % das visitas que rolou até cada trecho da página. Queda brusca = ponto onde as pessoas desistem.
      </p>
    </div>
  );
}

export function LandingPagesTab({ clientId }: { clientId: string }) {
  const [lps, setLps] = useState<Lp[]>([]);
  const [base, setBase] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stats, setStats] = useState<LpStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/landing-pages`);
      if (!res.ok) throw new Error('Falha ao carregar');
      const data = await res.json() as { lps: Lp[]; base: string };
      setLps(data.lps ?? []);
      setBase(data.base || publicBase());
      setSelectedId(prev => prev ?? data.lps?.[0]?.id ?? null);
    } catch {
      setError('Não foi possível carregar as landing pages.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const loadStats = useCallback(async (lpId: string, d: number) => {
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/landing-pages/${lpId}/stats?days=${d}`);
      setStats(res.ok ? await res.json() as LpStats : null);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (selectedId) void loadStats(selectedId, days);
    else setStats(null);
  }, [selectedId, days, loadStats]);

  const createLp = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/landing-pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, url: formUrl }),
      });
      const data = await res.json().catch(() => null) as (Lp & { error?: string }) | null;
      if (!res.ok) {
        setFormError(data?.error ?? 'Erro ao criar landing page');
        return;
      }
      setShowForm(false);
      setFormName('');
      setFormUrl('');
      await load();
      if (data?.id) setSelectedId(data.id);
    } finally {
      setSaving(false);
    }
  };

  const deleteLp = async (lp: Lp) => {
    if (!confirm(`Excluir "${lp.name}"? Todos os dados de comportamento coletados dessa LP serão apagados junto.`)) return;
    await fetch(`/api/clients/${clientId}/landing-pages?lpId=${encodeURIComponent(lp.id)}`, { method: 'DELETE' });
    if (selectedId === lp.id) setSelectedId(null);
    await load();
  };

  const selected = lps.find(lp => lp.id === selectedId) ?? null;
  const snippet = selected
    ? `<script src="${base || publicBase()}/api/lp/tag.js?k=${selected.tracking_key}" defer></script>`
    : '';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-heading text-2xl uppercase leading-none tracking-wide text-foreground">Radar de LP</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Comportamento da massa de visitantes nas landing pages: onde clicam, até onde rolam, quanto tempo ficam.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setShowForm(true); setFormError(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold uppercase tracking-wide text-black transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Nova LP
          </button>
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h4 className="font-heading text-xl uppercase leading-none tracking-wide text-foreground">Nova landing page</h4>
              <button type="button" onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nome</span>
                <input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: LP Promoção Julho"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">URL da página</span>
                <input
                  value={formUrl}
                  onChange={e => setFormUrl(e.target.value)}
                  placeholder="https://cliente.com.br/promo"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
              {formError && <p className="text-xs text-red-400">{formError}</p>}
              <button
                type="button"
                onClick={() => void createLp()}
                disabled={saving || !formName.trim() || !formUrl.trim()}
                className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold uppercase tracking-wide text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {saving ? 'Criando…' : 'Criar e gerar código'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>
      )}

      {/* Empty state */}
      {!loading && !error && lps.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <Globe2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-heading text-xl uppercase tracking-wide text-foreground">Nenhuma LP cadastrada</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Cadastre a landing page do cliente, cole o código de coleta nela e o comportamento dos visitantes começa a aparecer aqui.
          </p>
        </div>
      )}

      {/* Lista de LPs */}
      {lps.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {lps.map((lp) => {
            const age = relativeAge(lp.last_session_at);
            return (
              <div
                key={lp.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(lp.id)}
                onKeyDown={e => { if (e.key === 'Enter') setSelectedId(lp.id); }}
                className={cn(
                  'cursor-pointer rounded-xl border p-3 transition-colors',
                  selectedId === lp.id ? 'border-primary/60 bg-primary/5' : 'border-border bg-card hover:border-muted-foreground/40',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{lp.name}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{lp.url}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a
                      href={lp.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Abrir a página"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); void deleteLp(lp); }}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                      title="Excluir"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn('h-1.5 w-1.5 rounded-full', age.fresh ? 'bg-primary' : 'bg-amber-500')} />
                    <span className="text-muted-foreground">{age.label}</span>
                  </span>
                  <span className="font-bold text-foreground">{lp.sessions_30d} <span className="font-normal text-muted-foreground">visitas em 30d</span></span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Snippet da LP selecionada */}
      {selected && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Código de coleta — cole antes do &lt;/body&gt; da página
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background/70 p-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{snippet}</code>
            <CopyButton text={snippet} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Coleta apenas cliques e rolagem, de forma agregada e anônima. Nenhum dado digitado nos formulários sai da página.
          </p>
        </div>
      )}

      {/* Stats */}
      {selected && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-heading text-xl uppercase leading-none tracking-wide text-foreground">
              Comportamento · {selected.name}
            </h4>
            <div className="flex items-center gap-1.5">
              <a
                href={`${selected.url}${selected.url.includes('?') ? '&' : '?'}onmid_hm=1&onmid_days=${days}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-2.5 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-primary/20"
                title="Abre a página real com as manchas de calor desenhadas em cima (precisa do snippet instalado)"
              >
                <Flame className="h-3.5 w-3.5 text-primary" /> Ver mapa de calor
              </a>
              {[7, 30, 90].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors',
                    days === d ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {d}d
                </button>
              ))}
              <button
                type="button"
                onClick={() => { if (selectedId) void loadStats(selectedId, days); }}
                className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground"
                title="Atualizar"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', statsLoading && 'animate-spin')} />
              </button>
            </div>
          </div>

          {statsLoading && !stats && <p className="text-xs text-muted-foreground">Carregando…</p>}

          {!statsLoading && stats && stats.total === 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <MousePointerClick className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-bold text-foreground">Nenhuma visita registrada no período</p>
              <p className="mt-1 text-xs text-muted-foreground">Instale o snippet na página e aguarde as primeiras visitas.</p>
            </div>
          )}

          {stats && stats.total > 0 && (
            <div className="space-y-5">
              {/* KPIs */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Visitas', value: String(stats.total) },
                  { label: 'Tempo médio', value: fmtDuration(stats.avgDurationMs) },
                  { label: 'Scroll médio', value: stats.avgScrollPct === null ? '–' : `${stats.avgScrollPct}%` },
                ].map(kpi => (
                  <div key={kpi.label} className="rounded-lg border border-border bg-background/50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
                    <p className="mt-1 font-heading text-3xl uppercase leading-none tracking-wide text-foreground">{kpi.value}</p>
                  </div>
                ))}
              </div>

              {/* Funil de scroll */}
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Até onde as pessoas rolam</p>
                <ScrollFunnel stats={stats} />
              </div>

              {/* Onde mais clicam */}
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Onde mais clicam</p>
                {stats.topClicks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum clique registrado no período.</p>
                ) : (
                  <div className="space-y-1.5">
                    {stats.topClicks.map((c, i) => (
                      <div key={`${c.el}|${c.txt}|${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2.5 py-1.5">
                        <span className="w-5 shrink-0 text-center font-heading text-base leading-none text-muted-foreground">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-foreground">{c.txt || '(sem texto)'}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">{c.el}</p>
                        </div>
                        <div className="hidden h-1.5 w-24 overflow-hidden rounded-sm bg-muted/40 sm:block">
                          <div className="h-full bg-primary/70" style={{ width: `${Math.min((c.sessions / stats.total) * 100, 100)}%` }} />
                        </div>
                        <span className="w-20 shrink-0 text-right text-xs font-bold text-foreground">
                          {c.clicks}<span className="ml-1 font-normal text-muted-foreground">({Math.round((c.sessions / stats.total) * 100)}%)</span>
                        </span>
                      </div>
                    ))}
                    <p className="pt-0.5 text-[10px] text-muted-foreground">Contagem de cliques · (% das visitas que clicou ali)</p>
                  </div>
                )}
              </div>

              {/* Device + origem */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Por dispositivo</p>
                  <div className="grid grid-cols-3 gap-2">
                    {stats.porDevice.map(d => {
                      const meta = DEVICE_META[d.label] ?? { label: d.label, icon: Monitor };
                      const Icon = meta.icon;
                      return (
                        <div key={d.label} className="rounded-lg border border-border bg-background/50 p-2.5 text-center">
                          <Icon className="mx-auto h-4 w-4 text-muted-foreground" />
                          <p className="mt-1 font-heading text-xl leading-none text-foreground">
                            {Math.round((d.count / stats.total) * 100)}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">{meta.label}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Por campanha</p>
                  <CountBars items={stats.porCampanha} total={stats.total} />
                </div>
              </div>

              {/* Série diária */}
              {stats.porDia.length > 1 && (
                <div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Visitas por dia</p>
                  <div className="flex h-16 items-end gap-[2px]">
                    {stats.porDia.map((d) => {
                      const max = Math.max(...stats.porDia.map(x => x.count), 1);
                      return (
                        <div
                          key={d.day}
                          className="flex-1 rounded-t-sm bg-primary/50 transition-colors hover:bg-primary/80"
                          style={{ height: `${Math.max((d.count / max) * 100, 4)}%` }}
                          title={`${new Date(d.day).toLocaleDateString('pt-BR')} · ${d.count} visitas`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
