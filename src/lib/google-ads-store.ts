"use client";

import { useEffect, useMemo, useState } from 'react';
import { assertSupabaseConfigured, supabase } from '@/lib/supabase';

const GOOGLE_ADS_UPDATED_EVENT = 'google-ads-updated';
export const GOOGLE_ADS_DEVELOPER_TOKEN = '1vR8GhAk4UMZoPaqo7Qq8Q';
export const GOOGLE_ADS_LOGIN_EMAIL = 'matheus.onmid@gmail.com';
export const GOOGLE_ADS_DEFAULT_MANAGER_ID = 'mcc-8493021188';

export type GoogleAdsMetrics = {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpc: number;
};

export type GoogleAdsAccount = {
  id: string;
  name: string;
  managerId: string;
  managerName: string;
  currency: string;
  status: 'Ativa' | 'Pausada';
  metrics: GoogleAdsMetrics;
};

export type GoogleAdsConnectionStatus = 'connected' | 'disconnected';

export type GoogleAdsIntegration = {
  status: GoogleAdsConnectionStatus;
  email: string;
  managerId: string;
  developerToken: string;
  connectedAt: string | null;
};

export type ClientGoogleAdsConnection = {
  clientId: string;
  managerId: string;
  accountIds: string[];
  status: GoogleAdsConnectionStatus;
  connectedAt: string;
  lastSync: string;
};

export const GOOGLE_ADS_MANAGERS = [
  { id: 'mcc-8493021188', name: 'MCC Onmid' },
  { id: 'mcc-1029384756', name: 'MCC Comercial' },
];

export const GOOGLE_ADS_ACCOUNTS: GoogleAdsAccount[] = [
  {
    id: '372-458-9910',
    name: 'Sorrifácil Londrina - Pesquisa',
    managerId: 'mcc-8493021188',
    managerName: 'MCC Onmid',
    currency: 'BRL',
    status: 'Ativa',
    metrics: { cost: 4120.45, impressions: 74320, clicks: 3820, conversions: 128, cpc: 1.08 },
  },
  {
    id: '774-219-3301',
    name: 'Sorrifácil Londrina - Performance Max',
    managerId: 'mcc-8493021188',
    managerName: 'MCC Onmid',
    currency: 'BRL',
    status: 'Ativa',
    metrics: { cost: 2890.2, impressions: 58240, clicks: 2190, conversions: 82, cpc: 1.32 },
  },
  {
    id: '119-442-7302',
    name: 'OdontoPrime - Search',
    managerId: 'mcc-1029384756',
    managerName: 'MCC Comercial',
    currency: 'BRL',
    status: 'Ativa',
    metrics: { cost: 2380.8, impressions: 39100, clicks: 1540, conversions: 56, cpc: 1.55 },
  },
  {
    id: '558-992-4811',
    name: 'Bella Imóveis - Leads',
    managerId: 'mcc-1029384756',
    managerName: 'MCC Comercial',
    currency: 'BRL',
    status: 'Pausada',
    metrics: { cost: 980.15, impressions: 18340, clicks: 610, conversions: 21, cpc: 1.61 },
  },
];

const DEFAULT_INTEGRATION: GoogleAdsIntegration = {
  status: 'disconnected',
  email: '',
  managerId: '',
  developerToken: '',
  connectedAt: null,
};

function sumMetrics(accounts: GoogleAdsAccount[]): GoogleAdsMetrics {
  const metrics = accounts.reduce(
    (total, account) => ({
      cost: total.cost + account.metrics.cost,
      impressions: total.impressions + account.metrics.impressions,
      clicks: total.clicks + account.metrics.clicks,
      conversions: total.conversions + account.metrics.conversions,
      cpc: 0,
    }),
    { cost: 0, impressions: 0, clicks: 0, conversions: 0, cpc: 0 },
  );

  return {
    ...metrics,
    cpc: metrics.clicks > 0 ? metrics.cost / metrics.clicks : 0,
  };
}

export function useGoogleAds() {
  const [integration, setIntegration] = useState<GoogleAdsIntegration>(DEFAULT_INTEGRATION);
  const [connections, setConnections] = useState<ClientGoogleAdsConnection[]>([]);

  useEffect(() => {
    async function load() {
      try {
        assertSupabaseConfigured();
        const [{ data: integrationData }, { data: connectionData }] = await Promise.all([
          supabase.from('google_ads_integration').select('*').eq('id', 'global').single(),
          supabase.from('google_ads_connections').select('*'),
        ]);

        if (integrationData) {
          setIntegration({
            status: integrationData.status as GoogleAdsConnectionStatus,
            email: integrationData.email ?? '',
            managerId: integrationData.manager_id ?? '',
            developerToken: integrationData.developer_token ?? '',
            connectedAt: integrationData.connected_at ?? null,
          });
        }

        if (connectionData) {
          setConnections(connectionData.map((row) => ({
            clientId: row.client_id,
            managerId: row.manager_id ?? '',
            accountIds: row.account_ids ?? [],
            status: row.status as GoogleAdsConnectionStatus,
            connectedAt: row.connected_at ?? new Date().toISOString(),
            lastSync: row.last_sync ?? new Date().toISOString(),
          })));
        }
      } catch (error) {
        console.error('Erro ao carregar Google Ads do Supabase:', error);
      }
    }

    void load();

    function handleUpdate() {
      void load();
    }

    window.addEventListener(GOOGLE_ADS_UPDATED_EVENT, handleUpdate);
    return () => window.removeEventListener(GOOGLE_ADS_UPDATED_EVENT, handleUpdate);
  }, []);

  return useMemo(() => {
    async function connect(input: { email: string; managerId: string; developerToken: string }) {
      const next: GoogleAdsIntegration = {
        status: 'connected',
        email: input.email.trim(),
        managerId: input.managerId,
        developerToken: input.developerToken.trim(),
        connectedAt: new Date().toISOString(),
      };

      setIntegration(next);
      const { error } = await supabase.from('google_ads_integration').upsert({
        id: 'global',
        status: next.status,
        email: next.email,
        manager_id: next.managerId,
        developer_token: next.developerToken,
        connected_at: next.connectedAt,
      });
      if (error) throw error;
      window.dispatchEvent(new Event(GOOGLE_ADS_UPDATED_EVENT));
      return next;
    }

    async function disconnect() {
      setIntegration(DEFAULT_INTEGRATION);
      const { error } = await supabase.from('google_ads_integration').upsert({
        id: 'global',
        status: 'disconnected',
        email: '',
        manager_id: '',
        developer_token: '',
        connected_at: null,
      });
      if (error) throw error;
      window.dispatchEvent(new Event(GOOGLE_ADS_UPDATED_EVENT));
    }

    function getConnection(clientId: string) {
      return connections.find((connection) => connection.clientId === clientId && connection.status === 'connected') ?? null;
    }

    function getClientAccounts(clientId: string) {
      const connection = getConnection(clientId);
      if (!connection) return [];
      return GOOGLE_ADS_ACCOUNTS.filter((account) => connection.accountIds.includes(account.id));
    }

    function getClientMetrics(clientId: string) {
      return sumMetrics(getClientAccounts(clientId));
    }

    function saveClientConnection(clientId: string, managerId: string, accountIds: string[]) {
      const now = new Date().toISOString();
      const next: ClientGoogleAdsConnection = {
        clientId,
        managerId,
        accountIds,
        status: 'connected',
        connectedAt: connections.find((connection) => connection.clientId === clientId)?.connectedAt ?? now,
        lastSync: now,
      };

      setConnections((prev) => [...prev.filter((connection) => connection.clientId !== clientId), next]);
      void (async () => {
        const { error } = await supabase.from('google_ads_connections').upsert({
          client_id: next.clientId,
          manager_id: next.managerId,
          account_ids: next.accountIds,
          status: next.status,
          connected_at: next.connectedAt,
          last_sync: next.lastSync,
        });
        if (error) console.error('Erro ao salvar vínculo Google Ads no Supabase:', error);
        else window.dispatchEvent(new Event(GOOGLE_ADS_UPDATED_EVENT));
      })();
    }

    function disconnectClient(clientId: string) {
      setConnections((prev) => prev.filter((connection) => connection.clientId !== clientId));
      void (async () => {
        const { error } = await supabase.from('google_ads_connections').delete().eq('client_id', clientId);
        if (error) console.error('Erro ao remover vínculo Google Ads no Supabase:', error);
        else window.dispatchEvent(new Event(GOOGLE_ADS_UPDATED_EVENT));
      })();
    }

    return {
      integration,
      connections,
      accounts: GOOGLE_ADS_ACCOUNTS,
      connect,
      disconnect,
      getConnection,
      getClientAccounts,
      getClientMetrics,
      saveClientConnection,
      disconnectClient,
    };
  }, [connections, integration]);
}
