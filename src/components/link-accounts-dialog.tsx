"use client";

import { useEffect, useState } from 'react';
import { Link2, RefreshCw, CheckSquare, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { loadClientLinks, addClientLink, removeClientLink, type ClientAccountLink } from '@/lib/client-links-store';
import type { GoogleConnection } from '@/lib/google-connections-store';

type AdsAccount = { id: string; name: string; status: string; isManager: boolean; mccId?: string; currency?: string };

export function LinkAccountsDialog({ clientId, clientName, open, onOpenChange }: {
  clientId: string;
  clientName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [googleConns, setGoogleConns] = useState<GoogleConnection[]>([]);
  const [accountsByConn, setAccountsByConn] = useState<Record<string, AdsAccount[]>>({});
  const [existingLinks, setExistingLinks] = useState<ClientAccountLink[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    void loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId]);

  async function loadData() {
    setLoading(true);
    try {
      const [linksRes, connsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/links`),
        fetch('/api/google/connections'),
      ]);
      const links: ClientAccountLink[] = linksRes.ok ? await linksRes.json() : [];
      const conns: GoogleConnection[] = connsRes.ok ? await connsRes.json() : [];

      setExistingLinks(links);
      setSelected(new Set(links.map((l) => l.accountId)));

      const adsConns = conns.filter((c) => c.accountType === 'google_ads');
      setGoogleConns(adsConns);

      const accsMap: Record<string, AdsAccount[]> = {};
      await Promise.allSettled(
        adsConns.map(async (conn) => {
          const res = await fetch(`/api/google/ads-accounts?connectionId=${conn.id}&noMetrics=true`);
          if (res.ok) accsMap[conn.id] = (await res.json() as AdsAccount[]).filter((a) => !a.isManager);
        })
      );
      setAccountsByConn(accsMap);
    } finally {
      setLoading(false);
    }
  }

  function toggle(accountId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const existingAccountIds = new Set(existingLinks.map((l) => l.accountId));

      await Promise.allSettled(
        [...selected]
          .filter((id) => !existingAccountIds.has(id))
          .map((accountId) => {
            let conn: GoogleConnection | undefined;
            let account: AdsAccount | undefined;
            for (const [connId, accs] of Object.entries(accountsByConn)) {
              const found = accs.find((a) => a.id === accountId);
              if (found) { account = found; conn = googleConns.find((c) => c.id === connId); break; }
            }
            if (!account || !conn) return Promise.resolve();
            return addClientLink(clientId, {
              platform: 'google_ads',
              connectionId: conn.id,
              accountId: account.id,
              accountName: account.name,
              currency: account.currency ?? 'BRL',
            });
          })
      );

      await Promise.allSettled(
        existingLinks
          .filter((l) => !selected.has(l.accountId))
          .map((l) => removeClientLink(clientId, l.id))
      );

      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const allAccounts = Object.entries(accountsByConn).flatMap(([connId, accs]) =>
    accs.map((a) => ({ ...a, connId }))
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            Vincular contas — {clientName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Carregando contas...
          </div>
        ) : allAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma conta Google Ads disponível. Conecte uma conta em Integrações primeiro.
          </p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {googleConns.map((conn) => {
              const accs = accountsByConn[conn.id] ?? [];
              if (accs.length === 0) return null;
              return (
                <div key={conn.id}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                    Google Ads · {conn.email}
                  </p>
                  <div className="space-y-1">
                    {accs.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => toggle(a.id)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                      >
                        {selected.has(a.id)
                          ? <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                          : <Square className="w-4 h-4 text-muted-foreground shrink-0" />}
                        <span className="text-sm flex-1 truncate">{a.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{a.id}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => void handleSave()} disabled={saving || loading} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : <Link2 className="w-3.5 h-3.5 mr-1" />}
            Salvar vínculos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
