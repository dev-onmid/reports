'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, Link2, Loader2, Plug, RefreshCw, Trash2, Wand2, XCircle, ListTodo, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { callerHeaders } from '@/lib/auth-store';

// ─── Types ───────────────────────────────────────────────────────────────────

type Client = { id: string; name: string };

type Connection = {
  id: string;
  name: string;
  token_masked: string;
  workspace_id: string | null;
  workspace_name: string | null;
  user_name: string | null;
  user_email: string | null;
  updated_at: string;
};

type ClickupList = { id: string; name: string; task_count?: number | null };

type Hierarchy = {
  team: { id: string; name: string };
  spaces: {
    id: string;
    name: string;
    folders: { id: string; name: string; lists: ClickupList[] }[];
    lists: ClickupList[];
  }[];
};

type Link = {
  client_id: string;
  list_id: string;
  list_name: string | null;
  folder_name: string | null;
  space_name: string | null;
};

/** Uma lista do ClickUp achatada com o caminho até ela, pra popular o seletor. */
type FlatList = { id: string; name: string; space: string; folder: string | null; path: string };

type Task = {
  id: string;
  name: string;
  url: string;
  status?: { status: string; color: string } | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CARD = 'rounded-[var(--radius)] border border-border bg-card p-6';
const SELECT = 'h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm font-medium text-foreground outline-none focus:border-primary/60';

function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...callerHeaders() };
}

function flattenLists(h: Hierarchy | null): FlatList[] {
  if (!h) return [];
  const out: FlatList[] = [];
  for (const space of h.spaces) {
    for (const list of space.lists) {
      out.push({ id: list.id, name: list.name, space: space.name, folder: null, path: `${space.name} › ${list.name}` });
    }
    for (const folder of space.folders) {
      for (const list of folder.lists) {
        out.push({
          id: list.id, name: list.name, space: space.name, folder: folder.name,
          path: `${space.name} › ${folder.name} › ${list.name}`,
        });
      }
    }
  }
  return out;
}

/** Tira acento, caixa e pontuação pra casar "Panino'77" com "Panino 77". */
function normalizeName(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ClickUpIntegrationPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [links, setLinks] = useState<Record<string, Link>>({});
  const [savingLink, setSavingLink] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [probeClient, setProbeClient] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeTasks, setProbeTasks] = useState<Task[] | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  const flatLists = useMemo(() => flattenLists(hierarchy), [hierarchy]);
  const connected = !!connection;

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/clickup/config', { headers: callerHeaders() });
      const data = await res.json();
      setConnection(data?.connection ?? null);
    } catch {
      setConnection(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLinks = useCallback(async () => {
    try {
      const res = await fetch('/api/clickup/links', { headers: callerHeaders() });
      const rows = await res.json();
      if (!Array.isArray(rows)) return;
      setLinks(Object.fromEntries((rows as Link[]).map((r) => [r.client_id, r])));
    } catch { /* tela degrada sem vínculos */ }
  }, []);

  const loadHierarchy = useCallback(async () => {
    setLoadingTree(true);
    try {
      const res = await fetch('/api/clickup/hierarchy', { headers: callerHeaders() });
      const data = await res.json();
      if (data?.error) { setBanner({ type: 'err', msg: data.error }); setHierarchy(null); return; }
      setHierarchy(data as Hierarchy);
    } catch {
      setBanner({ type: 'err', msg: 'Falha ao carregar o workspace do ClickUp' });
    } finally {
      setLoadingTree(false);
    }
  }, []);

  useEffect(() => { void loadConfig(); }, [loadConfig]);
  useEffect(() => {
    fetch('/api/clients', { headers: callerHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setClients(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!connected) return;
    void loadLinks();
    void loadHierarchy();
  }, [connected, loadLinks, loadHierarchy]);

  async function handleConnect() {
    if (!token.trim()) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch('/api/clickup/config', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ api_token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setBanner({ type: 'err', msg: data?.error ?? 'Falha ao conectar' }); return; }
      setConnection(data.connection);
      setToken('');
      setBanner({ type: 'ok', msg: `Conectado como ${data.connection?.user_name ?? 'usuário do ClickUp'}.` });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setBanner(null);
    try {
      const res = await fetch('/api/clickup/config', { method: 'PUT', headers: jsonHeaders(), body: '{}' });
      const data = await res.json();
      setBanner(data?.ok
        ? { type: 'ok', msg: `Conexão ok — ${data.user?.username ?? ''} · ${data.teams?.length ?? 0} workspace(s).` }
        : { type: 'err', msg: data?.error ?? 'Falha no teste' });
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Desconectar o ClickUp? Os vínculos de cliente ↔ lista também serão apagados.')) return;
    await fetch('/api/clickup/config', { method: 'DELETE', headers: callerHeaders() });
    setConnection(null);
    setHierarchy(null);
    setLinks({});
    setBanner(null);
  }

  async function saveLink(clientId: string, listId: string) {
    setSavingLink(clientId);
    try {
      if (!listId) {
        await fetch(`/api/clickup/links?client_id=${encodeURIComponent(clientId)}`, {
          method: 'DELETE', headers: callerHeaders(),
        });
        setLinks((prev) => { const next = { ...prev }; delete next[clientId]; return next; });
        return;
      }
      const list = flatLists.find((l) => l.id === listId);
      const payload = {
        client_id: clientId, list_id: listId,
        list_name: list?.name, folder_name: list?.folder ?? undefined, space_name: list?.space,
      };
      const res = await fetch('/api/clickup/links', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload) });
      if (!res.ok) { setBanner({ type: 'err', msg: 'Não foi possível salvar o vínculo' }); return; }
      setLinks((prev) => ({
        ...prev,
        [clientId]: {
          client_id: clientId, list_id: listId,
          list_name: list?.name ?? null, folder_name: list?.folder ?? null, space_name: list?.space ?? null,
        },
      }));
    } finally {
      setSavingLink(null);
    }
  }

  /** Casa cliente com lista de mesmo nome — as listas do ClickUp já se chamam como os clientes. */
  async function autoMatch() {
    const byName = new Map<string, FlatList>();
    for (const l of flatLists) {
      const key = normalizeName(l.name);
      if (!byName.has(key)) byName.set(key, l);
    }
    const pending = clients
      .filter((c) => !links[c.id])
      .map((c) => ({ client: c, list: byName.get(normalizeName(c.name)) }))
      .filter((p): p is { client: Client; list: FlatList } => !!p.list);

    if (!pending.length) { setBanner({ type: 'err', msg: 'Nenhum cliente novo casou com uma lista pelo nome.' }); return; }

    setSavingLink('__all__');
    try {
      const res = await fetch('/api/clickup/links', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          links: pending.map(({ client, list }) => ({
            client_id: client.id, list_id: list.id,
            list_name: list.name, folder_name: list.folder ?? undefined, space_name: list.space,
          })),
        }),
      });
      if (!res.ok) { setBanner({ type: 'err', msg: 'Falha ao vincular automaticamente' }); return; }
      await loadLinks();
      setBanner({ type: 'ok', msg: `${pending.length} cliente(s) vinculados pelo nome.` });
    } finally {
      setSavingLink(null);
    }
  }

  async function probe() {
    if (!probeClient) return;
    setProbing(true);
    setProbeTasks(null);
    setProbeError(null);
    try {
      const res = await fetch(`/api/clickup/tasks?clientId=${encodeURIComponent(probeClient)}`, { headers: callerHeaders() });
      const data = await res.json();
      if (!res.ok) { setProbeError(data?.error ?? 'Falha ao puxar tarefas'); return; }
      setProbeTasks(data.tasks ?? []);
    } catch {
      setProbeError('Falha de rede');
    } finally {
      setProbing(false);
    }
  }

  const visibleClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q ? clients.filter((c) => c.name?.toLowerCase().includes(q)) : clients;
    return [...rows].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }, [clients, search]);

  const linkedCount = Object.keys(links).length;

  return (
    <div className="space-y-7">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => router.push('/integracoes')} aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">ClickUp</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Conexão com o seu workspace e o mapa de qual cliente vive em qual lista.
            </p>
          </div>
        </div>
        {connected && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/35 bg-primary/12 px-3 py-1 text-xs font-bold text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
          </span>
        )}
      </div>

      {banner && (
        <div className={`flex items-center gap-2 rounded-[var(--radius)] border px-4 py-3 text-sm font-medium ${
          banner.type === 'ok'
            ? 'border-primary/35 bg-primary/10 text-primary'
            : 'border-red-500/30 bg-red-500/10 text-red-400'
        }`}>
          {banner.type === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          <span>{banner.msg}</span>
          <button onClick={() => setBanner(null)} className="ml-auto text-xs opacity-70 hover:opacity-100">fechar</button>
        </div>
      )}

      {/* ── 1. Conexão ─────────────────────────────────────────────────────── */}
      <div className={CARD}>
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-primary" />
          <h2 className="font-heading text-sm uppercase tracking-wide text-foreground">Conexão</h2>
        </div>

        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </p>
        ) : connection ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Conta" value={connection.user_name ?? '—'} hint={connection.user_email ?? undefined} />
              <Field label="Workspace" value={connection.workspace_name ?? '—'} />
              <Field label="Token" value={connection.token_masked} hint="guardado no servidor" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Testar conexão
              </Button>
              <Button variant="outline" onClick={handleDisconnect} className="text-red-400 hover:text-red-300">
                <Trash2 className="mr-2 h-4 w-4" /> Desconectar
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              No ClickUp: foto do perfil → <strong className="text-foreground">Settings</strong> →{' '}
              <strong className="text-foreground">Apps</strong> → <strong className="text-foreground">API Token</strong> →
              {' '}Generate. Cole o token abaixo (começa com <code className="text-foreground">pk_</code>).
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="pk_..."
                type="password"
                className="max-w-md flex-1"
              />
              <Button onClick={handleConnect} disabled={saving || !token.trim()}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plug className="mr-2 h-4 w-4" />}
                Conectar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              O token é validado no ClickUp antes de salvar e nunca volta inteiro para o navegador.
            </p>
          </div>
        )}
      </div>

      {/* ── 2. Vínculo cliente ↔ lista ─────────────────────────────────────── */}
      {connected && (
        <div className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" />
              <h2 className="font-heading text-sm uppercase tracking-wide text-foreground">Cliente ↔ Lista</h2>
              <span className="rounded-md border border-border bg-background/60 px-2 py-0.5 text-xs font-bold text-muted-foreground">
                {linkedCount}/{clients.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={autoMatch} disabled={savingLink === '__all__' || !flatLists.length}>
                {savingLink === '__all__' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Vincular pelo nome
              </Button>
              <Button variant="outline" size="sm" onClick={loadHierarchy} disabled={loadingTree}>
                {loadingTree ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Recarregar listas
              </Button>
            </div>
          </div>

          <p className="mt-3 text-sm text-muted-foreground">
            É esse mapa que qualquer envio futuro consulta para saber onde a tarefa deve nascer.
            Cliente sem lista é simplesmente ignorado.
          </p>

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente..."
            className="mt-4 max-w-sm"
          />

          <div className="mt-4 max-h-[420px] overflow-auto rounded-[var(--radius)] border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-border">Cliente</th>
                  <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-border">Lista no ClickUp</th>
                </tr>
              </thead>
              <tbody>
                {visibleClients.map((client) => {
                  const link = links[client.id];
                  return (
                    <tr key={client.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-2">
                        <span className="font-semibold text-foreground">{client.name}</span>
                        {link && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-primary">
                            <CheckCircle2 className="h-3 w-3" />
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <select
                            className={SELECT}
                            value={link?.list_id ?? ''}
                            disabled={savingLink === client.id || !flatLists.length}
                            onChange={(e) => void saveLink(client.id, e.target.value)}
                          >
                            <option value="">— sem vínculo —</option>
                            {flatLists.map((l) => (
                              <option key={l.id} value={l.id}>{l.path}</option>
                            ))}
                          </select>
                          {savingLink === client.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!visibleClients.length && (
                  <tr><td colSpan={2} className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum cliente encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 3. Teste de leitura ────────────────────────────────────────────── */}
      {connected && (
        <div className={CARD}>
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-primary" />
            <h2 className="font-heading text-sm uppercase tracking-wide text-foreground">Teste de leitura</h2>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Puxa as tarefas da lista vinculada — prova que o caminho cliente → ClickUp está de pé.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select className={`${SELECT} max-w-xs`} value={probeClient} onChange={(e) => setProbeClient(e.target.value)}>
              <option value="">Escolha um cliente vinculado…</option>
              {visibleClients.filter((c) => links[c.id]).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <Button variant="outline" onClick={probe} disabled={!probeClient || probing}>
              {probing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Puxar tarefas
            </Button>
          </div>

          {probeError && <p className="mt-3 text-sm font-medium text-red-400">{probeError}</p>}
          {probeTasks && (
            probeTasks.length ? (
              <ul className="mt-4 space-y-2">
                {probeTasks.slice(0, 15).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-background/40 px-3 py-2">
                    <span className="truncate text-sm text-foreground">{t.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {t.status?.status && (
                        <span className="rounded-md px-2 py-0.5 text-xs font-bold" style={{ color: t.status.color, border: `1px solid ${t.status.color}55` }}>
                          {t.status.status}
                        </span>
                      )}
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" aria-label="Abrir no ClickUp">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Conexão ok — a lista não tem tarefas abertas.</p>
            )
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-background/40 px-3 py-2">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
