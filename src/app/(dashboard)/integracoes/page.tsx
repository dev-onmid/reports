"use client";

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, ExternalLink, X, AlertCircle, ChevronDown, RefreshCw, Building2, Megaphone, Camera, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  GOOGLE_ADS_DEFAULT_MANAGER_ID,
  GOOGLE_ADS_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_EMAIL,
  type GoogleAdsAccount,
  GOOGLE_ADS_MANAGERS,
  useGoogleAds,
  type GoogleAdsIntegration,
} from '@/lib/google-ads-store';
import {
  loadIntegrations,
  readIntegrations,
  connectMeta,
  disconnectMeta,
  fbLogin,
  fbLogout,
  loadCachedAdAccounts,
  saveCachedAdAccounts,
  setAccountEnabled,
  type MetaIntegration,
  type CachedAdAccount,
} from '@/lib/integration-store';

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

  // Also fetch ad accounts via Business Manager (for users who access accounts through BM)
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

  // Merge /me/adaccounts with BM accounts, deduplicated
  const directAccounts = settled(adAccounts);
  const allAdAccounts = [...directAccounts];
  for (const a of bmAccounts) {
    if (!allAdAccounts.some(x => x.id === a.id)) allAdAccounts.push(a);
  }

  const pagesData = settled(pages);

  // Extract Instagram accounts linked to pages
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

function MetaAssetsPanel({ meta }: { meta: MetaIntegration }) {
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

      const data = await fetchMetaAssets(meta.accessToken);

      // Fall back to cached accounts if the live API returned none
      const finalAdAccounts = data.adAccounts.length > 0 ? data.adAccounts : cached;
      setAssets({ ...data, adAccounts: finalAdAccounts });

      const newMap: Record<string, boolean> = {};
      finalAdAccounts.forEach((a) => { newMap[a.id] = existingEnabled[a.id] ?? true; });
      setEnabledMap(newMap);

      if (data.adAccounts.length > 0) {
        await saveCachedAdAccounts(finalAdAccounts.map((a) => ({ ...a, enabled: newMap[a.id] ?? true })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao buscar ativos.');
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
    { key: 'instagram',  label: 'Instagram',         icon: Camera,  count: assets?.instagram.length ?? 0  },
  ];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <p className="text-sm font-bold">Ativos acessíveis</p>
          <p className="text-xs text-muted-foreground mt-0.5">Perfil: {meta.userName}</p>
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

      {/* Tabs */}
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

      {/* Content */}
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
            {/* Ad Accounts */}
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

            {/* Pages */}
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

            {/* Instagram */}
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

const LogoMeta = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none">
    <path
      d="M4.15 15.45c0-3.92 1.98-7.03 4.34-7.03 1.38 0 2.47 1.03 3.52 2.68 1.05-1.65 2.14-2.68 3.52-2.68 2.36 0 4.34 3.11 4.34 7.03 0 2.5-1.08 4.13-2.8 4.13-1.46 0-2.54-.95-4.96-5.18-2.42 4.23-3.5 5.18-4.96 5.18-1.72 0-3-1.63-3-4.13Z"
      stroke="#0668E1"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12.01 11.1c2.4 3.78 3.45 5.47 5.06 5.47.74 0 1.19-.53 1.19-1.23 0-2.32-1.28-4.58-2.72-4.58-1.05 0-1.85.94-3.53 3.64-1.68-2.7-2.48-3.64-3.53-3.64-1.44 0-2.72 2.26-2.72 4.58 0 .7.45 1.23 1.19 1.23 1.61 0 2.66-1.69 5.06-5.47Z"
      stroke="#0668E1"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const LogoGoogle = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

const LogoGoogleMyBusiness = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7">
    <path fill="#4285F4" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
  </svg>
);

const LogoWebsite = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

// ─── Meta Connect Modal (OAuth flow) ─────────────────────────────────────────

const META_APP_ID = '4523722054582315';

function MetaConnectModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (meta: MetaIntegration) => void;
}) {
  const [showGuide, setShowGuide] = useState(false);
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

      // Fetch user profile
      const meRes = await fetch(
        `https://graph.facebook.com/v21.0/me?fields=id,name,picture&access_token=${encodeURIComponent(accessToken)}`
      );
      const me = await meRes.json() as { id: string; name: string; picture?: { data: { url: string } }; error?: { message: string } };
      if (me.error) throw new Error(me.error.message);

      const data: Omit<MetaIntegration, 'status' | 'connectedAt'> = {
        appId: META_APP_ID,
        accessToken,
        userId,
        userName: me.name,
        userPicture: me.picture?.data?.url,
      };
      const savedMeta = await connectMeta(data);
      onConnected(savedMeta);
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
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center">
              <LogoMeta />
            </div>
            <div>
              <h2 className="font-bold text-sm">Conectar Meta Ads</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Login via Facebook — vale para todos os clientes</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* How it works */}
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 leading-relaxed space-y-1">
            <p className="font-semibold">Como funciona</p>
            <p className="text-blue-300/80">Você entra com o Facebook e o sistema acessa automaticamente as contas de anúncio, páginas e perfis Instagram que seu perfil tem permissão — igual ao Reportei e Dashgo.</p>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">App Meta configurado</p>
            <p className="mt-1 text-sm font-mono text-foreground">{META_APP_ID}</p>
          </div>

          {/* Guide accordion */}
          <div className="rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setShowGuide((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/30 text-xs text-muted-foreground font-semibold hover:bg-muted/50 transition-colors"
            >
              <span>Checklist da conexão</span>
              <ChevronDown className={cn('w-4 h-4 transition-transform', showGuide && 'rotate-180')} />
            </button>
            {showGuide && (
              <div className="px-3 py-3 bg-muted/10 text-xs text-muted-foreground leading-relaxed space-y-2">
                <ol className="list-decimal list-inside space-y-1">
                  <li>O App ID já está fixado no sistema.</li>
                  <li>Certifique-se que o domínio do sistema está liberado no app da Meta.</li>
                  <li>Use um perfil Facebook com permissão nas contas de anúncio dos clientes.</li>
                </ol>
                <p className="text-muted-foreground/60 pt-1">O app precisa estar no modo <strong>Desenvolvimento</strong> para funcionar no localhost.</p>
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
              onClick={handleFBLogin}
              disabled={loading}
              className="flex-1 h-10 font-bold text-xs uppercase bg-[#1877F2] hover:bg-[#1565C0] text-white disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Conectando...</span>
              ) : (
                <span className="flex items-center gap-2"><LogoMeta /> Entrar com Facebook</span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
                  <li>Para login real com Gmail, ainda precisamos configurar Client ID, Client Secret e callback no backend.</li>
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

// ─── Types ────────────────────────────────────────────────────────────────────

type IntegrationId = 'meta-ads' | 'google-ads' | 'google-my-business' | 'website';

type Integration = {
  id: IntegrationId;
  name: string;
  description: string;
  category: string;
  status: 'conectado' | 'desconectado';
  logo: React.ReactNode;
  hasCustomConnect?: boolean;
};

const BASE_INTEGRATIONS: Integration[] = [
  {
    id: 'meta-ads',
    name: 'Meta Ads',
    description: 'Meta Ads — sincronize campanhas, leads e métricas.',
    category: 'Anúncios',
    status: 'desconectado',
    logo: <LogoMeta />,
    hasCustomConnect: true,
  },
  {
    id: 'google-ads',
    name: 'Google Ads',
    description: 'Importe campanhas, palavras-chave e conversões do Google Ads.',
    category: 'Anúncios',
    status: 'desconectado',
    logo: <LogoGoogle />,
  },
  {
    id: 'google-my-business',
    name: 'Google Meu Negócio',
    description: 'Avaliações, buscas e desempenho do perfil do Google.',
    category: 'Presença Digital',
    status: 'desconectado',
    logo: <LogoGoogleMyBusiness />,
  },
  {
    id: 'website',
    name: 'Website / Analytics',
    description: 'Conecte o Google Analytics ou GTM para rastrear visitas e conversões.',
    category: 'Presença Digital',
    status: 'desconectado',
    logo: <LogoWebsite />,
  },
];

const CATEGORIES = ['Todos', 'Anúncios', 'Presença Digital'];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IntegracoesPage() {
  const [integrations, setIntegrations] = useState<Integration[]>(BASE_INTEGRATIONS);
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [metaModal, setMetaModal] = useState(false);
  const [googleModal, setGoogleModal] = useState(false);
  const [metaInfo, setMetaInfo] = useState<MetaIntegration | null>(null);
  const [googleDisplayInfo, setGoogleDisplayInfo] = useState<GoogleAdsIntegration | null>(null);
  const { integration: googleInfo, disconnect: disconnectGoogle } = useGoogleAds();

  // Load persisted Meta connection on mount
  useEffect(() => {
    loadIntegrations().then((store) => {
      if (store.meta.status === 'connected') {
        setMetaInfo(store.meta);
        setIntegrations((prev) =>
          prev.map((i) => (i.id === 'meta-ads' ? { ...i, status: 'conectado' } : i))
        );
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (googleInfo.status === 'connected') {
      setGoogleDisplayInfo(googleInfo);
      setIntegrations((prev) =>
        prev.map((i) => (i.id === 'google-ads' ? { ...i, status: 'conectado' } : i))
      );
    }
  }, [googleInfo]);

  function handleMetaConnected(meta: MetaIntegration) {
    setMetaInfo(meta);
    setMetaModal(false);
    setIntegrations((prev) =>
      prev.map((i) => (i.id === 'meta-ads' ? { ...i, status: 'conectado' } : i))
    );
  }

  async function handleMetaDisconnect() {
    await fbLogout().catch(() => {});
    try {
      await disconnectMeta();
      setMetaInfo(null);
      setIntegrations((prev) =>
        prev.map((i) => (i.id === 'meta-ads' ? { ...i, status: 'desconectado' } : i))
      );
    } catch (error) {
      console.error('Erro ao desconectar Meta Ads:', error);
      alert(error instanceof Error ? error.message : 'Erro ao salvar desconexão no Supabase.');
    }
  }

  function handleGoogleConnected(google: GoogleAdsIntegration) {
    setGoogleDisplayInfo(google);
    setGoogleModal(false);
    setIntegrations((prev) =>
      prev.map((i) => (i.id === 'google-ads' ? { ...i, status: 'conectado' } : i))
    );
  }

  async function handleGoogleDisconnect() {
    try {
      await disconnectGoogle();
      setGoogleDisplayInfo(null);
      setIntegrations((prev) =>
        prev.map((i) => (i.id === 'google-ads' ? { ...i, status: 'desconectado' } : i))
      );
    } catch (error) {
      console.error('Erro ao desconectar Google Ads:', error);
      alert(error instanceof Error ? error.message : 'Erro ao salvar desconexão no Supabase.');
    }
  }

  function toggleConnection(id: IntegrationId) {
    if (id === 'meta-ads') {
      const current = integrations.find((i) => i.id === 'meta-ads');
      if (current?.status === 'conectado') {
        handleMetaDisconnect();
      } else {
        setMetaModal(true);
      }
      return;
    }
    if (id === 'google-ads') {
      const current = integrations.find((i) => i.id === 'google-ads');
      if (current?.status === 'conectado') {
        handleGoogleDisconnect();
      } else {
        setGoogleModal(true);
      }
      return;
    }
    setIntegrations((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: i.status === 'conectado' ? 'desconectado' : 'conectado' }
          : i
      )
    );
  }

  const filtered =
    activeCategory === 'Todos'
      ? integrations
      : integrations.filter((i) => i.category === activeCategory);

  const connected = integrations.filter((i) => i.status === 'conectado').length;

  return (
    <>
      {metaModal && (
        <MetaConnectModal
          onClose={() => setMetaModal(false)}
          onConnected={handleMetaConnected}
        />
      )}
      {googleModal && (
        <GoogleAdsConnectModal
          onClose={() => setGoogleModal(false)}
          onConnected={handleGoogleConnected}
        />
      )}

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-heading tracking-wider uppercase">Integrações</h1>
            <p className="text-muted-foreground mt-1">
              Conecte suas plataformas para sincronizar dados automaticamente.
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-primary">
              {connected} de {integrations.length} conectadas
            </span>
          </div>
        </div>

        {/* Category filter */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
                activeCategory === cat
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-card hover:text-foreground'
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Integration cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((integration) => {
            const isConnected = integration.status === 'conectado';
            const isMeta = integration.id === 'meta-ads';
            const isGoogleAds = integration.id === 'google-ads';

            return (
              <div
                key={integration.id}
                className={cn(
                  'bg-card border rounded-xl p-5 flex flex-col gap-4 transition-colors',
                  isConnected ? 'border-primary/30' : 'border-border'
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 rounded-xl bg-background border border-border flex items-center justify-center shadow-sm">
                    {integration.logo}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isConnected ? (
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                    ) : (
                      <XCircle className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        'text-[10px] font-bold uppercase tracking-wider',
                        isConnected ? 'text-primary' : 'text-muted-foreground'
                      )}
                    >
                      {isConnected ? 'Conectado' : 'Desconectado'}
                    </span>
                  </div>
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm">{integration.name}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                      {integration.category}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {integration.description}
                  </p>

                  {/* Meta connected details */}
                  {isMeta && isConnected && metaInfo && (
                    <div className="mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/15 flex items-center gap-2.5">
                      {metaInfo.userPicture ? (
                        <img src={metaInfo.userPicture} alt={metaInfo.userName} className="w-8 h-8 rounded-full shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#1877F2] flex items-center justify-center shrink-0">
                          <LogoMeta />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{metaInfo.userName}</p>
                        {metaInfo.connectedAt && (
                          <p className="text-[10px] text-muted-foreground/60">
                            Conectado em {new Date(metaInfo.connectedAt).toLocaleDateString('pt-BR')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {isGoogleAds && isConnected && googleDisplayInfo && (
                    <div className="mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/15 flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-background border border-border flex items-center justify-center shrink-0">
                        <LogoGoogle />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{googleDisplayInfo.email}</p>
                        <p className="text-[10px] text-muted-foreground/60">
                          MCC {googleDisplayInfo.managerId}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => toggleConnection(integration.id)}
                    variant={isConnected ? 'outline' : 'default'}
                    className={cn(
                      'flex-1 text-xs font-bold uppercase h-9',
                      !isConnected && 'bg-primary text-primary-foreground hover:bg-primary/90'
                    )}
                  >
                    {isConnected ? 'Desconectar' : 'Conectar'}
                  </Button>
                  {isConnected && (
                    <Button variant="ghost" size="icon" title="Configurações da integração">
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Meta Assets Panel — shown when connected */}
        {metaInfo && metaInfo.status === 'connected' && (
          <MetaAssetsPanel meta={metaInfo} />
        )}

        {googleDisplayInfo && googleDisplayInfo.status === 'connected' && (
          <GoogleAdsAssetsPanel google={googleDisplayInfo} />
        )}
      </div>
    </>
  );
}
