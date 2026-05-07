"use client";

import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'onmid-meta-ads-connections';

export type MetaAdsMetrics = {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
};

export type MetaAdsAccount = {
  id: string;
  name: string;
  profileId: string;
  profileName: string;
  currency: string;
  status: 'Ativa' | 'Em análise';
  metrics: MetaAdsMetrics;
};

export type ClientMetaAdsConnection = {
  clientId: string;
  profileId: string;
  accountIds: string[];
  status: 'connected' | 'disconnected';
  connectedAt: string;
  lastSync: string;
};

export const META_ADS_PROFILES = [
  { id: 'profile-onmid', name: 'Perfil Onmid' },
  { id: 'profile-matheus', name: 'Matheus Campos' },
  { id: 'profile-comercial', name: 'Comercial Onmid' },
];

export const META_ADS_ACCOUNTS: MetaAdsAccount[] = [
  {
    id: 'act_1029384756',
    name: 'Sorrifácil Londrina - Tráfego',
    profileId: 'profile-onmid',
    profileName: 'Perfil Onmid',
    currency: 'BRL',
    status: 'Ativa',
    metrics: { spend: 6240.35, impressions: 184230, clicks: 4732, leads: 318, cpl: 19.62 },
  },
  {
    id: 'act_5647382910',
    name: 'Sorrifácil Londrina - Remarketing',
    profileId: 'profile-onmid',
    profileName: 'Perfil Onmid',
    currency: 'BRL',
    status: 'Ativa',
    metrics: { spend: 1780.9, impressions: 58210, clicks: 1328, leads: 92, cpl: 19.36 },
  },
  {
    id: 'act_8374651029',
    name: 'OdontoPrime - Captação',
    profileId: 'profile-matheus',
    profileName: 'Matheus Campos',
    currency: 'BRL',
    status: 'Ativa',
    metrics: { spend: 3920.1, impressions: 96340, clicks: 2510, leads: 166, cpl: 23.61 },
  },
  {
    id: 'act_7463829105',
    name: 'Bella Imóveis - Leads',
    profileId: 'profile-comercial',
    profileName: 'Comercial Onmid',
    currency: 'BRL',
    status: 'Em análise',
    metrics: { spend: 2140.7, impressions: 64120, clicks: 1488, leads: 74, cpl: 28.93 },
  },
];

function readConnections(): ClientMetaAdsConnection[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeConnections(connections: ClientMetaAdsConnection[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  window.dispatchEvent(new Event('meta-ads-connections-updated'));
}

function sumMetrics(accounts: MetaAdsAccount[]): MetaAdsMetrics {
  const metrics = accounts.reduce(
    (total, account) => ({
      spend: total.spend + account.metrics.spend,
      impressions: total.impressions + account.metrics.impressions,
      clicks: total.clicks + account.metrics.clicks,
      leads: total.leads + account.metrics.leads,
      cpl: 0,
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0 },
  );

  return {
    ...metrics,
    cpl: metrics.leads > 0 ? metrics.spend / metrics.leads : 0,
  };
}

export function useMetaAdsConnections() {
  const [connections, setConnections] = useState<ClientMetaAdsConnection[]>([]);

  useEffect(() => {
    setConnections(readConnections());

    function sync() {
      setConnections(readConnections());
    }

    window.addEventListener('storage', sync);
    window.addEventListener('meta-ads-connections-updated', sync);

    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('meta-ads-connections-updated', sync);
    };
  }, []);

  return useMemo(() => {
    function persist(next: ClientMetaAdsConnection[]) {
      setConnections(next);
      writeConnections(next);
    }

    function getConnection(clientId: string) {
      return connections.find((connection) => connection.clientId === clientId && connection.status === 'connected') ?? null;
    }

    function getClientAccounts(clientId: string) {
      const connection = getConnection(clientId);
      if (!connection) return [];

      return META_ADS_ACCOUNTS.filter((account) => connection.accountIds.includes(account.id));
    }

    function getClientMetrics(clientId: string) {
      return sumMetrics(getClientAccounts(clientId));
    }

    function saveConnection(clientId: string, profileId: string, accountIds: string[]) {
      const now = new Date().toISOString();
      const nextConnection: ClientMetaAdsConnection = {
        clientId,
        profileId,
        accountIds,
        status: 'connected',
        connectedAt: connections.find((connection) => connection.clientId === clientId)?.connectedAt ?? now,
        lastSync: now,
      };

      persist([
        ...connections.filter((connection) => connection.clientId !== clientId),
        nextConnection,
      ]);
    }

    function disconnectClient(clientId: string) {
      persist(connections.filter((connection) => connection.clientId !== clientId));
    }

    return {
      connections,
      getConnection,
      getClientAccounts,
      getClientMetrics,
      saveConnection,
      disconnectClient,
    };
  }, [connections]);
}
