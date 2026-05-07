"use client";

import { useCallback, useEffect, useState } from 'react';
import { assertSupabaseConfigured, supabase } from '@/lib/supabase';

export type MetaConnection = {
  id: string;
  label: string;
  status: 'connected' | 'disconnected' | 'error';
  appId: string;
  accessToken: string;
  userId: string;
  userName: string;
  userPicture?: string;
  connectedAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToConnection(r: any): MetaConnection {
  return {
    id: r.id,
    label: r.label ?? '',
    status: r.status ?? 'connected',
    appId: r.app_id ?? '',
    accessToken: r.access_token ?? '',
    userId: r.user_id ?? '',
    userName: r.user_name ?? '',
    userPicture: r.user_picture ?? undefined,
    connectedAt: r.connected_at ?? new Date().toISOString(),
  };
}

export async function loadMetaConnections(): Promise<MetaConnection[]> {
  assertSupabaseConfigured();
  const { data, error } = await supabase
    .from('meta_connections')
    .select('*')
    .order('connected_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToConnection);
}

export async function addMetaConnection(
  conn: Omit<MetaConnection, 'id' | 'connectedAt'>
): Promise<MetaConnection> {
  assertSupabaseConfigured();
  const { data, error } = await supabase
    .from('meta_connections')
    .insert({
      label: conn.label,
      status: conn.status,
      app_id: conn.appId,
      access_token: conn.accessToken,
      user_id: conn.userId,
      user_name: conn.userName,
      user_picture: conn.userPicture ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToConnection(data);
}

export async function removeMetaConnection(id: string): Promise<void> {
  assertSupabaseConfigured();
  const { error } = await supabase.from('meta_connections').delete().eq('id', id);
  if (error) throw error;
}

export function useMetaConnections() {
  const [connections, setConnections] = useState<MetaConnection[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadMetaConnections();
      setConnections(data);
    } catch (err) {
      console.error('Erro ao carregar conexões Meta:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function add(conn: Omit<MetaConnection, 'id' | 'connectedAt'>): Promise<MetaConnection> {
    const saved = await addMetaConnection(conn);
    setConnections((prev) => [saved, ...prev]);
    return saved;
  }

  async function remove(id: string) {
    await removeMetaConnection(id);
    setConnections((prev) => prev.filter((c) => c.id !== id));
  }

  return { connections, loading, reload, add, remove };
}
