"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getAuthSession, clearAuthSession } from '@/lib/auth-store';
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
  '/ferramentas': ['Administrador', 'Usuário'],
  '/pagamentos':  ['Administrador', 'Usuário'],
  '/disparos':    ['Administrador', 'Usuário'],
  '/otimizacoes': ['Administrador', 'Usuário'],
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
  // /ferramentas/biblioteca-meta usa a mesma flag do Radar (o item na sidebar
  // também — ver nav-items.ts); ferramenta nova sob /ferramentas: decidir a flag.
  '/ferramentas': 'radar',
  '/pagamentos':  'pagamentos',
  '/disparos':    'disparos',
  '/otimizacoes': 'otimizador',
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

    // Uma única flag pros dois fetches: os caminhos de saída antecipada abaixo
    // também precisam cancelar a validação de sessão, senão ela redireciona
    // depois que o componente já saiu de tela.
    let active = true;
    const cleanup = () => { active = false; };

    // O localStorage não é mais autoridade: ele sobrevive à expiração do cookie
    // e a um logout feito em outra aba. Sem esta checagem, o usuário veria a
    // interface montada com todas as chamadas de API devolvendo 401.
    void fetch('/api/auth/me')
      .then((res) => {
        if (!active) return;
        if (res.status === 401) {
          clearAuthSession();
          router.replace('/');
        }
      })
      .catch(() => {});

    const role = session.role as Role;
    const allowedRoles = getAllowedRoles(pathname);
    if (!allowedRoles.includes(role)) {
      router.replace('/inicio');
      return cleanup;
    }

    const requiredFeature = getRequiredFeature(pathname);
    if (!requiredFeature) {
      setAllowed(true);
      return cleanup;
    }
    if (requiredFeature === 'otimizador' && role === 'Administrador') {
      setAllowed(true);
      return cleanup;
    }

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
      // Falha FECHADA. Antes isto era `setAllowed(true)`: qualquer erro em
      // /api/permissions (inclusive o 401 de quem não tem sessão) liberava a
      // tela. Agora volta pro início — a tela é secundária de qualquer forma,
      // já que as APIs por trás dela exigem sessão.
      .catch(() => { if (active) router.replace('/inicio'); });

    return cleanup;
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
