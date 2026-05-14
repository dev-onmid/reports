"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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

  const visibleItems = navItems.filter(item => item.roles.includes(role));
  const showConfiguracoes = role === 'Administrador';

  return (
    <aside className="w-64 bg-background border-r border-border h-screen flex flex-col sticky top-0 relative z-20">
      <div className="h-20 flex items-center px-6 border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-3">
          <img
            src="/brand/onmid-logo-white.png"
            alt="Onmid"
            className="h-8 w-auto max-w-[160px] object-contain"
          />
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            v{APP_VERSION}
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-8 space-y-2 overflow-y-auto">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-6 px-3">Menu Principal</div>
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-semibold transition-all relative overflow-hidden",
                isActive
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:bg-card hover:text-foreground"
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary shadow-[0_0_10px_rgba(85,245,47,0.8)]" />
              )}
              <item.icon className={cn("w-5 h-5", isActive ? "text-primary drop-shadow-[0_0_5px_rgba(85,245,47,0.5)]" : "text-muted-foreground")} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border space-y-2 bg-background">
        {showConfiguracoes && (
          <Link
            href="/configuracoes"
            className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-muted-foreground hover:bg-card hover:text-foreground transition-all"
          >
            <Settings className="w-5 h-5" />
            Configurações
          </Link>
        )}
        <Link
          href="/"
          onClick={() => clearAuthSession()}
          className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-destructive/80 hover:text-destructive hover:bg-destructive/10 transition-all"
        >
          <LogOut className="w-5 h-5" />
          Sair
        </Link>
      </div>
    </aside>
  );
}
