"use client";

import { useEffect, useMemo, useState } from 'react';
import { logActivity } from '@/lib/activity-log-store';
import { type Client, type ClientStatus, type DashboardType } from '@/lib/mock-data';

const CLIENTS_UPDATED_EVENT = 'clients-updated';

export const CURRENT_USER_ROLE = 'Administrador';

export type NewClientInput = {
  name: string;
  segment: string;
  status: ClientStatus;
  gestor_id?: string;
  category_id?: string;
  dashboard_type?: DashboardType;
};

export function canManageClients(role = CURRENT_USER_ROLE): boolean {
  return role === 'Administrador';
}

async function apiClients(method: string, body?: unknown, id?: string): Promise<Response> {
  const url = id ? `/api/clients?id=${encodeURIComponent(id)}` : '/api/clients';
  return fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function useClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const visibleClients = useMemo(() => clients.filter((c) => c.status !== 'Arquivado' && c.status !== 'Inativo'), [clients]);
  const archivedClients = useMemo(() => clients.filter((c) => c.status === 'Arquivado' || c.status === 'Inativo'), [clients]);

  async function load() {
    try {
      const res = await fetch('/api/clients');
      if (!res.ok) return;
      const data: Client[] = await res.json();
      setClients(data);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
    }
  }

  useEffect(() => {
    void load();
    window.addEventListener(CLIENTS_UPDATED_EVENT, load);
    return () => window.removeEventListener(CLIENTS_UPDATED_EVENT, load);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        gestor_id: input.gestor_id,
        category_id: input.category_id,
        dashboard_type: input.dashboard_type ?? 'leads',
      };
      setClients((prev) => [...prev, client]);
      void apiClients('POST', client).then(() => {
        window.dispatchEvent(new Event(CLIENTS_UPDATED_EVENT));
      }).catch((e) => console.error('Erro ao salvar cliente:', e));
      logActivity('client_created', `Cliente ${client.name} criado no segmento ${client.segment}`);
      return client;
    },

    updateClientGestor(id: string, gestorId: string | null) {
      setClients((prev) => prev.map((c) => c.id === id ? { ...c, gestor_id: gestorId ?? undefined } : c));
      void apiClients('PATCH', { gestor_id: gestorId }, id)
        .then(() => window.dispatchEvent(new Event(CLIENTS_UPDATED_EVENT)))
        .catch((e) => console.error('Erro ao atualizar gestor:', e));
    },

    archiveClient(id: string) {
      setClients((prev) => prev.map((c) => c.id === id ? { ...c, status: 'Arquivado' as ClientStatus } : c));
      void apiClients('PATCH', { status: 'Arquivado' }, id)
        .then(() => window.dispatchEvent(new Event(CLIENTS_UPDATED_EVENT)))
        .catch((e) => console.error('Erro ao arquivar cliente:', e));
    },

    restoreClient(id: string) {
      setClients((prev) => prev.map((c) => c.id === id ? { ...c, status: 'Ativo' as ClientStatus } : c));
      void apiClients('PATCH', { status: 'Ativo' }, id)
        .then(() => window.dispatchEvent(new Event(CLIENTS_UPDATED_EVENT)))
        .catch((e) => console.error('Erro ao restaurar cliente:', e));
    },

    setClientStatus(id: string, status: ClientStatus) {
      const target = clients.find((c) => c.id === id);
      setClients((prev) => prev.map((c) => c.id === id ? { ...c, status } : c));
      void apiClients('PATCH', { status }, id)
        .then(() => window.dispatchEvent(new Event(CLIENTS_UPDATED_EVENT)))
        .catch((e) => console.error('Erro ao atualizar status:', e));
      logActivity('client_status_updated', `Cliente ${target?.name ?? id} atualizado para ${status}`);
    },

    deleteClient(id: string) {
      setClients((prev) => prev.filter((c) => c.id !== id));
      void apiClients('DELETE', undefined, id)
        .then((res) => {
          if (res.ok) window.dispatchEvent(new Event(CLIENTS_UPDATED_EVENT));
          else void load();
        })
        .catch((e) => { console.error('Erro ao excluir cliente:', e); void load(); });
    },
  }), [archivedClients, clients, visibleClients]); // eslint-disable-line react-hooks/exhaustive-deps
}
