"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { LogOut, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clearAuthSession } from '@/lib/auth-store';
import { useSessaoLocal } from '@/lib/modo-cliente';
import { Sidebar } from '@/components/layout/sidebar';
import { HeaderWrapper } from '@/components/layout/header-wrapper';
import { MainWrapper } from '@/components/layout/main-wrapper';
import { HolidayPaymentAlert } from '@/components/layout/holiday-payment-alert';
import { EvolutionAlertBanner } from '@/components/layout/evolution-alert-banner';
import { AuthGuard } from '@/components/layout/auth-guard';
import { PaymentProviderWrapper } from '@/components/layout/payment-provider-wrapper';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * Casca do FUNCIONÁRIO DO CLIENTE (team='cliente'): sem menu da agência, sem
 * alertas de pagamento/instância e sem o cabeçalho com uso de IA e lembretes —
 * tudo isso chama rotas que o servidor recusa para ele, e nada disso é da
 * conta dele. Só o CRM, o nome dele e o botão de sair.
 */
function ClienteShell({ children }: { children: React.ReactNode }) {
  const sessao = useSessaoLocal();
  const nome = sessao?.name ?? '';
  const gestor = sessao?.perfil === 'gestor';
  const pathname = usePathname();
  const aba = (href: string, rotulo: string) => (
    <Link href={href} className={`rounded-md px-3 py-1 text-xs font-semibold ${pathname.startsWith(href) ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
      {rotulo}
    </Link>
  );
  useEffect(() => { document.title = 'Onmid CRM'; }, []);
  return (
    <AuthGuard>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-4">
            <Image src="/brand/onmid-logo-white.png" alt="Onmid" width={84} height={20} className="h-5 w-auto" unoptimized />
            {gestor && <nav className="flex items-center gap-1">{aba('/crm', 'CRM')}{aba('/dashboard', 'Dashboard')}</nav>}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{nome}</span>
            <button
              onClick={() => { clearAuthSession(); window.location.href = '/'; }}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-semibold hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" /> Sair
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">{children}</main>
      </div>
    </AuthGuard>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // undefined = ainda não leu (evita montar a casca errada e disparar fetches dela)
  const sessao = useSessaoLocal();
  if (sessao === undefined) return <div className="h-screen bg-background" />;
  if (sessao?.team === 'cliente') return <ClienteShell>{children}</ClienteShell>;

  return (
    <PaymentProviderWrapper>
      <AuthGuard>
        <div className="flex h-screen w-full overflow-hidden bg-background">
          <Sidebar className="hidden md:flex" />

          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-[18rem] max-w-[88vw] border-border bg-background p-0"
            >
              <SheetTitle className="sr-only">Navegação principal</SheetTitle>
              <Sidebar
                mode="mobile"
                onNavigate={() => setMobileSidebarOpen(false)}
                className="h-full w-full border-r-0"
              />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <HeaderWrapper onOpenSidebar={() => setMobileSidebarOpen(true)} />
            <EvolutionAlertBanner />
            <MainWrapper
              mobileNavButton={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setMobileSidebarOpen(true)}
                  className="md:hidden"
                  aria-label="Abrir navegação"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              }
            >
              {children}
            </MainWrapper>
          </div>
          <HolidayPaymentAlert />
        </div>
      </AuthGuard>
    </PaymentProviderWrapper>
  );
}
