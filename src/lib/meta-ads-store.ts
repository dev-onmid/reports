"use client";

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

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
  return { ...metrics, cpl: metrics.leads > 0 ? metrics.spend / metrics.leads : 0 };
}

export function useMetaAdsConnections() {
  const [connections, setConnections] = useState<ClientMetaAdsConnection[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('meta_ads_connections').select('*');
        if (!data) return;
        setConnections(
          data.map((row) => ({
            clientId: row.client_id,
            profileId: row.profile_id ?? '',
            accountIds: row.account_ids ?? [],
            status: row.status as 'connected' | 'disconnected',
            connectedAt: row.connected_at ?? new Date().toISOString(),
            lastSync: row.last_sync ?? new Date().toISOString(),
          }))
        );
      } catch {
        // silently ignore
      }
    })();
  }, []);

  return useMemo(() => {
    function getConnection(clientId: string) {
      return connections.find((c) => c.clientId === clientId && c.status === 'connected') ?? null;
    }

    function getClientAccounts(clientId: string) {
      const connection = getConnection(clientId);
      if (!connection) return [];
      return META_ADS_ACCOUNTS.filter((a) => connection.accountIds.includes(a.id));
    }

    function getClientMetrics(clientId: string) {
      return sumMetrics(getClientAccounts(clientId));
    }

    function saveConnection(clientId: string, profileId: string, accountIds: string[]) {
      const now = new Date().toISOString();
      const conn: ClientMetaAdsConnection = {
        clientId,
        profileId,
        accountIds,
        status: 'connected',
        connectedAt: connections.find((c) => c.clientId === clientId)?.connectedAt ?? now,
        lastSync: now,
      };
      setConnections((prev) => [...prev.filter((c) => c.clientId !== clientId), conn]);
      void supabase.from('meta_ads_connections').upsert({
        client_id: conn.clientId,
        profile_id: conn.profileId,
        account_ids: conn.accountIds,
        status: conn.status,
        connected_at: conn.connectedAt,
        last_sync: conn.lastSync,
      });
    }

    function disconnectClient(clientId: string) {
      setConnections((prev) => prev.filter((c) => c.clientId !== clientId));
      void supabase.from('meta_ads_connections').delete().eq('client_id', clientId);
    }

    return { connections, getConnection, getClientAccounts, getClientMetrics, saveConnection, disconnectClient };
  }, [connections]);
}
