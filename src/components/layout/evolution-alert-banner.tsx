"use client";

import { useEffect, useState } from 'react';
import { AlertTriangle, X, RefreshCw, Wifi } from 'lucide-react';
import type { DisconnectedAlert } from '@/lib/evolution-instance-alerts';

const POLL_INTERVAL = 5 * 60 * 1000; // 5 min
const DISMISSED_KEY = 'onmid-evolution-banner-dismissed-at';
const DISMISS_TTL = 30 * 60 * 1000; // re-show after 30 min if still broken

function statusLabel(status: string) {
  if (status === 'close') return 'fechada';
  if (status === 'connecting') return 'reconectando';
  return status;
}

export function EvolutionAlertBanner() {
  const [alerts, setAlerts] = useState<DisconnectedAlert[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function check() {
    try {
      const res = await fetch('/api/alerts/evolution-status');
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; disconnected: DisconnectedAlert[] };
      setAlerts(data.disconnected ?? []);

      // If new alerts came in, reset dismiss so it reappears
      if ((data.disconnected ?? []).length > 0) {
        const dismissedAt = Number(sessionStorage.getItem(DISMISSED_KEY) ?? 0);
        if (Date.now() - dismissedAt > DISMISS_TTL) {
          setDismissed(false);
        }
      }
    } catch { /* network error, skip */ }
  }

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    setDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, String(Date.now()));
  }

  async function refresh() {
    setLoading(true);
    await check();
    setLoading(false);
  }

  if (alerts.length === 0 || dismissed) return null;

  return (
    <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2.5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-red-300">
            {alerts.length === 1
              ? '1 instância WhatsApp desconectada'
              : `${alerts.length} instâncias WhatsApp desconectadas`}
          </p>

          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            {alerts.map((a) => (
              <span key={a.name} className="flex items-center gap-1 text-xs text-red-200/80">
                <Wifi className="h-3 w-3" />
                <span className="font-semibold">{a.profileName ?? a.name}</span>
                <span className="text-red-300/60">({statusLabel(a.status)})</span>
              </span>
            ))}
          </div>

          <p className="mt-0.5 text-[11px] text-red-300/60">
            Acesse <span className="font-semibold">Configurações → Disparos</span> para reconectar via QR Code.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={refresh}
            title="Verificar agora"
            className="rounded p-1 text-red-400 hover:bg-red-500/20 disabled:opacity-40"
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={dismiss}
            title="Fechar"
            className="rounded p-1 text-red-400 hover:bg-red-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
