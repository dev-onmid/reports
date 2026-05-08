"use client";

import { useCallback, useEffect, useState } from 'react';

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

export async function loadMetaConnections(): Promise<MetaConnection[]> {
  const res = await fetch('/api/meta/connections');
  if (!res.ok) throw new Error('Erro ao carregar conexões Meta');
  return res.json() as Promise<MetaConnection[]>;
}

export async function addMetaConnection(
  conn: Omit<MetaConnection, 'id' | 'connectedAt'>
): Promise<MetaConnection> {
  const res = await fetch('/api/meta/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  });
  if (!res.ok) throw new Error('Erro ao salvar conexão Meta');
  return res.json() as Promise<MetaConnection>;
}

export async function removeMetaConnection(id: string): Promise<void> {
  const res = await fetch(`/api/meta/connections?id=${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Erro ao remover conexão Meta');
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
