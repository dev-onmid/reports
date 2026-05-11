"use client";

import { getAuthSession } from '@/lib/auth-store';

export type ActivityType = 'payment_added' | 'payment_deleted' | 'client_created' | 'client_status_updated';

export type ActivityEntry = {
  id: string;
  type: ActivityType;
  actor: string;
  description: string;
  timestamp: string;
};

export const CURRENT_USER = 'Matheus Campos';

export function logActivity(type: ActivityType, description: string): void {
  const session = typeof window !== 'undefined' ? getAuthSession() : null;
  const actor = session?.name ?? CURRENT_USER;

  void fetch('/api/activity-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      actor,
      description,
    }),
  }).catch((e) => console.error('Erro ao salvar log:', e));
}

export async function readActivityLog(): Promise<ActivityEntry[]> {
  try {
    const res = await fetch('/api/activity-logs');
    if (!res.ok) return [];
    return res.json() as Promise<ActivityEntry[]>;
  } catch {
    return [];
  }
}

export async function clearActivityLog(): Promise<void> {
  await fetch('/api/activity-logs', { method: 'DELETE' }).catch(() => {});
}
