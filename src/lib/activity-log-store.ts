"use client";

import { supabase } from '@/lib/supabase';
import { getAuthSession } from '@/lib/auth-store';

export type ActivityType = 'payment_added' | 'payment_deleted' | 'client_created';

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

  void supabase.from('activity_logs').insert({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    actor,
    description,
    created_at: new Date().toISOString(),
  });
}

export async function readActivityLog(): Promise<ActivityEntry[]> {
  const { data } = await supabase
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    type: r.type as ActivityType,
    actor: r.actor,
    description: r.description,
    timestamp: r.created_at,
  }));
}

export async function clearActivityLog(): Promise<void> {
  await supabase.from('activity_logs').delete().neq('id', 'none');
}
