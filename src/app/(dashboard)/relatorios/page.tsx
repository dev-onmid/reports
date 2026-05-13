"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, Download, Eye, Trash2, Sparkles, FileText } from 'lucide-react';
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

export default function RelatoriosPage() {
  const { clients } = useClients();
  const [libraryReports, setLibraryReports] = useState<StoredReport[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport[]>([]);
  const [tab, setTab] = useState<'diagnostico' | 'widget'>('diagnostico');

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-muted-foreground mt-1">Diagnósticos de performance e relatórios personalizados.</p>
        </div>
        <div className="flex gap-2">
          <Button
            render={<Link href="/relatorios/diagnostico" />}
            nativeButton={false}
            className="bg-[#7B21D0] hover:bg-[#6418B0] text-white"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Novo Diagnóstico
          </Button>
          <Button
            render={<Link href="/relatorios/novo" />}
            nativeButton={false}
            variant="outline"
          >
            <Plus className="w-4 h-4 mr-2" />
            Relatório Personalizado
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        {([['diagnostico', 'Diagnósticos de Performance', Sparkles], ['widget', 'Relatórios Personalizados', FileText]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Diagnostics tab */}
      {tab === 'diagnostico' && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium">
              <tr>
                <th className="px-6 py-4">Relatório</th>
                <th className="px-6 py-4">Cliente</th>
                <th className="px-6 py-4">Período</th>
                <th className="px-6 py-4">Gerado em</th>
                <th className="px-6 py-4">Origem</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {diagnostics.map((r) => (
                <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4 font-medium max-w-xs truncate">{r.title}</td>
                  <td className="px-6 py-4 text-muted-foreground">{r.client_name}</td>
                  <td className="px-6 py-4 text-muted-foreground text-xs">
                    {fmtDate(r.period_from)} – {fmtDate(r.period_to)}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground text-xs">{fmtDate(r.created_at)}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-semibold',
                      r.generated_by === 'auto'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-violet-500/15 text-violet-400',
                    )}>
                      {r.generated_by === 'auto' ? 'Automático' : 'Manual'}
                    </span>
                  </td>
                  <td className="px-6 py-4 flex justify-end gap-1">
                    <Button variant="ghost" size="icon" title="Visualizar" render={<Link href={`/relatorios/${r.id}`} />} nativeButton={false}>
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" title="Excluir"
                      className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      onClick={() => handleDeleteDiagnostic(r.id, r.title)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {diagnostics.length === 0 && (
            <div className="py-14 text-center">
              <Sparkles className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Nenhum diagnóstico gerado ainda.</p>
              <p className="text-xs text-muted-foreground mt-1">
                <Link href="/relatorios/diagnostico" className="text-primary hover:underline">
                  Gerar primeiro diagnóstico →
                </Link>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Widget reports tab */}
      {tab === 'widget' && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium">
              <tr>
                <th className="px-6 py-4">Título</th>
                <th className="px-6 py-4">Cliente</th>
                <th className="px-6 py-4">Data</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {widgetReports.map((report) => (
                <tr key={report.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4 font-medium">{report.title}</td>
                  <td className="px-6 py-4">{report.client}</td>
                  <td className="px-6 py-4">{report.date}</td>
                  <td className="px-6 py-4">
                    <span className={cn('px-2 py-1 rounded-full text-xs font-medium',
                      report.status === 'Gerado' ? 'bg-primary/20 text-primary' :
                      report.status === 'Enviado' ? 'bg-blue-500/20 text-blue-500' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {report.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 flex justify-end gap-2">
                    <Button variant="ghost" size="icon" title="Baixar PDF" onClick={() => downloadReportPdf(report)}>
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" title="Excluir"
                      className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      onClick={() => {
                        if (window.confirm(`Excluir "${report.title}"?`)) {
                          deleteReport(report.id);
                          setLibraryReports(readReports());
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {widgetReports.length === 0 && (
            <div className="py-14 text-center text-sm text-muted-foreground">
              Nenhum relatório personalizado.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
