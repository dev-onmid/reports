"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getAuthSession } from '@/lib/auth-store';
import { defaultPermission, type Permission } from '@/lib/mock-data';

type Role = 'Administrador' | 'Usuário' | 'Visualizador';

const routeRoles: Record<string, Role[]> = {
  // /inicio is the system's free landing — everyone gets in, no feature gate.
  // It's also the safe redirect target so denied users never loop.
  '/inicio':      ['Administrador', 'Usuário', 'Visualizador'],
  '/dashboard':   ['Administrador', 'Usuário', 'Visualizador'],
  '/clientes':    ['Administrador', 'Usuário'],
  '/crm':         ['Administrador', 'Usuário'],
  '/relatorios':  ['Administrador', 'Usuário'],
  '/resultados':  ['Administrador', 'Usuário'],
  '/pagamentos':  ['Administrador', 'Usuário'],
  '/biblioteca':  ['Administrador', 'Usuário'],
  '/disparos':    ['Administrador', 'Usuário'],
  '/agente':      ['Administrador', 'Usuário'],
  '/vault':       ['Administrador', 'Usuário'],
  '/automacoes':  ['Administrador'],
  '/integracoes': ['Administrador'],
  '/logs':        ['Administrador'],
  '/configuracoes': ['Administrador'],
};

// Feature gate per route, checked against the user's live permissions on top of
// the role check above. Routes not listed here (e.g. /configuracoes) are role-only.
const routeFeature: Record<string, keyof Permission> = {
  '/dashboard':   'dashboard',
  '/clientes':    'clientes',
  '/crm':         'crm',
  '/relatorios':  'relatorios',
  '/resultados':  'radar',
  '/pagamentos':  'pagamentos',
  '/disparos':    'disparos',
  '/agente':      'luna_ia',
  '/vault':       'cofre',
  '/automacoes':  'automacoes',
  '/integracoes': 'integracoes',
  '/logs':        'logs',
};

function getAllowedRoles(pathname: string): Role[] {
  for (const [route, roles] of Object.entries(routeRoles)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return roles;
  }
  return ['Administrador', 'Usuário', 'Visualizador'];
}

function getRequiredFeature(pathname: string): keyof Permission | null {
  for (const [route, feature] of Object.entries(routeFeature)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return feature;
  }
  return null;
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const session = getAuthSession();
    if (!session) {
      router.replace('/');
      return;
    }

    const role = session.role as Role;
    const allowedRoles = getAllowedRoles(pathname);
    if (!allowedRoles.includes(role)) {
      router.replace('/inicio');
      return;
    }

    const requiredFeature = getRequiredFeature(pathname);
    if (!requiredFeature) {
      setAllowed(true);
      return;
    }

    let active = true;
    setAllowed(false);
    void fetch('/api/permissions')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Record<string, Permission>>;
      })
      .then((map) => {
        if (!active) return;
        const permissions = map[session.userId] ?? defaultPermission;
        if (!permissions[requiredFeature]) {
          router.replace('/inicio');
          return;
        }
        setAllowed(true);
      })
      .catch(() => { if (active) setAllowed(true); }); // fail open: the endpoint itself errored, not a denied permission

    return () => { active = false; };
  }, [router, pathname]);

  if (!allowed) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Validando acesso...
      </div>
    );
  }

  return children;
}
