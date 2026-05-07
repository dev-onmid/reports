import { assertSupabaseConfigured, supabase } from '@/lib/supabase';

export type MetaConnectionStatus = 'disconnected' | 'connected' | 'error';

export type CachedAdAccount = {
  id: string;
  name: string;
  account_status: number;
  currency: string;
  amount_spent?: string;
  enabled: boolean;
};

export type MetaIntegration = {
  status: MetaConnectionStatus;
  appId: string;
  accessToken: string;
  userId: string;
  userName: string;
  userPicture?: string;
  connectedAt: string | null;
};

export type IntegrationStore = {
  meta: MetaIntegration;
};

const DEFAULT_META: MetaIntegration = {
  status: 'disconnected',
  appId: '',
  accessToken: '',
  userId: '',
  userName: '',
  userPicture: undefined,
  connectedAt: null,
};

const DEFAULT_STORE: IntegrationStore = { meta: DEFAULT_META };

// ─── In-memory cache ──────────────────────────────────────────────────────────

let _cache: IntegrationStore = DEFAULT_STORE;
let _assetsCache: CachedAdAccount[] = [];
let _loadPromise: Promise<IntegrationStore> | null = null;
let _assetsLoadPromise: Promise<CachedAdAccount[]> | null = null;

// ─── Integration ─────────────────────────────────────────────────────────────

export async function loadIntegrations(): Promise<IntegrationStore> {
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    try {
      assertSupabaseConfigured();
      const { data } = await supabase
        .from('meta_integration')
        .select('*')
        .eq('id', 'global')
        .single();

      if (data) {
        _cache = {
          meta: {
            status: data.status as MetaConnectionStatus,
            appId: data.app_id ?? '',
            accessToken: data.access_token ?? '',
            userId: data.meta_user_id ?? '',
            userName: data.meta_user_name ?? '',
            userPicture: data.meta_user_picture ?? undefined,
            connectedAt: data.connected_at ?? null,
          },
        };
      }
    } catch (error) {
      console.error('Erro ao carregar integração Meta:', error);
    }
    return _cache;
  })();

  return _loadPromise;
}

export function readIntegrations(): IntegrationStore {
  return _cache;
}

export async function saveIntegrations(store: IntegrationStore): Promise<void> {
  assertSupabaseConfigured();
  _cache = store;
  const meta = store.meta;
  const { error } = await supabase.from('meta_integration').upsert({
    id: 'global',
    status: meta.status,
    app_id: meta.appId,
    access_token: meta.accessToken,
    meta_user_id: meta.userId,
    meta_user_name: meta.userName,
    meta_user_picture: meta.userPicture ?? null,
    connected_at: meta.connectedAt,
  });

  if (error) throw error;
}

export async function connectMeta(data: Omit<MetaIntegration, 'status' | 'connectedAt'>): Promise<MetaIntegration> {
  const newMeta: MetaIntegration = { ...data, status: 'connected', connectedAt: new Date().toISOString() };
  _cache = { meta: newMeta };
  _loadPromise = null;
  await saveIntegrations(_cache);
  return newMeta;
}

export async function disconnectMeta(): Promise<void> {
  _cache = DEFAULT_STORE;
  _loadPromise = null;
  await saveIntegrations(_cache);
  _assetsCache = [];
  _assetsLoadPromise = null;
  const { error } = await supabase.from('meta_assets_cache').delete().neq('id', 'none');
  if (error) throw error;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('meta-assets-updated'));
  }
}

// ─── Cached assets ────────────────────────────────────────────────────────────

export async function loadCachedAdAccounts(): Promise<CachedAdAccount[]> {
  if (_assetsLoadPromise) return _assetsLoadPromise;

  _assetsLoadPromise = (async () => {
    try {
      assertSupabaseConfigured();
      const { data } = await supabase.from('meta_assets_cache').select('*');
      if (data && data.length > 0) {
        _assetsCache = data.map((r) => ({
          id: r.id,
          name: r.name ?? '',
          account_status: r.account_status ?? 1,
          currency: r.currency ?? 'BRL',
          amount_spent: r.amount_spent ?? undefined,
          enabled: r.enabled ?? true,
        }));
      }
    } catch (error) {
      console.error('Erro ao carregar contas Meta em cache:', error);
    }
    return _assetsCache;
  })();

  return _assetsLoadPromise;
}

export function readCachedAdAccounts(): CachedAdAccount[] {
  return _assetsCache;
}

export async function saveCachedAdAccounts(accounts: CachedAdAccount[]): Promise<void> {
  assertSupabaseConfigured();
  _assetsCache = accounts;
  _assetsLoadPromise = null;

  if (accounts.length > 0) {
    const { error } = await supabase.from('meta_assets_cache').upsert(
      accounts.map((a) => ({
        id: a.id,
        name: a.name,
        account_status: a.account_status,
        currency: a.currency,
        amount_spent: a.amount_spent ?? null,
        enabled: a.enabled,
      }))
    );
    if (error) throw error;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('meta-assets-updated'));
  }
}

export async function setAccountEnabled(id: string, enabled: boolean): Promise<void> {
  assertSupabaseConfigured();
  _assetsCache = _assetsCache.map((a) => a.id === id ? { ...a, enabled } : a);
  _assetsLoadPromise = null;
  const { error } = await supabase.from('meta_assets_cache').update({ enabled }).eq('id', id);
  if (error) throw error;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('meta-assets-updated'));
  }
}

// ─── Facebook JS SDK ──────────────────────────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FB: any;
    fbAsyncInit?: () => void;
  }
}

const FB_SCOPE = [
  'public_profile',
  'ads_read',
  'ads_management',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
].join(',');

export function loadFBSDK(appId: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return;

    if (window.FB) {
      window.FB.init({ appId, cookie: true, xfbml: false, version: 'v21.0' });
      resolve();
      return;
    }

    window.fbAsyncInit = () => {
      window.FB.init({ appId, cookie: true, xfbml: false, version: 'v21.0' });
      resolve();
    };

    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
  });
}

export type FBLoginResult = {
  accessToken: string;
  userId: string;
};

export async function fbLogin(appId: string): Promise<FBLoginResult> {
  await loadFBSDK(appId);
  return new Promise((resolve, reject) => {
    window.FB.login(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response: any) => {
        if (response.authResponse?.accessToken) {
          resolve({
            accessToken: response.authResponse.accessToken,
            userId: response.authResponse.userID,
          });
        } else {
          reject(new Error('Login cancelado ou não autorizado.'));
        }
      },
      { scope: FB_SCOPE, return_scopes: true },
    );
  });
}

export async function fbLogout(): Promise<void> {
  if (typeof window === 'undefined' || !window.FB) return;
  return new Promise((resolve) => {
    window.FB.logout(() => resolve());
  });
}
