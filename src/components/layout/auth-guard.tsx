"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAuthSession } from '@/lib/auth-store';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const session = getAuthSession();
    if (!session) {
      router.replace('/');
      return;
    }

    setAllowed(true);
  }, [router]);

  if (!allowed) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Validando acesso...
      </div>
    );
  }

  return children;
}
