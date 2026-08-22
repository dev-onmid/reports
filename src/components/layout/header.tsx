"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, Menu, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getAuthSession, type AuthSession } from '@/lib/auth-store';
import { useClients } from '@/lib/client-store';
import { BackButton } from './back-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { AIUsagePill } from './ai-usage-pill';

type Notificacao = {
  id: string;
  titulo: string;
  descricao: string | null;
  href: string | null;
  severidade: 'critico' | 'atencao' | 'info';
  lida_em: string | null;
};

const DOT_SEVERIDADE: Record<Notificacao['severidade'], string> = {
  critico: 'bg-destructive',
  atencao: 'bg-amber-400',
  info: 'bg-muted-foreground',
};

/** Acento/caixa fora do caminho — "Panino'77" tem que casar com "panino". */
function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function Header({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [busca, setBusca] = useState('');
  const [buscaAberta, setBuscaAberta] = useState(false);
  const { clients } = useClients();

  useEffect(() => {
    setSession(getAuthSession());
  }, []);

  // auditoria 2026-08-22: o sino era decorativo (bolinha sempre acesa) — agora
  // lê a caixa real e o ponto só aparece quando há não-lida.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const res = await fetch('/api/notificacoes?limit=8');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as {
          itens?: Notificacao[];
          contadores?: { naoLidas?: number };
        };
        if (!ativo) return;
        setNotificacoes(Array.isArray(data.itens) ? data.itens.slice(0, 8) : []);
        setNaoLidas(Number(data.contadores?.naoLidas ?? 0));
      } catch {
        // Falha da rota não pode acender alerta falso nem quebrar o header.
        if (ativo) { setNotificacoes([]); setNaoLidas(0); }
      }
    }

    void carregar();
    const timer = setInterval(carregar, 60_000);
    return () => { ativo = false; clearInterval(timer); };
  }, []);

  function marcarLida(id: string) {
    setNotificacoes((atuais) => atuais.map((n) => (n.id === id ? { ...n, lida_em: new Date().toISOString() } : n)));
    setNaoLidas((n) => Math.max(0, n - 1));
    void fetch('/api/notificacoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], lida: true }),
    }).catch(() => {});
  }

  const resultados = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return [];
    return clients.filter((c) => normalizar(c.name).includes(termo)).slice(0, 8);
  }, [busca, clients]);

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
      <div
        className="relative hidden lg:block w-44 xl:w-52"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setBuscaAberta(false);
        }}
      >
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          value={busca}
          onChange={(event) => { setBusca(event.target.value); setBuscaAberta(true); }}
          onFocus={() => setBuscaAberta(true)}
          onKeyDown={(event) => { if (event.key === 'Escape') { setBusca(''); setBuscaAberta(false); } }}
          placeholder="Buscar clientes..."
          className="pl-9 bg-muted/50 border-transparent focus-visible:ring-primary text-xs h-9"
        />
        {buscaAberta && busca.trim().length > 0 && (
          // O mousedown não pode tirar o foco do input antes do clique no link.
          <div
            onMouseDown={(event) => event.preventDefault()}
            className="absolute right-0 top-full mt-1.5 w-72 rounded-lg border border-border bg-popover p-1 shadow-md z-50"
          >
            {resultados.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
            ) : (
              resultados.map((client) => (
                <Link
                  key={client.id}
                  href={`/clientes/${client.id}`}
                  onClick={() => { setBusca(''); setBuscaAberta(false); }}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-xs hover:bg-muted/60"
                >
                  <span className="truncate font-medium">{client.name}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {client.segment}
                  </span>
                </Link>
              ))
            )}
          </div>
        )}
      </div>

      <AIUsagePill />
      <ThemeToggle />

      <Popover>
        <PopoverTrigger
          aria-label="Notificações"
          className="relative p-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Bell className="h-5 w-5" />
          {naoLidas > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wider">Notificações</span>
            {naoLidas > 0 && (
              <span className="text-[10px] font-semibold text-primary">{naoLidas} não lida{naoLidas > 1 ? 's' : ''}</span>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {notificacoes.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nada por aqui.</p>
            ) : (
              notificacoes.map((n) => {
                const conteudo = (
                  <>
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT_SEVERIDADE[n.severidade] ?? DOT_SEVERIDADE.info}`} />
                    <span className="min-w-0">
                      <span className={`block text-xs ${n.lida_em ? 'font-medium text-muted-foreground' : 'font-semibold'}`}>
                        {n.titulo}
                      </span>
                      {n.descricao && (
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground line-clamp-2">
                          {n.descricao}
                        </span>
                      )}
                    </span>
                  </>
                );
                const classe = 'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted/60';
                return n.href ? (
                  <Link key={n.id} href={n.href} onClick={() => marcarLida(n.id)} className={classe}>
                    {conteudo}
                  </Link>
                ) : (
                  <button key={n.id} type="button" onClick={() => marcarLida(n.id)} className={classe}>
                    {conteudo}
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

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
