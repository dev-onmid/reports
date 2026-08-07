"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AtSign, BarChart3, Clapperboard } from 'lucide-react';
import { cn } from '@/lib/utils';

// A Biblioteca Meta (baixar criativos) NÃO é aba daqui — mora no grupo
// "Ferramentas" da sidebar, em /ferramentas/biblioteca-meta.
const TABS = [
  { label: 'Radar', href: '/resultados', icon: BarChart3 },
  { label: 'Redes Sociais', href: '/resultados/redes-sociais', icon: AtSign },
  { label: 'Criativos', href: '/resultados/criativos', icon: Clapperboard },
];

// Tab-nav do módulo Radar (/resultados e subrotas). A subrota herda a flag
// de permissão `radar` pelo match por prefixo do auth-guard — nada extra a configurar.
export function ResultsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
      {TABS.map(({ label, href, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-bold uppercase tracking-wide border-b-2 -mb-px transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
