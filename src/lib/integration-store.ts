import { supabase } from '@/lib/supabase';

export type MetaConnectionStatus = 'disconnected' | 'connected' | 'error';

export type CachedAdAccount = {
  id: string;
  name: string;
  account_status: number;
  currency: string;
  amount_spent?: string;
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
    } catch {
      // fall back to default
    }
    return _cache;
  })();

  return _loadPromise;
}

export function readIntegrations(): IntegrationStore {
  return _cache;
}

export function saveIntegrations(store: IntegrationStore): void {
  _cache = store;
  const meta = store.meta;
  void supabase.from('meta_integration').upsert({
    id: 'global',
    status: meta.status,
    app_id: meta.appId,
    access_token: meta.accessToken,
    meta_user_id: meta.userId,
    meta_user_name: meta.userName,
    meta_user_picture: meta.userPicture ?? null,
    connected_at: meta.connectedAt,
  });
}

export function connectMeta(data: Omit<MetaIntegration, 'status' | 'connectedAt'>): void {
  const newMeta: MetaIntegration = { ...data, status: 'connected', connectedAt: new Date().toISOString() };
  _cache = { meta: newMeta };
  _loadPromise = null;
  saveIntegrations(_cache);
}

export function disconnectMeta(): void {
  _cache = DEFAULT_STORE;
  _loadPromise = null;
  saveIntegrations(_cache);
  _assetsCache = [];
  _assetsLoadPromise = null;
  void supabase.from('meta_assets_cache').delete().neq('id', 'none');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('meta-assets-updated'));
  }
}

// ─── Cached assets ────────────────────────────────────────────────────────────

export async function loadCachedAdAccounts(): Promise<CachedAdAccount[]> {
  if (_assetsLoadPromise) return _assetsLoadPromise;

  _assetsLoadPromise = (async () => {
    try {
      const { data } = await supabase.from('meta_assets_cache').select('*');
      if (data && data.length > 0) {
        _assetsCache = data.map((r) => ({
          id: r.id,
          name: r.name ?? '',
          account_status: r.account_status ?? 1,
          currency: r.currency ?? 'BRL',
          amount_spent: r.amount_spent ?? undefined,
        }));
      }
    } catch {
      // fall back
    }
    return _assetsCache;
  })();

  return _assetsLoadPromise;
}

export function readCachedAdAccounts(): CachedAdAccount[] {
  return _assetsCache;
}

export function saveCachedAdAccounts(accounts: CachedAdAccount[]): void {
  _assetsCache = accounts;
  _assetsLoadPromise = null;

  if (accounts.length > 0) {
    void supabase.from('meta_assets_cache').upsert(
      accounts.map((a) => ({
        id: a.id,
        name: a.name,
        account_status: a.account_status,
        currency: a.currency,
        amount_spent: a.amount_spent ?? null,
      }))
    );
  }

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
