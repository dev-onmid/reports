"use client";

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, ExternalLink, X, AlertCircle, ChevronDown, RefreshCw, Building2, Megaphone, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  readIntegrations,
  connectMeta,
  disconnectMeta,
  fbLogin,
  fbLogout,
  saveCachedAdAccounts,
  type MetaIntegration,
  type CachedAdAccount,
} from '@/lib/integration-store';

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

  // Fetch from the logged-in user's perspective (/me) — same as Reportei/Dashgo
  const [adAccounts, pages, igFromPages] = await Promise.allSettled([
    fetchAll<MetaAdAccount>(
      `${base}/me/adaccounts?limit=100&fields=id,name,account_status,currency,amount_spent&${t}`
    ),
    fetchAll<MetaPage & { instagram_business_account?: { id: string; username: string; name: string; followers_count: number; profile_picture_url: string } }>(
      `${base}/me/accounts?limit=100&fields=id,name,category,fan_count,picture,instagram_business_account{id,username,name,followers_count,profile_picture_url}&${t}`
    ),
    Promise.resolve([] as MetaInstagram[]),
  ]);

  function settled<T>(r: PromiseSettledResult<T[]>): T[] {
    return r.status === 'fulfilled' ? r.value : [];
  }

  const pagesData = settled(adAccounts).length >= 0 ? settled(pages) : [];

  // Extract Instagram accounts linked to pages
  const instagramMap = new Map<string, MetaInstagram>();
  pagesData.forEach((p) => {
    if (p.instagram_business_account) {
      instagramMap.set(p.instagram_business_account.id, p.instagram_business_account);
    }
  });

  return {
    adAccounts: settled(adAccounts),
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

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchMetaAssets(meta.accessToken);
      setAssets(data);
      // Persist ad accounts so client pages can use them for selection
      saveCachedAdAccounts(data.adAccounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao buscar ativos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
                  return (
                    <div key={acc.id} className="flex items-center justify-between py-3 gap-4">
                      <div>
                        <p className="text-sm font-semibold">{acc.name}</p>
                        <p className="text-xs font-mono text-muted-foreground mt-0.5">{acc.id} · {acc.currency}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn('text-xs font-bold', statusInfo.color)}>{statusInfo.label}</p>
                        {spent !== null && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {spent.toLocaleString('pt-BR', { style: 'currency', currency: acc.currency })} gasto
                          </p>
                        )}
                      </div>
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

// ─── Logos ────────────────────────────────────────────────────────────────────

const LogoMeta = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="#0668E1">
    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12c0-5.523-4.477-10-10-10z" />
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

const LogoInstagram = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7">
    <defs>
      <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#f09433" />
        <stop offset="25%" stopColor="#e6683c" />
        <stop offset="50%" stopColor="#dc2743" />
        <stop offset="75%" stopColor="#cc2366" />
        <stop offset="100%" stopColor="#bc1888" />
      </linearGradient>
    </defs>
    <path fill="url(#ig-grad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
  </svg>
);

const LogoWhatsApp = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="#25D366">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.06-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
  </svg>
);

const LogoTikTok = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 2.78-1.15 5.54-3.33 7.39-2.2 1.85-5.36 2.4-8.08 1.47-2.73-.93-4.94-3.11-5.74-5.82-.8-2.72-.11-5.84 1.76-8 1.86-2.16 4.88-3.03 7.6-2.2v4.06c-1.31-.38-2.81-.13-3.86.81-1.04.94-1.38 2.49-1.03 3.86.35 1.36 1.48 2.5 2.87 2.84 1.4.35 2.96.06 4.09-.85 1.14-.91 1.74-2.39 1.72-3.89-.04-5.46-.02-10.92-.02-16.38z" />
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

function MetaConnectModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (meta: MetaIntegration) => void;
}) {
  const [appId, setAppId] = useState(() => readIntegrations().meta.appId || '');
  const [showGuide, setShowGuide] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const backdropRef = useRef<HTMLDivElement>(null);

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  async function handleFBLogin() {
    const id = appId.trim();
    if (!id) { setError('Informe o App ID antes de continuar.'); return; }
    setError('');
    setLoading(true);
    try {
      const { accessToken, userId } = await fbLogin(id);

      // Fetch user profile
      const meRes = await fetch(
        `https://graph.facebook.com/v21.0/me?fields=id,name,picture.width(80)&access_token=${accessToken}`
      );
      const me = await meRes.json() as { id: string; name: string; picture?: { data: { url: string } }; error?: { message: string } };
      if (me.error) throw new Error(me.error.message);

      const data: Omit<MetaIntegration, 'status' | 'connectedAt'> = {
        appId: id,
        accessToken,
        userId,
        userName: me.name,
        userPicture: me.picture?.data?.url,
      };
      connectMeta(data);
      onConnected({ ...data, status: 'connected', connectedAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao conectar.');
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

          {/* App ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              App ID do Meta for Developers
            </label>
            <input
              type="text"
              value={appId}
              onChange={(e) => { setAppId(e.target.value); setError(''); }}
              placeholder="Ex: 1234567890123456"
              className="w-full h-10 rounded-lg bg-background border border-border px-3 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition"
            />
          </div>

          {/* Guide accordion */}
          <div className="rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setShowGuide((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/30 text-xs text-muted-foreground font-semibold hover:bg-muted/50 transition-colors"
            >
              <span>Como obter o App ID?</span>
              <ChevronDown className={cn('w-4 h-4 transition-transform', showGuide && 'rotate-180')} />
            </button>
            {showGuide && (
              <div className="px-3 py-3 bg-muted/10 text-xs text-muted-foreground leading-relaxed space-y-2">
                <ol className="list-decimal list-inside space-y-1">
                  <li>Acesse <span className="font-mono text-foreground/70">developers.facebook.com/apps</span></li>
                  <li>Selecione o app <strong className="text-foreground/80">ON_REPORT</strong> que você criou</li>
                  <li>No painel do app, o <strong className="text-foreground/80">ID do aplicativo</strong> aparece no topo</li>
                  <li>Certifique-se que o domínio <span className="font-mono text-foreground/70">localhost:3000</span> está em <strong className="text-foreground/80">Configurações → Básico → Domínios do app</strong></li>
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

// ─── Types ────────────────────────────────────────────────────────────────────

type IntegrationId = 'meta-ads' | 'instagram' | 'google-ads' | 'google-my-business' | 'whatsapp' | 'tiktok-ads' | 'website';

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
    description: 'Facebook e Instagram Ads — sincronize campanhas, leads e métricas.',
    category: 'Anúncios',
    status: 'desconectado',
    logo: <LogoMeta />,
    hasCustomConnect: true,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Acesse dados orgânicos, stories, reels e engajamento.',
    category: 'Social',
    status: 'conectado',
    logo: <LogoInstagram />,
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
    id: 'whatsapp',
    name: 'WhatsApp Business API',
    description: 'Integre disparos, atendimento e métricas de conversas.',
    category: 'Comunicação',
    status: 'conectado',
    logo: <LogoWhatsApp />,
  },
  {
    id: 'tiktok-ads',
    name: 'TikTok Ads',
    description: 'Campanhas, alcance e performance de vídeos no TikTok.',
    category: 'Anúncios',
    status: 'desconectado',
    logo: <LogoTikTok />,
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

const CATEGORIES = ['Todos', 'Anúncios', 'Social', 'Presença Digital', 'Comunicação'];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IntegracoesPage() {
  const [integrations, setIntegrations] = useState<Integration[]>(BASE_INTEGRATIONS);
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [metaModal, setMetaModal] = useState(false);
  const [metaInfo, setMetaInfo] = useState<MetaIntegration | null>(null);

  // Load persisted Meta connection on mount
  useEffect(() => {
    const store = readIntegrations();
    if (store.meta.status === 'connected') {
      setMetaInfo(store.meta);
      setIntegrations((prev) =>
        prev.map((i) => (i.id === 'meta-ads' ? { ...i, status: 'conectado' } : i))
      );
    }
  }, []);

  function handleMetaConnected(meta: MetaIntegration) {
    setMetaInfo(meta);
    setMetaModal(false);
    setIntegrations((prev) =>
      prev.map((i) => (i.id === 'meta-ads' ? { ...i, status: 'conectado' } : i))
    );
  }

  async function handleMetaDisconnect() {
    await fbLogout().catch(() => {});
    disconnectMeta();
    setMetaInfo(null);
    setIntegrations((prev) =>
      prev.map((i) => (i.id === 'meta-ads' ? { ...i, status: 'desconectado' } : i))
    );
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
      </div>
    </>
  );
}
