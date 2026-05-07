"use client";

import { useEffect, useState } from 'react';
import { Bell, Search, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getAuthSession, type AuthSession } from '@/lib/auth-store';

import { ThemeToggle } from '@/components/theme-toggle';

export function Header() {
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
    <header className="h-16 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-between px-6 sticky top-0 z-10">
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar clientes, relatórios..."
            className="w-full pl-9 bg-muted/50 border-transparent focus-visible:ring-primary"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />
        </Button>
        
        <div className="flex items-center gap-3 border-l border-border pl-4">
          <div className="flex flex-col items-end">
            <span className="text-sm font-medium">{session?.name ?? 'Usuário'}</span>
            <span className="text-xs text-muted-foreground">{session?.role ?? 'Sem sessão'}</span>
          </div>
          <Avatar className="h-9 w-9 border border-border">
            <AvatarImage src="" alt="User" />
            <AvatarFallback className="bg-primary/20 text-primary">{initials}</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
