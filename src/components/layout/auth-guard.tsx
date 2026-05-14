"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getAuthSession } from '@/lib/auth-store';

type Role = 'Administrador' | 'Usuário' | 'Visualizador';

const routeRoles: Record<string, Role[]> = {
  '/dashboard':   ['Administrador', 'Usuário', 'Visualizador'],
  '/clientes':    ['Administrador', 'Usuário'],
  '/crm':         ['Administrador', 'Usuário'],
  '/relatorios':  ['Administrador', 'Usuário'],
  '/resultados':  ['Administrador', 'Usuário'],
  '/pagamentos':  ['Administrador', 'Usuário'],
  '/biblioteca':  ['Administrador', 'Usuário'],
  '/disparos':    ['Administrador', 'Usuário'],
  '/integracoes': ['Administrador'],
  '/logs':        ['Administrador'],
  '/configuracoes': ['Administrador'],
};

function getAllowedRoles(pathname: string): Role[] {
  for (const [route, roles] of Object.entries(routeRoles)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return roles;
  }
  return ['Administrador', 'Usuário', 'Visualizador'];
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
      router.replace('/dashboard');
      return;
    }

    setAllowed(true);
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
