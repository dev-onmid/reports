import { Sidebar } from '@/components/layout/sidebar';
import { HeaderWrapper } from '@/components/layout/header-wrapper';
import { MainWrapper } from '@/components/layout/main-wrapper';
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
        <div className="flex h-screen w-full overflow-hidden bg-background">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <HeaderWrapper />
            <MainWrapper>{children}</MainWrapper>
          </div>
          <HolidayPaymentAlert />
        </div>
      </AuthGuard>
    </PaymentProviderWrapper>
  );
}
