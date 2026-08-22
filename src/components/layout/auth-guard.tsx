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
  const [indisponivel, setIndisponivel] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const session = getAuthSession();
    if (!session) {
      router.replace(`/?next=${encodeURIComponent(pathname)}`);
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
    //
    // auditoria 2026-08-22: só o 401 desloga. Erro de infraestrutura (503/5xx
    // ou rede) mostra aviso com "tentar de novo" — antes qualquer piscada do
    // banco expulsava o usuário com a sessão ainda válida.
    setIndisponivel(false);
    void fetch('/api/auth/me')
      .then((res) => {
        if (!active) return;
        if (res.status === 401) {
          clearAuthSession();
          router.replace(`/?expirado=1&next=${encodeURIComponent(pathname)}`);
          return;
        }
        if (!res.ok) setIndisponivel(true);
      })
      .catch(() => { if (active) setIndisponivel(true); });

    const role = session.role as Role;
    const allowedRoles = getAllowedRoles(pathname);
    if (!allowedRoles.includes(role)) {
      // Fechar ANTES de navegar: senão a tela proibida monta e dispara fetches.
      setAllowed(false);
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
  }, [router, pathname, tentativa]);

  const avisoIndisponivel = (
    <span className="flex items-center gap-3">
      Não foi possível falar com o servidor. Sua sessão continua ativa.
      <button
        onClick={() => setTentativa((n) => n + 1)}
        className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-card"
      >
        Tentar de novo
      </button>
    </span>
  );

  if (!allowed) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4 text-center text-sm text-muted-foreground">
        {indisponivel ? avisoIndisponivel : 'Validando acesso...'}
      </div>
    );
  }

  return (
    <>
      {children}
      {indisponivel && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-amber-400/40 bg-card px-3 py-2 text-xs text-muted-foreground shadow-md">
          {avisoIndisponivel}
        </div>
      )}
    </>
  );
}
