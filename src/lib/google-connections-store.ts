"use client";

import { useCallback, useEffect, useState } from 'react';

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

export async function loadGoogleConnections(): Promise<GoogleConnection[]> {
  const res = await fetch('/api/google/connections');
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<GoogleConnection[]>;
}

export async function removeGoogleConnection(id: string): Promise<void> {
  const res = await fetch(`/api/google/connections?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
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
