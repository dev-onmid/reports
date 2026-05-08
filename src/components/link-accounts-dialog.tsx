"use client";

import { useEffect, useState } from 'react';
import { Link2, RefreshCw, CheckSquare, Square, AlertCircle } from 'lucide-react';
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
import { type PlatformId, PLATFORM_INFO, PlatformIconButton } from '@/components/platform-icons';

type AdsAccount = { id: string; name: string; status: string; isManager: boolean; mccId?: string; currency?: string };
type GmbLocation = { locationId: string; accountId: string; name: string; address?: string; phone?: string };

const PLATFORM_LABEL = (p: PlatformId) => PLATFORM_INFO[p].label;

const COMING_SOON_PLATFORMS: PlatformId[] = ['meta_ads', 'facebook', 'instagram', 'google_sheets'];

function GoogleAdsContent({
  clientId,
  onDone,
  onCancel,
}: {
  clientId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [googleConns, setGoogleConns] = useState<GoogleConnection[]>([]);
  const [accountsByConn, setAccountsByConn] = useState<Record<string, AdsAccount[]>>({});
  const [existingLinks, setExistingLinks] = useState<ClientAccountLink[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadData() {
    setLoading(true);
    try {
      const [linksRes, connsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/links`),
        fetch('/api/google/connections'),
      ]);
      const links: ClientAccountLink[] = linksRes.ok ? await linksRes.json() : [];
      const conns: GoogleConnection[] = connsRes.ok ? await connsRes.json() : [];

      setExistingLinks(links.filter((l) => l.platform === 'google_ads'));
      setSelected(new Set(links.filter((l) => l.platform === 'google_ads').map((l) => l.accountId)));

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
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const allAccounts = Object.entries(accountsByConn).flatMap(([connId, accs]) =>
    accs.map((a) => ({ ...a, connId }))
  );

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Carregando contas...
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        </DialogFooter>
      </>
    );
  }

  if (allAccounts.length === 0) {
    return (
      <>
        <p className="text-sm text-muted-foreground py-6 text-center">
          Nenhuma conta Google Ads disponível. Conecte uma conta em Integrações primeiro.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Fechar</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
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
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => void handleSave()} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : <Link2 className="w-3.5 h-3.5 mr-1" />}
          Salvar vínculos
        </Button>
      </DialogFooter>
    </>
  );
}

function GmbContent({ clientId, onDone, onCancel }: { clientId: string; onDone: () => void; onCancel: () => void }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gmbConns, setGmbConns] = useState<GoogleConnection[]>([]);
  const [locationsByConn, setLocationsByConn] = useState<Record<string, GmbLocation[]>>({});
  const [existingLinks, setExistingLinks] = useState<{ locationId: string; linkId: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadData() {
    setLoading(true);
    try {
      const [linksRes, connsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/links`),
        fetch('/api/google/connections'),
      ]);
      const links: Array<{ id: string; platform: string; accountId: string }> = linksRes.ok ? await linksRes.json() : [];
      const conns: GoogleConnection[] = connsRes.ok ? await connsRes.json() : [];

      const gmbLinks = links.filter((l) => l.platform === 'google_business');
      setExistingLinks(gmbLinks.map((l) => ({ locationId: l.accountId, linkId: l.id })));
      setSelected(new Set(gmbLinks.map((l) => l.accountId)));

      const filtered = conns.filter((c) => c.accountType === 'gmb');
      setGmbConns(filtered);

      const locMap: Record<string, GmbLocation[]> = {};
      const errors: string[] = [];
      await Promise.allSettled(
        filtered.map(async (conn) => {
          const res = await fetch(`/api/google/business-locations?connectionId=${conn.id}&noMetrics=true`);
          if (res.ok) {
            locMap[conn.id] = await res.json() as GmbLocation[];
          } else {
            const body = await res.json().catch(() => ({})) as { error?: string; detail?: string };
            const detail = body.detail ? ` — ${body.detail.slice(0, 200)}` : '';
            errors.push(`${conn.email ?? conn.id}: ${body.error ?? 'Erro'}${detail}`);
          }
        })
      );
      if (errors.length > 0) setLoadError(errors.join('\n'));
      setLocationsByConn(locMap);
    } finally {
      setLoading(false);
    }
  }

  function toggle(locationId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(locationId)) next.delete(locationId); else next.add(locationId);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const existingIds = new Set(existingLinks.map((l) => l.locationId));
      await Promise.allSettled(
        [...selected]
          .filter((id) => !existingIds.has(id))
          .map((locationId) => {
            let location: GmbLocation | undefined;
            let conn: GoogleConnection | undefined;
            for (const [connId, locs] of Object.entries(locationsByConn)) {
              const found = locs.find((l) => l.locationId === locationId);
              if (found) { location = found; conn = gmbConns.find((c) => c.id === connId); break; }
            }
            if (!location || !conn) return Promise.resolve();
            return addClientLink(clientId, {
              platform: 'google_business',
              connectionId: conn.id,
              accountId: location.locationId,
              accountName: location.name,
              currency: 'BRL',
            });
          })
      );
      await Promise.allSettled(
        existingLinks
          .filter((l) => !selected.has(l.locationId))
          .map((l) => removeClientLink(clientId, l.linkId))
      );
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const allLocations = Object.entries(locationsByConn).flatMap(([connId, locs]) =>
    locs.map((l) => ({ ...l, connId }))
  );

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Carregando locais...
        </div>
        <DialogFooter><Button variant="outline" onClick={onCancel}>Cancelar</Button></DialogFooter>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
          <p className="font-semibold">Erro ao carregar locais</p>
          <pre className="whitespace-pre-wrap break-all font-mono">{loadError}</pre>
        </div>
        <DialogFooter><Button variant="outline" onClick={onCancel}>Fechar</Button></DialogFooter>
      </>
    );
  }

  if (allLocations.length === 0) {
    return (
      <>
        <p className="text-sm text-muted-foreground py-6 text-center">
          Nenhum local Google Meu Negócio disponível. Conecte uma conta GMB em Integrações primeiro.
        </p>
        <DialogFooter><Button variant="outline" onClick={onCancel}>Fechar</Button></DialogFooter>
      </>
    );
  }

  return (
    <>
      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {gmbConns.map((conn) => {
          const locs = locationsByConn[conn.id] ?? [];
          if (locs.length === 0) return null;
          return (
            <div key={conn.id}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                Google Meu Negócio · {conn.email}
              </p>
              <div className="space-y-1">
                {locs.map((loc) => (
                  <button
                    key={loc.locationId}
                    onClick={() => toggle(loc.locationId)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                  >
                    {selected.has(loc.locationId)
                      ? <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                      : <Square className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <span className="text-sm flex-1 truncate">{loc.name}</span>
                    {loc.address && <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">{loc.address}</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => void handleSave()} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : <Link2 className="w-3.5 h-3.5 mr-1" />}
          Salvar vínculos
        </Button>
      </DialogFooter>
    </>
  );
}

function ComingSoonContent({ platform, onCancel }: { platform: PlatformId; onCancel: () => void }) {
  return (
    <>
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center shadow-md"
          style={{ backgroundColor: PLATFORM_INFO[platform].bg }}
        >
          <PlatformIconButton platform={platform} size="md" onClick={() => {}} />
        </div>
        <AlertCircle className="w-5 h-5 text-muted-foreground" />
        <p className="text-sm font-semibold">Em breve</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          A integração com <strong>{PLATFORM_LABEL(platform)}</strong> está em desenvolvimento e será disponibilizada em breve.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Fechar</Button>
      </DialogFooter>
    </>
  );
}

export function LinkAccountsDialog({
  clientId,
  clientName,
  platform = 'google_ads',
  open,
  onOpenChange,
}: {
  clientId: string;
  clientName: string;
  platform?: PlatformId;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const info = PLATFORM_INFO[platform];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: info.bg }}
            >
              <PlatformIconButton platform={platform} size="sm" onClick={() => {}} />
            </div>
            {info.label} — {clientName}
          </DialogTitle>
        </DialogHeader>

        {COMING_SOON_PLATFORMS.includes(platform) ? (
          <ComingSoonContent platform={platform} onCancel={() => onOpenChange(false)} />
        ) : platform === 'google_business' ? (
          <GmbContent
            clientId={clientId}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        ) : (
          <GoogleAdsContent
            clientId={clientId}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
