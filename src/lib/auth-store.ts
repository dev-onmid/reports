"use client";

import { mockUsers, type User } from '@/lib/mock-data';

const USERS_STORAGE_KEY = 'onmid-users';
const SESSION_STORAGE_KEY = 'onmid-session';

export type AuthSession = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

function readUsers(): User[] {
  if (typeof window === 'undefined') return mockUsers;

  const stored = window.localStorage.getItem(USERS_STORAGE_KEY);
  if (!stored) return mockUsers;

  try {
    const parsed = JSON.parse(stored) as Partial<User>[];
    if (!Array.isArray(parsed)) return mockUsers;

    return parsed.map((user) => ({
      id: user.id ?? `user-${Date.now()}`,
      name: user.name ?? '',
      email: user.email === 'matheus' ? 'matheus@onmid.com.br' : user.email ?? '',
      password: user.password ?? mockUsers.find((item) => item.email === user.email || (user.email === 'matheus' && item.email === 'matheus@onmid.com.br'))?.password ?? '',
      role: user.role ?? 'Usuário',
      status: user.status ?? 'Ativo',
    }));
  } catch {
    return mockUsers;
  }
}

export function authenticateUser(email: string, password: string): AuthSession | null {
  if (typeof window === 'undefined') return null;

  const normalizedEmail = email.trim().toLowerCase();
  const user = readUsers().find((item) => (
    item.email.trim().toLowerCase() === normalizedEmail &&
    item.password === password &&
    item.status === 'Ativo'
  ));

  if (!user) return null;

  const session = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

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
