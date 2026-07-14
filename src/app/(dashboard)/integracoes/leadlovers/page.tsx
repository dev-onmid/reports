'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  Upload, BarChart3, Plus, Trash2, Megaphone,
  CheckCircle2, XCircle, Clock, Play, Pause, RefreshCw,
  ChevronLeft, ChevronRight, AlertCircle, Loader2, Check, X, Pencil, Copy, Zap, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAuthSession } from '@/lib/auth-store';
import { effectiveField, normalizeContact } from '@/lib/leadlovers-fields';

// ─── Types ───────────────────────────────────────────────────────────────────

type ContactRow = {
  nome?: string; email?: string; telefone?: string; empresa?: string;
  [key: string]: unknown;
};

type ContactRecord = ContactRow & {
  id: string; status: 'pendente' | 'enviado' | 'erro';
  sent_at?: string; error_msg?: string; next_send_at?: string;
};

type Client = { id: string; name: string };

type Connection = {
  id: string;
  client_id: string;
  name: string;
  webhook_url: string;
  machine_code?: string;
  email_sequence_code?: string;
  sequence_level_code?: string;
  auth_key?: string;
};

type Campaign = {
  id: string;
  name: string;
  webhook_url: string;
  machine_code?: string;
  email_sequence_code?: string;
  sequence_level_code?: string;
  auth_key?: string;
  client_id?: string;
  client_name?: string;
  connection_id?: string;
  connection_name?: string;
  status: 'rascunho' | 'ativa' | 'pausada' | 'concluida';
  total_contacts: number;
  total_sent: number;
  total_errors: number;
  created_at: string;
};

type ScheduleDay = {
  date: string;
  total: number;
  pendente: number;
  enviado: number;
  erro: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(userId: string | null, json = false): Record<string, string> {
  const h: Record<string, string> = { 'x-onmid-user-id': userId ?? '' };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function statusBadge(status: ContactRecord['status']) {
  if (status === 'enviado') return (
    <span className="inline-flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
      <CheckCircle2 className="h-3 w-3" /> Enviado
    </span>
  );
  if (status === 'erro') return (
    <span className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
      <XCircle className="h-3 w-3" /> Erro
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-400">
      <Clock className="h-3 w-3" /> Pendente
    </span>
  );
}

function campaignStatusBadge(status: Campaign['status']) {
  const map: Record<Campaign['status'], { label: string; cls: string }> = {
    rascunho:  { label: 'Rascunho',  cls: 'border-border bg-muted/30 text-muted-foreground' },
    ativa:     { label: 'Ativa',     cls: 'border-green-500/30 bg-green-500/10 text-green-400' },
    pausada:   { label: 'Pausada',   cls: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400' },
    concluida: { label: 'Concluída', cls: 'border-blue-500/30 bg-blue-500/10 text-blue-400' },
  };
  const { label, cls } = map[status] ?? map.rascunho;
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

function campaignStatusLabel(s: Campaign['status']) {
  return { rascunho: 'Rascunho', ativa: 'Ativa', pausada: 'Pausada', concluida: 'Concluída' }[s] ?? s;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR');
}

// Data do N-ésimo dia útil a partir de `startISO` (inclusive) — usada pra calcular
// até quando o cronograma "X por dia" precisa ir pra caber todos os contatos.
function nthBusinessDay(startISO: string, nBusinessDays: number): string {
  const cur = new Date(startISO + 'T00:00:00');
  let count = 0;
  // Se começar num fim de semana, anda até o primeiro dia útil
  for (let guard = 0; guard < 3650; guard++) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    if (count >= nBusinessDays) break;
    cur.setDate(cur.getDate() + 1);
  }
  return toISODate(cur);
}

function parseSheet(file: File): Promise<{ rows: ContactRow[]; headers: string[] }> {
  // .csv precisa ser lido como texto (readAsText), não como bytes binários: lido
  // como ArrayBuffer o SheetJS não decodifica UTF-8 corretamente (acentos viram
  // mojibake, "João" -> "JoÃ£o") e em alguns casos nem separa as colunas direito.
  // Como texto, o SheetJS detecta automaticamente o separador (vírgula ou ; —
  // Excel BR salva CSV com ponto-e-vírgula) e o encoding fica certo.
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let json: Record<string, unknown>[];
        if (isCsv) {
          const text = (e.target!.result as string).replace(/^﻿/, ''); // remove BOM
          const wb = XLSX.read(text, { type: 'string' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        } else {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        }
        if (json.length === 0) { reject(new Error('Planilha vazia ou sem linhas válidas')); return; }
        resolve({ rows: json as ContactRow[], headers: Object.keys(json[0]) });
      } catch {
        reject(new Error('Não foi possível ler o arquivo. Verifique se é .xlsx, .xls ou .csv'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo'));
    if (isCsv) reader.readAsText(file, 'utf-8');
    else reader.readAsArrayBuffer(file);
  });
}

// ─── Wizard: Cliente → Contatos → Disparo ─────────────────────────────────────

const STEPS = ['Cliente', 'Contatos', 'Disparo'] as const;

function NewCampaignWizard({
  clients, initialClientId, userId, onCreated, onCancel,
}: {
  clients: Client[];
  initialClientId?: string;
  userId: string | null;
  onCreated: (campaignId: string, dispatchNow: boolean) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState('');

  // Passo 1 — cliente + conexão
  const [clientId, setClientId] = useState(initialClientId ?? '');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [connectionId, setConnectionId] = useState('');
  const [connName, setConnName] = useState('');
  const [connWebhook, setConnWebhook] = useState('');
  const [connMachine, setConnMachine] = useState('');
  const [connEmailSeq, setConnEmailSeq] = useState('');
  const [connSeqLevel, setConnSeqLevel] = useState('1');
  const [connAuthKey, setConnAuthKey] = useState('');

  // Passo 2 — contatos
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Passo 3 — disparo
  const [campaignName, setCampaignName] = useState('');
  const [dispatchMode, setDispatchMode] = useState<'now' | 'perday'>('perday');
  const [qtyPerDay, setQtyPerDay] = useState(50);
  const [startDate, setStartDate] = useState(toISODate(new Date()));
  const [sendTime, setSendTime] = useState('09:00');
  const [intervalMinutes, setIntervalMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (!clientId || !userId) { setConnections([]); setConnectionId(''); return; }
    setLoadingConnections(true);
    fetch(`/api/leadlovers/connections?client_id=${clientId}`, { headers: authHeaders(userId) })
      .then(r => r.json())
      .then((d: Connection[]) => {
        setConnections(d);
        setConnectionId(d.length > 0 ? d[0].id : '__new__');
      })
      .catch(() => setConnections([]))
      .finally(() => setLoadingConnections(false));
  }, [clientId, userId]);

  async function loadFile(file: File) {
    try {
      const { rows: r } = await parseSheet(file);
      setRows(r); setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao ler planilha');
    }
  }

  const daysNeeded = qtyPerDay > 0 ? Math.ceil(rows.length / qtyPerDay) : 0;
  const endDate = daysNeeded > 0 ? nthBusinessDay(startDate, daysNeeded) : startDate;

  const canNext =
    step === 0 ? (!!clientId && !!connectionId && (connectionId !== '__new__' || (connName.trim() && connWebhook.trim()))) :
    step === 1 ? rows.length > 0 :
    true;

  async function finish() {
    if (!campaignName.trim()) { setError('Dê um nome à campanha'); return; }
    setSubmitting(true); setError('');
    try {
      // 1) cria a campanha (com conexão existente ou nova)
      setProgress('Criando campanha…');
      const body: Record<string, unknown> = { name: campaignName.trim(), client_id: clientId };
      if (connectionId === '__new__') {
        body.new_connection = {
          name: connName.trim() || campaignName.trim(),
          webhook_url: connWebhook.trim(),
          machine_code: connMachine.trim() || undefined,
          email_sequence_code: connEmailSeq.trim() || undefined,
          sequence_level_code: connSeqLevel.trim() || '1',
          auth_key: connAuthKey.trim() || undefined,
        };
      } else {
        body.connection_id = connectionId;
      }
      const cRes = await fetch('/api/leadlovers/campaigns', { method: 'POST', headers: authHeaders(userId, true), body: JSON.stringify(body) });
      if (!cRes.ok) throw new Error((await cRes.json()).error ?? 'Erro ao criar campanha');
      const campaign = await cRes.json();

      // 2) sobe os contatos
      setProgress(`Importando ${rows.length} contatos…`);
      const ctRes = await fetch('/api/leadlovers/contacts', { method: 'POST', headers: authHeaders(userId, true), body: JSON.stringify({ contacts: rows, campaign_id: campaign.id }) });
      if (!ctRes.ok) throw new Error((await ctRes.json()).error ?? 'Erro ao importar contatos');

      // 3) agenda + ativa
      if (dispatchMode === 'perday') {
        setProgress('Montando cronograma…');
        const rRes = await fetch(`/api/leadlovers/campaigns/${campaign.id}/rules`, {
          method: 'POST', headers: authHeaders(userId, true),
          body: JSON.stringify({ date_from: startDate, date_to: endDate, qty_per_day: qtyPerDay, interval_minutes: intervalMinutes, send_time: sendTime }),
        });
        if (!rRes.ok) throw new Error((await rRes.json()).error ?? 'Erro ao criar cronograma');
        const aRes = await fetch(`/api/leadlovers/campaigns/${campaign.id}/activate`, { method: 'POST', headers: authHeaders(userId) });
        if (!aRes.ok) throw new Error((await aRes.json()).error ?? 'Erro ao ativar');
        onCreated(campaign.id, false);
      } else {
        setProgress('Ativando para disparo imediato…');
        const aRes = await fetch(`/api/leadlovers/campaigns/${campaign.id}/activate?mode=now`, { method: 'POST', headers: authHeaders(userId) });
        if (!aRes.ok) throw new Error((await aRes.json()).error ?? 'Erro ao ativar');
        onCreated(campaign.id, true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro');
      setSubmitting(false);
      setProgress('');
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 space-y-5">
      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${
              i === step ? 'bg-primary text-black' : i < step ? 'text-green-400' : 'text-muted-foreground'
            }`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                i === step ? 'bg-black/20' : i < step ? 'bg-green-500/20' : 'bg-muted'
              }`}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>
              {label}
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
        <button onClick={onCancel} className="ml-auto text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Passo 1 — Cliente */}
      {step === 0 && (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Cliente</p>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="">Selecione o cliente…</option>
              {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
            </select>
          </div>

          {clientId && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Credencial do Leadlovers</p>
              <select
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                disabled={loadingConnections}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-50"
              >
                {connections.map(cn => <option key={cn.id} value={cn.id}>{cn.name}</option>)}
                <option value="__new__">+ Nova credencial…</option>
              </select>
              {connections.length > 0 && connectionId !== '__new__' && (
                <p className="mt-1 text-xs text-green-400">Esse cliente já tem credencial — é só seguir.</p>
              )}
            </div>
          )}

          {clientId && connectionId === '__new__' && (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <Input placeholder="Nome da credencial (ex: Fluxo Boas-vindas)" value={connName} onChange={(e) => setConnName(e.target.value)} />
              <Input placeholder="URL do Webhook (https://llapi.leadlovers.com/webapi/lead?token=…)" value={connWebhook} onChange={(e) => setConnWebhook(e.target.value)} />
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">MachineCode</p>
                  <Input placeholder="ex: 777360" value={connMachine} onChange={(e) => setConnMachine(e.target.value)} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">EmailSequenceCode</p>
                  <Input placeholder="ex: 1845595" value={connEmailSeq} onChange={(e) => setConnEmailSeq(e.target.value)} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">SequenceLevelCode</p>
                  <Input placeholder="ex: 1" value={connSeqLevel} onChange={(e) => setConnSeqLevel(e.target.value)} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Bearer Token (opcional)</p>
                <Input type="password" placeholder="eyJ0eXAiOi…" value={connAuthKey} onChange={(e) => setConnAuthKey(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">Fica salva no cliente — nas próximas campanhas dele é só escolher na lista.</p>
            </div>
          )}
        </div>
      )}

      {/* Passo 2 — Contatos */}
      {step === 1 && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
            onClick={() => fileRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-10 text-center transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-border bg-card/40 hover:border-primary/40 hover:bg-primary/5'
            }`}
          >
            <Upload className="mb-3 h-9 w-9 text-muted-foreground" />
            <p className="text-base font-semibold">
              {rows.length > 0 ? `${rows.length} contatos carregados` : 'Arraste a planilha aqui'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">ou clique para selecionar — .xlsx / .xls / .csv</p>
            <p className="mt-2 text-xs text-muted-foreground">Colunas: <span className="text-foreground">Nome, Email, Telefone, Empresa</span> (outros campos aceitos)</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
          </div>

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-card/60">
                    {['Nome', 'Email', 'Telefone', 'Empresa'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((row, i) => {
                    const { nome, email, telefone, empresa } = normalizeContact(row);
                    return (
                      <tr key={i} className="border-b border-border/50">
                        <td className="px-4 py-1.5">{nome || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-1.5">{email || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-1.5">{telefone || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-1.5">{empresa || <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 8 && <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border">… e mais {rows.length - 8} contatos</p>}
            </div>
          )}
        </div>
      )}

      {/* Passo 3 — Disparo */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Nome da campanha</p>
            <Input placeholder="ex: Boas-vindas — Julho" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setDispatchMode('now')}
              className={`rounded-xl border p-4 text-left transition-colors ${dispatchMode === 'now' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
            >
              <div className="flex items-center gap-2 font-semibold text-sm"><Zap className="h-4 w-4" /> Tudo de uma vez</div>
              <p className="mt-1 text-xs text-muted-foreground">Dispara os {rows.length} contatos agora, de uma vez só.</p>
            </button>
            <button
              onClick={() => setDispatchMode('perday')}
              className={`rounded-xl border p-4 text-left transition-colors ${dispatchMode === 'perday' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
            >
              <div className="flex items-center gap-2 font-semibold text-sm"><Clock className="h-4 w-4" /> Distribuir por dia</div>
              <p className="mt-1 text-xs text-muted-foreground">Envia X por dia, ao longo de vários dias úteis.</p>
            </button>
          </div>

          {dispatchMode === 'perday' && (
            <div className="space-y-3 rounded-xl border border-border/60 p-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Contatos por dia</p>
                  <Input type="number" min={1} value={qtyPerDay} onChange={(e) => setQtyPerDay(Math.max(1, parseInt(e.target.value) || 1))} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Começar em</p>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Horário</p>
                  <input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Intervalo entre envios (min, opcional)</p>
                <Input type="number" min={1} placeholder="— (todos no mesmo horário)" value={intervalMinutes ?? ''} onChange={(e) => setIntervalMinutes(e.target.value ? parseInt(e.target.value) : null)} />
              </div>
              <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-xs">
                <span className="text-foreground font-medium">{rows.length}</span> contatos ÷ <span className="text-foreground font-medium">{qtyPerDay}</span>/dia ={' '}
                <span className="text-foreground font-medium">{daysNeeded}</span> dias úteis — de {fmtDate(startDate)} até {fmtDate(endDate)}.
              </div>
            </div>
          )}

          {dispatchMode === 'now' && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-muted-foreground">
              Ao concluir, os {rows.length} contatos entram na fila e começam a ser enviados imediatamente.
            </div>
          )}
        </div>
      )}

      {/* Navegação */}
      <div className="flex items-center gap-2 pt-1">
        {step > 0 && !submitting && (
          <Button variant="ghost" onClick={() => setStep(s => s - 1)}><ChevronLeft className="h-4 w-4" /> Voltar</Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {submitting && <span className="text-xs text-muted-foreground">{progress}</span>}
          {step < STEPS.length - 1 ? (
            <Button onClick={() => { setError(''); setStep(s => s + 1); }} disabled={!canNext}>Continuar <ChevronRight className="h-4 w-4" /></Button>
          ) : (
            <Button onClick={finish} disabled={submitting || !campaignName.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {dispatchMode === 'now' ? 'Criar e disparar' : 'Criar e agendar'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Aba Campanhas: lista + gerenciar ─────────────────────────────────────────

function CampanhasTab({
  campaigns, clients, onRefresh, onOpenPanel,
}: {
  campaigns: Campaign[];
  clients: Client[];
  onRefresh: () => void;
  onOpenPanel: (campaignId: string, dispatchNow: boolean) => void;
}) {
  const userId = getAuthSession()?.userId ?? null;
  const [showWizard, setShowWizard] = useState(false);
  const [wizardClientId, setWizardClientId] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Editar credencial (snapshot da campanha)
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', webhook_url: '', machine_code: '', email_sequence_code: '', sequence_level_code: '1', auth_key: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  function openWizard(clientId?: string) {
    setWizardClientId(clientId);
    setShowWizard(true);
  }

  async function setStatus(c: Campaign, status: Campaign['status']) {
    setBusyId(c.id);
    try {
      await fetch(`/api/leadlovers/campaigns/${c.id}`, { method: 'PATCH', headers: authHeaders(userId, true), body: JSON.stringify({ status }) });
      onRefresh();
    } finally { setBusyId(null); }
  }

  async function remove(c: Campaign) {
    if (!confirm(`Excluir a campanha "${c.name}"? Os contatos e o histórico dela serão apagados. Essa ação não tem volta.`)) return;
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/leadlovers/campaigns/${c.id}`, { method: 'DELETE', headers: authHeaders(userId) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao excluir');
      onRefresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao excluir');
    } finally { setBusyId(null); }
  }

  function startEdit(c: Campaign) {
    setEditId(c.id);
    setEdit({
      name: c.name ?? '', webhook_url: c.webhook_url ?? '', machine_code: c.machine_code ?? '',
      email_sequence_code: c.email_sequence_code ?? '', sequence_level_code: c.sequence_level_code ?? '1', auth_key: c.auth_key ?? '',
    });
  }

  async function saveEdit(id: string) {
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/leadlovers/campaigns/${id}`, {
        method: 'PATCH', headers: authHeaders(userId, true),
        body: JSON.stringify({
          name: edit.name.trim() || undefined, webhook_url: edit.webhook_url.trim(),
          machine_code: edit.machine_code.trim() || null, email_sequence_code: edit.email_sequence_code.trim() || null,
          sequence_level_code: edit.sequence_level_code.trim() || '1', auth_key: edit.auth_key.trim() || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao salvar');
      setEditId(null);
      onRefresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally { setSavingEdit(false); }
  }

  if (showWizard) {
    return (
      <NewCampaignWizard
        clients={clients}
        initialClientId={wizardClientId}
        userId={userId}
        onCreated={(id, dispatchNow) => { setShowWizard(false); onRefresh(); onOpenPanel(id, dispatchNow); }}
        onCancel={() => setShowWizard(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{campaigns.length} campanha{campaigns.length === 1 ? '' : 's'}</p>
        <Button onClick={() => openWizard()}><Plus className="h-4 w-4" /> Nova campanha</Button>
      </div>

      {campaigns.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Megaphone className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-semibold">Nenhuma campanha ainda</p>
          <p className="mt-1 text-xs text-muted-foreground">Clique em “Nova campanha” para criar a primeira.</p>
        </div>
      )}

      <div className="space-y-3">
        {campaigns.map(c => {
          const pct = c.total_contacts > 0 ? Math.min(100, (c.total_sent / c.total_contacts) * 100) : 0;
          const busy = busyId === c.id;
          return (
            <div key={c.id} className="rounded-xl border border-border bg-card/40 p-4">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{c.name}</p>
                    {campaignStatusBadge(c.status)}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.client_name && <>Cliente: <span className="text-foreground">{c.client_name}</span></>}
                    {c.connection_name && <> • Credencial: <span className="text-foreground">{c.connection_name}</span></>}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => onOpenPanel(c.id, false)}><BarChart3 className="h-3.5 w-3.5" /> Painel</Button>
                  {c.status === 'ativa' && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(c, 'pausada')} disabled={busy}><Pause className="h-3.5 w-3.5" /> Pausar</Button>
                  )}
                  {c.status === 'pausada' && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(c, 'ativa')} disabled={busy}><Play className="h-3.5 w-3.5" /> Retomar</Button>
                  )}
                  <button onClick={() => openWizard(c.client_id)} title="Nova campanha reaproveitando o cliente e a credencial desta" className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs hover:bg-card/60"><Copy className="h-3.5 w-3.5" /> Duplicar</button>
                  <button onClick={() => (editId === c.id ? setEditId(null) : startEdit(c))} title="Editar credencial" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-card/60"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => remove(c)} disabled={busy} title="Excluir campanha" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-red-500/40 hover:text-red-400">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
                </div>
              </div>

              {c.total_contacts > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{c.total_sent} enviados{c.total_errors > 0 ? ` • ${c.total_errors} erros` : ''}</span>
                    <span>{c.total_sent} / {c.total_contacts}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}

              {editId === c.id && (
                <div className="mt-3 space-y-3 rounded-lg border border-border/60 p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Editar credencial da campanha</p>
                  <Input placeholder="Nome" value={edit.name} onChange={(e) => setEdit(v => ({ ...v, name: e.target.value }))} />
                  <Input placeholder="URL do Webhook" value={edit.webhook_url} onChange={(e) => setEdit(v => ({ ...v, webhook_url: e.target.value }))} />
                  <div className="grid grid-cols-3 gap-3">
                    <Input placeholder="MachineCode" value={edit.machine_code} onChange={(e) => setEdit(v => ({ ...v, machine_code: e.target.value }))} />
                    <Input placeholder="EmailSequenceCode" value={edit.email_sequence_code} onChange={(e) => setEdit(v => ({ ...v, email_sequence_code: e.target.value }))} />
                    <Input placeholder="SequenceLevelCode" value={edit.sequence_level_code} onChange={(e) => setEdit(v => ({ ...v, sequence_level_code: e.target.value }))} />
                  </div>
                  <Input type="password" placeholder="Bearer Token" value={edit.auth_key} onChange={(e) => setEdit(v => ({ ...v, auth_key: e.target.value }))} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdit(c.id)} disabled={savingEdit || !edit.webhook_url.trim()}>{savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancelar</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Testar webhook (bloco discreto no Painel) ────────────────────────────────

function WebhookTester() {
  const userId = getAuthSession()?.userId ?? null;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [machineCode, setMachineCode] = useState('');
  const [emailSequenceCode, setEmailSequenceCode] = useState('');
  const [sequenceLevelCode, setSequenceLevelCode] = useState('1');
  const [authKey, setAuthKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; httpStatus: number; responseBody: string } | null>(null);

  async function test() {
    if (!url.trim()) return;
    setTesting(true); setResult(null);
    try {
      const res = await fetch('/api/leadlovers/config', {
        method: 'PUT', headers: authHeaders(userId, true),
        body: JSON.stringify({ webhook_url: url, machine_code: machineCode, email_sequence_code: emailSequenceCode, sequence_level_code: sequenceLevelCode, auth_key: authKey }),
      });
      setResult(await res.json());
    } catch (err: unknown) {
      setResult({ ok: false, httpStatus: 0, responseBody: err instanceof Error ? err.message : 'Erro de rede' });
    } finally { setTesting(false); }
  }

  return (
    <div className="rounded-xl border border-border bg-card/40">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground hover:text-foreground">
        <Zap className="h-4 w-4" /> Testar webhook do provedor
        <ChevronRight className={`ml-auto h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-4">
          <p className="text-xs text-muted-foreground">Valida uma credencial avulsa contra o Leadlovers. Nada é salvo aqui.</p>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL do Webhook" />
          <div className="grid grid-cols-3 gap-3">
            <Input value={machineCode} onChange={(e) => setMachineCode(e.target.value)} placeholder="MachineCode" />
            <Input value={emailSequenceCode} onChange={(e) => setEmailSequenceCode(e.target.value)} placeholder="EmailSequenceCode" />
            <Input value={sequenceLevelCode} onChange={(e) => setSequenceLevelCode(e.target.value)} placeholder="SequenceLevelCode" />
          </div>
          <Input type="password" value={authKey} onChange={(e) => setAuthKey(e.target.value)} placeholder="Bearer Token (opcional)" />
          <Button size="sm" onClick={test} disabled={testing || !url.trim()}>{testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Testar</Button>
          {result && (
            <div className={`rounded-lg border p-3 text-sm ${result.ok ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
              <div className="flex items-center gap-2">
                {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {result.ok ? 'Conexão bem-sucedida' : 'Falha na conexão'}
                <span className="ml-auto text-xs text-muted-foreground">HTTP {result.httpStatus}</span>
              </div>
              {result.responseBody && <pre className="mt-2 max-h-24 overflow-auto rounded bg-black/30 p-2 text-xs text-muted-foreground">{result.responseBody.slice(0, 400)}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Aba Painel: acompanhar ───────────────────────────────────────────────────

function PainelTab({
  campaigns, selectedId, autoDispatchDate, onConsumeAutoDispatch, onRefresh,
}: {
  campaigns: Campaign[];
  selectedId: string;
  autoDispatchDate: string | null;
  onConsumeAutoDispatch: () => void;
  onRefresh: () => void;
}) {
  const userId = getAuthSession()?.userId ?? null;
  const [sel, setSel] = useState(selectedId);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<ScheduleDay[]>([]);
  const [dispatchingDay, setDispatchingDay] = useState<string | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const [monitorResult, setMonitorResult] = useState<{ sent: number; errors: number } | null>(null);
  const monitorRef = useRef(false);

  // Contatos individuais
  const [adding, setAdding] = useState(false);
  const [newContact, setNewContact] = useState({ nome: '', email: '', telefone: '', empresa: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContact, setEditContact] = useState({ nome: '', email: '', telefone: '', empresa: '' });
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { if (selectedId) setSel(selectedId); }, [selectedId]);

  const campaign = campaigns.find(c => c.id === sel);

  const loadContacts = useCallback(async () => {
    if (!sel || !userId) { setContacts([]); return; }
    setLoadingContacts(true);
    try {
      const res = await fetch(`/api/leadlovers/contacts?campaign_id=${sel}&limit=1000`, { headers: authHeaders(userId) });
      const d = await res.json();
      setContacts(d.contacts ?? []);
    } catch {} finally { setLoadingContacts(false); }
  }, [sel, userId]);

  const loadSchedule = useCallback(async () => {
    if (!sel || !userId) { setScheduleDays([]); return; }
    try {
      const res = await fetch(`/api/leadlovers/campaigns/${sel}/schedule`, { headers: authHeaders(userId) });
      if (res.ok) setScheduleDays(await res.json());
    } catch {}
  }, [sel, userId]);

  useEffect(() => { loadContacts(); loadSchedule(); }, [loadContacts, loadSchedule]);

  const dispatchDay = useCallback(async (date: string) => {
    if (!sel || !userId) return;
    setDispatchingDay(date);
    try {
      let remaining = 1;
      while (remaining > 0) {
        const res = await fetch(`/api/leadlovers/campaigns/${sel}/dispatch-day`, { method: 'POST', headers: authHeaders(userId, true), body: JSON.stringify({ date }) });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao disparar');
        const d = await res.json();
        remaining = d.remaining ?? 0;
        await loadSchedule();
        onRefresh();
      }
      await loadContacts();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao disparar o dia');
    } finally { setDispatchingDay(null); }
  }, [sel, userId, loadSchedule, loadContacts, onRefresh]);

  // Disparo automático vindo do wizard ("tudo de uma vez")
  useEffect(() => {
    if (autoDispatchDate && sel && userId) {
      const date = autoDispatchDate;
      onConsumeAutoDispatch();
      dispatchDay(date);
    }
  }, [autoDispatchDate, sel, userId, onConsumeAutoDispatch, dispatchDay]);

  // Monitor (envio automático)
  useEffect(() => {
    if (!monitoring || !sel || !userId) return;
    monitorRef.current = true;
    async function tick() {
      if (!monitorRef.current) return;
      try {
        const res = await fetch('/api/leadlovers/worker', { method: 'POST', headers: authHeaders(userId, true), body: JSON.stringify({ campaign_id: sel, limit: 10 }) });
        const d = await res.json();
        setMonitorResult({ sent: d.sent, errors: d.errors });
        await loadContacts(); await loadSchedule(); onRefresh();
      } catch {}
      if (monitorRef.current) setTimeout(tick, 60_000);
    }
    tick();
    return () => { monitorRef.current = false; };
  }, [monitoring, sel, userId, loadContacts, loadSchedule, onRefresh]);

  async function addContact() {
    if (!sel || !userId) return;
    if (!newContact.nome.trim() && !newContact.email.trim() && !newContact.telefone.trim()) return;
    setSavingContact(true);
    try {
      const res = await fetch('/api/leadlovers/contacts', { method: 'POST', headers: authHeaders(userId, true), body: JSON.stringify({ contacts: [newContact], campaign_id: sel }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro');
      setNewContact({ nome: '', email: '', telefone: '', empresa: '' });
      setAdding(false);
      await loadContacts(); onRefresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao adicionar');
    } finally { setSavingContact(false); }
  }

  async function saveEditContact(id: string) {
    if (!userId) return;
    setSavingEditId(id);
    try {
      const res = await fetch(`/api/leadlovers/contacts/${id}`, { method: 'PATCH', headers: authHeaders(userId, true), body: JSON.stringify(editContact) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro');
      setEditingId(null);
      await loadContacts();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally { setSavingEditId(null); }
  }

  async function removeContact(c: ContactRecord) {
    if (!userId) return;
    const label = effectiveField(c, 'nome') || effectiveField(c, 'email') || 'este contato';
    const warn = c.status === 'enviado' ? ' Ele já foi enviado — o histórico de envio também será perdido.' : '';
    if (!confirm(`Remover ${label}?${warn}`)) return;
    setDeletingId(c.id);
    try {
      const res = await fetch(`/api/leadlovers/contacts/${c.id}`, { method: 'DELETE', headers: authHeaders(userId) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro');
      await loadContacts(); onRefresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao remover');
    } finally { setDeletingId(null); }
  }

  const today = new Date().toISOString().slice(0, 10);
  const sentToday = contacts.filter(c => c.status === 'enviado' && c.sent_at?.startsWith(today)).length;
  const pendingAll = contacts.filter(c => c.status === 'pendente').length;
  const errorsAll = contacts.filter(c => c.status === 'erro').length;
  const errorContacts = contacts.filter(c => c.status === 'erro').slice(0, 20);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={sel} onChange={(e) => { setSel(e.target.value); setMonitoring(false); }} className="h-9 rounded-lg border border-border bg-background px-3 text-sm flex-1 max-w-xs">
          <option value="">Selecione uma campanha…</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} — {campaignStatusLabel(c.status)}</option>)}
        </select>
        {sel && (
          <button onClick={() => { loadContacts(); loadSchedule(); }} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${loadingContacts ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        )}
      </div>

      {sel && campaign && (
        <>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Enviados hoje', value: sentToday, color: 'text-green-400' },
              { label: 'Faltam', value: pendingAll, color: 'text-yellow-400' },
              { label: 'Total enviados', value: campaign.total_sent, color: 'text-blue-400' },
              { label: 'Erros', value: errorsAll, color: 'text-red-400' },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-border bg-card/60 p-4 text-center">
                <p className={`text-3xl font-bold font-[family-name:var(--font-bebas)] tabular-nums ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {campaign.total_contacts > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progresso</span><span>{campaign.total_sent} / {campaign.total_contacts}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (campaign.total_sent / campaign.total_contacts) * 100)}%` }} />
              </div>
            </div>
          )}

          {(campaign.status === 'ativa' || campaign.status === 'pausada') && (
            <div className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3">
              <div>
                <p className="text-sm font-semibold">{monitoring ? 'Monitorando envios…' : 'Envio automático'}</p>
                <p className="text-xs text-muted-foreground">{monitoring ? 'Processando a fila a cada minuto' : 'Liga para enviar os agendados automaticamente'}</p>
                {monitorResult && <p className="text-xs text-muted-foreground mt-0.5">Último lote: <span className="text-green-400">{monitorResult.sent} enviados</span>{monitorResult.errors > 0 && <span className="text-red-400 ml-1">{monitorResult.errors} erros</span>}</p>}
              </div>
              <button onClick={() => setMonitoring(m => !m)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${monitoring ? 'bg-primary' : 'bg-muted'}`}>
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${monitoring ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          )}

          {scheduleDays.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-3">Disparos por dia</p>
              <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border bg-card/60">
                      {['Data', 'Total', 'Enviados', 'Pendentes', 'Erros', ''].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleDays.map(d => (
                      <tr key={d.date} className="border-b border-border/50 hover:bg-card/40">
                        <td className="px-4 py-2.5">{fmtDate(d.date)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{d.total}</td>
                        <td className="px-4 py-2.5 text-green-400 font-medium">{d.enviado}</td>
                        <td className="px-4 py-2.5 text-yellow-400 font-medium">{d.pendente}</td>
                        <td className="px-4 py-2.5 text-red-400 font-medium">{d.erro}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => dispatchDay(d.date)} disabled={d.pendente === 0 || dispatchingDay !== null || !['ativa', 'pausada'].includes(campaign.status)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-card/60 disabled:opacity-40" title="Dispara agora todos os pendentes desse dia, ignorando o horário programado">
                            {dispatchingDay === d.date ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                            {dispatchingDay === d.date ? 'Disparando…' : 'Disparar agora'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Contatos */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Contatos ({contacts.length})</p>
              <Button size="sm" variant="outline" onClick={() => setAdding(v => !v)}><Plus className="h-3.5 w-3.5" /> {adding ? 'Cancelar' : 'Adicionar contato'}</Button>
            </div>
            {adding && (
              <div className="mb-3 grid grid-cols-1 gap-2 rounded-xl border border-border bg-card/60 p-3 sm:grid-cols-5">
                <Input placeholder="Nome" value={newContact.nome} onChange={(e) => setNewContact(v => ({ ...v, nome: e.target.value }))} />
                <Input placeholder="Email" value={newContact.email} onChange={(e) => setNewContact(v => ({ ...v, email: e.target.value }))} />
                <Input placeholder="Telefone" value={newContact.telefone} onChange={(e) => setNewContact(v => ({ ...v, telefone: e.target.value }))} />
                <Input placeholder="Empresa" value={newContact.empresa} onChange={(e) => setNewContact(v => ({ ...v, empresa: e.target.value }))} />
                <Button onClick={addContact} disabled={savingContact}>{savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar</Button>
              </div>
            )}
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-card/60">
                    {['Status', 'Nome', 'Email', 'Telefone', 'Empresa', ''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contacts.map(c => {
                    const editing = editingId === c.id;
                    return (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-card/40">
                        <td className="px-4 py-2">{statusBadge(c.status)}</td>
                        {editing ? (
                          <>
                            {(['nome', 'email', 'telefone', 'empresa'] as const).map(f => (
                              <td key={f} className="px-2 py-1.5"><input className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs" value={editContact[f]} onChange={(e) => setEditContact(v => ({ ...v, [f]: e.target.value }))} /></td>
                            ))}
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <button onClick={() => saveEditContact(c.id)} disabled={savingEditId === c.id} className="text-green-400 hover:text-green-300">{savingEditId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</button>
                                <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-2">{effectiveField(c, 'nome') || <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-4 py-2 text-muted-foreground">{effectiveField(c, 'email') || '—'}</td>
                            <td className="px-4 py-2 text-muted-foreground">{effectiveField(c, 'telefone') || '—'}</td>
                            <td className="px-4 py-2 text-muted-foreground">{effectiveField(c, 'empresa') || '—'}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <button onClick={() => { setEditingId(c.id); setEditContact({ nome: effectiveField(c, 'nome'), email: effectiveField(c, 'email'), telefone: effectiveField(c, 'telefone'), empresa: effectiveField(c, 'empresa') }); }} className="text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                                <button onClick={() => removeContact(c)} disabled={deletingId === c.id} className="text-muted-foreground hover:text-red-400">{deletingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {contacts.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum contato nesta campanha.</p>}
            </div>
            {contacts.length >= 1000 && <p className="mt-2 text-xs text-muted-foreground">Exibindo os 1000 primeiros contatos.</p>}
          </div>

          {errorContacts.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-3">Alertas de erro</p>
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-red-500/20">{['Nome', 'Email', 'Telefone', 'Erro'].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>)}</tr></thead>
                  <tbody>
                    {errorContacts.map(c => (
                      <tr key={c.id} className="border-b border-red-500/10">
                        <td className="px-4 py-2.5">{effectiveField(c, 'nome') || '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{effectiveField(c, 'email') || '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{effectiveField(c, 'telefone') || '—'}</td>
                        <td className="px-4 py-2.5 text-red-400 text-xs">{c.error_msg ?? 'Erro desconhecido'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!sel && (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">Selecione uma campanha para acompanhar os envios.</p>
      )}

      {/* Testar webhook — utilitário discreto, por último */}
      <WebhookTester />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'campanhas' | 'painel';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'campanhas', label: 'Campanhas', icon: Megaphone },
  { id: 'painel', label: 'Painel', icon: BarChart3 },
];

export default function LeadloversPage() {
  const router = useRouter();
  const userId = getAuthSession()?.userId ?? null;

  const [tab, setTab] = useState<Tab>('campanhas');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelSelectedId, setPanelSelectedId] = useState('');
  const [autoDispatchDate, setAutoDispatchDate] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/leadlovers/campaigns', { headers: authHeaders(userId) });
      if (res.ok) setCampaigns(await res.json());
    } catch {} finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { fetch('/api/clients').then(r => r.ok ? r.json() : []).then(setClients).catch(() => {}); }, []);

  function openPanel(campaignId: string, dispatchNow: boolean) {
    setPanelSelectedId(campaignId);
    setAutoDispatchDate(dispatchNow ? new Date().toISOString().slice(0, 10) : null);
    setTab('painel');
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/40 px-6 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/integracoes')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" /> Integrações
          </button>
          <span className="text-muted-foreground">/</span>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a1a2e] border border-border"><span className="text-xs font-bold text-[#00a8ff]">LL</span></div>
            <div>
              <p className="text-sm font-bold">Leadlovers</p>
              <p className="text-xs text-muted-foreground">Campanhas de contatos por cliente</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 flex gap-1 rounded-xl border border-border bg-card/40 p-1 max-w-md">
          {TABS.map(t => {
            const Icon = t.icon; const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${active ? 'bg-primary text-black shadow' : 'text-muted-foreground hover:text-foreground hover:bg-card/60'}`}>
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : tab === 'campanhas' ? (
          <CampanhasTab campaigns={campaigns} clients={clients} onRefresh={loadData} onOpenPanel={openPanel} />
        ) : (
          <PainelTab campaigns={campaigns} selectedId={panelSelectedId} autoDispatchDate={autoDispatchDate} onConsumeAutoDispatch={() => setAutoDispatchDate(null)} onRefresh={loadData} />
        )}
      </div>
    </div>
  );
}
