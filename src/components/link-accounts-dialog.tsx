"use client";

import { useEffect, useState } from 'react';
import { Link2, RefreshCw, CheckSquare, Square, AlertCircle, Search, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { addClientLink, removeClientLink, type ClientAccountLink } from '@/lib/client-links-store';
import type { GoogleConnection } from '@/lib/google-connections-store';
import { type PlatformId, PLATFORM_INFO, PlatformIconButton } from '@/components/platform-icons';
import type { MetaAdAccount } from '@/app/api/meta/ad-accounts/route';
import type { MetaPage } from '@/app/api/meta/pages/route';

type AdsAccount = { id: string; name: string; status: string; isManager: boolean; mccId?: string; currency?: string };
type GmbLocation = { locationId: string; accountId: string; name: string; address?: string; phone?: string };
type MetaConn = { id: string; label: string; userName: string; userPicture?: string; accessToken: string };

const PLATFORM_LABEL = (p: PlatformId) => PLATFORM_INFO[p].label;

const COMING_SOON_PLATFORMS: PlatformId[] = [];
const LINKABLE_PLATFORMS: PlatformId[] = ['meta_ads', 'google_ads', 'google_business'];

type SortDirection = 'az' | 'za';

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function sortByName<T>(items: T[], getName: (item: T) => string, direction: SortDirection) {
  return [...items].sort((a, b) => {
    const result = getName(a).localeCompare(getName(b), 'pt-BR', { sensitivity: 'base' });
    return direction === 'az' ? result : -result;
  });
}

function filterBySearch<T>(items: T[], search: string, getValues: (item: T) => Array<string | undefined>) {
  const q = normalizeSearch(search);
  if (!q) return items;
  return items.filter((item) => getValues(item).some((value) => value?.toLowerCase().includes(q)));
}

function AccountListControls({
  search,
  onSearchChange,
  sortDirection,
  onSortDirectionChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (value: SortDirection) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Pesquisar conta ou ID..."
          className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
        />
      </div>
      <button
        type="button"
        onClick={() => onSortDirectionChange(sortDirection === 'az' ? 'za' : 'az')}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        title="Alterar ordem"
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        {sortDirection === 'az' ? 'A-Z' : 'Z-A'}
      </button>
    </div>
  );
}

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
  const [search, setSearch] = useState('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('az');

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
      <AccountListControls
        search={search}
        onSearchChange={setSearch}
        sortDirection={sortDirection}
        onSortDirectionChange={setSortDirection}
      />
      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {googleConns.map((conn) => {
          const accs = sortByName(
            filterBySearch(accountsByConn[conn.id] ?? [], search, (account) => [account.name, account.id]),
            (account) => account.name,
            sortDirection,
          );
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
  const [search, setSearch] = useState('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('az');

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
      <AccountListControls
        search={search}
        onSearchChange={setSearch}
        sortDirection={sortDirection}
        onSortDirectionChange={setSortDirection}
      />
      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {gmbConns.map((conn) => {
          const locs = sortByName(
            filterBySearch(locationsByConn[conn.id] ?? [], search, (location) => [location.name, location.locationId, location.address, location.phone]),
            (location) => location.name,
            sortDirection,
          );
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

function MetaAdsContent({ clientId, onDone, onCancel }: { clientId: string; onDone: () => void; onCancel: () => void }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [metaConns, setMetaConns] = useState<MetaConn[]>([]);
  const [accountsByConn, setAccountsByConn] = useState<Record<string, MetaAdAccount[]>>({});
  const [existingLinks, setExistingLinks] = useState<ClientAccountLink[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('az');

  useEffect(() => { void loadData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  async function loadData() {
    setLoading(true);
    setLoadError(null);
    try {
      const [linksRes, connsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/links`),
        fetch('/api/meta/connections'),
      ]);
      const links: ClientAccountLink[] = linksRes.ok ? await linksRes.json() : [];
      const conns: MetaConn[] = connsRes.ok ? await connsRes.json() : [];

      const existing = links.filter((l) => l.platform === 'meta_ads');
      setExistingLinks(existing);
      setSelected(new Set(existing.map((l) => l.accountId)));
      setMetaConns(conns);

      const map: Record<string, MetaAdAccount[]> = {};
      const errors: string[] = [];
      await Promise.allSettled(
        conns.map(async (conn) => {
          const res = await fetch(`/api/meta/ad-accounts?connectionId=${conn.id}`);
          if (res.ok) {
            map[conn.id] = await res.json() as MetaAdAccount[];
          } else {
            const body = await res.json().catch(() => ({})) as { error?: string };
            errors.push(`${conn.userName}: ${body.error ?? 'Erro'}`);
          }
        })
      );
      if (errors.length > 0) setLoadError(errors.join('\n'));
      setAccountsByConn(map);
    } finally {
      setLoading(false);
    }
  }

  function toggle(accountId: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(accountId) ? n.delete(accountId) : n.add(accountId); return n; });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const existingIds = new Set(existingLinks.map((l) => l.accountId));
      await Promise.allSettled(
        [...selected].filter((id) => !existingIds.has(id)).map((accountId) => {
          let conn: MetaConn | undefined;
          let account: MetaAdAccount | undefined;
          for (const [connId, accs] of Object.entries(accountsByConn)) {
            const found = accs.find((a) => a.id === accountId);
            if (found) { account = found; conn = metaConns.find((c) => c.id === connId); break; }
          }
          if (!account || !conn) return Promise.resolve();
          return addClientLink(clientId, {
            platform: 'meta_ads', connectionId: conn.id,
            accountId: account.id, accountName: account.name, currency: account.currency ?? 'BRL',
          });
        })
      );
      await Promise.allSettled(
        existingLinks.filter((l) => !selected.has(l.accountId)).map((l) => removeClientLink(clientId, l.id))
      );
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const allAccounts = Object.values(accountsByConn).flat();

  if (loading) return (
    <>
      <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" /> Carregando contas Meta Ads...
      </div>
      <DialogFooter><Button variant="outline" onClick={onCancel}>Cancelar</Button></DialogFooter>
    </>
  );

  if (loadError && allAccounts.length === 0) return (
    <>
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
        <p className="font-semibold">Erro ao carregar contas</p>
        <pre className="whitespace-pre-wrap break-all font-mono">{loadError}</pre>
      </div>
      <DialogFooter><Button variant="outline" onClick={onCancel}>Fechar</Button></DialogFooter>
    </>
  );

  if (metaConns.length === 0) return (
    <>
      <p className="text-sm text-muted-foreground py-6 text-center">
        Nenhuma conexão Meta disponível. Conecte uma conta em Integrações primeiro.
      </p>
      <DialogFooter><Button variant="outline" onClick={onCancel}>Fechar</Button></DialogFooter>
    </>
  );

  return (
    <>
      {loadError && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-2.5 text-xs text-yellow-300 mb-2">
          {loadError}
        </div>
      )}
      <AccountListControls
        search={search}
        onSearchChange={setSearch}
        sortDirection={sortDirection}
        onSortDirectionChange={setSortDirection}
      />
      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {metaConns.map((conn) => {
          const accs = sortByName(
            filterBySearch(accountsByConn[conn.id] ?? [], search, (account) => [account.name, account.id, account.id.replace('act_', '')]),
            (account) => account.name,
            sortDirection,
          );
          if (accs.length === 0) return null;
          return (
            <div key={conn.id}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                Meta Ads · {conn.userName || conn.label}
              </p>
              <div className="space-y-1">
                {accs.map((a) => (
                  <button key={a.id} onClick={() => toggle(a.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left">
                    {selected.has(a.id)
                      ? <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                      : <Square className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <span className="text-sm flex-1 truncate">{a.name}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{a.id.replace('act_', '')}</span>
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

function MetaPagesContent({
  clientId, platform, onDone, onCancel,
}: {
  clientId: string;
  platform: 'facebook' | 'instagram';
  onDone: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [metaConns, setMetaConns] = useState<MetaConn[]>([]);
  const [pagesByConn, setPagesByConn] = useState<Record<string, MetaPage[]>>({});
  const [existingLinks, setExistingLinks] = useState<ClientAccountLink[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('az');

  useEffect(() => { void loadData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId, platform]);

  async function loadData() {
    setLoading(true);
    setLoadError(null);
    try {
      const [linksRes, connsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/links`),
        fetch('/api/meta/connections'),
      ]);
      const links: ClientAccountLink[] = linksRes.ok ? await linksRes.json() : [];
      const conns: MetaConn[] = connsRes.ok ? await connsRes.json() : [];

      const existing = links.filter((l) => l.platform === platform);
      setExistingLinks(existing);
      setSelected(new Set(existing.map((l) => l.accountId)));
      setMetaConns(conns);

      const map: Record<string, MetaPage[]> = {};
      const errors: string[] = [];
      await Promise.allSettled(
        conns.map(async (conn) => {
          const res = await fetch(`/api/meta/pages?connectionId=${conn.id}`);
          if (res.ok) {
            const pages: MetaPage[] = await res.json();
            map[conn.id] = platform === 'instagram'
              ? pages.filter((p) => !!p.instagramAccountId)
              : pages;
          } else {
            const body = await res.json().catch(() => ({})) as { error?: string };
            errors.push(`${conn.userName}: ${body.error ?? 'Erro'}`);
          }
        })
      );
      if (errors.length > 0) setLoadError(errors.join('\n'));
      setPagesByConn(map);
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const existingIds = new Set(existingLinks.map((l) => l.accountId));
      await Promise.allSettled(
        [...selected].filter((id) => !existingIds.has(id)).map((selectedId) => {
          let conn: MetaConn | undefined;
          let page: MetaPage | undefined;
          for (const [connId, pages] of Object.entries(pagesByConn)) {
            const found = pages.find((p) =>
              platform === 'instagram' ? p.instagramAccountId === selectedId : p.id === selectedId
            );
            if (found) { page = found; conn = metaConns.find((c) => c.id === connId); break; }
          }
          if (!page || !conn) return Promise.resolve();
          const accountId = platform === 'instagram' ? page.instagramAccountId! : page.id;
          const accountName = platform === 'instagram'
            ? (page.instagramUsername ? `@${page.instagramUsername}` : page.name)
            : page.name;
          return addClientLink(clientId, { platform, connectionId: conn.id, accountId, accountName, currency: 'BRL' });
        })
      );
      await Promise.allSettled(
        existingLinks.filter((l) => !selected.has(l.accountId)).map((l) => removeClientLink(clientId, l.id))
      );
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const allItems = Object.values(pagesByConn).flat();
  const label = platform === 'instagram' ? 'Instagram' : 'Facebook';
  const emptyMsg = platform === 'instagram'
    ? 'Nenhuma conta Instagram Business encontrada. Certifique-se que as páginas estão vinculadas a uma conta profissional.'
    : 'Nenhuma página Facebook encontrada nesta conexão.';

  if (loading) return (
    <>
      <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" /> Carregando contas {label}...
      </div>
      <DialogFooter><Button variant="outline" onClick={onCancel}>Cancelar</Button></DialogFooter>
    </>
  );

  if (loadError && allItems.length === 0) return (
    <>
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
        <p className="font-semibold">Erro ao carregar contas</p>
        <pre className="whitespace-pre-wrap break-all font-mono">{loadError}</pre>
      </div>
      <DialogFooter><Button variant="outline" onClick={onCancel}>Fechar</Button></DialogFooter>
    </>
  );

  if (metaConns.length === 0) return (
    <>
      <p className="text-sm text-muted-foreground py-6 text-center">
        Nenhuma conexão Meta disponível. Conecte uma conta em Integrações primeiro.
      </p>
      <DialogFooter><Button variant="outline" onClick={onCancel}>Fechar</Button></DialogFooter>
    </>
  );

  if (allItems.length === 0) return (
    <>
      <p className="text-sm text-muted-foreground py-6 text-center">{emptyMsg}</p>
      <DialogFooter><Button variant="outline" onClick={onCancel}>Fechar</Button></DialogFooter>
    </>
  );

  return (
    <>
      {loadError && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-2.5 text-xs text-yellow-300 mb-2">
          {loadError}
        </div>
      )}
      <AccountListControls
        search={search}
        onSearchChange={setSearch}
        sortDirection={sortDirection}
        onSortDirectionChange={setSortDirection}
      />
      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {metaConns.map((conn) => {
          const items = sortByName(
            filterBySearch(pagesByConn[conn.id] ?? [], search, (item) => [
              item.name,
              item.id,
              item.instagramAccountId,
              item.instagramUsername,
            ]),
            (item) => platform === 'instagram'
              ? (item.instagramUsername ? `@${item.instagramUsername}` : item.name)
              : item.name,
            sortDirection,
          );
          if (items.length === 0) return null;
          return (
            <div key={conn.id}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                {label} · {conn.userName || conn.label}
              </p>
              <div className="space-y-1">
                {items.map((item) => {
                  const itemId = platform === 'instagram' ? item.instagramAccountId! : item.id;
                  const itemName = platform === 'instagram'
                    ? (item.instagramUsername ? `@${item.instagramUsername}` : item.name)
                    : item.name;
                  return (
                    <button key={itemId} onClick={() => toggle(itemId)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left">
                      {selected.has(itemId)
                        ? <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                        : <Square className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <span className="text-sm flex-1 truncate">{itemName}</span>
                      {platform === 'facebook' && item.instagramAccountId && (
                        <span className="text-[10px] text-muted-foreground/60">+ IG</span>
                      )}
                    </button>
                  );
                })}
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

function GoogleSheetsContent({ clientId, onDone, onCancel }: { clientId: string; onDone: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'analyzing'>('idle');
  const [error, setError] = useState('');
  const [hasResult, setHasResult] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`/api/clients/${clientId}/sheets`)
      .then(r => r.ok ? r.json() as Promise<{ sheetsUrl: string | null; sheetsResult: unknown }> : null)
      .then(d => {
        if (d?.sheetsUrl) setUrl(d.sheetsUrl);
        setHasResult(!!d?.sheetsResult);
      });
  }, [clientId]);

  async function handleSave() {
    if (!url.trim()) return;
    if (!url.includes('docs.google.com/spreadsheets')) {
      setError('Cole uma URL válida do Google Sheets.');
      return;
    }
    setStatus('saving');
    const putRes = await fetch(`/api/clients/${clientId}/sheets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetsUrl: url.trim() }),
    });
    if (!putRes.ok) { setStatus('idle'); setError('Erro ao salvar.'); return; }

    setStatus('analyzing');
    const postRes = await fetch(`/api/clients/${clientId}/sheets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetsUrl: url.trim() }),
    });
    setStatus('idle');
    if (!postRes.ok) {
      const data = await postRes.json() as { error?: string };
      setError(data.error ?? 'Erro ao analisar planilha.');
      return;
    }
    onDone();
  }

  const busy = status !== 'idle';
  const btnLabel = status === 'analyzing' ? 'Analisando...' : status === 'saving' ? 'Salvando...' : hasResult === false && url ? 'Analisar agora' : 'Vincular Planilha';

  return (
    <>
      <div className="space-y-4 py-2">
        <p className="text-sm text-muted-foreground">
          Cole o link da planilha do Google Sheets. Ela precisa estar como <strong>"qualquer pessoa com o link pode visualizar"</strong>.
        </p>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">URL da Planilha</label>
          <input
            type="url"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={url}
            onChange={e => { setUrl(e.target.value); setError(''); }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        {hasResult === false && url && status === 'idle' && (
          <p className="text-xs text-amber-400/80">Planilha vinculada mas ainda não analisada. Clique em &quot;Analisar agora&quot; para buscar os dados de faturamento.</p>
        )}
        {status === 'analyzing' && (
          <p className="text-xs text-muted-foreground/70">A IA está lendo as abas da planilha. Isso pode levar alguns segundos...</p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button onClick={handleSave} disabled={busy || !url.trim()} className="bg-[#0F9D58] text-white hover:bg-[#0F9D58]/90">
          {btnLabel}
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

function PlatformChooser({
  onSelect,
  onCancel,
}: {
  onSelect: (platform: PlatformId) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="grid gap-2">
        {LINKABLE_PLATFORMS.map((platform) => {
          const info = PLATFORM_INFO[platform];
          return (
            <div
              key={platform}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(platform)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(platform);
              }}
              className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              <PlatformIconButton
                platform={platform}
                size="md"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(platform);
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{info.label}</p>
                <p className="text-xs text-muted-foreground">
                  Escolher ativos e contas vinculadas deste canal.
                </p>
              </div>
              <Link2 className="h-4 w-4 text-muted-foreground" />
            </div>
          );
        })}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
      </DialogFooter>
    </>
  );
}

export function LinkAccountsDialog({
  clientId,
  clientName,
  platform,
  open,
  onOpenChange,
}: {
  clientId: string;
  clientName: string;
  platform?: PlatformId;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId | null>(platform ?? null);
  const activePlatform = platform ?? selectedPlatform;
  const info = activePlatform ? PLATFORM_INFO[activePlatform] : null;

  useEffect(() => {
    if (open) setSelectedPlatform(platform ?? null);
  }, [open, platform]);

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) setSelectedPlatform(platform ?? null);
  }

  function closeDialog() {
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {info ? (
              <>
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: info.bg }}
                >
                  <PlatformIconButton platform={activePlatform!} size="sm" onClick={() => {}} />
                </div>
                {info.label} — {clientName}
              </>
            ) : (
              <>
                <Link2 className="h-5 w-5 text-primary" />
                Vincular contas — {clientName}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {!activePlatform ? (
          <PlatformChooser onSelect={setSelectedPlatform} onCancel={closeDialog} />
        ) : COMING_SOON_PLATFORMS.includes(activePlatform) ? (
          <ComingSoonContent platform={activePlatform} onCancel={closeDialog} />
        ) : activePlatform === 'google_business' ? (
          <GmbContent clientId={clientId} onDone={closeDialog} onCancel={closeDialog} />
        ) : activePlatform === 'meta_ads' ? (
          <MetaAdsContent clientId={clientId} onDone={closeDialog} onCancel={closeDialog} />
        ) : activePlatform === 'facebook' ? (
          <MetaPagesContent platform="facebook" clientId={clientId} onDone={closeDialog} onCancel={closeDialog} />
        ) : activePlatform === 'instagram' ? (
          <MetaPagesContent platform="instagram" clientId={clientId} onDone={closeDialog} onCancel={closeDialog} />
        ) : (
          <GoogleAdsContent clientId={clientId} onDone={closeDialog} onCancel={closeDialog} />
        )}
      </DialogContent>
    </Dialog>
  );
}
