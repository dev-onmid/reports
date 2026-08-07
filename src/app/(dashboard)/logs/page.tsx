"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Logs mora dentro de Configurações (aba "Logs") desde 2026-08-07.
// Esta rota fica só como redirect pra links antigos.
export default function LogsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/configuracoes?tab=logs');
  }, [router]);
  return (
    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
      Redirecionando para Configurações → Logs…
    </div>
  );
}
