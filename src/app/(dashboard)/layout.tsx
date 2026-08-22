import { DashboardShell } from '@/components/layout/dashboard-shell';
import { Toasts } from '@/components/ui/toast';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell>{children}<Toasts /></DashboardShell>;
}
