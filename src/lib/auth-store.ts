"use client";

import { useEffect, useState } from 'react';
import { mockUsers, defaultPermission, allPermission, type User, type Permission, type Team } from '@/lib/mock-data';

const SESSION_STORAGE_KEY = 'onmid-session';

export type AuthSession = {
  userId: string;
  name: string;
  email: string;
  role: string;
  team: Team;
};

async function loadAuthUsers(): Promise<User[]> {
  try {
    const res = await fetch('/api/users?login=1');
    if (res.ok) {
      const data = await res.json() as User[];
      if (data && data.length > 0) return data;
    }
  } catch {
    // fall back to mock users if API not available
  }
  return mockUsers;
}

export async function verifyUserCredentials(email: string, password: string): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const users = await loadAuthUsers();

  const user = users.find((u) => (
    u.email.trim().toLowerCase() === normalizedEmail &&
    u.password === password &&
    u.status === 'Ativo'
  ));

  if (!user) return null;
  return user;
}

export async function authenticateUser(email: string, password: string): Promise<AuthSession | null> {
  if (typeof window === 'undefined') return null;

  const user = await verifyUserCredentials(email, password);
  if (!user) return null;

  const session: AuthSession = { userId: user.id, name: user.name, email: user.email, role: user.role, team: user.team ?? 'onmid' };
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function getAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<AuthSession>;
    // Sessions created before the `team` field existed default to 'onmid'.
    return { team: 'onmid', ...parsed } as AuthSession;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function clearAuthSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

/**
 * Identifies the logged-in user to API routes that need to scope data per-caller
 * (e.g. Disparos: a "parceiro" only sees their own instances/campaigns). This app
 * has no server session of its own, so — like /api/permissions — the server trusts
 * whatever id the client reports here. Spread into a fetch's `headers` option.
 */
export function callerHeaders(): Record<string, string> {
  const session = getAuthSession();
  return session ? { 'x-onmid-user-id': session.userId } : {};
}

/**
 * Live permissions for the logged-in user. Fetches on every mount so that
 * access granted by an admin shows up without requiring a re-login.
 */
export function useMyPermissions(): { permissions: Permission; loading: boolean } {
  const [permissions, setPermissions] = useState<Permission>(defaultPermission);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = getAuthSession();
    if (!session) { setLoading(false); return; }

    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/permissions');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const map = await res.json() as Record<string, Permission>;
        if (active) {
          const current = map[session.userId] ?? defaultPermission;
          setPermissions(
            session.role === 'Administrador'
              ? { ...current, otimizador: true }
              : current,
          );
        }
      } catch {
        // The endpoint itself failed (not "no permission row") — fail open.
        if (active) setPermissions(allPermission);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, []);

  return { permissions, loading };
}
