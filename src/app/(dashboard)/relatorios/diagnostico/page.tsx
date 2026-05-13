"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClients } from '@/lib/client-store';
import { Sparkles, AlertCircle, ChevronDown } from 'lucide-react';

export default function NovoDiagnosticoPage() {
  const router = useRouter();
  const { clients } = useClients();

  const [clientId, setClientId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Default: last month
  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(to.toISOString().split('T')[0]);
  }, []);

  async function handleGenerate() {
    if (!clientId || !dateFrom || !dateTo) {
      setError('Selecione o cliente e o período.');
      return;
    }
    const clientName = clients.find(c => c.id === clientId)?.name ?? clientId;
    setGenerating(true);
    setError('');

    const res = await fetch('/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientName, dateFrom, dateTo }),
    });

    const data = await res.json() as { id?: string; error?: string };
    setGenerating(false);

    if (!res.ok || data.error) {
      setError(data.error ?? 'Erro ao gerar relatório.');
    } else {
      router.push(`/relatorios/${data.id}`);
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6 pt-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Novo Diagnóstico</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Selecione o cliente e o período. Os dados são puxados automaticamente da dashboard.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        {/* Client */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Cliente</label>
          <div className="relative">
            <select
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm pr-8"
            >
              <option value="">Selecione o cliente...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Period */}
        <div className="flex gap-3">
          <div className="flex-1 space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Data início</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
            />
          </div>
          <div className="flex-1 space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Data fim</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={generating || !clientId || !dateFrom || !dateTo}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        style={{ background: '#7B21D0' }}
      >
        {generating ? (
          <>
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            Gerando com IA...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Gerar Diagnóstico
          </>
        )}
      </button>
    </div>
  );
}
