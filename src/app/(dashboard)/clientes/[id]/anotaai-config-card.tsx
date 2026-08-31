"use client";

/**
 * Cadastro de lojas do Anota Aí — EXTRAÍDO do modal Configurar do cliente
 * (2026-08-21, consolidação pedida pelo Matheus: toda a configuração de
 * delivery mora num lugar só, a sub-aba Delivery da aba Integrações).
 * Mesmos endpoints e semântica do modal: /api/clients/{id}/anota-ai.
 */

import { useEffect, useState } from 'react';
import { Loader2, Pencil, PlugZap, Store, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type AnotaAiStore = {
  id: string;
  storeName: string;
  storeId: string;
  ifoodStoreId: string | null;
  integrationToken: string;
  active: boolean;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  lastTestAt: string | null;
};

const EMPTY_FORM = {
  id: '', storeName: '', storeId: '', ifoodStoreId: '', integrationToken: '', active: true,
};

function maskToken(token: string) {
  if (!token) return '—';
  if (token.length <= 14) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

export function AnotaAiConfigCard({ clientId, onChanged }: { clientId: string; onChanged?: () => void }) {
  const [stores, setStores] = useState<AnotaAiStore[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formAberto, setFormAberto] = useState(false);
  const [testando, setTestando] = useState<string | null>(null);

  // Testar é o que transforma "colar token" em algo verificável. Sem isso o
  // único sinal de credencial morta é a coleta em zero — que parece loja
  // parada, não integração quebrada.
  async function testar(store: AnotaAiStore) {
    setTestando(store.id);
    try {
      const res = await fetch(`/api/clients/${clientId}/anota-ai/test?storeId=${store.id}`, { method: 'POST' });
      const data = await res.json() as { status?: string; mensagem?: string; error?: string };
      setStores(prev => prev.map(s => s.id === store.id ? {
        ...s,
        lastTestStatus: data.status ?? 'erro',
        lastTestMessage: data.mensagem ?? data.error ?? 'Falha no teste.',
        lastTestAt: new Date().toISOString(),
      } : s));
    } catch {
      setStores(prev => prev.map(s => s.id === store.id ? {
        ...s, lastTestStatus: 'erro', lastTestMessage: 'Erro de rede ao testar.', lastTestAt: new Date().toISOString(),
      } : s));
    } finally {
      setTestando(null);
    }
  }

  useEffect(() => {
    fetch(`/api/clients/${clientId}/anota-ai`)
      .then(r => r.ok ? r.json() as Promise<AnotaAiStore[]> : [])
      .then(rows => setStores(Array.isArray(rows) ? rows : []))
      .catch(() => setStores([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  async function salvar() {
    setError('');
    if (!form.storeName.trim() || !form.storeId.trim() || !form.integrationToken.trim()) {
      setError('Preencha nome da loja, ID da loja e token.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/anota-ai`, {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({})) as AnotaAiStore & { error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? 'Erro ao salvar integração.');
        return;
      }
      setStores(prev => form.id ? prev.map(s => s.id === data.id ? data : s) : [...prev, data]);
      setForm(EMPTY_FORM);
      setFormAberto(false);
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  async function remover(store: AnotaAiStore) {
    if (!window.confirm(`Remover a loja "${store.storeName}" do Anota Aí?`)) return;
    await fetch(`/api/clients/${clientId}/anota-ai?storeId=${store.id}`, { method: 'DELETE' });
    setStores(prev => prev.filter(s => s.id !== store.id));
    if (form.id === store.id) setForm(EMPTY_FORM);
    onChanged?.();
  }

  function editar(store: AnotaAiStore) {
    setError('');
    setFormAberto(true);
    setForm({
      id: store.id,
      storeName: store.storeName,
      storeId: store.storeId,
      ifoodStoreId: store.ifoodStoreId ?? '',
      integrationToken: store.integrationToken,
      active: store.active,
    });
  }

  const campo = 'mt-1 w-full rounded-[var(--radius)] border border-border bg-surface-soft px-3 py-2 text-sm text-foreground';

  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-primary" />
          <h3 className="font-heading text-xl uppercase leading-none">Lojas Anota Aí</h3>
        </div>
        <button
          type="button"
          onClick={() => { setFormAberto(a => !a); setForm(EMPTY_FORM); setError(''); }}
          className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          {formAberto ? 'Fechar' : '+ Loja'}
        </button>
      </div>

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : stores.length === 0 && !formAberto ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nenhuma loja cadastrada. O ID da loja e a Chave de integração ficam no Anota AI em Configurações › Integrações.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {stores.map(store => (
            <li key={store.id} className="rounded-[var(--radius)] border border-border/60 bg-background/40 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', store.active ? 'bg-primary' : 'bg-muted-foreground')} />
                <span className="font-semibold">{store.storeName}</span>
                <span className="text-[11px] text-muted-foreground">
                  ID {store.storeId} · Token {maskToken(store.integrationToken)}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button" disabled={testando === store.id} onClick={() => void testar(store)}
                    title="Testar conexão com o Anota AI"
                    className="flex items-center gap-1 rounded border border-border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    {testando === store.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <PlugZap className="h-3.5 w-3.5" />}
                    Testar
                  </button>
                  <button type="button" onClick={() => editar(store)} className="rounded border border-border p-1.5 text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => void remover(store)} className="rounded border border-border p-1.5 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
              {store.lastTestMessage && (
                <p className={cn(
                  'mt-1.5 text-[11px] leading-snug',
                  store.lastTestStatus === 'ok' ? 'text-primary' : 'text-destructive',
                )}>
                  {store.lastTestStatus === 'ok' ? '✓ ' : '✕ '}{store.lastTestMessage}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {formAberto && (
        <div className="mt-3 space-y-3 rounded-[var(--radius)] border border-border/60 bg-background/40 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Nome da loja</span>
              <input value={form.storeName} onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))} className={campo} />
            </label>
            <label>
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">ID da loja</span>
              <input value={form.storeId} onChange={e => setForm(f => ({ ...f, storeId: e.target.value }))} className={campo} />
            </label>
            <label>
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">ID iFood (opcional)</span>
              <input value={form.ifoodStoreId} onChange={e => setForm(f => ({ ...f, ifoodStoreId: e.target.value }))} className={campo} />
            </label>
            <label>
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Token de integração</span>
              <input type="password" value={form.integrationToken} onChange={e => setForm(f => ({ ...f, integrationToken: e.target.value }))} className={campo} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            Loja ativa (coleta de pedidos ligada)
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="button" disabled={saving} onClick={() => void salvar()}
            className="rounded-[var(--radius)] bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-40"
          >
            {saving ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Adicionar loja'}
          </button>
        </div>
      )}
    </div>
  );
}
