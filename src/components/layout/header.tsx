"use client";

import { useEffect, useState } from 'react';
import { Bell, Menu, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getAuthSession, type AuthSession } from '@/lib/auth-store';
import { BackButton } from './back-button';
import { ThemeToggle } from '@/components/theme-toggle';

export function Header({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    setSession(getAuthSession());
  }, []);

  const initials = session?.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'ON';

  return (
    <header className="h-14 border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-10 flex items-center gap-1.5 px-3 sm:px-4">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onOpenSidebar}
        className="md:hidden"
        aria-label="Abrir navegação"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <BackButton />

      <div className="flex-1" />

      {/* Search */}
      <div className="relative hidden lg:block w-44 xl:w-52">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          placeholder="Buscar clientes, relatórios..."
          className="pl-9 bg-muted/50 border-transparent focus-visible:ring-primary text-xs h-9"
        />
      </div>

      <ThemeToggle />

      <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors">
        <Bell className="h-5 w-5" />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />
      </button>

      <div className="flex items-center gap-2.5 border-l border-border pl-2 sm:pl-3">
        <div className="hidden md:flex flex-col items-end leading-none gap-0.5">
          <span className="text-sm font-medium">{session?.name ?? 'Usuário'}</span>
          <span className="text-[11px] text-muted-foreground">{session?.role ?? ''}</span>
        </div>
        <Avatar className="h-8 w-8 border border-border">
          <AvatarImage src="" alt="User" />
          <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">{initials}</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
