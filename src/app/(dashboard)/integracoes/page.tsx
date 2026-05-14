"use client";

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Camera,
  ChevronDown,
  CheckCircle2,
  ExternalLink,
  LayoutGrid,
  Megaphone,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  GOOGLE_ADS_DEFAULT_MANAGER_ID,
  GOOGLE_ADS_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_EMAIL,
  GOOGLE_ADS_MANAGERS,
  type GoogleAdsAccount,
  type GoogleAdsIntegration,
  useGoogleAds,
} from '@/lib/google-ads-store';
import {
  fbLogin,
  loadCachedAdAccounts,
  saveCachedAdAccounts,
  setAccountEnabled,
  type CachedAdAccount,
} from '@/lib/integration-store';
import { useMetaConnections, type MetaConnection } from '@/lib/meta-connections-store';
import { useGoogleConnections, type GoogleConnection } from '@/lib/google-connections-store';

// ─── Account avatar helpers ───────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-pink-500',
];

function accountInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function accountColorClass(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Meta Graph API types ─────────────────────────────────────────────────────

type MetaAdAccount = CachedAdAccount;

type MetaPage = {
  id: string;
  name: string;
  category: string;
  fan_count?: number;
  picture?: { data: { url: string } };
};

type MetaInstagram = {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
};

type MetaAssets = {
  adAccounts: MetaAdAccount[];
  pages: MetaPage[];
  instagram: MetaInstagram[];
};

const AD_ACCOUNT_STATUS: Record<number, { label: string; color: string }> = {
  1: { label: 'Ativa',        color: 'text-emerald-400' },
  2: { label: 'Desativada',   color: 'text-red-400'     },
  3: { label: 'Não gasta',    color: 'text-yellow-400'  },
  7: { label: 'Cancelada',    color: 'text-red-400'     },
};

async function fetchMetaAssets(token: string): Promise<MetaAssets> {
  const base = 'https://graph.facebook.com/v21.0';

  async function fetchAll<T>(url: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = url;
    while (nextUrl) {
      const res = await fetch(nextUrl);
      const json = await res.json() as { data?: T[]; paging?: { next?: string }; error?: { message: string } };
      if (json.error) throw new Error(json.error.message);
      results.push(...(json.data ?? []));
      nextUrl = json.paging?.next ?? null;
    }
    return results;
  }

  const t = `access_token=${token}`;

  const [adAccounts, pages, businesses] = await Promise.allSettled([
    fetchAll<MetaAdAccount>(
      `${base}/me/adaccounts?limit=100&fields=id,name,account_status,currency,amount_spent&${t}`
    ),
    fetchAll<MetaPage & { instagram_business_account?: { id: string; username: string; name: string; followers_count: number; profile_picture_url: string } }>(
      `${base}/me/accounts?limit=100&fields=id,name,category,fan_count,picture,instagram_business_account{id,username,name,followers_count,profile_picture_url}&${t}`
    ),
    fetchAll<{ id: string; name: string }>(
      `${base}/me/businesses?fields=id,name&${t}`
    ),
  ]);

  function settled<T>(r: PromiseSettledResult<T[]>): T[] {
    return r.status === 'fulfilled' ? r.value : [];
  }

  const bmAccounts: MetaAdAccount[] = [];
  for (const bm of settled(businesses)) {
    const [owned, client] = await Promise.allSettled([
      fetchAll<MetaAdAccount>(`${base}/${bm.id}/owned_ad_accounts?limit=100&fields=id,name,account_status,currency,amount_spent&${t}`),
      fetchAll<MetaAdAccount>(`${base}/${bm.id}/client_ad_accounts?limit=100&fields=id,name,account_status,currency,amount_spent&${t}`),
    ]);
    for (const a of [...(owned.status === 'fulfilled' ? owned.value : []), ...(client.status === 'fulfilled' ? client.value : [])]) {
      if (!bmAccounts.some(x => x.id === a.id)) bmAccounts.push(a);
    }
  }

  const directAccounts = settled(adAccounts);
  const allAdAccounts = [...directAccounts];
  for (const a of bmAccounts) {
    if (!allAdAccounts.some(x => x.id === a.id)) allAdAccounts.push(a);
  }

  const pagesData = settled(pages);
  const instagramMap = new Map<string, MetaInstagram>();
  pagesData.forEach((p) => {
    if (p.instagram_business_account) {
      instagramMap.set(p.instagram_business_account.id, p.instagram_business_account);
    }
  });

  return {
    adAccounts: allAdAccounts,
    pages: pagesData.map(({ instagram_business_account: _, ...p }) => p) as MetaPage[],
    instagram: [...instagramMap.values()],
  };
}

// ─── Meta Assets Panel ────────────────────────────────────────────────────────

type AssetTab = 'adAccounts' | 'pages' | 'instagram';

function MetaAssetsPanel({ connection }: { connection: MetaConnection }) {
  const [assets, setAssets] = useState<MetaAssets | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<AssetTab>('adAccounts');
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const cached = await loadCachedAdAccounts();
      const existingEnabled: Record<string, boolean> = {};
      cached.forEach((a) => { existingEnabled[a.id] = a.enabled; });

      const data = await fetchMetaAssets(connection.accessToken);
      const finalAdAccounts = data.adAccounts.length > 0 ? data.adAccounts : cached;
      setAssets({ ...data, adAccounts: finalAdAccounts });

      const newMap: Record<string, boolean> = {};
      finalAdAccounts.forEach((a) => { newMap[a.id] = existingEnabled[a.id] ?? true; });
      setEnabledMap(newMap);

      if (data.adAccounts.length > 0) {
        try {
          await saveCachedAdAccounts(finalAdAccounts.map((a) => ({ ...a, enabled: newMap[a.id] ?? true })));
        } catch (saveErr) {
          console.error('Erro ao salvar cache de contas Meta:', saveErr);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Erro ao buscar ativos.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggleAccount(id: string) {
    const newEnabled = !(enabledMap[id] ?? true);
    setEnabledMap((prev) => ({ ...prev, [id]: newEnabled }));
    try {
      await setAccountEnabled(id, newEnabled);
    } catch {
      setEnabledMap((prev) => ({ ...prev, [id]: !newEnabled }));
    }
  }

  const tabs: { key: AssetTab; label: string; icon: React.ElementType; count: number }[] = [
    { key: 'adAccounts', label: 'Contas de Anúncio', icon: Megaphone,  count: assets?.adAccounts.length ?? 0 },
    { key: 'pages',      label: 'Páginas',           icon: Building2,  count: assets?.pages.length ?? 0      },
    { key: 'instagram',  label: 'Instagram',         icon: Camera,     count: assets?.instagram.length ?? 0  },
  ];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <p className="text-sm font-bold">Ativos acessíveis</p>
          <p className="text-xs text-muted-foreground mt-0.5">Perfil: {connection.userName}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      <div className="flex border-b border-border px-5 gap-1">
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-3 text-xs font-semibold border-b-2 transition-colors',
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {!loading && assets && (
              <span className={cn(
                'ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                tab === key ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
              )}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="p-5">
        {loading && (
          <div className="py-10 text-center">
            <RefreshCw className="w-5 h-5 text-muted-foreground/40 animate-spin mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Buscando ativos no Meta...</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Erro ao carregar ativos</p>
              <p className="mt-0.5 text-red-400/70">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && assets && (
          <>
            {tab === 'adAccounts' && (
              <div className="divide-y divide-border">
                {assets.adAccounts.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma conta de anúncio encontrada.</p>
                )}
                {assets.adAccounts.map((acc) => {
                  const statusInfo = AD_ACCOUNT_STATUS[acc.account_status] ?? { label: 'Desconhecido', color: 'text-muted-foreground' };
                  const spent = acc.amount_spent ? (Number(acc.amount_spent) / 100) : null;
                  const enabled = enabledMap[acc.id] ?? true;
                  return (
                    <div key={acc.id} className={cn('flex items-center gap-3 py-3 transition-opacity', !enabled && 'opacity-50')}>
                      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0', accountColorClass(acc.id))}>
                        {accountInitials(acc.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{acc.name}</p>
                        <p className="text-xs font-mono text-muted-foreground mt-0.5">{acc.id} · {acc.currency}</p>
                      </div>
                      <div className="text-right shrink-0 mr-2">
                        <p className={cn('text-xs font-bold', statusInfo.color)}>{statusInfo.label}</p>
                        {spent !== null && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {spent.toLocaleString('pt-BR', { style: 'currency', currency: acc.currency })} gasto
                          </p>
                        )}
                      </div>
                      <button
                        role="switch"
                        aria-checked={enabled}
                        title={enabled ? 'Desativar conta' : 'Ativar conta'}
                        onClick={() => handleToggleAccount(acc.id)}
                        className={cn(
                          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none',
                          enabled ? 'bg-primary' : 'bg-muted',
                        )}
                      >
                        <span className={cn(
                          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                          enabled ? 'translate-x-4' : 'translate-x-0',
                        )} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'pages' && (
              <div className="divide-y divide-border">
                {assets.pages.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma página encontrada.</p>
                )}
                {assets.pages.map((page) => (
                  <div key={page.id} className="flex items-center gap-3 py-3">
                    {page.picture?.data?.url ? (
                      <img src={page.picture.data.url} alt={page.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{page.name}</p>
                      <p className="text-xs text-muted-foreground">{page.category}</p>
                    </div>
                    {page.fan_count !== undefined && (
                      <p className="text-xs text-muted-foreground shrink-0">
                        {page.fan_count.toLocaleString('pt-BR')} seguidores
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab === 'instagram' && (
              <div className="divide-y divide-border">
                {assets.instagram.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma conta Instagram encontrada.</p>
                )}
                {assets.instagram.map((ig) => (
                  <div key={ig.id} className="flex items-center gap-3 py-3">
                    {ig.profile_picture_url ? (
                      <img src={ig.profile_picture_url} alt={ig.username} className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center shrink-0">
                        <Camera className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">@{ig.username}</p>
                      {ig.name && <p className="text-xs text-muted-foreground truncate">{ig.name}</p>}
                    </div>
                    {ig.followers_count !== undefined && (
                      <p className="text-xs text-muted-foreground shrink-0">
                        {ig.followers_count.toLocaleString('pt-BR')} seguidores
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Google Ads Assets Panel ──────────────────────────────────────────────────

type AccountFormState = { id: string; name: string; managerId: string; managerName: string; currency: string; status: 'Ativa' | 'Pausada'; balance: number };
const EMPTY_ACCOUNT_FORM: AccountFormState = { id: '', name: '', managerId: 'mcc-8493021188', managerName: 'MCC Onmid', currency: 'BRL', status: 'Ativa', balance: 0 };

function GoogleAdsAssetsPanel({ google }: { google: GoogleAdsIntegration }) {
  const { accounts, saveAccount, deleteAccount } = useGoogleAds();
  const managerName = GOOGLE_ADS_MANAGERS.find((m) => m.id === google.managerId)?.name ?? google.managerId;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AccountFormState>(EMPTY_ACCOUNT_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function handleAdd() {
    if (!form.id.trim() || !form.name.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveAccount({ ...form, managerId: form.managerId, managerName: GOOGLE_ADS_MANAGERS.find((m) => m.id === form.managerId)?.name ?? form.managerId });
      setForm(EMPTY_ACCOUNT_FORM);
      setShowForm(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(account: GoogleAdsAccount) {
    if (!window.confirm(`Remover a conta "${account.name}"?`)) return;
    await deleteAccount(account.id);
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <p className="text-sm font-bold">Contas Google Ads</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Conta: {google.email} · {managerName}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
            <Megaphone className="w-3.5 h-3.5" />
            {accounts.length} conta{accounts.length === 1 ? '' : 's'}
          </div>
          <Button size="sm" onClick={() => { setShowForm((v) => !v); setSaveError(''); }} className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="border-b border-border bg-muted/20 p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Nova conta Google Ads</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">ID da conta</label>
              <input
                placeholder="ex: 123-456-7890"
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Nome da conta</label>
              <input
                placeholder="ex: Cliente XYZ - Search"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">MCC / Gerenciadora</label>
              <select
                value={form.managerId}
                onChange={(e) => setForm((f) => ({ ...f, managerId: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {GOOGLE_ADS_MANAGERS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Moeda</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="BRL">BRL</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'Ativa' | 'Pausada' }))}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="Ativa">Ativa</option>
                  <option value="Pausada">Pausada</option>
                </select>
              </div>
            </div>
          </div>
          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setForm(EMPTY_ACCOUNT_FORM); }}>Cancelar</Button>
            <Button size="sm" onClick={handleAdd} disabled={saving || !form.id.trim() || !form.name.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? 'Salvando...' : 'Salvar conta'}
            </Button>
          </div>
        </div>
      )}

      <div className="p-5">
        {accounts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma conta adicionada. Use o botão &quot;Adicionar&quot; para cadastrar suas contas Google Ads.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">{account.name}</p>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0',
                      account.status === 'Ativa' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                    )}>
                      {account.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs font-mono text-muted-foreground truncate">
                    {account.id} · {account.currency} · {account.managerName}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(account)}
                  className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
                  title="Remover conta"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Logos ────────────────────────────────────────────────────────────────────

const LogoMeta = ({ size = 'sm' }: { size?: 'sm' | 'lg' }) => (
  <svg viewBox="0 0 24 24" className={size === 'lg' ? 'w-8 h-8' : 'w-7 h-7'} fill="none">
    <path
      d="M4.15 15.45c0-3.92 1.98-7.03 4.34-7.03 1.38 0 2.47 1.03 3.52 2.68 1.05-1.65 2.14-2.68 3.52-2.68 2.36 0 4.34 3.11 4.34 7.03 0 2.5-1.08 4.13-2.8 4.13-1.46 0-2.54-.95-4.96-5.18-2.42 4.23-3.5 5.18-4.96 5.18-1.72 0-3-1.63-3-4.13Z"
      stroke="#0668E1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    />
    <path
      d="M12.01 11.1c2.4 3.78 3.45 5.47 5.06 5.47.74 0 1.19-.53 1.19-1.23 0-2.32-1.28-4.58-2.72-4.58-1.05 0-1.85.94-3.53 3.64-1.68-2.7-2.48-3.64-3.53-3.64-1.44 0-2.72 2.26-2.72 4.58 0 .7.45 1.23 1.19 1.23 1.61 0 2.66-1.69 5.06-5.47Z"
      stroke="#0668E1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

const LogoGoogle = ({ size = 'sm' }: { size?: 'sm' | 'lg' }) => (
  <svg viewBox="0 0 24 24" className={size === 'lg' ? 'w-8 h-8' : 'w-7 h-7'}>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

const LogoGoogleMyBusiness = ({ size = 'sm' }: { size?: 'sm' | 'lg' }) => (
  <svg viewBox="0 0 24 24" className={size === 'lg' ? 'w-8 h-8' : 'w-7 h-7'}>
    <path fill="#4285F4" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
  </svg>
);

const LogoWebsite = ({ size = 'sm' }: { size?: 'sm' | 'lg' }) => (
  <svg viewBox="0 0 24 24" className={size === 'lg' ? 'w-8 h-8' : 'w-7 h-7'} fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

// ─── Meta Connect Modal ───────────────────────────────────────────────────────

const META_APP_ID = '4523722054582315';

function MetaConnectModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (conn: MetaConnection) => void;
}) {
  const { add } = useMetaConnections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const backdropRef = useRef<HTMLDivElement>(null);

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  async function handleFBLogin() {
    setError('');
    setLoading(true);
    try {
      const { accessToken, userId } = await fbLogin(META_APP_ID);

      const meRes = await fetch(
        `https://graph.facebook.com/v21.0/me?fields=id,name,picture&access_token=${encodeURIComponent(accessToken)}`
      );
      const me = await meRes.json() as { id: string; name: string; picture?: { data: { url: string } }; error?: { message: string } };
      if (me.error) throw new Error(me.error.message);

      const saved = await add({
        appId: META_APP_ID,
        accessToken,
        userId,
        userName: me.name,
        userPicture: me.picture?.data?.url,
        status: 'connected',
        label: '',
      });
      onConnected(saved);
    } catch (e) {
      const msg = e instanceof Error
        ? e.message
        : (e as { message?: string })?.message ?? JSON.stringify(e) ?? 'Erro ao conectar.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-sm">Conectar conta Meta</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-6 space-y-5">
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            Clique no botão abaixo e faça login com o Facebook que tem acesso às contas de anúncio. Você pode repetir o processo para conectar múltiplos perfis.
          </p>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          <Button
            onClick={handleFBLogin}
            disabled={loading}
            className="w-full h-11 font-bold text-sm bg-[#1877F2] hover:bg-[#1565C0] text-white disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Conectando...</span>
            ) : (
              <span className="flex items-center gap-2"><LogoMeta /> Entrar com Facebook</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Google Ads Connect Modal ─────────────────────────────────────────────────

function GoogleAdsConnectModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (google: GoogleAdsIntegration) => void;
}) {
  const { connect } = useGoogleAds();
  const [showGuide, setShowGuide] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const backdropRef = useRef<HTMLDivElement>(null);
  const managerName = GOOGLE_ADS_MANAGERS.find((manager) => manager.id === GOOGLE_ADS_DEFAULT_MANAGER_ID)?.name ?? 'MCC Onmid';

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  async function handleConnect() {
    setError('');
    setLoading(true);
    try {
      const saved = await connect({
        email: GOOGLE_ADS_LOGIN_EMAIL,
        managerId: GOOGLE_ADS_DEFAULT_MANAGER_ID,
        developerToken: GOOGLE_ADS_DEVELOPER_TOKEN,
      });
      onConnected(saved);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erro ao conectar Google Ads.';
      setError(`${message} Se persistir, confirme se a migration do Google Ads foi rodada no Supabase.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center">
              <LogoGoogle />
            </div>
            <div>
              <h2 className="font-bold text-sm">Conectar Google Ads</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Gmail ou MCC para contas dos clientes</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 leading-relaxed space-y-1">
            <p className="font-semibold">Como funciona</p>
            <p className="text-blue-300/80">Clique para usar a conta Google configurada no sistema. Depois, em cada cliente, escolha quais contas Google Ads alimentam dashboards e relatórios.</p>
          </div>

          <div className="grid gap-3 rounded-lg border border-border bg-background/70 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conta Google</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{GOOGLE_ADS_LOGIN_EMAIL}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">MCC configurada</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{managerName}</p>
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Developer token configurado</p>
            <p className="mt-1 text-sm font-mono text-foreground">••••••••••••••••••••</p>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setShowGuide((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/30 text-xs text-muted-foreground font-semibold hover:bg-muted/50 transition-colors"
            >
              <span>Checklist da API Google Ads</span>
              <ChevronDown className={cn('w-4 h-4 transition-transform', showGuide && 'rotate-180')} />
            </button>
            {showGuide && (
              <div className="px-3 py-3 bg-muted/10 text-xs text-muted-foreground leading-relaxed space-y-2">
                <ol className="list-decimal list-inside space-y-1">
                  <li>O Gmail precisa ter acesso ao Google Ads ou ao MCC.</li>
                  <li>A conta Google e a MCC já estão fixadas no sistema.</li>
                  <li>O developer token já está fixado no sistema.</li>
                </ol>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="outline" className="flex-1 text-xs font-bold uppercase h-10" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              onClick={handleConnect}
              disabled={loading}
              className="flex-1 h-10 font-bold text-xs uppercase bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Salvando...</span>
              ) : (
                'Conectar com Gmail'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Meta Connections Panel ───────────────────────────────────────────────────

function MetaConnectionsPanel({
  connections,
  onRemove,
  onAdd,
  selectedId,
  onSelect,
}: {
  connections: MetaConnection[];
  onRemove: (id: string) => Promise<void>;
  onAdd: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [assetTab, setAssetTab] = useState<AssetTab>('adAccounts');
  const [assets, setAssets] = useState<MetaAssets | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState('');
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});

  const selectedConn = connections.find((c) => c.id === selectedId) ?? connections[0] ?? null;

  async function loadAssets(conn: MetaConnection) {
    setAssetsLoading(true);
    setAssetsError('');
    setAssets(null);
    try {
      const cached = await loadCachedAdAccounts();
      const existingEnabled: Record<string, boolean> = {};
      cached.forEach((a) => { existingEnabled[a.id] = a.enabled; });

      const data = await fetchMetaAssets(conn.accessToken);
      const finalAdAccounts = data.adAccounts.length > 0 ? data.adAccounts : cached;
      setAssets({ ...data, adAccounts: finalAdAccounts });

      const newMap: Record<string, boolean> = {};
      finalAdAccounts.forEach((a) => { newMap[a.id] = existingEnabled[a.id] ?? true; });
      setEnabledMap(newMap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Erro ao buscar ativos.';
      setAssetsError(msg);
    } finally {
      setAssetsLoading(false);
    }
  }

  useEffect(() => {
    if (selectedConn) loadAssets(selectedConn);
  }, [selectedConn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggleAccount(id: string) {
    const newEnabled = !(enabledMap[id] ?? true);
    setEnabledMap((prev) => ({ ...prev, [id]: newEnabled }));
    try {
      await setAccountEnabled(id, newEnabled);
    } catch {
      setEnabledMap((prev) => ({ ...prev, [id]: !newEnabled }));
    }
  }

  async function handleRemove(conn: MetaConnection) {
    if (!window.confirm(`Desconectar a conta "${conn.userName}"?`)) return;
    await onRemove(conn.id);
  }

  const assetTabs: { key: AssetTab; label: string; icon: React.ElementType; count: number }[] = [
    { key: 'adAccounts', label: 'Contas de Anúncio', icon: Megaphone,  count: assets?.adAccounts.length ?? 0 },
    { key: 'pages',      label: 'Páginas',           icon: Building2,  count: assets?.pages.length ?? 0      },
    { key: 'instagram',  label: 'Instagram',         icon: Camera,     count: assets?.instagram.length ?? 0  },
  ];

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#1877F2]/10 border border-[#1877F2]/30 flex items-center justify-center shrink-0">
            <LogoMeta />
          </div>
          <div>
            <p className="text-sm font-bold">Contas Meta conectadas</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Gerencie suas contas de anúncios, páginas e perfis do Instagram conectados ao ONMID.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={onAdd}
          className="bg-emerald-500 hover:bg-emerald-600 text-white h-8 gap-1.5 text-xs font-semibold shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Adicionar conta
        </Button>
      </div>

      {/* 2-column layout */}
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        {/* LEFT: Contas conectadas */}
        <div className="p-5 space-y-3">
          <div>
            <p className="text-sm font-semibold">Contas conectadas ({connections.length})</p>
            <p className="text-xs text-muted-foreground mt-0.5">Clique em uma conta para ver seus ativos</p>
          </div>

          <div className="space-y-2">
            {connections.map((conn) => {
              const isSelected = conn.id === (selectedId ?? connections[0]?.id);
              return (
                <div
                  key={conn.id}
                  onClick={() => onSelect(conn.id)}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                    isSelected
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-border hover:border-border/80 hover:bg-muted/20',
                  )}
                >
                  {conn.userPicture ? (
                    <img src={conn.userPicture} alt={conn.userName} className="w-9 h-9 rounded-full shrink-0 object-cover" />
                  ) : (
                    <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-bold', accountColorClass(conn.id))}>
                      {accountInitials(conn.userName)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{conn.userName}</p>
                      {isSelected && (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                          Selecionada
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">{conn.userId ?? conn.id}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleRemove(conn); }}
                      className="ml-0.5 rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      title="Desconectar conta"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={onAdd}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar outra conta
          </button>
        </div>

        {/* RIGHT: Ativos da conta selecionada */}
        <div className="p-5 space-y-3">
          <div>
            <p className="text-sm font-semibold">Ativos da conta selecionada</p>
            {selectedConn && (
              <p className="text-xs text-muted-foreground mt-0.5">{selectedConn.userName}</p>
            )}
          </div>

          {/* Asset tabs */}
          <div className="flex border-b border-border gap-1 -mx-0">
            {assetTabs.map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => setAssetTab(key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap',
                  assetTab === key
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {key === 'adAccounts' && <span className="text-emerald-400">✓</span>}
                <Icon className="w-3.5 h-3.5" />
                {label}
                {!assetsLoading && assets && (
                  <span className={cn(
                    'ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    assetTab === key ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground',
                  )}>
                    {count}
                  </span>
                )}
              </button>
            ))}
            {!assetsLoading && assets && (
              <span className="ml-auto self-center text-[10px] text-muted-foreground pr-1">
                {assetTab === 'adAccounts' && `${assets.adAccounts.length} conta${assets.adAccounts.length === 1 ? '' : 's'} de anúncio`}
                {assetTab === 'pages' && `${assets.pages.length} página${assets.pages.length === 1 ? '' : 's'}`}
                {assetTab === 'instagram' && `${assets.instagram.length} perfil${assets.instagram.length === 1 ? '' : 'is'}`}
              </span>
            )}
          </div>

          {/* Asset content */}
          {assetsLoading && (
            <div className="py-8 text-center">
              <RefreshCw className="w-4 h-4 text-muted-foreground/40 animate-spin mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Buscando ativos...</p>
            </div>
          )}

          {!assetsLoading && assetsError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Erro ao carregar ativos</p>
                <p className="mt-0.5 text-red-400/70">{assetsError}</p>
              </div>
            </div>
          )}

          {!assetsLoading && !assetsError && assets && (
            <div className="space-y-1">
              {assetTab === 'adAccounts' && assets.adAccounts.map((acc) => {
                const statusInfo = AD_ACCOUNT_STATUS[acc.account_status] ?? { label: 'Desconhecido', color: 'text-muted-foreground' };
                const enabled = enabledMap[acc.id] ?? true;
                return (
                  <div key={acc.id} className={cn('flex items-center gap-3 p-3 rounded-lg bg-muted/20 transition-opacity', !enabled && 'opacity-50')}>
                    <div className="w-8 h-8 rounded-lg bg-muted/50 border border-border flex items-center justify-center shrink-0">
                      <Megaphone className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold truncate">{acc.name}</p>
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">Padrão</span>
                      </div>
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{acc.id} · {acc.currency}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <span className={cn('text-[10px] font-medium', statusInfo.color)}>{statusInfo.label}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleToggleAccount(acc.id)}
                        className={cn(
                          'relative inline-flex h-4 w-7 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                          enabled ? 'bg-emerald-500' : 'bg-muted',
                        )}
                      >
                        <span className={cn(
                          'pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
                          enabled ? 'translate-x-3' : 'translate-x-0',
                        )} />
                      </button>
                      <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                );
              })}

              {assetTab === 'pages' && assets.pages.map((page) => (
                <div key={page.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20">
                  {page.picture?.data?.url ? (
                    <img src={page.picture.data.url} alt={page.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{page.name}</p>
                    <p className="text-[10px] text-muted-foreground">{page.category}</p>
                  </div>
                  {page.fan_count !== undefined && (
                    <p className="text-[10px] text-muted-foreground shrink-0">{page.fan_count.toLocaleString('pt-BR')} seg.</p>
                  )}
                </div>
              ))}

              {assetTab === 'instagram' && assets.instagram.map((ig) => (
                <div key={ig.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20">
                  {ig.profile_picture_url ? (
                    <img src={ig.profile_picture_url} alt={ig.username} className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center shrink-0">
                      <Camera className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">@{ig.username}</p>
                    {ig.name && <p className="text-[10px] text-muted-foreground truncate">{ig.name}</p>}
                  </div>
                  {ig.followers_count !== undefined && (
                    <p className="text-[10px] text-muted-foreground shrink-0">{ig.followers_count.toLocaleString('pt-BR')} seg.</p>
                  )}
                </div>
              ))}

              {assetTab === 'adAccounts' && assets.adAccounts.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma conta de anúncio encontrada.</p>
              )}
              {assetTab === 'pages' && assets.pages.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma página encontrada.</p>
              )}
              {assetTab === 'instagram' && assets.instagram.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma conta Instagram encontrada.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Google Connections Panel ─────────────────────────────────────────────────

function GoogleConnectionsPanel({
  connections,
  onRemove,
  onAddGoogleAds,
  onAddGMB,
}: {
  connections: GoogleConnection[];
  onRemove: (id: string) => Promise<void>;
  onAddGoogleAds: () => void;
  onAddGMB: () => void;
}) {
  const gmbConns = connections.filter((c) => c.accountType === 'gmb');
  const adsConns = connections.filter((c) => c.accountType === 'google_ads');

  async function handleRemove(conn: GoogleConnection) {
    const label = conn.accountType === 'gmb' ? 'Google Meu Negócio' : 'Google Ads';
    if (!window.confirm(`Desconectar "${conn.email}" (${label})?`)) return;
    await onRemove(conn.id);
  }

  type AdsAccount = { id: string; name: string; status: string; isManager: boolean; mccId?: string };
  type GmbLocation = { locationId: string; accountId: string; name: string; address?: string; phone?: string; websiteUrl?: string; metrics?: { impressions: number; websiteClicks: number; callClicks: number; directionRequests: number } };

  function ConnectionRow({ conn }: { conn: GoogleConnection }) {
    const isAds = conn.accountType === 'google_ads';
    const isGmb = conn.accountType === 'gmb';

    const [adsAccounts, setAdsAccounts] = useState<AdsAccount[]>([]);
    const [gmbLocations, setGmbLocations] = useState<GmbLocation[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showItems, setShowItems] = useState(false);

    async function loadItems() {
      if ((isAds && adsAccounts.length > 0) || (isGmb && gmbLocations.length > 0)) {
        setShowItems((v) => !v); return;
      }
      setLoading(true);
      setError(null);
      try {
        if (isAds) {
          const res = await fetch(`/api/google/ads-accounts?connectionId=${conn.id}&period=THIS_MONTH`);
          const data = await res.json() as { error?: string } | AdsAccount[];
          if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Erro ao buscar contas');
          setAdsAccounts(data as AdsAccount[]);
        } else if (isGmb) {
          const res = await fetch(`/api/google/business-locations?connectionId=${conn.id}&noMetrics=true`);
          const data = await res.json() as { error?: string; detail?: string } | GmbLocation[];
          if (!res.ok) {
            const d = data as { error?: string; detail?: string };
            throw new Error([d.error, d.detail].filter(Boolean).join(' — '));
          }
          setGmbLocations(data as GmbLocation[]);
        }
        setShowItems(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro');
        setShowItems(true);
      } finally {
        setLoading(false);
      }
    }

    return (
      <div>
        <div className="flex items-center gap-3 py-3">
          {conn.picture ? (
            <img src={conn.picture} alt={conn.displayName} className="w-9 h-9 rounded-full shrink-0 object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-background border border-border flex items-center justify-center shrink-0">
              <LogoGoogle />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{conn.displayName || conn.email}</p>
            <p className="text-xs text-muted-foreground truncate">{conn.email}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              {conn.connectedAt ? new Date(conn.connectedAt).toLocaleDateString('pt-BR') : '—'}
              {isGmb && <span className="ml-2 font-bold text-[#34A853]">GMB</span>}
              {isAds && <span className="ml-2 font-bold text-[#4285F4]">Ads</span>}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {(isAds || isGmb) && (
              <button
                onClick={() => void loadItems()}
                disabled={loading}
                className="rounded-lg px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted transition-colors flex items-center gap-1"
              >
                {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ChevronDown className={cn('w-3 h-3 transition-transform', showItems && 'rotate-180')} />}
                {isGmb ? 'Ver locais' : 'Ver contas'}
              </button>
            )}
            <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
            <button onClick={() => void handleRemove(conn)} className="ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors" title="Desconectar conta">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showItems && (
          <div className="pl-12 pb-3 space-y-1.5">
            {error && <p className="text-xs text-red-400 break-all">{error}</p>}
            {isAds && !error && adsAccounts.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma conta encontrada.</p>
            )}
            {isAds && adsAccounts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs bg-muted/30 rounded-lg px-3 py-2">
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', a.status === 'ENABLED' ? 'bg-primary' : 'bg-muted-foreground')} />
                <span className="font-medium truncate flex-1">{a.name}</span>
                <span className="text-muted-foreground font-mono shrink-0">{a.id}</span>
                {a.isManager && <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded font-bold">MCC</span>}
                {a.mccId && !a.isManager && <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">via MCC</span>}
              </div>
            ))}
            {isGmb && !error && gmbLocations.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum local encontrado.</p>
            )}
            {isGmb && gmbLocations.map((loc) => (
              <div key={loc.locationId} className="text-xs bg-muted/30 rounded-lg px-3 py-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#34A853] shrink-0" />
                  <span className="font-medium truncate flex-1">{loc.name}</span>
                  <span className="text-muted-foreground font-mono shrink-0">{loc.locationId}</span>
                </div>
                {loc.address && <p className="text-muted-foreground pl-3.5 truncate">{loc.address}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-background border border-border flex items-center justify-center shrink-0">
            <LogoGoogle />
          </div>
          <div>
            <p className="text-sm font-bold">Contas Google conectadas</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {connections.length} conta{connections.length === 1 ? '' : 's'} — {gmbConns.length} GMB · {adsConns.length} Ads
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onAddGMB} variant="outline" className="h-8 gap-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" />
            GMB
          </Button>
          <Button size="sm" onClick={onAddGoogleAds} className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" />
            Google Ads
          </Button>
        </div>
      </div>

      <div className="px-5">
        {gmbConns.length > 0 && (
          <>
            <p className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <LogoGoogleMyBusiness />
              Google Meu Negócio
            </p>
            <div className="divide-y divide-border">
              {gmbConns.map((c) => <ConnectionRow key={c.id} conn={c} />)}
            </div>
          </>
        )}

        {adsConns.length > 0 && (
          <>
            <p className={cn('pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2', gmbConns.length > 0 ? 'pt-4 border-t border-border mt-2' : 'pt-4')}>
              <LogoGoogle />
              Google Ads
            </p>
            <div className="divide-y divide-border">
              {adsConns.map((c) => <ConnectionRow key={c.id} conn={c} />)}
            </div>
          </>
        )}

        {connections.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma conta Google conectada.
          </p>
        )}

        <div className="pb-4" />
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type IntegrationId = 'meta-ads' | 'google-ads' | 'google-my-business' | 'website';

type Integration = {
  id: IntegrationId;
  name: string;
  description: string;
  category: string;
  logo: React.ReactNode;
};

const BASE_INTEGRATIONS: Integration[] = [
  {
    id: 'meta-ads',
    name: 'Meta Ads',
    description: 'Meta Ads — sincronize campanhas, leads e métricas.',
    category: 'Anúncios',
    logo: <LogoMeta size="lg" />,
  },
  {
    id: 'google-ads',
    name: 'Google Ads',
    description: 'Importe campanhas, palavras-chave e conversões do Google Ads.',
    category: 'Anúncios',
    logo: <LogoGoogle size="lg" />,
  },
  {
    id: 'google-my-business',
    name: 'Google Meu Negócio',
    description: 'Avaliações, buscas e desempenho do perfil do Google.',
    category: 'Presença Digital',
    logo: <LogoGoogleMyBusiness size="lg" />,
  },
  {
    id: 'website',
    name: 'Website / Analytics',
    description: 'Conecte o Google Analytics ou GTM para rastrear visitas e conversões.',
    category: 'Presença Digital',
    logo: <LogoWebsite size="lg" />,
  },
];

const CATEGORIES = ['Todos', 'Anúncios', 'Presença Digital'];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IntegracoesPage() {
  const { connections: metaConns, loading: metaLoading, remove: removeMeta } = useMetaConnections();
  const { connections: googleConns, loading: googleLoading, remove: removeGoogle, reload: reloadGoogle } = useGoogleConnections();
  const { integration: googleAdsInfo, disconnect: disconnectGoogleAds } = useGoogleAds();

  const [activeCategory, setActiveCategory] = useState('Todos');
  const [metaModal, setMetaModal] = useState(false);
  const [googleModal, setGoogleModal] = useState(false);
  const [googleDisplayInfo, setGoogleDisplayInfo] = useState<GoogleAdsIntegration | null>(null);
  const [selectedMetaId, setSelectedMetaId] = useState<string | null>(null);
  const [oauthBanner, setOauthBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Connection status derived from hooks
  const metaConnected = !metaLoading && metaConns.length > 0;
  const googleAdsConnected = !googleLoading && googleConns.some((c) => c.accountType === 'google_ads');
  const gmbConnected = !googleLoading && googleConns.some((c) => c.accountType === 'gmb');

  // Handle OAuth callback URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('google_connected');
    const errParam = params.get('google_error');
    const connType = params.get('type');

    if (connected) {
      const label = connType === 'google_ads' ? 'Google Ads' : 'Google Meu Negócio';
      setOauthBanner({ type: 'success', msg: `${label} conectado com sucesso!` });
      void reloadGoogle();
      window.history.replaceState({}, '', '/integracoes');
    } else if (errParam) {
      setOauthBanner({ type: 'error', msg: `Erro ao conectar Google: ${decodeURIComponent(errParam)}` });
      window.history.replaceState({}, '', '/integracoes');
    }
  }, [reloadGoogle]);

  useEffect(() => {
    if (googleAdsInfo.status === 'connected') {
      setGoogleDisplayInfo(googleAdsInfo);
    }
  }, [googleAdsInfo]);

  async function handleGoogleAdsDisconnect() {
    try {
      await disconnectGoogleAds();
      setGoogleDisplayInfo(null);
    } catch (error) {
      console.error('Erro ao desconectar Google Ads:', error);
      alert(error instanceof Error ? error.message : 'Erro ao salvar desconexão no Supabase.');
    }
  }

  function openGoogleOAuth(type: 'gmb' | 'google_ads') {
    const popup = window.open(
      `/api/auth/google?type=${type}`,
      'google-oauth',
      'width=520,height=660,scrollbars=yes,resizable=yes'
    );

    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'google_oauth_success') {
        window.removeEventListener('message', handleMessage);
        popup?.close();
        void reloadGoogle();
        const label = event.data.accountType === 'gmb' ? 'Google Meu Negócio' : 'Google Ads';
        setOauthBanner({ type: 'success', msg: `${label} conectado com sucesso!` });
      } else if (event.data?.type === 'google_oauth_error') {
        window.removeEventListener('message', handleMessage);
        popup?.close();
        setOauthBanner({ type: 'error', msg: `Erro ao conectar Google: ${event.data.error}` });
      }
    }

    window.addEventListener('message', handleMessage);
  }

  function handleCardAction(id: IntegrationId) {
    if (id === 'meta-ads') {
      setMetaModal(true);
      return;
    }
    if (id === 'google-ads') {
      openGoogleOAuth('google_ads');
      return;
    }
    if (id === 'google-my-business') {
      openGoogleOAuth('gmb');
      return;
    }
  }

  const filtered =
    activeCategory === 'Todos'
      ? BASE_INTEGRATIONS
      : BASE_INTEGRATIONS.filter((i) => i.category === activeCategory);

  const totalConnected =
    (metaConnected ? 1 : 0) +
    (googleAdsConnected ? 1 : 0) +
    (gmbConnected ? 1 : 0);

  function isConnected(id: IntegrationId): boolean {
    if (id === 'meta-ads') return metaConnected;
    if (id === 'google-ads') return googleAdsConnected;
    if (id === 'google-my-business') return gmbConnected;
    return false;
  }

  function connectionCount(id: IntegrationId): number {
    if (id === 'meta-ads') return metaConns.length;
    if (id === 'google-ads') return googleConns.filter((c) => c.accountType === 'google_ads').length;
    if (id === 'google-my-business') return googleConns.filter((c) => c.accountType === 'gmb').length;
    return 0;
  }

  return (
    <>
      {metaModal && (
        <MetaConnectModal
          onClose={() => setMetaModal(false)}
          onConnected={() => setMetaModal(false)}
        />
      )}
      {googleModal && (
        <GoogleAdsConnectModal
          onClose={() => setGoogleModal(false)}
          onConnected={(g) => { setGoogleDisplayInfo(g); setGoogleModal(false); }}
        />
      )}

      <div className="space-y-6">

        {/* ── HEADER ─────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Integrações</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Conecte suas plataformas para sincronizar dados automaticamente e potencializar seus resultados.
            </p>
          </div>

          {/* Stats card — purple gradient */}
          <div className="shrink-0 rounded-xl bg-gradient-to-br from-violet-600/20 to-violet-500/10 border border-violet-500/20 px-5 py-4 flex items-center gap-4 min-w-[220px]">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
              <LayoutGrid className="w-5 h-5 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-2xl font-bold leading-none">{totalConnected} <span className="text-sm font-normal text-muted-foreground">de 4</span></p>
              <p className="text-xs text-muted-foreground mt-1">Plataformas conectadas</p>
              <button className="mt-2 text-[11px] text-violet-400 hover:text-violet-300 transition-colors font-medium">
                Ver status das integrações →
              </button>
            </div>
          </div>
        </div>

        {/* OAuth feedback banner */}
        {oauthBanner && (
          <div className={cn(
            'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm',
            oauthBanner.type === 'success'
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-red-500/20 bg-red-500/10 text-red-400',
          )}>
            <div className="flex items-center gap-2">
              {oauthBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              {oauthBanner.msg}
            </div>
            <button onClick={() => setOauthBanner(null)} className="opacity-60 hover:opacity-100 transition-opacity">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── FILTER TABS ─────────────────────────────────────────────────────── */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                'px-4 py-1.5 rounded-full text-xs font-semibold transition-colors',
                activeCategory === cat
                  ? 'bg-emerald-500 text-white'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border border-border'
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* ── INTEGRATION CARDS ───────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filtered.map((integration) => {
            const connected = isConnected(integration.id);
            const isWebsite = integration.id === 'website';
            const isGMB = integration.id === 'google-my-business';

            return (
              <div
                key={integration.id}
                className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4"
              >
                {/* Top: logo + status badge */}
                <div className="flex items-start justify-between">
                  <div className="w-14 h-14 rounded-xl bg-background border border-border flex items-center justify-center shadow-sm">
                    {integration.logo}
                  </div>
                  {connected ? (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-emerald-500/40 text-emerald-400 text-[11px] font-semibold">
                      <CheckCircle2 className="w-3 h-3" />
                      Conectado
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-border text-muted-foreground text-[11px] font-semibold">
                      <span className="w-2 h-2 rounded-full border border-muted-foreground" />
                      Desconectado
                    </span>
                  )}
                </div>

                {/* Name + category + description */}
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm">{integration.name}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      {integration.category}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {integration.description}
                  </p>
                </div>

                {/* Action button */}
                {isWebsite ? (
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground opacity-50 cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Conectar agora
                  </button>
                ) : connected && isGMB ? (
                  <button
                    onClick={() => handleCardAction(integration.id)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors"
                  >
                    Abrir painel
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                ) : connected ? (
                  <button
                    onClick={() => handleCardAction(integration.id)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted/30 transition-colors"
                  >
                    Gerenciar integração
                    <span className="text-muted-foreground">→</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleCardAction(integration.id)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted/30 transition-colors"
                  >
                    Conectar agora
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── META CONNECTIONS PANEL (new design) ─────────────────────────────── */}
        {(metaConnected || metaLoading) && (
          <MetaConnectionsPanel
            connections={metaConns}
            onRemove={removeMeta}
            onAdd={() => setMetaModal(true)}
            selectedId={selectedMetaId ?? metaConns[0]?.id ?? null}
            onSelect={setSelectedMetaId}
          />
        )}

        {/* Google connections panel */}
        {(googleConns.length > 0 || googleLoading) && (
          <GoogleConnectionsPanel
            connections={googleConns}
            onRemove={removeGoogle}
            onAddGoogleAds={() => openGoogleOAuth('google_ads')}
            onAddGMB={() => openGoogleOAuth('gmb')}
          />
        )}

        {/* Legacy Google Ads accounts panel — shown when google ads connected via old flow */}
        {googleDisplayInfo && googleDisplayInfo.status === 'connected' && (
          <GoogleAdsAssetsPanel google={googleDisplayInfo} />
        )}

        {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-violet-400 shrink-0" />
            <div>
              <p className="text-sm font-bold">Sincronização automática e segura</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Seus dados são sincronizados com segurança e atualizados automaticamente em segundo plano.
              </p>
            </div>
          </div>
          <a
            href="#"
            className="shrink-0 text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors whitespace-nowrap"
          >
            Saiba mais sobre integrações ↗
          </a>
        </div>

      </div>
    </>
  );
}
