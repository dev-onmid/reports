"use client";

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Check, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useClients } from '@/lib/client-store';
import { useMetaAdsConnections } from '@/lib/meta-ads-store';
import { loadIntegrations, loadCachedAdAccounts, type CachedAdAccount } from '@/lib/integration-store';
import type { DashboardType } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

// Onboarding obrigatório de cliente novo: enquanto não concluir os 4 passos, o cliente
// fica em modo rascunho (onboarding_completed=false) e qualquer tentativa de abrir as
// abas normais dele (ver guard em clientes/[id]/page.tsx) volta pra cá, no passo certo.
const STEPS = [
  { n: 1, label: 'Dados básicos' },
  { n: 2, label: 'Conta de anúncios' },
  { n: 3, label: 'Pixel de mensagem' },
  { n: 4, label: 'Eventos' },
] as const;

type EventoCustom = { id: string; status_gatilho: string; meta_event_name: string | null; google_conversion_label: string | null; ativo: boolean };
type ConversionConfig = { meta_pixel_id: string | null; meta_access_token: string | null; meta_page_id: string | null };

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center gap-2">
          <div className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold',
            step === s.n ? 'border-primary bg-primary/20 text-primary' :
            step > s.n ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-400' :
            'border-border text-muted-foreground',
          )}>
            {step > s.n ? <Check className="h-4 w-4" /> : s.n}
          </div>
          <span className={cn('text-xs font-semibold', step === s.n ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</span>
          {i < STEPS.length - 1 && <div className="h-px w-8 bg-border" />}
        </div>
      ))}
    </div>
  );
}

function NovoClienteWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const existingId = searchParams.get('id');

  const { addClient, markOnboardingComplete } = useClients();
  const { getConnection, saveConnection } = useMetaAdsConnections();

  const [clientId, setClientId] = useState<string | null>(existingId);
  const [step, setStep] = useState(1);
  const [resumeChecked, setResumeChecked] = useState(!existingId);

  // ── Passo 1: dados básicos ──────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [dashType, setDashType] = useState<DashboardType>('leads');
  const [gestorId, setGestorId] = useState('');
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);

  useEffect(() => {
    fetch('/api/users').then(r => r.ok ? r.json() : []).then(setUsers).catch(() => {});
    fetch('/api/clients/categories').then(r => r.ok ? r.json() : []).then(setCategories).catch(() => {});
  }, []);

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;
    const res = await fetch('/api/clients/categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newCategoryName.trim() }),
    });
    if (res.ok) {
      const newCat = await res.json() as { id: string; name: string };
      setCategories(prev => [...prev, newCat]);
      setCategoryId(newCat.id);
      setNewCategoryName('');
      setShowNewCategory(false);
    }
  }

  function handleCreateClient() {
    if (!name.trim() || !categoryId) return;
    const cat = categories.find(c => c.id === categoryId);
    const client = addClient({
      name,
      segment: cat?.name ?? '',
      status: 'Ativo',
      gestor_id: gestorId || undefined,
      category_id: categoryId,
      dashboard_type: dashType,
      onboarding_completed: false,
    });
    setClientId(client.id);
    router.replace(`/clientes/novo?id=${client.id}`);
    setStep(2);
  }

  // ── Passo 2: conta de anúncios Meta ─────────────────────────────────────────
  const [globalMetaConnected, setGlobalMetaConnected] = useState<boolean | null>(null);
  const [cachedAccounts, setCachedAccounts] = useState<CachedAdAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  useEffect(() => {
    if (step !== 2) return;
    Promise.all([loadIntegrations(), loadCachedAdAccounts()]).then(([store, accounts]) => {
      setGlobalMetaConnected(store.meta.status === 'connected');
      setCachedAccounts(accounts);
      if (clientId) {
        const conn = getConnection(clientId);
        if (conn && conn.accountIds.length > 0) setSelectedAccountIds(conn.accountIds);
      }
    }).finally(() => setLoadingAccounts(false));
  }, [step, clientId, getConnection]);

  function toggleAccount(id: string) {
    setSelectedAccountIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function handleSaveAccounts() {
    if (!clientId || selectedAccountIds.length === 0) return;
    const firstName = cachedAccounts.find(a => a.id === selectedAccountIds[0])?.name ?? selectedAccountIds[0];
    saveConnection(clientId, firstName, selectedAccountIds);
    setStep(3);
  }

  // ── Passo 3: pixel de mensagem ───────────────────────────────────────────────
  const [pixelId, setPixelId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pageId, setPageId] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!clientId || step !== 3) return;
    fetch(`/api/clients/${clientId}/conversions`).then(r => r.ok ? r.json() as Promise<ConversionConfig> : null).then(cfg => {
      if (!cfg) return;
      setPixelId(cfg.meta_pixel_id ?? '');
      setAccessToken(cfg.meta_access_token ?? '');
      setPageId(cfg.meta_page_id ?? '');
    }).catch(() => {});
  }, [clientId, step]);

  async function handleTestPixel() {
    if (!clientId) return;
    setTesting(true);
    setTestResult(null);
    try {
      await fetch(`/api/clients/${clientId}/conversions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta_pixel_id: pixelId, meta_access_token: accessToken, meta_page_id: pageId, meta_ativo: true }),
      });
      const res = await fetch(`/api/clients/${clientId}/conversions/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'meta' }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; resultado?: { sucesso: boolean; resposta_body: string } };
      if (data.error) setTestResult({ ok: false, msg: data.error });
      else if (data.resultado) setTestResult({ ok: data.resultado.sucesso, msg: data.resultado.resposta_body?.slice(0, 200) ?? '' });
      else setTestResult({ ok: false, msg: 'Sem resposta da Meta.' });
    } catch {
      setTestResult({ ok: false, msg: 'Erro de conexão.' });
    } finally {
      setTesting(false);
    }
  }

  const pixelFieldsFilled = pixelId.trim() !== '' && accessToken.trim() !== '' && pageId.trim() !== '';

  // ── Passo 4: eventos customizados ───────────────────────────────────────────
  const [eventos, setEventos] = useState<EventoCustom[]>([]);
  const [novoStatus, setNovoStatus] = useState('');
  const [novoEventName, setNovoEventName] = useState('');
  const [savingEvento, setSavingEvento] = useState(false);

  useEffect(() => {
    if (!clientId || step !== 4) return;
    fetch(`/api/clients/${clientId}/conversions/eventos-custom`).then(r => r.ok ? r.json() as Promise<EventoCustom[]> : []).then(setEventos).catch(() => {});
  }, [clientId, step]);

  async function addEvento(statusGatilho: string, eventName: string) {
    if (!clientId || !statusGatilho.trim() || !eventName.trim()) return;
    setSavingEvento(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/conversions/eventos-custom`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_gatilho: statusGatilho.trim(), meta_event_name: eventName.trim(), ativo: true }),
      });
      if (res.ok) {
        const row = await res.json() as EventoCustom;
        setEventos(prev => [...prev.filter(e => e.status_gatilho !== row.status_gatilho), row]);
        setNovoStatus(''); setNovoEventName('');
      }
    } finally {
      setSavingEvento(false);
    }
  }

  function handleFinish() {
    if (!clientId) return;
    markOnboardingComplete(clientId);
    router.push(`/clientes/${clientId}`);
  }

  // ── Resume: ao voltar com ?id=, pula pro primeiro passo incompleto ──────────
  useEffect(() => {
    if (!existingId || resumeChecked) return;
    (async () => {
      const [accounts, cfgRes, eventosRes] = await Promise.all([
        loadCachedAdAccounts().then(() => getConnection(existingId)),
        fetch(`/api/clients/${existingId}/conversions`).then(r => r.ok ? r.json() as Promise<ConversionConfig> : null),
        fetch(`/api/clients/${existingId}/conversions/eventos-custom`).then(r => r.ok ? r.json() as Promise<EventoCustom[]> : []),
      ]);
      const step2Done = Boolean(accounts && accounts.accountIds.length > 0);
      const step3Done = Boolean(cfgRes?.meta_pixel_id && cfgRes?.meta_access_token && cfgRes?.meta_page_id);
      const step4Done = eventosRes.length > 0;
      if (!step2Done) setStep(2);
      else if (!step3Done) setStep(3);
      else if (!step4Done) setStep(4);
      else setStep(4);
      setResumeChecked(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingId]);

  if (!resumeChecked) {
    return <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">Carregando seu progresso...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="text-xl font-bold">Novo Cliente</h1>
        <p className="text-sm text-muted-foreground">Complete os 4 passos para liberar o acesso ao cliente.</p>
      </div>

      <div className="overflow-x-auto pb-2">
        <Stepper step={step} />
      </div>

      {/* PASSO 1 */}
      {step === 1 && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="space-y-1.5">
            <Label>Nome do cliente</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Clínica Nova Vida" />
          </div>
          <div className="space-y-1.5">
            <Label>Categoria <span className="text-destructive">*</span></Label>
            <select value={categoryId} onChange={e => { if (e.target.value === '__new__') setShowNewCategory(true); else { setCategoryId(e.target.value); setShowNewCategory(false); } }}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary">
              <option value="">Selecione...</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new__">+ Nova categoria</option>
            </select>
            {showNewCategory && (
              <div className="flex gap-2 pt-1.5">
                <Input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="Nome da categoria" />
                <Button size="sm" onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>Criar</Button>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de Dashboard</Label>
            <select value={dashType} onChange={e => setDashType(e.target.value as DashboardType)}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary">
              <option value="leads">Leads</option>
              <option value="branding">Branding</option>
              <option value="conversao">Conversão</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Gestor</Label>
            <select value={gestorId} onChange={e => setGestorId(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary">
              <option value="">Sem gestor</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </div>
          <div className="flex justify-between pt-2">
            <Link href="/clientes" className="text-xs text-muted-foreground hover:underline self-center">Cancelar</Link>
            <Button onClick={handleCreateClient} disabled={!name.trim() || !categoryId}>Avançar</Button>
          </div>
        </div>
      )}

      {/* PASSO 2 */}
      {step === 2 && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Selecione a conta de anúncios do Meta que pertence a este cliente.</p>
          {loadingAccounts && <p className="text-xs text-muted-foreground">Carregando contas...</p>}
          {!loadingAccounts && globalMetaConnected === false && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>A conta master de anúncios da agência ainda não foi conectada. Peça pra um admin conectar em{' '}
                <Link href="/integracoes" target="_blank" className="underline inline-flex items-center gap-0.5">Integrações <ExternalLink className="h-3 w-3" /></Link>, depois volte aqui.
              </span>
            </div>
          )}
          {!loadingAccounts && globalMetaConnected === true && cachedAccounts.length === 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Nenhuma conta de anúncio encontrada. Abra{' '}
                <Link href="/integracoes" target="_blank" className="underline inline-flex items-center gap-0.5">Integrações <ExternalLink className="h-3 w-3" /></Link>{' '}e atualize a lista de contas.
              </span>
            </div>
          )}
          {!loadingAccounts && cachedAccounts.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {cachedAccounts.map(a => (
                <button key={a.id} onClick={() => toggleAccount(a.id)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                    selectedAccountIds.includes(a.id) ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/40',
                  )}>
                  <p className="font-semibold">{a.name}</p>
                  <p className="text-muted-foreground font-mono">{a.id}</p>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(1)}>Voltar</Button>
            <Button onClick={handleSaveAccounts} disabled={selectedAccountIds.length === 0}>Avançar</Button>
          </div>
        </div>
      )}

      {/* PASSO 3 */}
      {step === 3 && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="rounded-lg border border-border bg-background/50 p-3 text-xs space-y-1.5">
            <p className="font-semibold">Antes de preencher, crie o Pixel de Mensagem no Meta:</p>
            <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
              <li>Abra o Gerenciador de Eventos e clique em &quot;Conectar dados&quot; → &quot;Mensagens&quot;</li>
              <li>Escolha a Página do Facebook usada nos anúncios deste cliente</li>
              <li>Anote o <strong>Page ID</strong> que aparece na confirmação</li>
              <li>Escolha &quot;Integração direta&quot; → gere o <strong>Token de acesso</strong></li>
              <li>O <strong>Pixel ID</strong> aparece em &quot;Conjuntos de dados&quot;, na configuração do dataset criado</li>
            </ol>
            <a href="https://business.facebook.com/events_manager2" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline">
              Abrir Gerenciador de Eventos <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="space-y-1.5">
            <Label>Pixel ID</Label>
            <Input value={pixelId} onChange={e => setPixelId(e.target.value)} placeholder="Ex: 1234567890123456" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label>Token de acesso</Label>
            <Input value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="EAAxxxxxxx..." className="font-mono" type="password" />
          </div>
          <div className="space-y-1.5">
            <Label>Page ID</Label>
            <Input value={pageId} onChange={e => setPageId(e.target.value)} placeholder="Ex: 1029384756" className="font-mono" />
          </div>
          <Button variant="outline" size="sm" onClick={handleTestPixel} disabled={testing || !pixelFieldsFilled} className="gap-1.5">
            {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null} Testar conexão
          </Button>
          {testResult && (
            <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
              testResult.ok ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-400' : 'border-red-400/30 bg-red-500/10 text-red-400')}>
              {testResult.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span className="font-mono break-all">{testResult.msg}</span>
            </div>
          )}
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(2)}>Voltar</Button>
            <Button onClick={() => setStep(4)} disabled={!pixelFieldsFilled}>Avançar</Button>
          </div>
        </div>
      )}

      {/* PASSO 4 */}
      {step === 4 && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Mapeie pelo menos o evento de lead para a Meta saber quando alguém vira um contato.</p>
          {eventos.length > 0 && (
            <div className="space-y-1.5">
              {eventos.map(ev => (
                <div key={ev.id} className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="font-mono">{ev.status_gatilho}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono font-semibold">{ev.meta_event_name}</span>
                </div>
              ))}
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => addEvento('Em Atendimento', 'LeadSubmitted')} disabled={savingEvento}>
            + Lead → LeadSubmitted (status &quot;Em Atendimento&quot;)
          </Button>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Status gatilho (Kanban)</Label>
              <Input value={novoStatus} onChange={e => setNovoStatus(e.target.value)} placeholder="Ex: Comprou" className="text-xs" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Evento Meta</Label>
              <Input value={novoEventName} onChange={e => setNovoEventName(e.target.value)} placeholder="Ex: Purchase" className="text-xs font-mono" />
            </div>
            <Button size="sm" onClick={() => addEvento(novoStatus, novoEventName)} disabled={savingEvento || !novoStatus.trim() || !novoEventName.trim()}>
              Adicionar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Dica: a venda (&quot;Purchase&quot;) já é enviada automaticamente quando o negócio é marcado como fechado no CRM — esse mapeamento aqui é só para outras etapas do funil que você queira reportar pra Meta.</p>
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(3)}>Voltar</Button>
            <Button onClick={handleFinish} disabled={eventos.length === 0}>Concluir cadastro</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NovoClientePage() {
  return (
    <Suspense fallback={<div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">Carregando...</div>}>
      <NovoClienteWizard />
    </Suspense>
  );
}
