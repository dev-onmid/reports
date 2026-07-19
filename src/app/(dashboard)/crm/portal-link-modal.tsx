'use client';

// Modal de gestão do link do Portal do Cliente (read-only por token).
// Gera/copia/revoga o link público /portal/[token] do cliente selecionado.

import { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, RefreshCw, Trash2, X, Globe2 } from 'lucide-react';

export function PortalLinkModal({ clientId, clientName, onClose }: {
  clientId: string;
  clientName: string;
  onClose: () => void;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastAccess, setLastAccess] = useState<string | null>(null);

  const fullUrl = path && typeof window !== 'undefined' ? `${window.location.origin}${path}` : null;

  useEffect(() => {
    let active = true;
    fetch(`/api/clients/${clientId}/portal`)
      .then(r => r.ok ? r.json() as Promise<{ token: string | null; path?: string; lastAccessAt?: string | null }> : null)
      .then(d => {
        if (!active) return;
        setPath(d?.token ? (d.path ?? `/portal/${d.token}`) : null);
        setLastAccess(d?.lastAccessAt ?? null);
      })
      .catch(() => null)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientId]);

  async function generate() {
    setWorking(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/portal`, { method: 'POST' });
      const d = await res.json().catch(() => null) as { path?: string } | null;
      if (d?.path) setPath(d.path);
    } finally {
      setWorking(false);
    }
  }

  async function revoke() {
    if (!confirm('Revogar o link? O cliente perde o acesso na hora e um link novo precisará ser enviado.')) return;
    setWorking(true);
    try {
      await fetch(`/api/clients/${clientId}/portal`, { method: 'DELETE' });
      setPath(null);
      setLastAccess(null);
    } finally {
      setWorking(false);
    }
  }

  function copy() {
    if (!fullUrl) return;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
              <Globe2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Portal do Cliente</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Link somente-leitura de <b className="text-foreground">{clientName}</b>: funil, leads com origem de campanha e conversas. Sem login, sem edição.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="h-20 animate-pulse rounded-xl bg-muted/30" />
        ) : path ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-2.5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-primary">{fullUrl}</code>
              <button onClick={copy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-black hover:bg-primary/90">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            {lastAccess && (
              <p className="text-[11px] text-muted-foreground">
                Último acesso do cliente: {new Date(lastAccess).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            <div className="flex gap-2">
              <a href={path} target="_blank" rel="noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-bold text-muted-foreground hover:bg-muted/40 hover:text-foreground">
                <ExternalLink className="h-3.5 w-3.5" /> Ver como o cliente
              </a>
              <button onClick={revoke} disabled={working}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-400/30 bg-red-500/10 py-2 text-xs font-bold text-red-300 hover:bg-red-500/15 disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" /> Revogar link
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Este cliente ainda não tem link de portal.
            </p>
            <button onClick={generate} disabled={working}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-60">
              {working ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}
              Gerar link do portal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
