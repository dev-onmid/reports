"use client";

import { usePathname } from 'next/navigation';

export function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard = pathname === '/dashboard';
  return (
    <main className={isDashboard
      ? 'min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-6'
      : 'min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-6'
    }>
      <div className="w-full min-w-0 max-w-full">
        {children}
      </div>
    </main>
  );
}
