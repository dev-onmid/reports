"use client";

import { useEffect, useState } from 'react';
import {
  BarChart2, TrendingUp, Plus, Eye, Trash2, Sparkles,
  FileText, Search, ChevronDown, RefreshCw, ArrowUpRight,
  FileCheck2, CalendarDays, Users, CheckCircle2, ChevronLeft,
  ChevronRight, Settings2, Zap, Play, ExternalLink, Pencil,
  X, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClientAvatar } from '@/components/client-avatar';
import { useClients } from '@/lib/client-store';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────────

type DiagnosticReport = {
  id: string; client_id: string; client_name: string; title: string;
  period_from: string; period_to: string; generated_by: string;
  public_token: string | null; created_at: string;
};

type ReportConfig = {
  id: string; client_id: string; client_name: string; name: string;
  whatsapp_group: string | null; zapi_client_id: string | null;
  zapi_name: string | null; send_day: number; active: boolean;
  report_count: number; last_run_at: string | null; last_token: string | null; created_at: string;
};

type ZapiClient = { id: string; name: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('pt-BR'); }
function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString('pt-BR'), time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) };
}

function defaultDateRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { from: fmt(first), to: fmt(last) };
}

type ClientLink = { platform: string; accountId: string; accountName: string | null };

function platformLabel(platform: string): string {
  const map: Record<string, string> = {
    meta: 'Meta Ads', meta_ads: 'Meta Ads',
    google: 'Google Ads', google_ads: 'Google Ads',
    instagram: 'Instagram',
  };
  return map[platform] ?? platform;
}

function platformColor(platform: string): string {
  if (platform === 'meta' || platform === 'meta_ads') return 'bg-blue-500/15 text-blue-300 border-blue-400/30';
  if (platform === 'google' || platform === 'google_ads') return 'bg-orange-500/15 text-orange-300 border-orange-400/30';
  if (platform === 'instagram') return 'bg-pink-500/15 text-pink-300 border-pink-400/30';
  return 'bg-muted text-muted-foreground border-border';
}

const PAGE_SIZE = 8;

// ── Page ────────────────────────────────────────────────────────────────────

export default function RelatoriosPage() {
  const { clients } = useClients();
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport[]>([]);
  const [tab, setTab] = useState<'relatorios' | 'automacoes'>('relatorios');

  // Geração avulsa
  const [showGenModal, setShowGenModal] = useState(false);
  const [genForm, setGenForm] = useState({ clientId: '', from: '', to: '', agencyContext: '' });
  const [genTemplate, setGenTemplate] = useState<'performance' | 'delivery'>('performance');
  const [genCsvFiles, setGenCsvFiles] = useState<{ name: string; content: string }[]>([]);
  const [genSupplementaryFiles, setGenSupplementaryFiles] = useState<{ name: string; content: string }[]>([]);
  const [clientLinks, setClientLinks] = useState<ClientLink[]>([]);
  const [generating, setGenerating] = useState(false);

  // Automações (configs)
  const [configs, setConfigs] = useState<ReportConfig[]>([]);
  const [zapiClients, setZapiClients] = useState<ZapiClient[]>([]);
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ReportConfig | null>(null);
  const [configForm, setConfigForm] = useState({ clientId: '', name: '', whatsappGroup: '', zapiClientId: '', sendDay: 1 });
  const [savingConfig, setSavingConfig] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterOrigin, setFilterOrigin] = useState('');
  const [page, setPage] = useState(1);

  // Load reports
  useEffect(() => {
    fetch('/api/reports')
      .then(r => r.ok ? r.json() : [])
      .then((rows: DiagnosticReport[]) => setDiagnostics(rows))
      .catch(() => {});
  }, []);

  // Load configs + zapi clients
  useEffect(() => {
    Promise.all([
      fetch('/api/reports/configs').then(r => r.ok ? r.json() : []),
      fetch('/api/disparos/clients').then(r => r.ok ? r.json() : []),
    ]).then(([cfgs, zapis]) => {
      setConfigs(cfgs as ReportConfig[]);
      setZapiClients(zapis as ZapiClient[]);
    }).catch(() => {});
  }, []);

  // Fetch connected assets when client changes
  useEffect(() => {
    if (!genForm.clientId) { setClientLinks([]); return; }
    fetch(`/api/clients/${genForm.clientId}/links`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: ClientLink[]) => setClientLinks(rows))
      .catch(() => setClientLinks([]));
  }, [genForm.clientId]);

  // Default dates when modal opens
  function openGenModal() {
    const { from, to } = defaultDateRange();
    setGenForm({ clientId: '', from, to, agencyContext: '' });
    setGenTemplate('performance');
    setGenCsvFiles([]);
    setGenSupplementaryFiles([]);
    setClientLinks([]);
    setShowGenModal(true);
  }

  function handleCsvFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = (ev.target?.result as string) ?? '';
        setGenCsvFiles(prev => [...prev, { name: file.name, content }]);
      };
      // XLSX/XLS must be read as base64 data URL — readAsText corrupts binary files
      if (/\.xlsx?$/i.test(file.name)) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file, 'utf-8');
      }
    });
    e.target.value = '';
  }

  function removeCsvFile(index: number) {
    setGenCsvFiles(prev => prev.filter((_, i) => i !== index));
  }

  function handleSupplementaryFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = (ev.target?.result as string) ?? '';
        setGenSupplementaryFiles(prev => [...prev, { name: file.name, content }]);
      };
      if (/\.xlsx?$/i.test(file.name)) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file, 'utf-8');
      }
    });
    e.target.value = '';
  }

  function removeSupplementaryFile(index: number) {
    setGenSupplementaryFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function generateReport() {
    if (!genForm.clientId || !genForm.from || !genForm.to) return;
    if (genTemplate === 'delivery' && !genCsvFiles.length) return;
    setGenerating(true);
    try {
      const payload: Record<string, unknown> = {
        clientId: genForm.clientId,
        from: genForm.from,
        to: genForm.to,
        template: genTemplate,
      };
      if (genForm.agencyContext) payload.agencyContext = genForm.agencyContext;
      if (genTemplate === 'delivery') payload.csvFiles = genCsvFiles;
      if (genTemplate === 'performance' && genSupplementaryFiles.length) {
        payload.supplementaryContent = genSupplementaryFiles.map(f => `[${f.name}]\n${f.content}`).join('\n\n');
      }

      const res = await fetch('/api/reports/run-once', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({ error: `Erro ${res.status} — tente novamente.` })) as { public_token?: string; id?: string; error?: string };
      if (data.public_token) {
        setShowGenModal(false);
        // window.open must be called before any await to avoid popup blocker
        window.open(`/relatorio/${data.public_token}`, '_blank');
        const rows = await fetch('/api/reports').then(r => r.ok ? r.json() : []) as DiagnosticReport[];
        setDiagnostics(rows);
      } else {
        alert(data.error ?? 'Erro ao gerar relatório. Tente novamente.');
      }
    } finally {
      setGenerating(false);
    }
  }

  async function saveConfig() {
    setSavingConfig(true);
    try {
      if (editingConfig) {
        await fetch(`/api/reports/configs/${editingConfig.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: configForm.name,
            whatsappGroup: configForm.whatsappGroup,
            zapiClientId: configForm.zapiClientId || undefined,
            sendDay: configForm.sendDay,
          }),
        });
        setConfigs(prev => prev.map(c => c.id === editingConfig.id
          ? { ...c, name: configForm.name, whatsapp_group: configForm.whatsappGroup || null, zapi_client_id: configForm.zapiClientId || null, send_day: configForm.sendDay, zapi_name: zapiClients.find(z => z.id === configForm.zapiClientId)?.name ?? null }
          : c));
      } else {
        const res = await fetch('/api/reports/configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: configForm.clientId, name: configForm.name,
            whatsappGroup: configForm.whatsappGroup,
            zapiClientId: configForm.zapiClientId || undefined,
            sendDay: configForm.sendDay,
          }),
        });
        const created = await res.json() as ReportConfig;
        setConfigs(prev => [{
          ...created,
          client_name: clients.find(c => c.id === configForm.clientId)?.name ?? configForm.clientId,
          zapi_name: zapiClients.find(z => z.id === configForm.zapiClientId)?.name ?? null,
          report_count: 0, last_run_at: null, last_token: null,
        }, ...prev]);
      }
      setShowConfigForm(false);
      setEditingConfig(null);
    } finally {
      setSavingConfig(false);
    }
  }

  async function runConfig(cfg: ReportConfig) {
    setRunningId(cfg.id);
    try {
      const res = await fetch(`/api/reports/run/${cfg.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { public_token?: string };
      if (data.public_token) {
        setConfigs(prev => prev.map(c => c.id === cfg.id
          ? { ...c, last_token: data.public_token ?? null, last_run_at: new Date().toISOString(), report_count: (c.report_count || 0) + 1 }
          : c));
        window.open(`/relatorio/${data.public_token}`, '_blank');
      }
    } finally {
      setRunningId(null);
    }
  }

  async function deleteConfig(id: string) {
    if (!confirm('Excluir esta automação?')) return;
    await fetch(`/api/reports/configs/${id}`, { method: 'DELETE' });
    setConfigs(prev => prev.filter(c => c.id !== id));
  }

  function openEditConfig(cfg: ReportConfig) {
    setEditingConfig(cfg);
    setConfigForm({ clientId: cfg.client_id, name: cfg.name, whatsappGroup: cfg.whatsapp_group ?? '', zapiClientId: cfg.zapi_client_id ?? '', sendDay: cfg.send_day });
    setShowConfigForm(true);
  }

  function openNewConfig() {
    setEditingConfig(null);
    setConfigForm({ clientId: '', name: '', whatsappGroup: '', zapiClientId: '', sendDay: 1 });
    setShowConfigForm(true);
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Excluir "${title}"?`)) return;
    await fetch(`/api/reports?id=${id}`, { method: 'DELETE' });
    setDiagnostics(prev => prev.filter(r => r.id !== id));
  }

  // Filters & pagination
  const filtered = diagnostics.filter(r => {
    if (search && !r.title.toLowerCase().includes(search.toLowerCase()) && !r.client_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterClient && r.client_name !== filterClient) return false;
    if (filterOrigin && r.generated_by !== filterOrigin) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const clientsById = new Map(clients.map(c => [c.id, c]));
  const clientsByName = new Map(clients.map(c => [c.name, c]));
  const allClientNames = Array.from(new Set(diagnostics.map(d => d.client_name))).sort();

  // KPIs
  const now = new Date();
  const thisMonth = diagnostics.filter(d => {
    const dt = new Date(d.created_at);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  }).length;
  const uniqueClients = new Set(diagnostics.map(d => d.client_name)).size;

  function renderClient(clientName: string, clientId?: string) {
    const client = (clientId ? clientsById.get(clientId) : undefined) ?? clientsByName.get(clientName);
    return (
      <div className="flex items-center gap-2.5">
        <ClientAvatar clientId={client?.id ?? clientId ?? clientName} name={clientName} size="sm" />
        <span className="truncate text-sm text-foreground">{clientName}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">

      {/* ── HEADER ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
            <BarChart2 className="w-6 h-6 text-violet-400" />
          </div>
          <div>
            <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">Relatórios</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Diagnósticos de performance gerados a partir de Meta Ads, Google Ads e CRM.
            </p>
          </div>
        </div>
        <Button
          onClick={openGenModal}
          className="bg-violet-600 hover:bg-violet-700 text-white gap-2 shrink-0"
        >
          <TrendingUp className="w-4 h-4" />
          Gerar Relatório
        </Button>
      </div>

      {/* ── TABS ── */}
      <div className="flex border-b border-border gap-0">
        {([
          ['relatorios', 'Relatórios', Sparkles],
          ['automacoes', 'Automações', Settings2],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1); }}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === key ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── RELATÓRIOS TAB ── */}
      {tab === 'relatorios' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-[var(--radius)] p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                <FileCheck2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total de relatórios</p>
                <p className="font-heading font-normal text-xl leading-none text-foreground mt-0.5">
                  {diagnostics.length}<span className="text-violet-400 text-sm ml-1">✦</span>
                </p>
              </div>
            </div>
            <div className="bg-card border border-border rounded-[var(--radius)] p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0">
                <CalendarDays className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Gerados este mês</p>
                <p className="font-heading font-normal text-xl leading-none text-foreground mt-0.5">{thisMonth}</p>
              </div>
            </div>
            <div className="bg-card border border-border rounded-[var(--radius)] p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Clientes únicos</p>
                <p className="font-heading font-normal text-xl leading-none text-foreground mt-0.5">{uniqueClients}</p>
              </div>
            </div>
            <div className="bg-card border border-border rounded-[var(--radius)] p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Automações ativas</p>
                <p className="font-heading font-normal text-xl leading-none text-foreground mt-0.5">{configs.filter(c => c.active).length}</p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar relatórios..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-4 py-2 text-sm bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
              />
            </div>
            <div className="relative">
              <select
                value={filterClient}
                onChange={e => { setFilterClient(e.target.value); setPage(1); }}
                className="appearance-none pl-3 pr-8 py-2 text-sm bg-card border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50 cursor-pointer"
              >
                <option value="">Cliente</option>
                {allClientNames.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
            <div className="relative">
              <select
                value={filterOrigin}
                onChange={e => { setFilterOrigin(e.target.value); setPage(1); }}
                className="appearance-none pl-3 pr-8 py-2 text-sm bg-card border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50 cursor-pointer"
              >
                <option value="">Origem</option>
                <option value="manual">Manual</option>
                <option value="auto">Automático</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
            <button
              onClick={() => { setSearch(''); setFilterClient(''); setFilterOrigin(''); setPage(1); }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Limpar
            </button>
          </div>

          {/* Table */}
          <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Relatório</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Período</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gerado em</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Origem</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <FileText className="w-8 h-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">Nenhum relatório encontrado.</p>
                        <button onClick={openGenModal} className="text-xs text-violet-400 hover:underline">
                          Gerar primeiro relatório →
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {paged.map(row => {
                  const dt = fmtDateTime(row.created_at);
                  const isAuto = row.generated_by === 'auto';
                  return (
                    <tr key={row.id} className="hover:bg-muted/40 transition-colors group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-md bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                          </div>
                          <div>
                            <p className="font-semibold text-foreground leading-none">{row.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Diagnóstico de performance</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">{renderClient(row.client_name, row.client_id)}</td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(row.period_from)} – {fmtDate(row.period_to)}
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-xs text-foreground">{dt.date}</p>
                        <p className="text-[10px] text-muted-foreground">{dt.time}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border',
                          isAuto
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                            : 'bg-violet-500/15 text-violet-300 border-violet-400/30',
                        )}>
                          {isAuto ? 'Automático' : 'Manual'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          {row.public_token ? (
                            <a
                              href={`/relatorio/${row.public_token}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Ver relatório"
                              className="p-1.5 rounded-md text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                            </a>
                          ) : (
                            <button disabled className="p-1.5 rounded-md text-muted-foreground/30 cursor-not-allowed">
                              <Eye className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            title="Excluir"
                            onClick={() => handleDelete(row.id, row.title)}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Mostrando {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} a{' '}
                {Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length} relatórios
              </p>
              <div className="flex items-center gap-1">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />Anterior
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={cn('w-7 h-7 text-xs rounded-md transition-colors', p === page ? 'bg-violet-600 text-white font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted')}
                  >
                    {p}
                  </button>
                ))}
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Próxima<ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── AUTOMAÇÕES TAB ── */}
      {tab === 'automacoes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Configure relatórios automáticos mensais por cliente.</p>
            <Button onClick={openNewConfig} className="bg-violet-600 hover:bg-violet-700 text-white gap-2 text-sm">
              <Plus className="w-4 h-4" />
              Nova automação
            </Button>
          </div>

          {showConfigForm && (
            <div className="bg-card border border-border rounded-[var(--radius)] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground text-sm">
                  {editingConfig ? 'Editar automação' : 'Nova automação de relatório'}
                </h3>
                <button onClick={() => setShowConfigForm(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {!editingConfig && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground font-medium">Cliente</label>
                    <select
                      value={configForm.clientId}
                      onChange={e => setConfigForm(f => ({ ...f, clientId: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                    >
                      <option value="">Selecionar cliente...</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">Nome da automação</label>
                  <input
                    type="text"
                    value={configForm.name}
                    onChange={e => setConfigForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Relatório mensal Sorrifácil"
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">ID do Grupo WhatsApp</label>
                  <input
                    type="text"
                    value={configForm.whatsappGroup}
                    onChange={e => setConfigForm(f => ({ ...f, whatsappGroup: e.target.value }))}
                    placeholder="Ex: 5583999999999-1234567890@g.us"
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">Instância Z-API</label>
                  <select
                    value={configForm.zapiClientId}
                    onChange={e => setConfigForm(f => ({ ...f, zapiClientId: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                  >
                    <option value="">Nenhuma (sem envio automático)</option>
                    {zapiClients.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">Dia de envio (do mês)</label>
                  <input
                    type="number" min={1} max={28}
                    value={configForm.sendDay}
                    onChange={e => setConfigForm(f => ({ ...f, sendDay: Number(e.target.value) }))}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setShowConfigForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Cancelar
                </button>
                <Button onClick={saveConfig} disabled={savingConfig} className="bg-violet-600 hover:bg-violet-700 text-white gap-2 text-sm">
                  {savingConfig ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  {editingConfig ? 'Salvar' : 'Criar'}
                </Button>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Grupo WhatsApp</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Z-API</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dia</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Relatórios</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Último envio</th>
                  <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {configs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Settings2 className="w-8 h-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">Nenhuma automação configurada.</p>
                        <button onClick={openNewConfig} className="text-xs text-violet-400 hover:underline">
                          Criar primeira automação →
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {configs.map(cfg => (
                  <tr key={cfg.id} className="hover:bg-muted/40 transition-colors group">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-foreground text-sm">{cfg.client_name}</p>
                      <p className="text-[11px] text-muted-foreground">{cfg.name}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      {cfg.whatsapp_group
                        ? <span className="text-xs text-foreground font-mono truncate block max-w-[160px]">{cfg.whatsapp_group}</span>
                        : <span className="text-xs text-muted-foreground/50">–</span>}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-foreground">
                      {cfg.zapi_name ?? <span className="text-muted-foreground/50">–</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-400/30 text-[11px] font-semibold">
                        Dia {cfg.send_day}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-foreground">{cfg.report_count ?? 0}</td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">{cfg.last_run_at ? fmtDate(cfg.last_run_at) : '–'}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title="Gerar agora"
                          disabled={runningId === cfg.id}
                          onClick={() => runConfig(cfg)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                        >
                          {runningId === cfg.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        </button>
                        {cfg.last_token && (
                          <a
                            href={`/relatorio/${cfg.last_token}`}
                            target="_blank" rel="noopener noreferrer"
                            title="Ver último relatório"
                            className="p-1.5 rounded-md text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          title="Editar"
                          onClick={() => openEditConfig(cfg)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          title="Excluir"
                          onClick={() => deleteConfig(cfg.id)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── GENERATE MODAL ── */}
      {showGenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground text-sm">Gerar Relatório</h2>
                  <p className="text-xs text-muted-foreground">Escolha o template e preencha os dados</p>
                </div>
              </div>
              <button onClick={() => { setShowGenModal(false); setGenSupplementaryFiles([]); setClientLinks([]); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Template selector */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Template</label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  {
                    key: 'performance' as const,
                    title: 'Performance',
                    desc: 'Meta Ads + CRM — diagnóstico de tráfego pago',
                    color: 'violet',
                    icon: <BarChart2 className="w-5 h-5" />,
                  },
                  {
                    key: 'delivery' as const,
                    title: 'Delivery',
                    desc: 'Cardápio digital + Meta Ads — relatório de restaurantes',
                    color: 'emerald',
                    icon: <FileText className="w-5 h-5" />,
                  },
                ]).map(tpl => {
                  const active = genTemplate === tpl.key;
                  return (
                    <button
                      key={tpl.key}
                      onClick={() => setGenTemplate(tpl.key)}
                      className={cn(
                        'flex flex-col gap-2 p-4 rounded-xl border-2 text-left transition-all',
                        active
                          ? tpl.color === 'violet'
                            ? 'border-violet-500 bg-violet-500/10'
                            : 'border-emerald-500 bg-emerald-500/10'
                          : 'border-border bg-background hover:border-border/80',
                      )}
                    >
                      <div className={cn(
                        'w-9 h-9 rounded-lg flex items-center justify-center',
                        active
                          ? tpl.color === 'violet' ? 'bg-violet-500/20 text-violet-400' : 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-muted text-muted-foreground',
                      )}>
                        {tpl.icon}
                      </div>
                      <div>
                        <p className={cn('text-sm font-semibold', active ? 'text-foreground' : 'text-muted-foreground')}>{tpl.title}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight">{tpl.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Cliente</label>
                <select
                  value={genForm.clientId}
                  onChange={e => setGenForm(f => ({ ...f, clientId: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                >
                  <option value="">Selecionar cliente...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {clientLinks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {Array.from(new Set(clientLinks.map(l => l.platform))).map(platform => (
                      <span key={platform} className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border', platformColor(platform))}>
                        {platformLabel(platform)}
                      </span>
                    ))}
                  </div>
                )}
                {genForm.clientId && clientLinks.length === 0 && (
                  <p className="text-[10px] text-muted-foreground/50 pt-0.5">Nenhuma integração vinculada a este cliente.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">De</label>
                  <input
                    type="date"
                    value={genForm.from}
                    onChange={e => setGenForm(f => ({ ...f, from: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">Até</label>
                  <input
                    type="date"
                    value={genForm.to}
                    onChange={e => setGenForm(f => ({ ...f, to: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                  />
                </div>
              </div>

              {/* Agency context — optional for both templates */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">
                  Contexto da agência <span className="text-muted-foreground/50">(opcional)</span>
                </label>
                <textarea
                  value={genForm.agencyContext}
                  onChange={e => setGenForm(f => ({ ...f, agencyContext: e.target.value }))}
                  placeholder="Ex: trocamos criativo dia 15, cliente ficou fechado 1 semana em fevereiro..."
                  rows={2}
                  className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50 resize-none placeholder:text-muted-foreground/40"
                />
              </div>

              {/* CSV upload — only for Delivery */}
              {genTemplate === 'delivery' && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">
                    Planilhas do cardápio digital <span className="text-muted-foreground/50">(CSV / XLSX — pode anexar várias)</span>
                  </label>
                  <p className="text-xs text-muted-foreground/60 leading-relaxed">
                    Para exibir comparativo com mês anterior, nomeie os arquivos com prefixo{' '}
                    <code className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">ant-</code>
                    {' '}— ex: <code className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">ant-ativos.csv</code>
                  </p>
                  {/* File list */}
                  {genCsvFiles.length > 0 && (
                    <div className="space-y-1">
                      {genCsvFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-500/8 border border-emerald-500/20">
                          <FileCheck2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="text-xs text-emerald-400 truncate flex-1">{f.name}</span>
                          <button
                            onClick={() => removeCsvFile(i)}
                            className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Add file button */}
                  <label className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed border-border hover:border-emerald-500/40 cursor-pointer transition-colors">
                    <input type="file" multiple accept=".csv,.xml,.txt,.xlsx" onChange={handleCsvFiles} className="hidden" />
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      {genCsvFiles.length > 0 ? 'Adicionar mais planilhas...' : 'Clique para anexar planilhas do Goomer, Anota Aí, etc.'}
                    </span>
                  </label>
                </div>
              )}

              {genTemplate === 'performance' && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">
                    Planilha suplementar <span className="text-muted-foreground/50">(opcional — enriquece a análise da IA)</span>
                  </label>
                  {genSupplementaryFiles.length > 0 && (
                    <div className="space-y-1">
                      {genSupplementaryFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-md bg-violet-500/8 border border-violet-500/20">
                          <FileCheck2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                          <span className="text-xs text-violet-400 truncate flex-1">{f.name}</span>
                          <button onClick={() => removeSupplementaryFile(i)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed border-border hover:border-violet-500/40 cursor-pointer transition-colors">
                    <input type="file" multiple accept=".csv,.xlsx,.txt" onChange={handleSupplementaryFiles} className="hidden" />
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      {genSupplementaryFiles.length > 0 ? 'Adicionar mais planilhas...' : 'CSV / XLSX com dados extras (Google Sheets, CRM, etc.)'}
                    </span>
                  </label>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setShowGenModal(false); setGenSupplementaryFiles([]); setClientLinks([]); }} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                Cancelar
              </button>
              <Button
                onClick={generateReport}
                disabled={
                  generating ||
                  !genForm.clientId ||
                  !genForm.from ||
                  !genForm.to ||
                  (genTemplate === 'delivery' && !genCsvFiles.length)
                }
                className={cn(
                  'text-white gap-2 text-sm min-w-[120px]',
                  genTemplate === 'delivery'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-violet-600 hover:bg-violet-700',
                )}
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Gerar
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
