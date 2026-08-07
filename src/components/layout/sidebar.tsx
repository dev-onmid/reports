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
  ChevronDown,
  Wrench,
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

  function toggle() {
    setCollapsed(prev => {
      localStorage.setItem('sidebar-collapsed', String(!prev));
      return !prev;
    });
  }

  const visibleItems = NAV_ITEMS.filter(item => {
    if (isMobile && !item.mobile) return false;
    return permissions[item.key] || (item.key === 'otimizador' && role === 'Administrador');
  });
  // Grupo "Ferramentas": só apresentação — a permissão é a de cada item.
  const mainItems = visibleItems.filter(item => !item.group);
  const toolItems = visibleItems.filter(item => item.group === 'ferramentas');
  const isToolActive = toolItems.some(
    item => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const [toolsOpen, setToolsOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar-tools-open') === 'true';
  });
  // Grupo com item ativo nunca fica fechado — senão a tela atual some do menu.
  const toolsExpanded = toolsOpen || isToolActive;

  function toggleTools() {
    setToolsOpen(prev => {
      localStorage.setItem('sidebar-tools-open', String(!prev));
      return !prev;
    });
  }

  const showConfiguracoes = role === 'Administrador' && !isMobile;
  const isCollapsed = !isMobile && collapsed;

  const isHomeActive = pathname === '/inicio' || pathname.startsWith('/inicio/');

  function renderNavLink(item: (typeof NAV_ITEMS)[number], indented = false) {
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.name}
        href={item.href}
        title={isCollapsed ? item.name : undefined}
        onClick={onNavigate}
        className={cn(
          'flex items-center rounded-md text-sm font-semibold transition-all relative overflow-hidden',
          isCollapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 py-2.5 pr-3',
          !isCollapsed && (indented ? 'pl-7' : 'pl-3'),
          isActive
            ? 'text-primary bg-primary/10'
            : 'text-muted-foreground hover:bg-card hover:text-foreground'
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
  }

  return (
    <aside className={cn(
      'h-screen flex flex-col sticky top-0 z-20 transition-all duration-200 shrink-0',
      'bg-background border-r border-border',
      isCollapsed ? 'w-16' : 'w-64',
      className
    )}>
      {/* Header */}
      <div className={cn('h-14 flex items-center relative border-b border-border', isCollapsed ? 'justify-center' : 'px-5')}>
        {isCollapsed ? (
          <Link href="/inicio" onClick={onNavigate}>
            <img src="/brand/onmid-logo-white.png" alt="Onmid" className="h-6 w-auto object-contain" />
          </Link>
        ) : (
          <Link href="/inicio" onClick={onNavigate} className="flex items-center gap-3 overflow-hidden">
            <img src="/brand/onmid-logo-white.png" alt="Onmid" className="h-8 max-w-[120px] w-auto object-contain" />
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary whitespace-nowrap">
              v{APP_VERSION}
            </span>
          </Link>
        )}
        {!isMobile && (
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
      <nav className={cn('flex-1 space-y-1 overflow-y-auto py-6', isCollapsed ? 'px-2' : 'px-3')}>
        {/* Início — sempre visível, sem trava de permissão */}
        <Link
          href="/inicio"
          title={isCollapsed ? 'Início' : undefined}
          onClick={onNavigate}
          className={cn(
            'flex items-center rounded-md text-sm font-semibold transition-all relative overflow-hidden',
            isCollapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5',
            isHomeActive
              ? 'text-primary bg-primary/10'
              : 'text-muted-foreground hover:bg-card hover:text-foreground'
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

        {mainItems.map((item) => renderNavLink(item))}

        {toolItems.length > 0 && (
          isCollapsed ? (
            // Menu recolhido: sem cabeçalho de grupo — só um divisor e os ícones.
            <>
              <div className="mx-2 my-2 border-t border-border" />
              {toolItems.map((item) => renderNavLink(item))}
            </>
          ) : (
            <div>
              <button
                onClick={toggleTools}
                aria-expanded={toolsExpanded}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-all',
                  isToolActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:bg-card hover:text-foreground',
                )}
              >
                <Wrench className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left">Ferramentas</span>
                <ChevronDown
                  className={cn('w-4 h-4 shrink-0 transition-transform', toolsExpanded ? 'rotate-180' : '')}
                />
              </button>
              {toolsExpanded && (
                <div className="mt-1 space-y-1">
                  {toolItems.map((item) => renderNavLink(item, true))}
                </div>
              )}
            </div>
          )
        )}
      </nav>

      {/* Footer */}
      <div className={cn('space-y-1 border-t border-border bg-background', isCollapsed ? 'px-2 py-3' : 'p-3')}>
        {showConfiguracoes && (
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
