const STORAGE_KEY = 'onmid-integrations';
const ASSETS_STORAGE_KEY = 'onmid-meta-assets-cache';

export type MetaConnectionStatus = 'disconnected' | 'connected' | 'error';

// Shared ad account type (used by integrations page and client dialog)
export type CachedAdAccount = {
  id: string;        // act_XXXXXXXXX
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

export function readIntegrations(): IntegrationStore {
  if (typeof window === 'undefined') return DEFAULT_STORE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_STORE;
    const parsed = JSON.parse(stored) as Partial<IntegrationStore>;
    return { meta: { ...DEFAULT_META, ...(parsed.meta ?? {}) } };
  } catch {
    return DEFAULT_STORE;
  }
}

export function saveIntegrations(store: IntegrationStore): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function connectMeta(data: Omit<MetaIntegration, 'status' | 'connectedAt'>): void {
  const store = readIntegrations();
  store.meta = { ...data, status: 'connected', connectedAt: new Date().toISOString() };
  saveIntegrations(store);
}

export function disconnectMeta(): void {
  const store = readIntegrations();
  store.meta = DEFAULT_META;
  saveIntegrations(store);
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(ASSETS_STORAGE_KEY);
  }
}

// ─── Cached assets (ad accounts fetched from Meta API) ───────────────────────

export function saveCachedAdAccounts(accounts: CachedAdAccount[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ASSETS_STORAGE_KEY, JSON.stringify(accounts));
  window.dispatchEvent(new Event('meta-assets-updated'));
}

export function readCachedAdAccounts(): CachedAdAccount[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(ASSETS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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
