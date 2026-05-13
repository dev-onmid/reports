"use client";

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useClients } from '@/lib/client-store';
import { Upload, Sparkles, AlertCircle, CheckCircle2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type Connection = { id: string; name?: string; label: string };
type AdAccount = { id: string; name: string };

export default function NovoDiagnosticoPage() {
  const router = useRouter();
  const { clients } = useClients();

  const [clientId, setClientId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [metaConns, setMetaConns] = useState<Connection[]>([]);
  const [googleConns, setGoogleConns] = useState<Connection[]>([]);
  const [metaAccounts, setMetaAccounts] = useState<AdAccount[]>([]);

  const [selectedMetaConn, setSelectedMetaConn] = useState('');
  const [selectedMetaAccounts, setSelectedMetaAccounts] = useState<string[]>([]);
  const [selectedGoogleConn, setSelectedGoogleConn] = useState('');
  const [selectedGoogleAccount, setSelectedGoogleAccount] = useState('');

  const [crmFile, setCrmFile] = useState<File | null>(null);
  const [crmStatus, setCrmStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [crmInfo, setCrmInfo] = useState('');
  const [existingUpload, setExistingUpload] = useState<{ filename: string; row_count: number } | null>(null);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);

  // Load connections
  useEffect(() => {
    fetch('/api/meta/connections')
      .then(r => r.ok ? r.json() : [])
      .then((rows: { id: string; label?: string; account_name?: string }[]) =>
        setMetaConns(rows.map(r => ({ id: r.id, label: r.label ?? r.account_name ?? r.id })))
      )
      .catch(() => {});

    fetch('/api/google/connections')
      .then(r => r.ok ? r.json() : [])
      .then((rows: { id: string; email?: string; name?: string }[]) =>
        setGoogleConns(rows.map(r => ({ id: r.id, label: r.email ?? r.name ?? r.id })))
      )
      .catch(() => {});
  }, []);

  // Load meta ad accounts when connection changes
  useEffect(() => {
    if (!selectedMetaConn) return;
    fetch(`/api/meta/ad-accounts?connectionId=${selectedMetaConn}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: { id: string; name: string }[]) => setMetaAccounts(rows))
      .catch(() => {});
  }, [selectedMetaConn]);

  // Load existing CRM upload when client changes
  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/reports/crm/upload?clientId=${clientId}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: { filename: string; row_count: number }[]) => {
        if (rows[0]) setExistingUpload(rows[0]);
        else setExistingUpload(null);
      })
      .catch(() => {});
  }, [clientId]);

  // Set default dates to last month
  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(to.toISOString().split('T')[0]);
  }, []);

  async function handleCrmUpload(file: File) {
    if (!clientId) { setError('Selecione o cliente antes de enviar a planilha.'); return; }
    setCrmFile(file);
    setCrmStatus('uploading');
    setCrmInfo('Analisando colunas com IA...');
    setError('');

    const form = new FormData();
    form.append('file', file);
    form.append('clientId', clientId);

    const res = await fetch('/api/reports/crm/upload', { method: 'POST', body: form });
    const data = await res.json() as { rowCount?: number; error?: string };

    if (!res.ok || data.error) {
      setCrmStatus('error');
      setCrmInfo(data.error ?? 'Erro ao processar planilha.');
    } else {
      setCrmStatus('done');
      setCrmInfo(`${data.rowCount} registros importados e mapeados.`);
      setExistingUpload({ filename: file.name, row_count: data.rowCount! });
    }
  }

  async function handleGenerate() {
    if (!clientId || !dateFrom || !dateTo) {
      setError('Preencha cliente, data início e data fim.');
      return;
    }
    const clientName = clients.find(c => c.id === clientId)?.name ?? clientId;

    setGenerating(true);
    setError('');

    const res = await fetch('/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        clientName,
        dateFrom,
        dateTo,
        metaConnectionId: selectedMetaConn || undefined,
        metaAccountIds: selectedMetaAccounts.length ? selectedMetaAccounts : undefined,
        googleConnectionId: selectedGoogleConn || undefined,
        googleAccountId: selectedGoogleAccount || undefined,
      }),
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Novo Diagnóstico de Performance</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gere um relatório completo com IA combinando Meta Ads, Google Ads e CRM.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Client + Period */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-sm">1. Cliente e Período</h2>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Cliente</label>
          <div className="relative">
            <select
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 text-sm pr-8"
            >
              <option value="">Selecione o cliente...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1 space-y-2">
            <label className="text-xs text-muted-foreground">Data início</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1 space-y-2">
            <label className="text-xs text-muted-foreground">Data fim</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* CRM Upload */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-sm">2. Dados CRM (Planilha)</h2>

        {existingUpload && crmStatus === 'idle' && (
          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Planilha atual: <strong>{existingUpload.filename}</strong> — {existingUpload.row_count} registros
          </div>
        )}

        <div
          className={cn(
            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
            crmStatus === 'done' ? 'border-emerald-500/40 bg-emerald-500/5' :
            crmStatus === 'error' ? 'border-red-500/40 bg-red-500/5' :
            'border-border hover:border-primary/50 hover:bg-muted/30',
          )}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleCrmUpload(f);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".xlsx,.xls,.csv"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCrmUpload(f); }}
          />
          {crmStatus === 'uploading' ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-muted-foreground">{crmInfo}</p>
            </div>
          ) : crmStatus === 'done' ? (
            <div className="flex flex-col items-center gap-1">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              <p className="text-xs font-semibold text-emerald-400">{crmFile?.name}</p>
              <p className="text-[10px] text-muted-foreground">{crmInfo}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Clique para substituir</p>
            </div>
          ) : crmStatus === 'error' ? (
            <div className="flex flex-col items-center gap-1">
              <AlertCircle className="h-6 w-6 text-red-400" />
              <p className="text-xs text-red-400">{crmInfo}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">Arraste ou clique para enviar</p>
              <p className="text-xs text-muted-foreground">.xlsx, .xls ou .csv</p>
              <p className="text-[10px] text-muted-foreground">A IA detecta automaticamente: leads, status, faturamento, cidades</p>
            </div>
          )}
        </div>
      </div>

      {/* Meta Ads */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-sm">3. Meta Ads <span className="text-muted-foreground font-normal">(opcional)</span></h2>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Conexão</label>
          <div className="relative">
            <select
              value={selectedMetaConn}
              onChange={e => { setSelectedMetaConn(e.target.value); setSelectedMetaAccounts([]); }}
              className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 text-sm pr-8"
            >
              <option value="">Nenhuma</option>
              {metaConns.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {selectedMetaConn && metaAccounts.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Contas de anúncio</label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {metaAccounts.map(a => (
                <label key={a.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedMetaAccounts.includes(a.id)}
                    onChange={e => setSelectedMetaAccounts(prev =>
                      e.target.checked ? [...prev, a.id] : prev.filter(x => x !== a.id)
                    )}
                    className="rounded"
                  />
                  <span className="text-xs">{a.name} <span className="text-muted-foreground">({a.id})</span></span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Google Ads */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-sm">4. Google Ads <span className="text-muted-foreground font-normal">(opcional)</span></h2>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Conexão</label>
          <div className="relative">
            <select
              value={selectedGoogleConn}
              onChange={e => { setSelectedGoogleConn(e.target.value); setSelectedGoogleAccount(''); }}
              className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 text-sm pr-8"
            >
              <option value="">Nenhuma</option>
              {googleConns.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {selectedGoogleConn && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">ID da conta</label>
            <input
              type="text"
              placeholder="Ex: 1234567890"
              value={selectedGoogleAccount}
              onChange={e => setSelectedGoogleAccount(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
            />
          </div>
        )}
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={generating || !clientId || !dateFrom || !dateTo}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        style={{ background: generating ? '#5a17a0' : '#7B21D0' }}
      >
        {generating ? (
          <>
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            Gerando relatório com IA...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Gerar Diagnóstico de Performance
          </>
        )}
      </button>
    </div>
  );
}
