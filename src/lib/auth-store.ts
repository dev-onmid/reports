"use client";

import { mockUsers, type User } from '@/lib/mock-data';
import { supabase } from '@/lib/supabase';

const SESSION_STORAGE_KEY = 'onmid-session';

export type AuthSession = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

async function loadAuthUsers(): Promise<User[]> {
  let users: User[] = [];
  try {
    const { data } = await supabase.from('users').select('*');
    if (data && data.length > 0) {
      users = data.map((u) => ({ id: u.id, name: u.name, email: u.email, password: u.password, role: u.role, status: u.status }));
    }
  } catch {
    // fall back to mock users if Supabase not available
  }

  if (users.length === 0) users = mockUsers;
  return users;
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
