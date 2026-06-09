"use client";

import { mockUsers, type User } from '@/lib/mock-data';

const SESSION_STORAGE_KEY = 'onmid-session';

export type AuthSession = {
  userId: string;
  name: string;
  email: string;
  role: string;
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

  const session: AuthSession = { userId: user.id, name: user.name, email: user.email, role: user.role };
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function getAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as AuthSession;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function clearAuthSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}
