"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Integrações mora dentro de Configurações (aba "Integrações") desde 2026-08-07.
// Esta rota fica só como redirect pra links antigos — PRESERVANDO a query string:
// o fallback do OAuth do Google redireciona pra cá com ?google_connected=/
// ?google_error=, e o banner de resultado é lido pela aba de destino.
// As subrotas /integracoes/clickup e /integracoes/leadlovers seguem páginas próprias.
export default function IntegracoesRedirect() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', 'integracoes');
    router.replace(`/configuracoes?${params.toString()}`);
  }, [router]);
  return (
    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
      Redirecionando para Configurações → Integrações…
    </div>
  );
}
