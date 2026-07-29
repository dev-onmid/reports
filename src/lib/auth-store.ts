"use client";

import { useEffect, useState } from 'react';
import { defaultPermission, type Permission, type Team } from '@/lib/mock-data';

const SESSION_STORAGE_KEY = 'onmid-session';

export type AuthSession = {
  userId: string;
  name: string;
  email: string;
  role: string;
  team: Team;
};

/**
 * A senha é verificada no SERVIDOR e o cookie de sessão vem na resposta.
 *
 * O modelo anterior baixava todos os usuários (com senha) via
 * `/api/users?login=1` e comparava aqui no browser — qualquer visitante podia
 * chamar essa URL e ler as credenciais de todo mundo. Também não há mais
 * fallback pra `mockUsers`: derrubar a API era um caminho de login com as
 * credenciais fixas do código.
 *
 * O localStorage segue guardando a sessão só para a UI (nome, papel). Quem
 * autoriza de verdade é o cookie HttpOnly, que o JS não lê nem forja.
 */
export async function authenticateUser(email: string, password: string): Promise<AuthSession | null> {
  if (typeof window === 'undefined') return null;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = await res.json() as Partial<AuthSession>;
    if (!data?.userId) return null;

    const session: AuthSession = {
      userId: data.userId,
      name: data.name ?? '',
      email: data.email ?? '',
      role: data.role ?? '',
      team: (data.team as Team) ?? 'onmid',
    };
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  } catch {
    return null;
  }
}

/**
 * Reconfirma a senha do usuário antes de uma ação sensível.
 *
 * Antes isto baixava a lista de senhas e comparava no browser; agora a
 * checagem é server-side e a resposta traz só o papel. Devolve null quando a
 * credencial não confere.
 */
export async function verifyUserCredentials(email: string, password: string): Promise<{ role: string } | null> {
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; role?: string };
    return data?.ok ? { role: data.role ?? '' } : null;
  } catch {
    return null;
  }
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
  // Limpar só o localStorage deixaria o cookie de sessão vivo no servidor —
  // "sair" não teria efeito nenhum sobre o acesso real.
  void fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
}

/**
 * Mantido por compatibilidade com os call sites existentes, mas não é mais o
 * que autentica: o proxy SOBRESCREVE `x-onmid-user-id`/`x-onmid-role` com os
 * valores do cookie assinado antes da requisição chegar na rota. O que for
 * mandado daqui é ignorado — inclusive se for forjado.
 */
export function callerHeaders(): Record<string, string> {
  const session = getAuthSession();
  return session ? { 'x-onmid-user-id': session.userId, 'x-onmid-role': session.role } : {};
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
        // Falha FECHADA: antes isto caía em `allPermission`, então derrubar
        // /api/permissions liberava todas as telas pra qualquer sessão.
        if (active) setPermissions(defaultPermission);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, []);

  return { permissions, loading };
}
