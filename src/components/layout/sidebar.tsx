"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { clearAuthSession, getAuthSession, useMyPermissions } from '@/lib/auth-store';
import type { Permission } from '@/lib/mock-data';
import {
  LayoutDashboard,
  Users,
  FileText,
  Settings,
  LogOut,
  Plug,
  WalletCards,
  ClipboardList,
  BarChart3,
  MessageCircle,
  TableProperties,
  ChevronLeft,
  ChevronRight,
  Zap,
  Bot,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_VERSION } from '@/lib/app-version';

type Role = 'Administrador' | 'Usuário' | 'Visualizador';
type SidebarMode = 'desktop' | 'mobile';

const navItems: { name: string; href: string; icon: React.ElementType; key: keyof Permission }[] = [
  { name: 'Dashboard',   href: '/dashboard',   icon: LayoutDashboard, key: 'dashboard' },
  { name: 'Clientes',    href: '/clientes',    icon: Users,           key: 'clientes' },
  { name: 'CRM',         href: '/crm',         icon: TableProperties, key: 'crm' },
  { name: 'Relatórios',  href: '/relatorios',  icon: FileText,        key: 'relatorios' },
  { name: 'Radar',       href: '/resultados',  icon: BarChart3,       key: 'radar' },
  { name: 'Pagamentos',  href: '/pagamentos',  icon: WalletCards,     key: 'pagamentos' },
  { name: 'Disparos',    href: '/disparos',    icon: MessageCircle,   key: 'disparos' },
  { name: 'Luna IA',     href: '/agente',      icon: Bot,             key: 'luna_ia' },
  { name: 'Cofre',       href: '/vault',       icon: ShieldCheck,     key: 'cofre' },
  { name: 'Automações',  href: '/automacoes',  icon: Zap,             key: 'automacoes' },
  { name: 'Integrações', href: '/integracoes', icon: Plug,            key: 'integracoes' },
  { name: 'Logs',        href: '/logs',        icon: ClipboardList,   key: 'logs' },
];

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

  const visibleItems = navItems.filter(item => permissions[item.key]);
  const showConfiguracoes = role === 'Administrador';
  const isCollapsed = !isMobile && collapsed;

  return (
    <aside className={cn(
      'bg-background border-r border-border h-screen flex flex-col sticky top-0 z-20 transition-all duration-200 shrink-0',
      isCollapsed ? 'w-16' : 'w-64',
      className
    )}>
      {/* Header */}
      <div className={cn('h-14 flex items-center border-b border-border relative', isCollapsed ? 'justify-center' : 'px-5')}>
        {isCollapsed ? (
          <Link href="/dashboard" onClick={onNavigate}>
            <img src="/brand/onmid-logo-white.png" alt="Onmid" className="h-6 w-auto object-contain" />
          </Link>
        ) : (
          <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-3 overflow-hidden">
            <img src="/brand/onmid-logo-white.png" alt="Onmid" className="h-8 w-auto max-w-[120px] object-contain" />
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
      <nav className={cn('flex-1 py-6 space-y-1 overflow-y-auto', isCollapsed ? 'px-2' : 'px-3')}>
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
        })}
      </nav>

      {/* Footer */}
      <div className={cn('border-t border-border space-y-1 bg-background', isCollapsed ? 'px-2 py-3' : 'p-3')}>
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
