"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { clearAuthSession, getAuthSession, useMyPermissions } from '@/lib/auth-store';
import { NAV_ITEMS } from '@/lib/nav-items';
import {
  Home,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_VERSION } from '@/lib/app-version';

type Role = 'Administrador' | 'Usuário' | 'Visualizador';
type SidebarMode = 'desktop' | 'mobile';

export function Sidebar({
  className,
  mode = 'desktop',
  onNavigate,
}: {
  className?: string;
  mode?: SidebarMode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const session = getAuthSession();
  const role = (session?.role ?? 'Visualizador') as Role;
  const { permissions } = useMyPermissions();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });
  const isMobile = mode === 'mobile';
  const isDashboardRoute = pathname === '/dashboard';

  function toggle() {
    setCollapsed(prev => {
      localStorage.setItem('sidebar-collapsed', String(!prev));
      return !prev;
    });
  }

  const visibleItems = NAV_ITEMS.filter(item => {
    const allowed = permissions[item.key] || (item.key === 'otimizador' && role === 'Administrador');
    if (!isDashboardRoute) return allowed;
    return allowed && ['dashboard', 'clientes', 'crm', 'relatorios', 'automacoes', 'integracoes'].includes(item.key);
  });
  const showConfiguracoes = role === 'Administrador';
  const isCollapsed = !isMobile && collapsed;

  const isHomeActive = pathname === '/inicio' || pathname.startsWith('/inicio/');

  return (
    <aside className={cn(
      'h-screen flex flex-col sticky top-0 z-20 transition-all duration-200 shrink-0',
      isDashboardRoute ? 'border-r border-white/[0.08] bg-[#060A0D]' : 'bg-background border-r border-border',
      isCollapsed ? 'w-16' : isDashboardRoute ? 'w-[220px]' : 'w-64',
      className
    )}>
      {/* Header */}
      <div className={cn('h-14 flex items-center relative', isDashboardRoute ? 'border-b border-white/[0.08]' : 'border-b border-border', isCollapsed ? 'justify-center' : 'px-5')}>
        {isCollapsed ? (
          <Link href="/inicio" onClick={onNavigate}>
            <img src="/brand/onmid-logo-white.png" alt="Onmid" className="h-6 w-auto object-contain" />
          </Link>
        ) : (
          <Link href="/inicio" onClick={onNavigate} className="flex items-center gap-3 overflow-hidden">
            <img src="/brand/onmid-logo-white.png" alt="Onmid" className={cn('w-auto object-contain', isDashboardRoute ? 'h-7 max-w-[112px]' : 'h-8 max-w-[120px]')} />
            {!isDashboardRoute && <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary whitespace-nowrap">
              v{APP_VERSION}
            </span>}
          </Link>
        )}
        {!isMobile && !isDashboardRoute && (
          <button
            onClick={toggle}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className="absolute -right-3 top-1/2 -translate-y-1/2 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-card transition-all shadow-sm"
          >
            {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 space-y-1 overflow-y-auto', isDashboardRoute ? 'py-5' : 'py-6', isCollapsed ? 'px-2' : 'px-3')}>
        {/* Início — sempre visível, sem trava de permissão (porta de entrada do sistema) */}
        <Link
          href="/inicio"
          title={isCollapsed ? 'Início' : undefined}
          onClick={onNavigate}
          className={cn(
            'flex items-center rounded-md text-sm font-semibold transition-all relative overflow-hidden',
            isCollapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5',
            isHomeActive
              ? 'text-primary bg-primary/10'
              : isDashboardRoute ? 'text-[#A7B0B6] hover:bg-white/[0.05] hover:text-[#F4F7F8]' : 'text-muted-foreground hover:bg-card hover:text-foreground'
          )}
        >
          {isHomeActive && !isCollapsed && (
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary shadow-[0_0_10px_rgba(85,245,47,0.8)]" />
          )}
          {isHomeActive && isCollapsed && (
            <div className="absolute inset-0 rounded-md ring-1 ring-inset ring-primary/40 bg-primary/10" />
          )}
          <Home className={cn('w-5 h-5 shrink-0 relative z-10', isHomeActive ? 'text-primary drop-shadow-[0_0_5px_rgba(85,245,47,0.5)]' : '')} />
          {!isCollapsed && 'Início'}
        </Link>
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              title={isCollapsed ? item.name : undefined}
              onClick={onNavigate}
              className={cn(
                'flex items-center rounded-md text-sm font-semibold transition-all relative overflow-hidden',
                isCollapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5',
                isActive
                  ? 'text-primary bg-primary/10'
                  : isDashboardRoute ? 'text-[#A7B0B6] hover:bg-white/[0.05] hover:text-[#F4F7F8]' : 'text-muted-foreground hover:bg-card hover:text-foreground'
              )}
            >
              {isActive && !isCollapsed && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary shadow-[0_0_10px_rgba(85,245,47,0.8)]" />
              )}
              {isActive && isCollapsed && (
                <div className="absolute inset-0 rounded-md ring-1 ring-inset ring-primary/40 bg-primary/10" />
              )}
              <item.icon className={cn('w-5 h-5 shrink-0 relative z-10', isActive ? 'text-primary drop-shadow-[0_0_5px_rgba(85,245,47,0.5)]' : '')} />
              {!isCollapsed && item.name}
            </Link>
          );
        })}
        {isDashboardRoute && showConfiguracoes && (
          <Link
            href="/configuracoes"
            title={isCollapsed ? 'Configurações' : undefined}
            onClick={onNavigate}
            className={cn(
              'flex items-center rounded-md text-sm font-semibold text-[#A7B0B6] transition-all hover:bg-white/[0.05] hover:text-[#F4F7F8]',
              isCollapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
            )}
          >
            <Settings className="w-5 h-5 shrink-0" />
            {!isCollapsed && 'Configurações'}
          </Link>
        )}
      </nav>

      {/* Footer */}
      <div className={cn('space-y-1', isDashboardRoute ? 'border-t border-white/[0.08] bg-[#060A0D]' : 'border-t border-border bg-background', isCollapsed ? 'px-2 py-3' : 'p-3')}>
        {isDashboardRoute && !isCollapsed && (
          <div className="mb-2 flex items-center gap-3 rounded-xl px-2 py-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#78D957] text-sm font-black text-black">
              {(session?.name ?? 'M').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-[#F4F7F8]">{session?.name ?? 'Matheus'}</span>
              <span className="block truncate text-[11px] text-[#9AA4AA]">{session?.role ?? 'Administrador'}</span>
            </span>
          </div>
        )}
        {showConfiguracoes && !isDashboardRoute && (
          <Link
            href="/configuracoes"
            title={isCollapsed ? 'Configurações' : undefined}
            onClick={onNavigate}
            className={cn(
              'flex items-center rounded-md text-sm font-medium text-muted-foreground hover:bg-card hover:text-foreground transition-all',
              isCollapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
            )}
          >
            <Settings className="w-5 h-5 shrink-0" />
            {!isCollapsed && 'Configurações'}
          </Link>
        )}
        <Link
          href="/"
          onClick={() => clearAuthSession()}
          title={isCollapsed ? 'Sair' : undefined}
          className={cn(
            'flex items-center rounded-md text-sm font-medium text-destructive/80 hover:text-destructive hover:bg-destructive/10 transition-all',
            isCollapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
          )}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!isCollapsed && 'Sair'}
        </Link>
      </div>
    </aside>
  );
}
