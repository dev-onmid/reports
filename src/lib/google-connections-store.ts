"use client";

import { useCallback, useEffect, useState } from 'react';
import { assertSupabaseConfigured, supabase } from '@/lib/supabase';

export type GoogleAccountType = 'gmb' | 'google_ads';

export type GoogleConnection = {
  id: string;
  email: string;
  displayName: string;
  picture?: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry?: string;
  scope: string;
  accountType: GoogleAccountType;
  status: 'connected' | 'error';
  connectedAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToConnection(r: any): GoogleConnection {
  return {
    id: r.id,
    email: r.email ?? '',
    displayName: r.display_name ?? '',
    picture: r.picture ?? undefined,
    accessToken: r.access_token ?? '',
    refreshToken: r.refresh_token ?? '',
    tokenExpiry: r.token_expiry ?? undefined,
    scope: r.scope ?? '',
    accountType: (r.account_type ?? 'gmb') as GoogleAccountType,
    status: r.status ?? 'connected',
    connectedAt: r.connected_at ?? new Date().toISOString(),
  };
}

export async function loadGoogleConnections(): Promise<GoogleConnection[]> {
  assertSupabaseConfigured();
  const { data, error } = await supabase
    .from('google_connections')
    .select('*')
    .order('connected_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToConnection);
}

export async function removeGoogleConnection(id: string): Promise<void> {
  assertSupabaseConfigured();
  const { error } = await supabase.from('google_connections').delete().eq('id', id);
  if (error) throw error;
}

export function useGoogleConnections() {
  const [connections, setConnections] = useState<GoogleConnection[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadGoogleConnections();
      setConnections(data);
    } catch (err) {
      console.error('Erro ao carregar conexões Google:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function remove(id: string) {
    await removeGoogleConnection(id);
    setConnections((prev) => prev.filter((c) => c.id !== id));
  }

  return { connections, loading, reload, remove };
}
