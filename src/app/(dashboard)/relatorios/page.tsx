"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  BarChart2,
  TrendingUp,
  Plus,
  Download,
  Eye,
  Trash2,
  Sparkles,
  FileText,
  Search,
  ChevronDown,
  RefreshCw,
  ArrowUpRight,
  FileCheck2,
  CalendarDays,
  Users,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useClients } from '@/lib/client-store';
import { deleteReport, downloadReportPdf, readReports, subscribeReports, type StoredReport } from '@/lib/report-store';
import { cn } from '@/lib/utils';

type DiagnosticReport = {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  period_from: string;
  period_to: string;
  generated_by: string;
  created_at: string;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('pt-BR'),
    time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

const PAGE_SIZE = 6;

export default function RelatoriosPage() {
  const { clients } = useClients();
  const [libraryReports, setLibraryReports] = useState<StoredReport[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport[]>([]);
  const [tab, setTab] = useState<'diagnostico' | 'widget'>('diagnostico');

  // Filters
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('');
  const [filterOrigin, setFilterOrigin] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Pagination
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLibraryReports(readReports());
    return subscribeReports(() => setLibraryReports(readReports()));
  }, []);

  useEffect(() => {
    fetch('/api/reports')
      .then(r => r.ok ? r.json() : [])
      .then((rows: DiagnosticReport[]) => setDiagnostics(rows))
      .catch(() => {});
  }, []);

  const visibleClientIds = new Set(clients.map((c) => c.id));
  const widgetReports = libraryReports.filter((r) => visibleClientIds.has(r.clientId));

  async function handleDeleteDiagnostic(id: string, title: string) {
    if (!window.confirm(`Excluir "${title}"?`)) return;
    await fetch(`/api/reports?id=${id}`, { method: 'DELETE' });
    setDiagnostics(prev => prev.filter(r => r.id !== id));
  }

  function clearFilters() {
    setSearch('');
    setFilterClient('');
    setFilterPeriod('');
    setFilterOrigin('');
    setFilterStatus('');
    setPage(1);
  }

  // Build the unified row list for the active tab
  type UnifiedRow =
    | ({ kind: 'diag' } & DiagnosticReport)
    | ({ kind: 'widget' } & StoredReport);

  const allRows: UnifiedRow[] =
    tab === 'diagnostico'
      ? diagnostics.map(d => ({ kind: 'diag' as const, ...d }))
      : widgetReports.map(w => ({ kind: 'widget' as const, ...w }));

  const filteredRows = allRows.filter(row => {
    const name = row.kind === 'diag' ? row.title : row.title;
    const client = row.kind === 'diag' ? row.client_name : row.client;
    const origin = row.kind === 'diag' ? (row.generated_by === 'auto' ? 'Automático' : 'Manual') : 'Personalizado';
    const status = row.kind === 'widget' ? row.status : 'Ativo';

    if (search && !name.toLowerCase().includes(search.toLowerCase()) && !client.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterClient && client !== filterClient) return false;
    if (filterOrigin && origin !== filterOrigin) return false;
    if (filterStatus && status !== filterStatus) return false;
    return true;
  });

  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // KPI counts
  const totalReports = diagnostics.length + widgetReports.length;
  const now = new Date();
  const thisMonth = diagnostics.filter(d => {
    const dt = new Date(d.created_at);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  }).length + widgetReports.filter(w => {
    const parts = w.date.split('/');
    if (parts.length !== 3) return false;
    const dt = new Date(+parts[2], +parts[1] - 1, +parts[0]);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  }).length;

  const uniqueClients = new Set([
    ...diagnostics.map(d => d.client_name),
    ...widgetReports.map(w => w.client),
  ]).size;

  const activeReports = widgetReports.filter(w => w.status === 'Gerado' || w.status === 'Enviado').length + diagnostics.length;

  // Unique client names for filter dropdown
  const allClientNames = Array.from(new Set([
    ...diagnostics.map(d => d.client_name),
    ...widgetReports.map(w => w.client),
  ])).sort();

  return (
    <div className="space-y-6 p-6">
      {/* ── HEADER ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
            <BarChart2 className="w-6 h-6 text-violet-400" />
          </div>
          <div>
            <h1 className="font-heading font-normal text-4xl uppercase leading-none tracking-wide text-foreground">Relatórios</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Diagnósticos de performance e relatórios personalizados para insights estratégicos.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            render={<Link href="/relatorios/diagnostico" />}
            nativeButton={false}
            className="bg-violet-600 hover:bg-violet-700 text-white gap-2"
          >
            <TrendingUp className="w-4 h-4" />
            Novo Diagnóstico
          </Button>
          <Button
            render={<Link href="/relatorios/novo" />}
            nativeButton={false}
            variant="outline"
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Relatório Personalizado
          </Button>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="flex border-b border-border gap-0">
        {([
          ['diagnostico', 'Diagnósticos de Performance', Sparkles],
          ['widget', 'Relatórios Personalizados', FileText],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1); }}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === key
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total */}
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
            <FileCheck2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total de relatórios</p>
            <p className="font-heading font-normal text-3xl leading-none text-foreground mt-0.5">
              {totalReports}
              <span className="text-violet-400 text-sm ml-1">✦</span>
            </p>
          </div>
        </div>
        {/* This month */}
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0">
            <CalendarDays className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gerados este mês</p>
            <p className="font-heading font-normal text-3xl leading-none text-foreground mt-0.5">{thisMonth}</p>
          </div>
        </div>
        {/* Unique clients */}
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Clientes únicos</p>
            <p className="font-heading font-normal text-3xl leading-none text-foreground mt-0.5">{uniqueClients}</p>
          </div>
        </div>
        {/* Active */}
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Relatórios ativos</p>
            <p className="font-heading font-normal text-3xl leading-none text-foreground mt-0.5">{activeReports}</p>
          </div>
        </div>
      </div>

      {/* ── SEARCH + FILTERS ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
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

        {/* Cliente */}
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

        {/* Período */}
        <div className="relative">
          <select
            value={filterPeriod}
            onChange={e => { setFilterPeriod(e.target.value); setPage(1); }}
            className="appearance-none pl-3 pr-8 py-2 text-sm bg-card border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50 cursor-pointer"
          >
            <option value="">Período</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>

        {/* Origem */}
        <div className="relative">
          <select
            value={filterOrigin}
            onChange={e => { setFilterOrigin(e.target.value); setPage(1); }}
            className="appearance-none pl-3 pr-8 py-2 text-sm bg-card border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50 cursor-pointer"
          >
            <option value="">Origem</option>
            <option value="Manual">Manual</option>
            <option value="Automático">Automático</option>
            <option value="Personalizado">Personalizado</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>

        {/* Status */}
        <div className="relative">
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
            className="appearance-none pl-3 pr-8 py-2 text-sm bg-card border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50 cursor-pointer"
          >
            <option value="">Status</option>
            <option value="Ativo">Ativo</option>
            <option value="Rascunho">Rascunho</option>
            <option value="Gerado">Gerado</option>
            <option value="Enviado">Enviado</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>

        {/* Clear */}
        <button
          onClick={clearFilters}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Limpar filtros
        </button>
      </div>

      {/* ── TABLE ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-border">
            <tr>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Relatório</th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente</th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Período</th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gerado em</th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Origem</th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pagedRows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-14 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <FileText className="w-8 h-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">Nenhum relatório encontrado.</p>
                    {tab === 'diagnostico' && (
                      <Link href="/relatorios/diagnostico" className="text-xs text-emerald-400 hover:underline">
                        Gerar primeiro diagnóstico →
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {pagedRows.map(row => {
              if (row.kind === 'diag') {
                const dt = fmtDateTime(row.created_at);
                const origin = row.generated_by === 'auto' ? 'Automático' : 'Manual';
                return (
                  <tr key={row.id} className="hover:bg-muted/40 transition-colors group">
                    {/* Relatório */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                          <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                          <p className="font-semibold text-foreground leading-none">{row.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Análise completa de campanhas e métricas</p>
                        </div>
                      </div>
                    </td>
                    {/* Cliente */}
                    <td className="px-5 py-3.5 text-sm text-foreground">{row.client_name}</td>
                    {/* Período */}
                    <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(row.period_from)} – {fmtDate(row.period_to)}
                    </td>
                    {/* Gerado em */}
                    <td className="px-5 py-3.5">
                      <p className="text-xs text-foreground">{dt.date}</p>
                      <p className="text-[10px] text-muted-foreground">{dt.time}</p>
                    </td>
                    {/* Origem */}
                    <td className="px-5 py-3.5">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border',
                        origin === 'Manual'
                          ? 'bg-violet-500/15 text-violet-300 border-violet-400/30'
                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
                      )}>
                        {origin}
                      </span>
                    </td>
                    {/* Status */}
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Ativo
                      </span>
                    </td>
                    {/* Ações */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/relatorios/${row.id}`}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Visualizar"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <button
                          title="Excluir"
                          onClick={() => handleDeleteDiagnostic(row.id, row.title)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              // widget row
              const statusConfig = {
                Gerado: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Ativo' },
                Enviado: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Ativo' },
                Rascunho: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Rascunho' },
              }[row.status] ?? { dot: 'bg-muted-foreground', text: 'text-muted-foreground', label: row.status };

              return (
                <tr key={row.id} className="hover:bg-muted/40 transition-colors group">
                  {/* Relatório */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground leading-none">{row.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{row.summary}</p>
                      </div>
                    </div>
                  </td>
                  {/* Cliente */}
                  <td className="px-5 py-3.5 text-sm text-foreground">{row.client}</td>
                  {/* Período */}
                  <td className="px-5 py-3.5 text-xs text-muted-foreground">{row.date}</td>
                  {/* Gerado em */}
                  <td className="px-5 py-3.5">
                    <p className="text-xs text-foreground">{row.date}</p>
                    <p className="text-[10px] text-muted-foreground">–</p>
                  </td>
                  {/* Origem */}
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-blue-500/15 text-blue-300 border-blue-400/30">
                      Personalizado
                    </span>
                  </td>
                  {/* Status */}
                  <td className="px-5 py-3.5">
                    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', statusConfig.text)}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', statusConfig.dot)} />
                      {statusConfig.label}
                    </span>
                  </td>
                  {/* Ações */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="Baixar PDF"
                        onClick={() => downloadReportPdf(row)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        title="Excluir"
                        onClick={() => {
                          if (window.confirm(`Excluir "${row.title}"?`)) {
                            deleteReport(row.id);
                            setLibraryReports(readReports());
                          }
                        }}
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

        {/* ── FOOTER / PAGINATION ── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Mostrando {totalRows === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} a{' '}
            {Math.min(page * PAGE_SIZE, totalRows)} de {totalRows} relatórios
          </p>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Anterior
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={cn(
                  'w-7 h-7 text-xs rounded-md transition-colors',
                  p === page
                    ? 'bg-violet-600 text-white font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                {p}
              </button>
            ))}

            <button
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Próxima
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
