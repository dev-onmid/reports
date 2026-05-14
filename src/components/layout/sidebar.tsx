"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { clearAuthSession, getAuthSession } from '@/lib/auth-store';
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
  Library,
  MessageCircle,
  TableProperties,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_VERSION } from '@/lib/app-version';

type Role = 'Administrador' | 'Usuário' | 'Visualizador';

const navItems: { name: string; href: string; icon: React.ElementType; roles: Role[] }[] = [
  { name: 'Dashboard',   href: '/dashboard',   icon: LayoutDashboard, roles: ['Administrador', 'Usuário', 'Visualizador'] },
  { name: 'Clientes',    href: '/clientes',    icon: Users,           roles: ['Administrador', 'Usuário'] },
  { name: 'CRM',         href: '/crm',         icon: TableProperties, roles: ['Administrador', 'Usuário'] },
  { name: 'Relatórios',  href: '/relatorios',  icon: FileText,        roles: ['Administrador', 'Usuário'] },
  { name: 'Resultados',  href: '/resultados',  icon: BarChart3,       roles: ['Administrador', 'Usuário'] },
  { name: 'Pagamentos',  href: '/pagamentos',  icon: WalletCards,     roles: ['Administrador', 'Usuário'] },
  { name: 'Biblioteca',  href: '/biblioteca',  icon: Library,         roles: ['Administrador', 'Usuário'] },
  { name: 'Disparos',    href: '/disparos',    icon: MessageCircle,   roles: ['Administrador', 'Usuário'] },
  { name: 'Integrações', href: '/integracoes', icon: Plug,            roles: ['Administrador'] },
  { name: 'Logs',        href: '/logs',        icon: ClipboardList,   roles: ['Administrador'] },
];

export function Sidebar() {
  const pathname = usePathname();
  const session = getAuthSession();
  const role = (session?.role ?? 'Visualizador') as Role;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed');
    if (stored === 'true') setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed(prev => {
      localStorage.setItem('sidebar-collapsed', String(!prev));
      return !prev;
    });
  }

  const visibleItems = navItems.filter(item => item.roles.includes(role));
  const showConfiguracoes = role === 'Administrador';

  return (
    <aside className={cn(
      'bg-background border-r border-border h-screen flex flex-col sticky top-0 z-20 transition-all duration-200 shrink-0',
      collapsed ? 'w-16' : 'w-64'
    )}>
      {/* Header */}
      <div className={cn('h-20 flex items-center border-b border-border relative', collapsed ? 'justify-center' : 'px-5')}>
        {collapsed ? (
          <Link href="/dashboard">
            <img src="/brand/onmid-logo-white.png" alt="Onmid" className="h-6 w-auto object-contain" />
          </Link>
        ) : (
          <Link href="/dashboard" className="flex items-center gap-3 overflow-hidden">
            <img src="/brand/onmid-logo-white.png" alt="Onmid" className="h-8 w-auto max-w-[120px] object-contain" />
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary whitespace-nowrap">
              v{APP_VERSION}
            </span>
          </Link>
        )}
        <button
          onClick={toggle}
          className="absolute -right-3 top-1/2 -translate-y-1/2 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-card transition-all shadow-sm"
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 py-6 space-y-1 overflow-y-auto', collapsed ? 'px-2' : 'px-3')}>
        {!collapsed && (
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4 px-3">Menu Principal</div>
        )}
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              title={collapsed ? item.name : undefined}
              className={cn(
                'flex items-center rounded-md text-sm font-semibold transition-all relative overflow-hidden',
                collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5',
                isActive
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:bg-card hover:text-foreground'
              )}
            >
              {isActive && !collapsed && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary shadow-[0_0_10px_rgba(85,245,47,0.8)]" />
              )}
              {isActive && collapsed && (
                <div className="absolute inset-0 rounded-md ring-1 ring-inset ring-primary/40 bg-primary/10" />
              )}
              <item.icon className={cn('w-5 h-5 shrink-0 relative z-10', isActive ? 'text-primary drop-shadow-[0_0_5px_rgba(85,245,47,0.5)]' : '')} />
              {!collapsed && item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={cn('border-t border-border space-y-1 bg-background', collapsed ? 'px-2 py-3' : 'p-3')}>
        {showConfiguracoes && (
          <Link
            href="/configuracoes"
            title={collapsed ? 'Configurações' : undefined}
            className={cn(
              'flex items-center rounded-md text-sm font-medium text-muted-foreground hover:bg-card hover:text-foreground transition-all',
              collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
            )}
          >
            <Settings className="w-5 h-5 shrink-0" />
            {!collapsed && 'Configurações'}
          </Link>
        )}
        <Link
          href="/"
          onClick={() => clearAuthSession()}
          title={collapsed ? 'Sair' : undefined}
          className={cn(
            'flex items-center rounded-md text-sm font-medium text-destructive/80 hover:text-destructive hover:bg-destructive/10 transition-all',
            collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
          )}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && 'Sair'}
        </Link>
      </div>
    </aside>
  );
}
