'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  Upload, Webhook, Calendar, BarChart3, Plus, Trash2,
  CheckCircle2, XCircle, Clock, Play, Pause, RefreshCw,
  ChevronLeft, AlertCircle, Loader2, Check, X, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAuthSession } from '@/lib/auth-store';

// ─── Types ───────────────────────────────────────────────────────────────────

type ContactRow = {
  nome?: string; email?: string; telefone?: string; empresa?: string;
  [key: string]: unknown;
};

type ContactRecord = ContactRow & {
  id: string; status: 'pendente' | 'enviado' | 'erro';
  sent_at?: string; error_msg?: string; next_send_at?: string;
};

type ScheduleRule = {
  id?: string;
  date_from: string;
  date_to: string;
  qty_per_day: number;
  interval_minutes: number | null;
  send_time: string;
};

type Campaign = {
  id: string;
  name: string;
  webhook_url: string;
  machine_code?: string;
  email_sequence_code?: string;
  sequence_level_code?: string;
  auth_key?: string;
  status: 'rascunho' | 'ativa' | 'pausada' | 'concluida';
  total_contacts: number;
  total_sent: number;
  total_errors: number;
  rules: ScheduleRule[];
  created_at: string;
};

type DispatchLog = {
  date: string;
  sent: number;
  errors: number;
};


// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function businessDayCount(from: string, to: string): number {
  if (!from || !to) return 0;
  let count = 0;
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function calcTotalByRules(rules: ScheduleRule[]): number {
  return rules.reduce((sum, r) => sum + businessDayCount(r.date_from, r.date_to) * r.qty_per_day, 0);
}

function fmtDate(iso: string | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

// ─── Tab components ───────────────────────────────────────────────────────────

// ── Tab 1: Upload ─────────────────────────────────────────────────────────────
function UploadTab({
  campaigns, onContactsUploaded,
}: {
  campaigns: Campaign[];
  onContactsUploaded: () => void;
}) {
  const userId = getAuthSession()?.userId ?? null;

  const [rows, setRows] = useState<ContactRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function parseFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        if (json.length === 0) { setError('Planilha vazia ou sem linhas válidas'); return; }
        setHeaders(Object.keys(json[0]));
        setRows(json as ContactRow[]);
        setError('');
        setSaved(false);
      } catch {
        setError('Não foi possível ler o arquivo. Verifique se é .xlsx ou .xls');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  async function saveContacts() {
    if (!rows.length) return;
    if (!campaignId) { setError('Selecione uma campanha para vincular os contatos'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/leadlovers/contacts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-onmid-user-id': userId ?? '',
        },
        body: JSON.stringify({ contacts: rows, campaign_id: campaignId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Erro ao salvar');
      }
      const d = await res.json();
      setSaved(true);
      setRows([]);
      setHeaders([]);
      onContactsUploaded();
      setTimeout(() => setSaved(false), 3000);
      alert(`${d.inserted} contatos importados com sucesso!`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar contatos');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`
          flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed
          px-8 py-14 text-center transition-colors
          ${dragging
            ? 'border-primary bg-primary/5'
            : 'border-border bg-card/40 hover:border-primary/40 hover:bg-primary/5'
          }
        `}
      >
        <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-base font-semibold">Arraste sua planilha aqui</p>
        <p className="mt-1 text-sm text-muted-foreground">ou clique para selecionar — .xlsx / .xls</p>
        <p className="mt-3 text-xs text-muted-foreground">
          Colunas esperadas: <span className="text-foreground">Nome, Email, Telefone, Empresa</span> (outros campos aceitos)
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{rows.length} contatos carregados</p>
              <p className="text-xs text-muted-foreground mt-0.5">Colunas detectadas: {headers.join(', ')}</p>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="">Vincular à campanha…</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <Button onClick={saveContacts} disabled={saving || !campaignId}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {saving ? 'Salvando…' : 'Salvar contatos'}
              </Button>
            </div>
          </div>

          {/* Preview table */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card/60">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  {['nome', 'email', 'telefone', 'empresa'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground capitalize">{h}</th>
                  ))}
                  {headers.filter(h => !['nome','email','telefone','empresa'].includes(h.toLowerCase())).slice(0, 3).map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row, i) => {
                  const nome     = String(row.nome     ?? row.Nome     ?? row.NOME     ?? '');
                  const email    = String(row.email    ?? row.Email    ?? row.EMAIL    ?? '');
                  const telefone = String(row.telefone ?? row.Telefone ?? row.TELEFONE ?? row.phone ?? '');
                  const empresa  = String(row.empresa  ?? row.Empresa  ?? row.EMPRESA  ?? '');
                  const extraHeaders = headers.filter(h => !['nome','email','telefone','empresa'].includes(h.toLowerCase())).slice(0, 3);
                  return (
                    <tr key={i} className="border-b border-border/50 hover:bg-card/40">
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-400">
                          <Clock className="h-3 w-3" /> Pendente
                        </span>
                      </td>
                      <td className="px-4 py-2">{nome || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-2">{email || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-2">{telefone || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-2">{empresa || <span className="text-muted-foreground">—</span>}</td>
                      {extraHeaders.map(h => (
                        <td key={h} className="px-4 py-2 text-muted-foreground">{String(row[h] ?? '')}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 50 && (
              <p className="px-4 py-2.5 text-xs text-muted-foreground border-t border-border">
                … e mais {rows.length - 50} contatos (exibindo prévia dos primeiros 50)
              </p>
            )}
          </div>
        </>
      )}

      {saved && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          <CheckCircle2 className="h-4 w-4" /> Contatos importados com sucesso!
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Testar Webhook ─────────────────────────────────────────────────────
// Standalone tester — no persistence. Each campaign stores its own credentials.
function WebhookTab() {
  const userId = getAuthSession()?.userId ?? null;

  const [url, setUrl] = useState('');
  const [machineCode, setMachineCode] = useState('');
  const [emailSequenceCode, setEmailSequenceCode] = useState('');
  const [sequenceLevelCode, setSequenceLevelCode] = useState('1');
  const [authKey, setAuthKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; httpStatus: number; responseBody: string } | null>(null);
  const [error, setError] = useState('');

  async function test() {
    if (!url.trim()) return;
    setTesting(true); setTestResult(null); setError('');
    try {
      const res = await fetch('/api/leadlovers/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-onmid-user-id': userId ?? '' },
        body: JSON.stringify({
          webhook_url: url,
          machine_code: machineCode,
          email_sequence_code: emailSequenceCode,
          sequence_level_code: sequenceLevelCode,
          auth_key: authKey,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Erro ao testar');
      setTestResult(d);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <div className="rounded-xl border border-border bg-card/40 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Use este testador para validar as credenciais antes de criar uma campanha.
          Nenhum dado é salvo aqui — as configurações ficam em cada campanha.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">URL do Webhook</p>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://llapi.leadlovers.com/webapi/lead?token=…"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">MachineCode</p>
            <Input value={machineCode} onChange={(e) => setMachineCode(e.target.value)} placeholder="ex: 777360" />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">EmailSequenceCode</p>
            <Input value={emailSequenceCode} onChange={(e) => setEmailSequenceCode(e.target.value)} placeholder="ex: 1845595" />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">SequenceLevelCode</p>
            <Input value={sequenceLevelCode} onChange={(e) => setSequenceLevelCode(e.target.value)} placeholder="ex: 1" />
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Chave de Autorização (Bearer Token)</p>
          <Input
            value={authKey}
            onChange={(e) => setAuthKey(e.target.value)}
            placeholder="eyJ0eXAiOiJKV1Qi…"
            type="password"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <Button onClick={test} disabled={testing || !url.trim()} className="w-full">
        {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Webhook className="h-4 w-4 mr-2" />}
        {testing ? 'Testando…' : 'Testar conexão'}
      </Button>

      {testResult && (
        <div className={`rounded-xl border p-4 ${
          testResult.ok ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {testResult.ok
              ? <CheckCircle2 className="h-4 w-4 text-green-400" />
              : <XCircle className="h-4 w-4 text-red-400" />
            }
            <span className={`text-sm font-semibold ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.ok ? 'Conexão bem-sucedida' : 'Falha na conexão'}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">HTTP {testResult.httpStatus}</span>
          </div>
          {testResult.responseBody && (
            <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-black/30 p-3 text-xs text-muted-foreground">
              {testResult.responseBody.slice(0, 600)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab 3: Cronograma ──────────────────────────────────────────────────────────
function CronogramaTab({
  campaigns,
  onRefresh,
}: {
  campaigns: Campaign[];
  onRefresh: () => void;
}) {
  const userId = getAuthSession()?.userId ?? null;

  const [selectedId, setSelectedId] = useState<string>('');
  const [newCampaignName, setNewCampaignName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [newMachineCode, setNewMachineCode] = useState('');
  const [newEmailSequenceCode, setNewEmailSequenceCode] = useState('');
  const [newSequenceLevelCode, setNewSequenceLevelCode] = useState('1');
  const [newAuthKey, setNewAuthKey] = useState('');
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  const [rules, setRules] = useState<ScheduleRule[]>([]);
  const [savingRule, setSavingRule] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');

  // Edit campaign credentials
  const [showEditCampaign, setShowEditCampaign] = useState(false);
  const [editWebhook, setEditWebhook] = useState('');
  const [editMachineCode, setEditMachineCode] = useState('');
  const [editEmailSequenceCode, setEditEmailSequenceCode] = useState('');
  const [editSequenceLevelCode, setEditSequenceLevelCode] = useState('1');
  const [editAuthKey, setEditAuthKey] = useState('');
  const [editName, setEditName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [testingEdit, setTestingEdit] = useState(false);
  const [editTestResult, setEditTestResult] = useState<{ ok: boolean; httpStatus: number; responseBody: string } | null>(null);

  const campaign = campaigns.find(c => c.id === selectedId);

  // New rule form state
  const [newRule, setNewRule] = useState<ScheduleRule>({
    date_from: '', date_to: '', qty_per_day: 50,
    interval_minutes: null, send_time: '09:00',
  });

  // Contacts count for selected campaign
  const [contactCount, setContactCount] = useState(0);
  useEffect(() => {
    if (!selectedId || !userId) return;
    fetch(`/api/leadlovers/contacts?campaign_id=${selectedId}&limit=1`, {
      headers: { 'x-onmid-user-id': userId },
    })
      .then(r => r.json())
      .then(d => setContactCount(d.total ?? 0))
      .catch(() => {});
  }, [selectedId, userId]);

  useEffect(() => {
    if (!selectedId) { setRules([]); return; }
    const c = campaigns.find(x => x.id === selectedId);
    setRules(c?.rules ?? []);
    if (c) {
      setEditName(c.name ?? '');
      setEditWebhook(c.webhook_url ?? '');
      setEditMachineCode(c.machine_code ?? '');
      setEditEmailSequenceCode(c.email_sequence_code ?? '');
      setEditSequenceLevelCode(c.sequence_level_code ?? '1');
      setEditAuthKey(c.auth_key ?? '');
    }
    setShowEditCampaign(false);
  }, [selectedId, campaigns]);

  async function createCampaign() {
    if (!newCampaignName.trim() || !webhookUrl.trim()) return;
    setCreatingCampaign(true); setError('');
    try {
      const res = await fetch('/api/leadlovers/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-onmid-user-id': userId ?? '' },
        body: JSON.stringify({
          name: newCampaignName.trim(),
          webhook_url: webhookUrl.trim(),
          machine_code: newMachineCode.trim() || undefined,
          email_sequence_code: newEmailSequenceCode.trim() || undefined,
          sequence_level_code: newSequenceLevelCode.trim() || '1',
          auth_key: newAuthKey.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro');
      const c = await res.json();
      onRefresh();
      setSelectedId(c.id);
      setShowNewForm(false);
      setNewCampaignName('');
      setWebhookUrl('');
      setNewMachineCode('');
      setNewEmailSequenceCode('');
      setNewSequenceLevelCode('1');
      setNewAuthKey('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro');
    } finally {
      setCreatingCampaign(false);
    }
  }

  async function addRule() {
    if (!selectedId || !newRule.date_from || !newRule.date_to || !newRule.qty_per_day) return;
    setSavingRule(true); setError('');
    try {
      const res = await fetch(`/api/leadlovers/campaigns/${selectedId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-onmid-user-id': userId ?? '' },
        body: JSON.stringify(newRule),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro');
      const rule = await res.json();
      setRules(prev => [...prev, rule]);
      setNewRule({ date_from: '', date_to: '', qty_per_day: 50, interval_minutes: null, send_time: '09:00' });
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro');
    } finally {
      setSavingRule(false);
    }
  }

  async function deleteRule(ruleId: string) {
    if (!selectedId) return;
    try {
      await fetch(`/api/leadlovers/campaigns/${selectedId}/rules?rule_id=${ruleId}`, {
        method: 'DELETE',
        headers: { 'x-onmid-user-id': userId ?? '' },
      });
      setRules(prev => prev.filter(r => r.id !== ruleId));
      onRefresh();
    } catch {}
  }

  async function testCampaignWebhook() {
    if (!editWebhook.trim()) return;
    setTestingEdit(true); setEditTestResult(null);
    try {
      const res = await fetch('/api/leadlovers/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-onmid-user-id': userId ?? '' },
        body: JSON.stringify({
          webhook_url: editWebhook.trim(),
          machine_code: editMachineCode.trim() || undefined,
          email_sequence_code: editEmailSequenceCode.trim() || undefined,
          sequence_level_code: editSequenceLevelCode.trim() || undefined,
          auth_key: editAuthKey.trim() || undefined,
        }),
      });
      const d = await res.json();
      setEditTestResult(d);
    } catch (err: unknown) {
      setEditTestResult({ ok: false, httpStatus: 0, responseBody: err instanceof Error ? err.message : 'Erro de rede' });
    } finally {
      setTestingEdit(false);
    }
  }

  async function saveCampaignEdit() {
    if (!selectedId || !editWebhook.trim()) return;
    setSavingEdit(true); setError('');
    try {
      const res = await fetch(`/api/leadlovers/campaigns/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-onmid-user-id': userId ?? '' },
        body: JSON.stringify({
          name: editName.trim() || undefined,
          webhook_url: editWebhook.trim(),
          machine_code: editMachineCode.trim() || null,
          email_sequence_code: editEmailSequenceCode.trim() || null,
          sequence_level_code: editSequenceLevelCode.trim() || '1',
          auth_key: editAuthKey.trim() || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro');
      onRefresh();
      setShowEditCampaign(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSavingEdit(false);
    }
  }

  async function updateRuleSendTime(ruleId: string, sendTime: string) {
    if (!selectedId || !ruleId) return;
    try {
      const res = await fetch(`/api/leadlovers/campaigns/${selectedId}/rules?rule_id=${ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-onmid-user-id': userId ?? '' },
        body: JSON.stringify({ send_time: sendTime }),
      });
      if (!res.ok) return;
      const updated = await res.json();
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, send_time: updated.send_time } : r));
      onRefresh();
    } catch {}
  }

  async function activateCampaign(reschedule = false) {
    if (!selectedId) return;
    if (reschedule && !confirm('Reagendar todos os contatos pendentes a partir de hoje, usando os horários atuais das regras?')) return;
    setActivating(true); setError('');
    try {
      const res = await fetch(`/api/leadlovers/campaigns/${selectedId}/activate${reschedule ? '?reschedule=1' : ''}`, {
        method: 'POST',
        headers: { 'x-onmid-user-id': userId ?? '' },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Erro ao ativar');
      onRefresh();
      alert(reschedule
        ? `Reagendado! ${d.scheduled} contatos pendentes redistribuídos a partir de hoje.`
        : `Campanha ativada! ${d.scheduled} contatos agendados.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro');
    } finally {
      setActivating(false);
    }
  }

  const totalByRules = calcTotalByRules(rules);

  return (
    <div className="space-y-6">
      {/* Campaign selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm flex-1 max-w-xs"
        >
          <option value="">Selecione uma campanha…</option>
          {campaigns.map(c => (
            <option key={c.id} value={c.id}>{c.name} — {campaignStatusLabel(c.status)}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => setShowNewForm(f => !f)}>
          <Plus className="h-4 w-4" />
          Nova campanha
        </Button>
      </div>

      {/* New campaign form */}
      {showNewForm && (
        <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
          <p className="text-sm font-semibold">Nova campanha</p>
          <Input
            placeholder="Nome da campanha (ex: Fluxo Dia dos Pais)"
            value={newCampaignName}
            onChange={(e) => setNewCampaignName(e.target.value)}
          />
          <Input
            placeholder="URL do Webhook (https://llapi.leadlovers.com/webapi/lead?token=…)"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">MachineCode</p>
              <Input placeholder="ex: 777360" value={newMachineCode} onChange={(e) => setNewMachineCode(e.target.value)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">EmailSequenceCode</p>
              <Input placeholder="ex: 1845595" value={newEmailSequenceCode} onChange={(e) => setNewEmailSequenceCode(e.target.value)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">SequenceLevelCode</p>
              <Input placeholder="ex: 1" value={newSequenceLevelCode} onChange={(e) => setNewSequenceLevelCode(e.target.value)} />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Bearer Token (opcional)</p>
            <Input placeholder="eyJ0eXAiOi…" type="password" value={newAuthKey} onChange={(e) => setNewAuthKey(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Cada campanha aponta para um fluxo diferente no Leadlovers — mude a URL e o MachineCode para o fluxo desejado.
          </p>
          <div className="flex gap-2">
            <Button onClick={createCampaign} disabled={creatingCampaign || !newCampaignName.trim() || !webhookUrl.trim()}>
              {creatingCampaign ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Criar campanha
            </Button>
            <Button variant="ghost" onClick={() => setShowNewForm(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {selectedId && campaign && (
        <>
          {/* Status header */}
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold">{campaign.name}</p>
            {campaignStatusBadge(campaign.status)}
            <button
              onClick={() => setShowEditCampaign(v => !v)}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-card/60 transition-colors"
            >
              <Pencil className="h-3 w-3" />
              {showEditCampaign ? 'Cancelar' : 'Editar credenciais'}
            </button>
          </div>

          {/* Edit campaign credentials */}
          {showEditCampaign && (
            <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
              <p className="text-sm font-semibold">Editar campanha</p>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Nome</p>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nome da campanha" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">URL do Webhook</p>
                <Input value={editWebhook} onChange={(e) => setEditWebhook(e.target.value)} placeholder="https://llapi.leadlovers.com/webapi/lead?token=…" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">MachineCode</p>
                  <Input value={editMachineCode} onChange={(e) => setEditMachineCode(e.target.value)} placeholder="ex: 777360" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">EmailSequenceCode</p>
                  <Input value={editEmailSequenceCode} onChange={(e) => setEditEmailSequenceCode(e.target.value)} placeholder="ex: 1845595" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">SequenceLevelCode</p>
                  <Input value={editSequenceLevelCode} onChange={(e) => setEditSequenceLevelCode(e.target.value)} placeholder="ex: 1" />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Bearer Token</p>
                <Input type="password" value={editAuthKey} onChange={(e) => setEditAuthKey(e.target.value)} placeholder="eyJ0eXAiOi… (deixe em branco para manter)" />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={saveCampaignEdit} disabled={savingEdit || !editWebhook.trim()}>
                  {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Salvar alterações
                </Button>
                <Button variant="outline" onClick={testCampaignWebhook} disabled={testingEdit || !editWebhook.trim()}>
                  {testingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Webhook className="h-4 w-4" />}
                  Testar conexão
                </Button>
                <Button variant="ghost" onClick={() => { setShowEditCampaign(false); setEditTestResult(null); }}>Cancelar</Button>
              </div>

              {editTestResult && (
                <div className={`rounded-xl border p-3 ${editTestResult.ok ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
                  <div className="flex items-center gap-2">
                    {editTestResult.ok
                      ? <CheckCircle2 className="h-4 w-4 text-green-400" />
                      : <XCircle className="h-4 w-4 text-red-400" />
                    }
                    <span className={`text-sm font-semibold ${editTestResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                      {editTestResult.ok ? 'Conexão bem-sucedida' : 'Falha na conexão'}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">HTTP {editTestResult.httpStatus}</span>
                  </div>
                  {editTestResult.responseBody && (
                    <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-black/30 p-2 text-xs text-muted-foreground">
                      {editTestResult.responseBody.slice(0, 400)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Rules table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card/60">
                  {['De', 'Até', 'Qtd/dia', 'Intervalo', 'Horário', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, i) => (
                  <tr key={rule.id ?? i} className="border-b border-border/50 hover:bg-card/40">
                    <td className="px-4 py-2.5">{fmtDate(rule.date_from)}</td>
                    <td className="px-4 py-2.5">{fmtDate(rule.date_to)}</td>
                    <td className="px-4 py-2.5 font-medium">{rule.qty_per_day}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {rule.interval_minutes ? `${rule.interval_minutes} min` : 'Todos de uma vez'}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        defaultValue={rule.send_time ?? '09:00'}
                        onBlur={(e) => { if (rule.id && e.target.value !== (rule.send_time ?? '09:00')) updateRuleSendTime(rule.id, e.target.value); }}
                        className="h-8 w-24 rounded-lg border border-border bg-background px-2 text-xs"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      {rule.id && campaign.status === 'rascunho' && (
                        <button onClick={() => deleteRule(rule.id!)} className="text-muted-foreground hover:text-red-400 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}

                {/* New rule row */}
                {campaign.status === 'rascunho' && (
                  <tr className="bg-primary/5">
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        value={newRule.date_from}
                        onChange={(e) => setNewRule(r => ({ ...r, date_from: e.target.value }))}
                        className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        value={newRule.date_to}
                        onChange={(e) => setNewRule(r => ({ ...r, date_to: e.target.value }))}
                        className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        value={newRule.qty_per_day}
                        onChange={(e) => setNewRule(r => ({ ...r, qty_per_day: parseInt(e.target.value) || 1 }))}
                        className="h-8 w-20 rounded-lg border border-border bg-background px-2 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        placeholder="— (opcional)"
                        value={newRule.interval_minutes ?? ''}
                        onChange={(e) => setNewRule(r => ({ ...r, interval_minutes: e.target.value ? parseInt(e.target.value) : null }))}
                        className="h-8 w-28 rounded-lg border border-border bg-background px-2 text-xs placeholder:text-muted-foreground"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        value={newRule.send_time}
                        onChange={(e) => setNewRule(r => ({ ...r, send_time: e.target.value }))}
                        className="h-8 w-24 rounded-lg border border-border bg-background px-2 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={addRule}
                        disabled={savingRule || !newRule.date_from || !newRule.date_to}
                        className="flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-bold text-black disabled:opacity-40"
                      >
                        {savingRule ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Adicionar
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {rules.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhuma regra criada. Preencha a linha acima para adicionar a primeira.
              </p>
            )}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-card/60 p-4 text-center">
              <p className="text-2xl font-bold font-[family-name:var(--font-bebas)] tabular-nums">{totalByRules}</p>
              <p className="text-xs text-muted-foreground mt-1">Contatos no cronograma</p>
            </div>
            <div className="rounded-xl border border-border bg-card/60 p-4 text-center">
              <p className="text-2xl font-bold font-[family-name:var(--font-bebas)] tabular-nums">{contactCount}</p>
              <p className="text-xs text-muted-foreground mt-1">Contatos disponíveis</p>
            </div>
            <div className={`rounded-xl border p-4 text-center ${
              contactCount >= totalByRules
                ? 'border-green-500/30 bg-green-500/10'
                : 'border-red-500/30 bg-red-500/10'
            }`}>
              {contactCount >= totalByRules
                ? <CheckCircle2 className="mx-auto h-6 w-6 text-green-400" />
                : <XCircle className="mx-auto h-6 w-6 text-red-400" />
              }
              <p className="text-xs mt-1">
                {contactCount >= totalByRules
                  ? 'Base suficiente'
                  : `Faltam ${totalByRules - contactCount} contatos`
                }
              </p>
            </div>
          </div>

          {/* Activate */}
          {campaign.status === 'rascunho' && rules.length > 0 && (
            <Button
              onClick={() => activateCampaign(false)}
              disabled={activating || contactCount === 0 || totalByRules === 0}
              className="w-full h-12 text-base font-bold"
            >
              {activating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Play className="h-5 w-5 mr-2" />}
              Ativar campanha
            </Button>
          )}

          {campaign.status !== 'rascunho' && (
            <div className="flex gap-3 flex-wrap">
              {(campaign.status === 'ativa' || campaign.status === 'pausada') && rules.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => activateCampaign(true)}
                  disabled={activating}
                  title="Redistribui os contatos pendentes a partir de hoje com os horários atuais das regras"
                >
                  {activating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Reagendar pendentes
                </Button>
              )}
              {campaign.status === 'ativa' && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    await fetch(`/api/leadlovers/campaigns/${selectedId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', 'x-onmid-user-id': userId ?? '' },
                      body: JSON.stringify({ status: 'pausada' }),
                    });
                    onRefresh();
                  }}
                >
                  <Pause className="h-4 w-4 mr-2" /> Pausar
                </Button>
              )}
              {campaign.status === 'pausada' && (
                <Button
                  onClick={async () => {
                    await fetch(`/api/leadlovers/campaigns/${selectedId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', 'x-onmid-user-id': userId ?? '' },
                      body: JSON.stringify({ status: 'ativa' }),
                    });
                    onRefresh();
                  }}
                >
                  <Play className="h-4 w-4 mr-2" /> Retomar
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function campaignStatusLabel(s: Campaign['status']) {
  return { rascunho: 'Rascunho', ativa: 'Ativa', pausada: 'Pausada', concluida: 'Concluída' }[s] ?? s;
}

// ── Tab 4: Painel ──────────────────────────────────────────────────────────────
function PainelTab({
  campaigns,
  onRefresh,
}: {
  campaigns: Campaign[];
  onRefresh: () => void;
}) {
  const userId = getAuthSession()?.userId ?? null;

  const [selectedId, setSelectedId] = useState<string>('');
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [monitorResult, setMonitorResult] = useState<{ sent: number; errors: number } | null>(null);
  const monitorRef = useRef(false);

  const campaign = campaigns.find(c => c.id === selectedId);

  // Load contacts for selected campaign
  const loadContacts = useCallback(async () => {
    if (!selectedId || !userId) return;
    setLoadingContacts(true);
    try {
      const res = await fetch(`/api/leadlovers/contacts?campaign_id=${selectedId}&limit=200`, {
        headers: { 'x-onmid-user-id': userId },
      });
      const d = await res.json();
      setContacts(d.contacts ?? []);
    } catch {} finally {
      setLoadingContacts(false);
    }
  }, [selectedId, userId]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Monitoring loop — calls worker and updates contacts
  useEffect(() => {
    if (!monitoring || !selectedId || !userId) return;
    monitorRef.current = true;

    async function tick() {
      if (!monitorRef.current) return;
      try {
        const res = await fetch('/api/leadlovers/worker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-onmid-user-id': userId! },
          body: JSON.stringify({ campaign_id: selectedId, limit: 10 }),
        });
        const d = await res.json();
        setMonitorResult({ sent: d.sent, errors: d.errors });
        await loadContacts();
        onRefresh();
      } catch {}
      if (monitorRef.current) setTimeout(tick, 60_000);
    }

    tick();
    return () => { monitorRef.current = false; };
  }, [monitoring, selectedId, userId, loadContacts, onRefresh]);

  // Build day-by-day history from contacts
  const historyMap: Record<string, { sent: number; errors: number }> = {};
  for (const c of contacts) {
    if (c.sent_at) {
      const day = c.sent_at.slice(0, 10);
      historyMap[day] = historyMap[day] ?? { sent: 0, errors: 0 };
      if (c.status === 'enviado') historyMap[day].sent++;
      else if (c.status === 'erro') historyMap[day].errors++;
    }
  }
  const history: DispatchLog[] = Object.entries(historyMap)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const today = new Date().toISOString().slice(0, 10);
  const sentToday  = contacts.filter(c => c.status === 'enviado' && c.sent_at?.startsWith(today)).length;
  const pendingAll = contacts.filter(c => c.status === 'pendente').length;
  const errorsAll  = contacts.filter(c => c.status === 'erro').length;

  const errorContacts = contacts.filter(c => c.status === 'erro').slice(0, 20);

  return (
    <div className="space-y-6">
      {/* Campaign selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedId}
          onChange={(e) => { setSelectedId(e.target.value); setMonitoring(false); }}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm flex-1 max-w-xs"
        >
          <option value="">Selecione uma campanha…</option>
          {campaigns.map(c => (
            <option key={c.id} value={c.id}>{c.name} — {campaignStatusLabel(c.status)}</option>
          ))}
        </select>
        {selectedId && (
          <button
            onClick={loadContacts}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingContacts ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        )}
      </div>

      {selectedId && campaign && (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Enviados hoje',   value: sentToday,  color: 'text-green-400' },
              { label: 'Faltam',          value: pendingAll, color: 'text-yellow-400' },
              { label: 'Total enviados',  value: campaign.total_sent,   color: 'text-blue-400' },
              { label: 'Erros',           value: errorsAll,  color: 'text-red-400' },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-border bg-card/60 p-4 text-center">
                <p className={`text-3xl font-bold font-[family-name:var(--font-bebas)] tabular-nums ${s.color}`}>
                  {s.value}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          {campaign.total_contacts > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progresso</span>
                <span>{campaign.total_sent} / {campaign.total_contacts}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, (campaign.total_sent / campaign.total_contacts) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Monitor toggle */}
          {campaign.status === 'ativa' && (
            <div className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3">
              <div>
                <p className="text-sm font-semibold">
                  {monitoring ? 'Monitorando envios…' : 'Envio automático'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {monitoring
                    ? 'Enviando contatos agendados a cada minuto'
                    : 'Ative para processar contatos agendados automaticamente'
                  }
                </p>
                {monitorResult && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Último lote: <span className="text-green-400">{monitorResult.sent} enviados</span>
                    {monitorResult.errors > 0 && <span className="text-red-400 ml-1">{monitorResult.errors} erros</span>}
                  </p>
                )}
              </div>
              <button
                onClick={() => setMonitoring(m => !m)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  monitoring ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  monitoring ? 'translate-x-5.5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          )}

          {/* Day-by-day history */}
          {history.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-3">Histórico por dia</p>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-card/60">
                      {['Data', 'Enviados', 'Erros', 'Total'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(row => (
                      <tr key={row.date} className="border-b border-border/50 hover:bg-card/40">
                        <td className="px-4 py-2.5">{new Date(row.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
                        <td className="px-4 py-2.5 text-green-400 font-medium">{row.sent}</td>
                        <td className="px-4 py-2.5 text-red-400 font-medium">{row.errors}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{row.sent + row.errors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Error log */}
          {errorContacts.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-3">Alertas de erro</p>
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-red-500/20">
                      {['Nome', 'Email', 'Telefone', 'Erro'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {errorContacts.map(c => (
                      <tr key={c.id} className="border-b border-red-500/10">
                        <td className="px-4 py-2.5">{c.nome ?? '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{c.email ?? '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{c.telefone ?? '—'}</td>
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
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'upload' | 'webhook' | 'cronograma' | 'painel';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'upload',      label: 'Upload de Contatos', icon: Upload },
  { id: 'webhook',     label: 'Testar Webhook',     icon: Webhook },
  { id: 'cronograma',  label: 'Campanhas',          icon: Calendar },
  { id: 'painel',      label: 'Painel',             icon: BarChart3 },
];

export default function LeadloversPage() {
  const router = useRouter();
  const userId = getAuthSession()?.userId ?? null;

  const [tab, setTab] = useState<Tab>('upload');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/leadlovers/campaigns', { headers: { 'x-onmid-user-id': userId } });
      if (res.ok) setCampaigns(await res.json());
    } catch {} finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/40 px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/integracoes')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Integrações
          </button>
          <span className="text-muted-foreground">/</span>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a1a2e] border border-border">
              <span className="text-xs font-bold text-[#00a8ff]">LL</span>
            </div>
            <div>
              <p className="text-sm font-bold">Leadlovers</p>
              <p className="text-xs text-muted-foreground">Integração de contatos via webhook</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-border bg-card/40 p-1 mb-8">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? 'bg-primary text-black shadow'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/60'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {tab === 'upload' && (
              <UploadTab campaigns={campaigns} onContactsUploaded={loadData} />
            )}
            {tab === 'webhook' && (
              <WebhookTab />
            )}
            {tab === 'cronograma' && (
              <CronogramaTab campaigns={campaigns} onRefresh={loadData} />
            )}
            {tab === 'painel' && (
              <PainelTab campaigns={campaigns} onRefresh={loadData} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
