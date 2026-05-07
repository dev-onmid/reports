"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, Download, Eye, MoreVertical } from 'lucide-react';
import { mockClients } from '@/lib/mock-data';
import { useClients } from '@/lib/client-store';

const mockReports = [
  { id: 1, title: 'Relatório Mensal - Abril 2026', clientId: mockClients[0].id, client: mockClients[0].name, date: '01/05/2026', status: 'Gerado' },
  { id: 2, title: 'Performance Campanhas Q1', clientId: mockClients[1].id, client: mockClients[1].name, date: '15/04/2026', status: 'Enviado' },
  { id: 3, title: 'Análise de Social Media', clientId: mockClients[2].id, client: mockClients[2].name, date: '10/04/2026', status: 'Rascunho' },
];

export default function RelatoriosPage() {
  const { clients } = useClients();
  const visibleClientIds = new Set(clients.map((client) => client.id));
  const reports = mockReports.filter((report) => visibleClientIds.has(report.clientId));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Biblioteca de Relatórios</h1>
          <p className="text-muted-foreground mt-1">Gerencie todos os relatórios gerados pela IA.</p>
        </div>
        <Button
          render={<Link href="/relatorios/novo" />}
          nativeButton={false}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo Relatório
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium">
            <tr>
              <th className="px-6 py-4">Título do Relatório</th>
              <th className="px-6 py-4">Cliente</th>
              <th className="px-6 py-4">Data</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {reports.map((report) => (
              <tr key={report.id} className="hover:bg-muted/50 transition-colors">
                <td className="px-6 py-4 font-medium">{report.title}</td>
                <td className="px-6 py-4">{report.client}</td>
                <td className="px-6 py-4">{report.date}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    report.status === 'Gerado' ? 'bg-primary/20 text-primary' :
                    report.status === 'Enviado' ? 'bg-blue-500/20 text-blue-500' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {report.status}
                  </span>
                </td>
                <td className="px-6 py-4 flex justify-end gap-2">
                  <Button variant="ghost" size="icon" title="Visualizar">
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Baixar PDF">
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {reports.length === 0 && (
          <div className="py-14 text-center text-sm text-muted-foreground">
            Nenhum relatório para clientes ativos.
          </div>
        )}
      </div>
    </div>
  );
}
