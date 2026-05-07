"use client";

import { useEffect, useMemo, useState } from 'react';
import { logActivity } from '@/lib/activity-log-store';
import { mockClients, type Client, type ClientStatus } from '@/lib/mock-data';

const STORAGE_KEY = 'onmid-clients';
export const CURRENT_USER_ROLE = 'Administrador';

export type NewClientInput = {
  name: string;
  segment: string;
  status: ClientStatus;
};

export function canManageClients(role = CURRENT_USER_ROLE): boolean {
  return role === 'Administrador';
}

function readStoredClients(): Client[] {
  if (typeof window === 'undefined') return mockClients;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return mockClients;

  try {
    const parsed = JSON.parse(stored) as Client[];
    return Array.isArray(parsed) ? parsed : mockClients;
  } catch {
    return mockClients;
  }
}

export function useClients() {
  const [clients, setClients] = useState<Client[]>(readStoredClients);
  const visibleClients = useMemo(() => clients.filter((client) => client.status !== 'Arquivado'), [clients]);
  const archivedClients = useMemo(() => clients.filter((client) => client.status === 'Arquivado'), [clients]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) setClients(readStoredClients());
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return useMemo(() => ({
    clients: visibleClients,
    allClients: clients,
    archivedClients,
    addClient(input: NewClientInput) {
      const client: Client = {
        id: `client-${Date.now()}`,
        name: input.name.trim(),
        segment: input.segment.trim(),
        status: input.status,
      };

      setClients((prev) => [...prev, client]);
      logActivity('client_created', `Cliente ${client.name} criado no segmento ${client.segment}`);
      return client;
    },
    archiveClient(id: string) {
      setClients((prev) => prev.map((client) => (
        client.id === id ? { ...client, status: 'Arquivado' } : client
      )));
    },
    restoreClient(id: string) {
      setClients((prev) => prev.map((client) => (
        client.id === id ? { ...client, status: 'Ativo' } : client
      )));
    },
    deleteClient(id: string) {
      setClients((prev) => prev.filter((client) => client.id !== id));
    },
  }), [archivedClients, clients, visibleClients]);
}
