"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  History, Zap, TrendingUp, PlayCircle, PauseCircle, Plus,
  FileText, RefreshCw, DollarSign, Activity, Loader2, Pencil,
  ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

type ActivityEvent = {
  id: string;
  platform: string;
  event_type: string;
  description: string;
  actor_name?: string;
  actor_source?: string;
  campaign_name?: string;
  old_value?: string;
  new_value?: string;
  created_at: string;
};

type MonthlySummary = {
  id: string;
  month: number;
  year: number;
  summary: string;
  meta_spend?: number | null;
  google_spend?: number | null;
  total_leads?: number | null;
  created_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const PLATFORM_COLOR: Record<string, string> = {
  meta:   '#0668E1',
  google: '#34A853',
  luna:   '#7B2CFF',
  system: '#7B2CFF',
  payment: '#F59E0B',
};

const PLATFORM_LABEL: Record<string, string> = {
  meta:   'Meta Ads',
  google: 'Google Ads',
  luna:   'Luna IA',
  system: 'Sistema',
  payment: 'Pagamento',
};

function eventIcon(eventType: string, platform: string) {
  const t = eventType.toLowerCase();
  const cls = 'w-3.5 h-3.5';
  if (t.includes('paused') || t.includes('pause'))   return <PauseCircle className={cls} />;
  if (t.includes('activ') || t.includes('enable'))   return <PlayCircle className={cls} />;
  if (t.includes('create') || t.includes('criou'))   return <Plus className={cls} />;
  if (t.includes('budget') || t.includes('spend'))   return <DollarSign className={cls} />;
  if (t.includes('update') || t.includes('alter'))   return <RefreshCw className={cls} />;
  if (platform === 'meta' || platform === 'google')  return <TrendingUp className={cls} />;
  return <Activity className={cls} />;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function groupByDate(events: ActivityEvent[]): [string, ActivityEvent[]][] {
  const map = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    const key = e.created_at ? new Date(e.created_at).toLocaleDateString('pt-BR') : 'Sem data';
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);
  }
  return [...map.entries()];
}

// ── Summary Modal ─────────────────────────────────────────────────────────────

function SummaryModal({
  open, onClose, clientId, events,
  initial, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  events: ActivityEvent[];
  initial?: MonthlySummary;
  onSaved: (s: MonthlySummary) => void;
}) {
  const now = new Date();
  const [month, setMonth] = useState(initial?.month ?? now.getMonth() + 1);
  const [year, setYear] = useState(initial?.year ?? now.getFullYear());
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [metaSpend, setMetaSpend] = useState(String(initial?.meta_spend ?? ''));
  const [googleSpend, setGoogleSpend] = useState(String(initial?.google_spend ?? ''));
  const [totalLeads, setTotalLeads] = useState(String(initial?.total_leads ?? ''));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Auto-fill summary from events if empty
    if (!summary && events.length > 0) {
      const metaCount  = events.filter(e => e.platform === 'meta').length;
      const googleCount = events.filter(e => e.platform === 'google').length;
      const lunaCount  = events.filter(e => e.actor_source === 'luna').length;
      const pausedCount = events.filter(e => e.event_type?.toLowerCase().includes('paused')).length;
      const lines: string[] = [];
      if (metaCount > 0)   lines.push(`${metaCount} evento(s) registrado(s) no Meta Ads.`);
      if (googleCount > 0) lines.push(`${googleCount} evento(s) registrado(s) no Google Ads.`);
      if (pausedCount > 0) lines.push(`${pausedCount} campanha(s) pausada(s) no período.`);
      if (lunaCount > 0)   lines.push(`${lunaCount} ação(ões) executada(s) via Luna IA.`);
      setSummary(lines.join('\n') || '');
    }
  }, [open]);// eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!summary.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month, year, summary: summary.trim(),
          meta_spend:   metaSpend   ? parseFloat(metaSpend)   : undefined,
          google_spend: googleSpend ? parseFloat(googleSpend) : undefined,
          total_leads:  totalLeads  ? parseInt(totalLeads, 10) : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json() as MonthlySummary;
        onSaved(data);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#0d1117] border-slate-800 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {initial ? 'Editar Resumo Mensal' : 'Novo Resumo Mensal'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Mês</Label>
              <select
                value={month}
                onChange={e => setMonth(Number(e.target.value))}
                className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {MONTH_NAMES.slice(1).map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Ano</Label>
              <Input
                type="number" value={year} onChange={e => setYear(Number(e.target.value))}
                className="bg-muted/30 border-border text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Gasto Meta (R$)</Label>
              <Input
                type="number" step="0.01" value={metaSpend}
                onChange={e => setMetaSpend(e.target.value)}
                placeholder="0,00" className="bg-muted/30 border-border text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Gasto Google (R$)</Label>
              <Input
                type="number" step="0.01" value={googleSpend}
                onChange={e => setGoogleSpend(e.target.value)}
                placeholder="0,00" className="bg-muted/30 border-border text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Total Leads</Label>
              <Input
                type="number" value={totalLeads}
                onChange={e => setTotalLeads(e.target.value)}
                placeholder="0" className="bg-muted/30 border-border text-foreground"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Resumo do mês</Label>
            <textarea
              value={summary} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSummary(e.target.value)}
              rows={5} placeholder="Descreva os principais acontecimentos, resultados e próximos passos..."
              className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !summary.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Salvar Resumo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({ summary, onEdit }: { summary: MonthlySummary; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const totalSpend = (summary.meta_spend ?? 0) + (summary.google_spend ?? 0);

  return (
    <Card className="bg-[rgba(8,15,27,0.80)] border-slate-800/60">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Resumo Mensal</p>
            <CardTitle className="text-base text-foreground mt-0.5">
              {MONTH_NAMES[summary.month]} {summary.year}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setExpanded(v => !v)}
              className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* KPI chips */}
        <div className="flex flex-wrap gap-2 mt-2">
          {totalSpend > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/15 text-blue-400">
              Gasto total: {formatCurrencyBRL(totalSpend)}
            </span>
          )}
          {(summary.meta_spend ?? 0) > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#0668E1]/15 text-[#0668E1]">
              Meta: {formatCurrencyBRL(summary.meta_spend!)}
            </span>
          )}
          {(summary.google_spend ?? 0) > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#34A853]/15 text-[#34A853]">
              Google: {formatCurrencyBRL(summary.google_spend!)}
            </span>
          )}
          {(summary.total_leads ?? 0) > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-violet-500/15 text-violet-400">
              {summary.total_leads} leads
            </span>
          )}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <div className="pt-3 border-t border-slate-800/60">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{summary.summary}</p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────────────

export function HistoricoTab({ clientId }: { clientId: string }) {
  const [events, setEvents]     = useState<ActivityEvent[]>([]);
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [period, setPeriod]     = useState(30);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSummary, setEditingSummary] = useState<MonthlySummary | undefined>();
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [eventsError, setEventsError] = useState(false);

  const loadEvents = useCallback((days: number) => {
    setLoadingEvents(true);
    setEventsError(false);
    fetch(`/api/clients/${clientId}/activity?days=${days}`)
      .then(r => r.ok ? r.json() as Promise<ActivityEvent[]> : Promise.reject())
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch(() => { setEvents([]); setEventsError(true); })
      .finally(() => setLoadingEvents(false));
  }, [clientId]);

  const loadSummaries = useCallback(() => {
    setLoadingSummaries(true);
    fetch(`/api/clients/${clientId}/history`)
      .then(r => r.ok ? r.json() as Promise<{ summaries: MonthlySummary[] }> : Promise.reject())
      .then(data => setSummaries(data.summaries ?? []))
      .catch(() => setSummaries([]))
      .finally(() => setLoadingSummaries(false));
  }, [clientId]);

  useEffect(() => { loadEvents(period); }, [loadEvents, period]);
  useEffect(() => { loadSummaries(); }, [loadSummaries]);

  function openNewSummary() { setEditingSummary(undefined); setModalOpen(true); }
  function openEditSummary(s: MonthlySummary) { setEditingSummary(s); setModalOpen(true); }
  function handleSaved(s: MonthlySummary) {
    setSummaries(prev => {
      const idx = prev.findIndex(x => x.month === s.month && x.year === s.year);
      if (idx >= 0) { const next = [...prev]; next[idx] = s; return next; }
      return [s, ...prev].sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);
    });
  }

  const filtered = platformFilter === 'all'
    ? events
    : events.filter(e => e.platform === platformFilter || e.actor_source === platformFilter);

  const metaCount   = events.filter(e => e.platform === 'meta').length;
  const googleCount = events.filter(e => e.platform === 'google').length;
  const lunaCount   = events.filter(e => e.actor_source === 'luna').length;
  const grouped     = groupByDate(filtered);

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total de eventos', value: events.length, color: '#55F52F', icon: <Activity className="w-4 h-4" /> },
          { label: 'Meta Ads', value: metaCount, color: '#0668E1', icon: <TrendingUp className="w-4 h-4" /> },
          { label: 'Google Ads', value: googleCount, color: '#34A853', icon: <TrendingUp className="w-4 h-4" /> },
          { label: 'Ações Luna IA', value: lunaCount, color: '#7B2CFF', icon: <Zap className="w-4 h-4" /> },
        ].map(stat => (
          <div key={stat.label} className="flex items-center gap-3 rounded-xl border border-slate-800/60 bg-[rgba(8,15,27,0.80)] px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${stat.color}20`, color: stat.color }}>
              {stat.icon}
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-none mb-0.5">{stat.label}</p>
              <p className="text-lg font-bold text-foreground leading-none">{loadingEvents ? '—' : stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-[1fr_340px] gap-6 items-start">
        {/* Left: event timeline */}
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 bg-card border border-border p-1 rounded-xl">
              {[
                { label: '7 dias', val: 7 },
                { label: '30 dias', val: 30 },
                { label: '60 dias', val: 60 },
                { label: '90 dias', val: 90 },
              ].map(opt => (
                <button
                  key={opt.val}
                  onClick={() => setPeriod(opt.val)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors',
                    period === opt.val
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 bg-card border border-border p-1 rounded-xl">
              {['all', 'meta', 'google', 'luna'].map(p => (
                <button
                  key={p}
                  onClick={() => setPlatformFilter(p)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors',
                    platformFilter === p
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  style={platformFilter === p && p !== 'all' ? { color: PLATFORM_COLOR[p] } : {}}
                >
                  {p === 'all' ? 'Todos' : PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Timeline */}
          {loadingEvents ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Carregando histórico...</span>
            </div>
          ) : eventsError ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <AlertTriangle className="w-8 h-8 text-amber-500/60" />
              <p className="text-sm">Não foi possível carregar o histórico de eventos.</p>
              <Button variant="outline" size="sm" onClick={() => loadEvents(period)}>Tentar novamente</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <History className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-sm">Nenhum evento encontrado para o período selecionado.</p>
              <p className="text-xs text-muted-foreground/60">Os eventos são registrados quando campanhas são alteradas via Meta/Google ou pela Luna IA.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([dateStr, evs]) => (
                <div key={dateStr}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{dateStr}</span>
                    <div className="flex-1 h-px bg-slate-800/60" />
                    <span className="text-[10px] text-muted-foreground/60">{evs.length} evento{evs.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="space-y-1.5">
                    {evs.map(ev => {
                      const color = PLATFORM_COLOR[ev.platform] ?? PLATFORM_COLOR.system;
                      return (
                        <div
                          key={ev.id}
                          className="flex items-start gap-3 rounded-xl border border-slate-800/40 bg-[rgba(8,15,27,0.60)] px-4 py-3 hover:border-slate-700/60 transition-colors"
                        >
                          <span
                            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                            style={{ background: `${color}20`, color }}
                          >
                            {eventIcon(ev.event_type, ev.platform)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
                                {PLATFORM_LABEL[ev.platform] ?? ev.platform}
                              </span>
                              {ev.campaign_name && (
                                <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                                  · {ev.campaign_name}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-foreground mt-0.5">{ev.description}</p>
                            {(ev.old_value || ev.new_value) && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {ev.old_value && <span className="line-through mr-1">{ev.old_value}</span>}
                                {ev.new_value && <span className="text-primary">→ {ev.new_value}</span>}
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground/60 mt-1">
                              {ev.actor_name ?? 'Sistema'} · {formatTime(ev.created_at)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: monthly summaries */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-sm uppercase tracking-wider text-foreground">Resumos Mensais</h3>
            </div>
            <Button size="sm" variant="outline" onClick={openNewSummary} className="h-8 gap-1.5 text-xs">
              <Plus className="w-3.5 h-3.5" /> Novo Resumo
            </Button>
          </div>

          {loadingSummaries ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Carregando resumos...</span>
            </div>
          ) : summaries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-3 rounded-xl border border-dashed border-slate-800/60 bg-[rgba(8,15,27,0.40)]">
              <FileText className="w-8 h-8 text-muted-foreground/30" />
              <div>
                <p className="text-sm text-muted-foreground">Nenhum resumo criado ainda.</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Crie resumos mensais para incluir nos relatórios automáticos.</p>
              </div>
              <Button size="sm" variant="outline" onClick={openNewSummary} className="gap-1.5 text-xs">
                <Plus className="w-3.5 h-3.5" /> Criar primeiro resumo
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {summaries.map(s => (
                <SummaryCard key={s.id} summary={s} onEdit={() => openEditSummary(s)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <SummaryModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingSummary(undefined); }}
        clientId={clientId}
        events={events}
        initial={editingSummary}
        onSaved={handleSaved}
      />
    </div>
  );
}
