import { Sidebar } from '@/components/layout/sidebar';
import { HeaderWrapper } from '@/components/layout/header-wrapper';
import { PaymentProviderWrapper } from '@/components/layout/payment-provider-wrapper';
import { HolidayPaymentAlert } from '@/components/layout/holiday-payment-alert';
import { AuthGuard } from '@/components/layout/auth-guard';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PaymentProviderWrapper>
      <AuthGuard>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <HeaderWrapper />
            <main className="flex-1 overflow-y-auto overflow-x-hidden p-6">
              <div className="w-full min-w-0">
                {children}
              </div>
            </main>
          </div>
          <HolidayPaymentAlert />
        </div>
      </AuthGuard>
    </PaymentProviderWrapper>
  );
}
