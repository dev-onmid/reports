"use client";

import { useState } from 'react';
import { Menu } from 'lucide-react';
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

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
