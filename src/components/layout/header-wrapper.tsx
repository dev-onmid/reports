"use client";

import { usePathname } from 'next/navigation';
import { Header } from './header';

export function HeaderWrapper({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const pathname = usePathname();
  if (pathname === '/dashboard') return null;
  return <Header onOpenSidebar={onOpenSidebar} />;
}
