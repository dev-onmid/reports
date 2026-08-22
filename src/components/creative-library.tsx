"use client";

// Biblioteca de Criativos — ranking de anúncios/criativos a partir da atribuição
// do CRM (leads/vendas/receita/etapas do funil) + gasto/CPL/thumbnail via Meta.
// Usada na aba global (/resultados/criativos, todos os clientes) e dentro do CRM
// (modo "Anúncios", com clientId fixo).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clapperboard, ExternalLink, Search, ImageOff,
  TrendingUp, Users, MessageCircle,
} from 'lucide-react';

// lucide não tem mais ícones de marca — badges de texto no lugar
const IgBadge = () => <span className="rounded bg-fuchsia-500/15 px-1 text-[9px] font-black text-fuchsia-400">IG</span>;
const FbBadge = () => <span className="rounded bg-blue-500/15 px-1 text-[9px] font-black text-blue-400">FB</span>;
import { cn } from '@/lib/utils';
import { isStageAxis, sortByAxis, stageAxesFrom } from '@/lib/creative-library-ui';

export type CreativeRow = {
  client_id: string;
  client_name: string | null;
  segment: string | null;
  ad_key: string;
  source_id: string | null;
  ad_name: string | null;
  creative_name: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  source_url: string | null;
  leads: number;
  conversas: number;
  comparecimentos: number;
  vendas: number;
  receita: number;
  ig_leads: number;
  fb_leads: number;
  por_status: Record<string, number>;
  first_lead_at: string | null;
  last_lead_at: string | null;
};

type EnrichMap = Record<string, { spend: number | null; thumbnail_url: string | null }>;

const PERIODOS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '60d', days: 60 },
  { label: '90d', days: 90 },
];

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v >= 100 ? 0 : 2 });

function Thumb({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted/30 border border-border">
        <ImageOff className="h-5 w-5 text-muted-foreground/50" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      className="h-16 w-16 shrink-0 rounded-md object-cover border border-border"
    />
  );
}

export function CreativeLibrary({ clientId }: { clientId?: string }) {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<CreativeRow[]>([]);
  const [enrich, setEnrich] = useState<EnrichMap>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  // Gasto/CPL/thumb vêm do enrich (Graph API), depois da lista. Sem este estado a
  // lista se reordenava embaixo do usuário nas ordenações por gasto/CPL.
  const [enriching, setEnriching] = useState(false);
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [segmentFilter, setSegmentFilter] = useState('');
  const [redeFilter, setRedeFilter] = useState<'' | 'instagram' | 'facebook'>('');
  const [sortBy, setSortBy] = useState('leads');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ days: String(days) });
      if (clientId) qs.set('clientId', clientId);
      const res = await fetch(`/api/creative-library?${qs}`);
      // Sem checar res.ok, erro do backend virava "nenhum criativo no período".
      if (!res.ok) { setErro(true); setRows([]); return; }
      const json = await res.json().catch(() => null) as { creatives?: CreativeRow[] } | null;
      const creatives = json?.creatives ?? [];
      setErro(false);
      setRows(creatives);

      // Enriquecimento (gasto + thumbnail) — best-effort, não bloqueia a lista
      const byClient = new Map<string, string[]>();
      for (const c of creatives) {
        if (!c.source_id) continue;
        const list = byClient.get(c.client_id) ?? [];
        list.push(c.source_id);
        byClient.set(c.client_id, list);
      }
      if (byClient.size > 0) {
        setEnriching(true);
        fetch('/api/creative-library/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            days,
            items: [...byClient.entries()].map(([cid, adIds]) => ({ clientId: cid, adIds: adIds.slice(0, 120) })),
          }),
        })
          .then(r => r.json())
          .then((j: { enrich?: EnrichMap }) => { if (j?.enrich) setEnrich(prev => ({ ...prev, ...j.enrich })); })
          .catch(() => null)
          .finally(() => setEnriching(false));
      }
    } catch {
      setErro(true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [days, clientId]);

  useEffect(() => { void load(); }, [load]);

  const clientes = useMemo(
    () => [...new Map(rows.map(r => [r.client_id, r.client_name ?? r.client_id])).entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    [rows],
  );
  const segmentos = useMemo(
    () => [...new Set(rows.map(r => r.segment).filter(Boolean) as string[])].sort(),
    [rows],
  );
  const etapas = useMemo(() => stageAxesFrom(rows), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter(r => {
      if (clientFilter && r.client_id !== clientFilter) return false;
      if (segmentFilter && r.segment !== segmentFilter) return false;
      if (redeFilter === 'instagram' && r.ig_leads === 0) return false;
      if (redeFilter === 'facebook' && r.fb_leads === 0) return false;
      if (q) {
        const hay = `${r.ad_name ?? ''} ${r.creative_name ?? ''} ${r.campaign_name ?? ''} ${r.adset_name ?? ''} ${r.client_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const spendOf = (r: CreativeRow) => (r.source_id ? enrich[r.source_id]?.spend ?? null : null);
    const cplOf = (r: CreativeRow) => {
      const s = spendOf(r);
      return s !== null && r.leads > 0 ? s / r.leads : null;
    };

    // Eixos que dependem do enrich (gasto da Graph API) ficam aqui, porque o módulo
    // compartilhado só conhece o que vem do CRM. O resto — leads/conversas/vendas/
    // receita/etapa — delega pro sortByAxis, fonte única dos desempates.
    if (sortBy === 'taxa_conversa') {
      return [...list].sort(
        (a, b) =>
          ((b.conversas ?? 0) / Math.max(b.leads, 1)) - ((a.conversas ?? 0) / Math.max(a.leads, 1)) ||
          b.leads - a.leads,
      );
    }
    // Enquanto o gasto não chega, ordenar por ele reordenaria tudo de novo quando
    // chegasse — segura no padrão (leads) até o enrich terminar.
    if (enriching && (sortBy === 'gasto' || sortBy === 'cpl')) return sortByAxis(list, 'leads');
    if (sortBy === 'gasto') return [...list].sort((a, b) => (spendOf(b) ?? -1) - (spendOf(a) ?? -1));
    if (sortBy === 'cpl') {
      // Menor CPL primeiro (melhor); sem gasto vai pro fim
      return [...list].sort(
        (a, b) => (cplOf(a) ?? Number.POSITIVE_INFINITY) - (cplOf(b) ?? Number.POSITIVE_INFINITY),
      );
    }
    if (isStageAxis(sortBy) || ['leads', 'conversas', 'vendas', 'receita'].includes(sortBy)) {
      return sortByAxis(list, sortBy);
    }
    return list;
  }, [rows, search, clientFilter, segmentFilter, redeFilter, sortBy, enrich, enriching]);

  const totals = useMemo(() => ({
    criativos: filtered.length,
    leads: filtered.reduce((a, r) => a + r.leads, 0),
    conversas: filtered.reduce((a, r) => a + (r.conversas ?? 0), 0),
    vendas: filtered.reduce((a, r) => a + r.vendas, 0),
    receita: filtered.reduce((a, r) => a + r.receita, 0),
  }), [filtered]);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {PERIODOS.map(p => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-bold transition-colors',
                days === p.days ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar criativo, campanha…"
            className="h-8 w-52 rounded-md border border-border bg-card pl-8 pr-2 text-xs outline-none focus:border-primary/50"
          />
        </div>

        {!clientId && (
          <>
            <select
              value={clientFilter}
              onChange={e => setClientFilter(e.target.value)}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs"
            >
              <option value="">Todos os clientes</option>
              {clientes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select
              value={segmentFilter}
              onChange={e => setSegmentFilter(e.target.value)}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs"
            >
              <option value="">Todos os segmentos</option>
              {segmentos.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        )}

        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {([['', 'Todas'], ['instagram', 'Instagram'], ['facebook', 'Facebook']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setRedeFilter(v)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-bold transition-colors',
                redeFilter === v ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2 text-xs"
        >
          <option value="leads">Mais leads</option>
          <option value="conversas">Mais conversas (responderam)</option>
          <option value="taxa_conversa">Maior taxa de conversa</option>
          <option value="vendas">Mais vendas</option>
          <option value="receita">Mais receita</option>
          <option value="cpl" disabled={enriching}>Menor CPL{enriching ? ' (carregando gasto…)' : ''}</option>
          <option value="gasto" disabled={enriching}>Maior gasto{enriching ? ' (carregando…)' : ''}</option>
          {etapas.map(e => <option key={e} value={`etapa:${e}`}>Mais “{e}”</option>)}
        </select>
      </div>

      {/* Totais */}
      <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card px-4 py-2.5 text-xs">
        <span className="flex items-center gap-1.5 font-bold"><Clapperboard className="h-3.5 w-3.5 text-primary" />{totals.criativos} criativos</span>
        <span className="flex items-center gap-1.5 text-muted-foreground"><Users className="h-3.5 w-3.5" />{totals.leads} leads</span>
        <span className="flex items-center gap-1.5 text-muted-foreground"><MessageCircle className="h-3.5 w-3.5" />{totals.conversas} conversas</span>
        <span className="flex items-center gap-1.5 text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" />{totals.vendas} vendas</span>
        <span className="font-bold text-primary">{fmtBRL(totals.receita)} em receita</span>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Carregando criativos…</div>
      ) : erro ? (
        <div className="rounded-md border border-border bg-card py-16 text-center">
          <Clapperboard className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Não foi possível carregar os criativos.</p>
          <button
            onClick={() => void load()}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:border-primary/50"
          >
            Tentar de novo
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-card py-16 text-center">
          <Clapperboard className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Nenhum criativo com atribuição no período.</p>
          <p className="mt-1 text-xs text-muted-foreground/70">Leads de anúncio (CTWA) entram aqui automaticamente conforme chegam no CRM.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r, i) => {
            const en = r.source_id ? enrich[r.source_id] : undefined;
            const spend = en?.spend ?? null;
            const cpl = spend !== null && r.leads > 0 ? spend / r.leads : null;
            const sortedStage = sortBy.startsWith('etapa:') ? sortBy.slice(6) : null;
            const topStatus = Object.entries(r.por_status).sort((a, b) => b[1] - a[1]).slice(0, 5);
            return (
              <div key={`${r.client_id}|${r.ad_key}`} className="rounded-md border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <Thumb url={en?.thumbnail_url ?? null} />
                    <span className="absolute -left-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded bg-primary px-1 text-[10px] font-black text-black">
                      {i + 1}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold" title={r.ad_name ?? r.creative_name ?? '—'}>
                      {r.ad_name ?? r.creative_name ?? 'Criativo sem nome'}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground" title={r.campaign_name ?? ''}>
                      {r.campaign_name ?? 'Campanha não identificada'}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {!clientId && (
                        <span className="rounded bg-secondary/15 px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">
                          {r.client_name ?? r.client_id}
                        </span>
                      )}
                      {r.segment && !clientId && (
                        <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">{r.segment}</span>
                      )}
                      {r.ig_leads > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><IgBadge />{r.ig_leads}</span>
                      )}
                      {r.fb_leads > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><FbBadge />{r.fb_leads}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-1 text-center">
                  <div><p className="truncate text-[11px] font-black tracking-tight">{r.leads}</p><p className="text-[9px] uppercase text-muted-foreground">Leads</p></div>
                  <div title={`${r.conversas ?? 0} de ${r.leads} leads responderam depois do atendimento`}>
                    <p className="truncate text-[11px] font-black tracking-tight">{r.conversas ?? 0}<span className="ml-0.5 font-semibold text-[9px] text-muted-foreground">({r.leads > 0 ? Math.round(((r.conversas ?? 0) / r.leads) * 100) : 0}%)</span></p>
                    <p className="text-[9px] uppercase text-muted-foreground">Conv.</p>
                  </div>
                  <div><p className="truncate text-[11px] font-black tracking-tight">{r.vendas}</p><p className="text-[9px] uppercase text-muted-foreground">Vendas</p></div>
                  <div><p className="truncate text-[11px] font-black tracking-tight text-primary" title={r.receita > 0 ? fmtBRL(r.receita) : ''}>{r.receita > 0 ? fmtBRL(r.receita) : '—'}</p><p className="text-[9px] uppercase text-muted-foreground">Receita</p></div>
                  <div>
                    {enriching && spend === null
                      ? <span className="mx-auto block h-3 w-10 animate-pulse rounded bg-muted/50" />
                      : <p className="truncate text-[11px] font-black tracking-tight" title={spend !== null ? fmtBRL(spend) : ''}>{spend !== null ? fmtBRL(spend) : '—'}</p>}
                    <p className="text-[9px] uppercase text-muted-foreground">Gasto</p>
                  </div>
                  <div>
                    {enriching && cpl === null
                      ? <span className="mx-auto block h-3 w-10 animate-pulse rounded bg-muted/50" />
                      : <p className="truncate text-[11px] font-black tracking-tight" title={cpl !== null ? fmtBRL(cpl) : ''}>{cpl !== null ? fmtBRL(cpl) : '—'}</p>}
                    <p className="text-[9px] uppercase text-muted-foreground">CPL</p>
                  </div>
                </div>

                {topStatus.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {topStatus.map(([st, n]) => (
                      <span
                        key={st}
                        title={`${n} de ${r.leads} leads (${Math.round((n / Math.max(r.leads, 1)) * 100)}%) na etapa ${st}`}
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px]',
                          sortedStage === st
                            ? 'bg-primary/15 font-bold text-primary'
                            : 'bg-muted/30 text-muted-foreground',
                        )}
                      >
                        {st}: <b className={sortedStage === st ? 'text-primary' : 'text-foreground'}>{n}</b>
                        <span className="ml-0.5 opacity-70">({Math.round((n / Math.max(r.leads, 1)) * 100)}%)</span>
                      </span>
                    ))}
                  </div>
                )}

                {r.source_url && (
                  <a
                    href={r.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Ver anúncio
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
