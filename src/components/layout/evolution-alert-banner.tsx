"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, X, RefreshCw, Wifi, Settings2 } from 'lucide-react';
import { getAuthSession } from '@/lib/auth-store';
import type { DisconnectedAlert } from '@/lib/evolution-instance-alerts';

// Popup flutuante (não mais banner fixo): avisa uma vez e some ao fechar.
// Só REAPARECE se a situação mudar (instância nova caiu / status mudou) —
// a "assinatura" do conjunto de alertas fica no sessionStorage.
const POLL_INTERVAL = 5 * 60 * 1000; // 5 min
const DISMISSED_SIG_KEY = 'onmid-evolution-alert-dismissed-sig';

function statusLabel(status: string) {
  if (status === 'close') return 'fechada';
  if (status === 'connecting') return 'reconectando';
  return status;
}

function signatureOf(alerts: DisconnectedAlert[]): string {
  return alerts.map(a => `${a.name}:${a.status}`).sort().join('|');
}

export function EvolutionAlertBanner() {
  const [alerts, setAlerts] = useState<DisconnectedAlert[]>([]);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  async function check() {
    try {
      const res = await fetch('/api/alerts/evolution-status');
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; disconnected: DisconnectedAlert[] };
      const list = data.disconnected ?? [];
      setAlerts(list);
      if (list.length === 0) {
        setVisible(false);
        return;
      }
      const sig = signatureOf(list);
      const dismissedSig = sessionStorage.getItem(DISMISSED_SIG_KEY);
      // Mostra só se o conjunto de problemas MUDOU desde o último "fechar"
      setVisible(sig !== dismissedSig);
    } catch { /* network error, skip */ }
  }

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISSED_SIG_KEY, signatureOf(alerts));
    setVisible(false);
  }

  async function refresh() {
    setLoading(true);
    await check();
    setLoading(false);
  }

  const session = getAuthSession();
  if (session?.role !== 'Administrador') return null;
  if (alerts.length === 0 || !visible) return null;

  const shown = alerts.slice(0, 5);
  const extra = alerts.length - shown.length;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius)] border border-red-500/40 bg-card shadow-2xl">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-red-500" />
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15">
          <AlertTriangle className="h-4.5 w-4.5 text-red-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">
            {alerts.length === 1
              ? '1 instância WhatsApp desconectada'
              : `${alerts.length} instâncias WhatsApp desconectadas`}
          </p>
          <div className="mt-1.5 space-y-0.5">
            {shown.map((a) => (
              <p key={a.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Wifi className="h-3 w-3 shrink-0 text-red-400/70" />
                <span className="truncate font-semibold text-foreground/90">{a.profileName ?? a.name}</span>
                <span className="shrink-0 text-red-300/70">({statusLabel(a.status)})</span>
              </p>
            ))}
            {extra > 0 && <p className="text-[11px] text-muted-foreground/70">e mais {extra}…</p>}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Link
              href="/configuracoes?tab=instancias"
              onClick={dismiss}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black hover:bg-primary/90 transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" /> Gerenciar instâncias
            </Link>
            <button
              onClick={refresh}
              disabled={loading}
              title="Verificar agora"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          title="Fechar (volta a avisar se a situação mudar)"
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
