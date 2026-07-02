"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Send, Plus, Users, Tag as TagIcon, Layers, Sparkles, X,
  Play, Pause, Square, CheckCircle2, AlertCircle, Loader2, Wifi, WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DictateButton } from '@/components/ui/dictate-button';

// ── Types ─────────────────────────────────────────────────────────────────────

type CrmFunnel = { id: string; name: string; created_at: string };
type CrmStage  = { id: string; label: string; color: string; position: number };
type CrmTag    = { id: string; name: string; color: string; lead_count: number };

type InstanceStatusResponse = { status: 'connected' | 'disconnected' | 'unknown' | 'no_instance'; instances: { nome: string; provider: string; status: string }[] };

type Campaign = {
  id: string;
  name: string;
  message: string;
  status: 'pending' | 'running' | 'paused' | 'done' | 'cancelled';
  total: number;
  sent: number;
  failed: number;
  starts_at: string;
  created_at: string;
};

type AudienceMode = 'filter' | 'manual';

const TEMPERATURA_OPTIONS = [
  { value: 'quente', label: 'Quente' },
  { value: 'morno', label: 'Morno' },
  { value: 'frio', label: 'Frio' },
];

const STATUS_LABEL: Record<Campaign['status'], string> = {
  pending: 'Agendada',
  running: 'Em andamento',
  paused: 'Pausada',
  done: 'Concluída',
  cancelled: 'Cancelada',
};

const STATUS_BADGE: Record<Campaign['status'], string> = {
  pending: 'bg-blue-500/15 text-blue-400',
  running: 'bg-emerald-500/15 text-emerald-400',
  paused: 'bg-amber-500/15 text-amber-400',
  done: 'bg-zinc-500/15 text-zinc-400',
  cancelled: 'bg-red-500/15 text-red-400',
};

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Instance lock banner ──────────────────────────────────────────────────────

function InstanceLockBanner({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<InstanceStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/crm/instance-status?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<InstanceStatusResponse> : null)
      .then(d => { setStatus(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const connected = status?.status === 'connected';
  const inst = status?.instances?.[0];

  return (
    <div className={cn(
      'flex items-center gap-3 rounded-[var(--radius)] border p-3',
      connected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5',
    )}>
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : connected ? (
        <Wifi className="h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <WifiOff className="h-4 w-4 shrink-0 text-red-400" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold">
          {loading ? 'Verificando instância…' : connected
            ? `Disparo travado na instância conectada${inst ? `: ${inst.nome}` : ''}`
            : status?.status === 'no_instance'
              ? 'Nenhuma instância de WhatsApp cadastrada para este cliente.'
              : 'A instância de WhatsApp deste cliente está desconectada.'}
        </p>
        <p className="text-[11px] text-muted-foreground">
          O disparo sempre usa a instância cadastrada no perfil do cliente — nunca outra. Conecte na aba Chat se necessário.
        </p>
      </div>
      <button onClick={load} className="shrink-0 text-[10px] font-semibold text-muted-foreground hover:text-foreground">↻</button>
    </div>
  );
}

// ── Audience selector ─────────────────────────────────────────────────────────

function AudienceSelector({
  clientId,
  value,
  onChange,
  audienceCount,
}: {
  clientId: string;
  value: {
    mode: AudienceMode;
    funnelId: string;
    stageLabels: string[];
    tagIds: string[];
    temperatura: string[];
    manualNumbers: string;
  };
  onChange: (next: typeof value) => void;
  audienceCount: number | null;
}) {
  const [funnels, setFunnels] = useState<CrmFunnel[]>([]);
  const [stages, setStages] = useState<CrmStage[]>([]);
  const [tags, setTags] = useState<CrmTag[]>([]);
  const [newTagName, setNewTagName] = useState('');

  useEffect(() => {
    fetch(`/api/crm/funnels?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<CrmFunnel[]> : [])
      .then(data => {
        setFunnels(data);
        if (data[0] && !value.funnelId) onChange({ ...value, funnelId: data[0].id });
      })
      .catch(() => setFunnels([]));
    loadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (!value.funnelId) { setStages([]); return; }
    fetch(`/api/crm/funnels/${value.funnelId}/stages`)
      .then(r => r.ok ? r.json() as Promise<CrmStage[]> : [])
      .then(setStages)
      .catch(() => setStages([]));
  }, [value.funnelId]);

  function loadTags() {
    fetch(`/api/crm/tags?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<CrmTag[]> : [])
      .then(setTags)
      .catch(() => setTags([]));
  }

  async function createTag() {
    if (!newTagName.trim()) return;
    const res = await fetch('/api/crm/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name: newTagName.trim() }),
    });
    if (res.ok) { setNewTagName(''); loadTags(); }
  }

  function toggle<K extends 'stageLabels' | 'tagIds' | 'temperatura'>(key: K, item: string) {
    const list = value[key];
    const next = list.includes(item) ? list.filter(x => x !== item) : [...list, item];
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 w-fit">
        {(['filter', 'manual'] as const).map(m => (
          <button key={m} type="button" onClick={() => onChange({ ...value, mode: m })}
            className={cn('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors',
              value.mode === m ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            {m === 'filter' ? <><Layers className="h-3.5 w-3.5" /> Filtrar leads</> : <><Users className="h-3.5 w-3.5" /> Lista manual</>}
          </button>
        ))}
      </div>

      {value.mode === 'manual' ? (
        <div className="space-y-1">
          <textarea
            value={value.manualNumbers}
            onChange={e => onChange({ ...value, manualNumbers: e.target.value })}
            rows={6}
            placeholder={'5511999999999, Nome do contato\n5511988888888'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <p className="text-[10px] text-muted-foreground">Um número por linha. Opcionalmente: telefone,nome</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Funil</span>
              <select value={value.funnelId} onChange={e => onChange({ ...value, funnelId: e.target.value, stageLabels: [] })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary appearance-none">
                {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Temperatura</span>
              <div className="flex flex-wrap gap-1.5">
                {TEMPERATURA_OPTIONS.map(t => (
                  <button key={t.value} type="button" onClick={() => toggle('temperatura', t.value)}
                    className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      value.temperatura.includes(t.value) ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapas do funil</span>
            <div className="flex flex-wrap gap-1.5">
              {stages.map(s => (
                <button key={s.id} type="button" onClick={() => toggle('stageLabels', s.label)}
                  className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    value.stageLabels.includes(s.label) ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                </button>
              ))}
              {stages.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma etapa configurada para este funil.</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tags</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map(t => (
                <button key={t.id} type="button" onClick={() => toggle('tagIds', t.id)}
                  className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    value.tagIds.includes(t.id) ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                  <TagIcon className="h-3 w-3" /> {t.name} <span className="text-muted-foreground">({t.lead_count})</span>
                </button>
              ))}
              <div className="flex items-center gap-1">
                <input value={newTagName} onChange={e => setNewTagName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createTag(); } }}
                  placeholder="Nova tag…"
                  className="h-7 w-28 rounded-full border border-dashed border-border bg-background px-2.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary" />
                <button type="button" onClick={createTag} className="text-muted-foreground hover:text-primary">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        {audienceCount === null
          ? <span className="text-muted-foreground">Calculando audiência…</span>
          : <span><strong className="text-foreground">{audienceCount}</strong> lead{audienceCount !== 1 ? 's' : ''} {audienceCount !== 1 ? 'serão' : 'será'} impactado{audienceCount !== 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}

// ── Main tab ───────────────────────────────────────────────────────────────────

export function DisparosTab({ clientId }: { clientId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [audience, setAudience] = useState({
    mode: 'filter' as AudienceMode,
    funnelId: '',
    stageLabels: [] as string[],
    tagIds: [] as string[],
    temperatura: [] as string[],
    manualNumbers: '',
  });
  const [audienceCount, setAudienceCount] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [intervalMin, setIntervalMin] = useState('8');
  const [intervalMax, setIntervalMax] = useState('20');
  const [startsAt, setStartsAt] = useState(() => toLocalInputValue(new Date(Date.now() + 5 * 60_000)));

  const loadCampaigns = useCallback(() => {
    setLoading(true);
    fetch(`/api/crm/disparos/campaigns?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<Campaign[]> : [])
      .then(d => { setCampaigns(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const audienceFilter = useMemo(() => ({
    clientId,
    funnelId: audience.mode === 'filter' ? audience.funnelId || undefined : undefined,
    stageLabels: audience.mode === 'filter' && audience.stageLabels.length ? audience.stageLabels : undefined,
    tagIds: audience.mode === 'filter' && audience.tagIds.length ? audience.tagIds : undefined,
    temperatura: audience.mode === 'filter' && audience.temperatura.length ? audience.temperatura : undefined,
    manualNumbers: audience.mode === 'manual' ? audience.manualNumbers : undefined,
  }), [clientId, audience]);

  useEffect(() => {
    if (!showNew) return;
    setAudienceCount(null);
    const t = setTimeout(() => {
      fetch('/api/crm/disparos/audience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audienceFilter),
      })
        .then(r => r.ok ? r.json() as Promise<{ count: number }> : { count: 0 })
        .then(d => setAudienceCount(d.count))
        .catch(() => setAudienceCount(0));
    }, 400);
    return () => clearTimeout(t);
  }, [audienceFilter, showNew]);

  async function handleAction(id: string, action: 'pause' | 'resume' | 'cancel') {
    await fetch(`/api/crm/disparos/campaigns/${id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    loadCampaigns();
  }

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !message.trim()) { setError('Nome e mensagem são obrigatórios.'); return; }
    setCreating(true);
    const res = await fetch('/api/crm/disparos/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...audienceFilter,
        name: name.trim(),
        message: message.trim(),
        startsAt: new Date(startsAt).toISOString(),
        intervalMin: Math.max(1, parseInt(intervalMin) || 8),
        intervalMax: Math.max(1, parseInt(intervalMax) || 20),
      }),
    });
    const data = await res.json().catch(() => ({})) as { error?: string };
    setCreating(false);
    if (!res.ok) { setError(data.error ?? 'Erro ao criar campanha.'); return; }
    setShowNew(false);
    setName('');
    setMessage('');
    loadCampaigns();
  }

  return (
    <div className="space-y-4">
      <InstanceLockBanner clientId={clientId} />

      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">Campanhas de disparo</p>
        <button onClick={() => setShowNew(v => !v)}
          className="flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
          <Plus className="h-3.5 w-3.5" /> Nova campanha
        </button>
      </div>

      {showNew && (
        <div className="space-y-4 rounded-[var(--radius)] border border-primary/30 bg-primary/5 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nome da campanha</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Reativação leads frios"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Início do disparo</span>
              <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Mensagem</span>
            <div className="relative">
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
                placeholder="Olá {{nome}}, tudo bem?"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
              <DictateButton className="absolute bottom-2 right-2" onTranscript={(text) => setMessage(message ? `${message} ${text}` : text)} />
            </div>
            <p className="text-[10px] text-muted-foreground">Variáveis: <code className="bg-muted px-1 rounded">{'{{nome}}'}</code> <code className="bg-muted px-1 rounded">{'{{telefone}}'}</code></p>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Intervalo mínimo</span>
              <div className="relative">
                <input type="number" min="1" value={intervalMin} onChange={e => setIntervalMin(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-12 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">seg</span>
              </div>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Intervalo máximo</span>
              <div className="relative">
                <input type="number" min="1" value={intervalMax} onChange={e => setIntervalMax(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-12 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">seg</span>
              </div>
            </label>
          </div>

          <div className="border-t border-border pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Sparkles className="h-3 w-3" /> Audiência
            </p>
            <AudienceSelector clientId={clientId} value={audience} onChange={setAudience} audienceCount={audienceCount} />
          </div>

          {error && (
            <p className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowNew(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancelar</button>
            <button onClick={handleCreate} disabled={creating || !name.trim() || !message.trim() || !audienceCount}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {creating ? 'Criando…' : 'Criar e agendar disparo'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-[var(--radius)] border border-border bg-card py-12 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-10 text-center">
          <Send className="h-9 w-9 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-semibold text-muted-foreground">Nenhuma campanha ainda</p>
          <p className="text-xs text-muted-foreground mt-1">Crie um disparo segmentado por funil, etapa, tag ou temperatura.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map(c => {
            const progress = c.total > 0 ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0;
            return (
              <div key={c.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.message}</p>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', STATUS_BADGE[c.status])}>
                    {STATUS_LABEL[c.status]}
                  </span>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> {c.sent} enviados</span>
                  <span>{c.failed} falhas</span>
                  <span>{c.total} total</span>
                  <div className="flex items-center gap-1">
                    {c.status === 'running' && (
                      <button onClick={() => handleAction(c.id, 'pause')} title="Pausar"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
                        <Pause className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {(c.status === 'paused' || c.status === 'pending') && (
                      <button onClick={() => handleAction(c.id, 'resume')} title="Retomar"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {(c.status === 'running' || c.status === 'paused' || c.status === 'pending') && (
                      <button onClick={() => handleAction(c.id, 'cancel')} title="Cancelar"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors">
                        <Square className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
