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
import type { Ga4Property } from '@/app/api/google/ga4-properties/route';
import { MAX_ABAS_POR_RODADA } from '@/lib/google-sheets';
import { cn } from '@/lib/utils';
import { CAMPOS, camposPreenchidos, avisosDoMapeamento, type Mapeamento } from '@/lib/sheets-mapeamento';

type AdsAccount = { id: string; name: string; status: string; isManager: boolean; mccId?: string; currency?: string };
type GmbLocation = { locationId: string; accountId: string; name: string; address?: string; phone?: string };
type MetaConn = { id: string; label: string; userName: string; userPicture?: string; accessToken: string };

const PLATFORM_LABEL = (p: PlatformId) => PLATFORM_INFO[p].label;

const COMING_SOON_PLATFORMS: PlatformId[] = [];
const LINKABLE_PLATFORMS: PlatformId[] = ['meta_ads', 'google_ads', 'google_business', 'ga4', 'google_sheets'];

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

type DiagAba = {
  nome: string; colunas: string[]; ok: boolean; faltamEssenciais: string[];
  escolhida: boolean; mapa: Mapeamento; origem: Record<string, string>; faltam: string[];
};

type SheetsCfg = {
  sheetUrl: string; tipoPlanilha: string; fonteFaturamento: boolean; ativo: boolean;
  abaExemplo: string | null; ultimaSync: string | null; ultimoErro: string | null;
  mapeamento: Mapeamento | null;
  abas: string[] | null; abasVistas: string[] | null; seguirMes: boolean;
  colunasVistas: string[] | null;
  camposManuais: string[] | null;
};

/**
 * Vincular a planilha do Google Sheets de um cliente e deixar a rotina diária
 * importá-la (pedido do Matheus, 2026-09-28).
 *
 * ⚠️ A IA de mapeamento roda UMA vez, aqui — a rotina diária reusa o de-para
 * salvo. Se ela rodasse todo dia, seria custo de IA por cliente por dia para
 * responder sempre a mesma coisa.
 */
function GoogleSheetsContent({ clientId, onDone, onCancel }: { clientId: string; onDone: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [cfg, setCfg] = useState<SheetsCfg | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'analyzing' | 'importing'>('idle');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [abas, setAbas] = useState<string[]>([]);
  const [abaDoMes, setAbaDoMes] = useState<string | null>(null);
  const [colunas, setColunas] = useState<Mapeamento | null>(null);
  // Cabeçalho real da planilha: é o que o seletor de coluna oferece. Sem ele o
  // gestor só consegue ver o de-para, não corrigir.
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [editandoColunas, setEditandoColunas] = useState(false);
  // Diagnóstico por aba: qual coluna cada aba entrega para cada campo.
  const [diag, setDiag] = useState<DiagAba[] | null>(null);
  const [abaAberta, setAbaAberta] = useState<string | null>(null);
  const [fatura, setFatura] = useState(false);
  const [ativo, setAtivo] = useState(false);
  const [resumo, setResumo] = useState('');
  // Escolha de abas (2026-09-28). `seguirMes` começa ligado: é o padrão de quem
  // não mexe em nada, e é o que faz a rotina acompanhar a virada do mês.
  const [abasFixas, setAbasFixas] = useState<string[]>([]);
  const [seguirMes, setSeguirMes] = useState(true);

  useEffect(() => {
    fetch(`/api/clients/${clientId}/sheets`)
      .then(r => r.ok ? r.json() as Promise<{ sheetsUrl: string | null; config: SheetsCfg | null }> : null)
      .then(d => {
        if (d?.sheetsUrl) setUrl(d.sheetsUrl);
        if (d?.config) {
          setCfg(d.config);
          setFatura(d.config.fonteFaturamento);
          setAtivo(d.config.ativo);
          setColunas(d.config.mapeamento);
          setAbaDoMes(d.config.abaExemplo);
          setAbasFixas(d.config.abas ?? []);
          setSeguirMes(d.config.seguirMes !== false);
          if (d.config.abasVistas?.length) setAbas(d.config.abasVistas);
          if (d.config.colunasVistas?.length) setCabecalho(d.config.colunasVistas);
        }
      });
  }, [clientId]);

  async function salvar(extra: Partial<{
    ativo: boolean; mapeamento: Mapeamento; manuais: string[];
    mapeamentoPorAba: Record<string, Mapeamento>; colunasPorAba: Record<string, string[]>;
  }> = {}) {
    const res = await fetch(`/api/clients/${clientId}/sheets`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      // `colunas` vai junto para o servidor poder recusar coluna que não existe
      // na planilha — ela derrubaria a aba inteira na rodada seguinte.
      body: JSON.stringify({ sheetsUrl: url.trim(), fonteFaturamento: fatura, ativo, abas: abasFixas, seguirMes, colunas: cabecalho, ...extra }),
    });
    if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Erro ao salvar.'); }
  }

  async function handleAnalisar() {
    setError(''); setAviso(''); setResumo('');
    if (!url.includes('docs.google.com/spreadsheets')) { setError('Cole uma URL válida do Google Sheets.'); return; }
    setStatus('saving');
    try { await salvar(); } catch (e) { setStatus('idle'); setError((e as Error).message); return; }

    setStatus('analyzing');
    const res = await fetch(`/api/clients/${clientId}/sheets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'analisar' }),
    });
    const d = await res.json() as {
      error?: string; abas?: string[]; colunas?: string[]; abaDoMes?: string | null; analisada?: string;
      preservados?: string[];
      analise?: { mapping?: Mapeamento; rowCount?: number };
    };
    setStatus('idle');
    if (!res.ok) { setError(d.error ?? 'Erro ao analisar a planilha.'); return; }
    setAbas(d.abas ?? []);
    setCabecalho(d.colunas ?? []);
    setAbaDoMes(d.abaDoMes ?? null);
    const m = d.analise?.mapping ?? null;
    setColunas(m);
    if (m) { try { await salvar({ mapeamento: m }); } catch { /* o de-para reaparece na próxima análise */ } }
    // ⚠️ Sem a aba do mês a rotina NÃO inventa outra: avisa aqui, na configuração,
    // em vez de deixar o gestor descobrir por um número errado na dashboard.
    if (!d.abaDoMes) setAviso(`A aba do mês atual ainda não existe na planilha. Analisei "${d.analisada}" só para descobrir as colunas — a rotina diária vai esperar a aba do mês nascer.`);
    const mantidos = (d.preservados ?? [])
      .map(k => CAMPOS.find(c => c.chave === k)?.rotulo ?? k);
    setResumo(
      `${d.analise?.rowCount ?? 0} linhas lidas em "${d.analisada}".` +
      (mantidos.length ? ` Mantive o que você ajustou à mão: ${mantidos.join(', ')}.` : '')
    );
  }

  /**
   * Troca o de-para de um campo e grava na hora.
   *
   * ⚠️ Grava a cada mudança em vez de esperar um "salvar": o gestor pode fechar
   * o modal achando que o ajuste pegou, e a rotina roda de madrugada com o
   * de-para velho sem ninguém perceber.
   */
  function trocarColuna(campo: string, valor: string | string[] | null) {
    const novo: Mapeamento = { ...(colunas ?? {}), [campo]: valor };
    setColunas(novo);
    // `manuais` é o que faz a reanálise respeitar esta escolha depois.
    void salvar({ mapeamento: novo, manuais: [campo] })
      .catch(() => setError('Não consegui salvar o ajuste de colunas.'));
  }

  async function carregarDiagnostico() {
    setError(''); setStatus('analyzing');
    const res = await fetch(`/api/clients/${clientId}/sheets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'diagnostico' }),
    });
    const d = await res.json() as { error?: string; abas?: DiagAba[] };
    setStatus('idle');
    if (!res.ok) { setError(d.error ?? 'Não consegui ler a planilha.'); return; }
    setDiag(d.abas ?? []);
  }

  /**
   * Aponta uma coluna para um campo DESTA aba.
   *
   * ⚠️ Manda só o ajuste da aba mexida, mais o cabeçalho dela — o servidor
   * valida contra as colunas que existem ali. Apontar numa aba uma coluna que só
   * existe em outra faria a importação procurar um texto inexistente.
   */
  function ajustarColunaDaAba(aba: DiagAba, campo: string, valor: string | null) {
    const mapa = { ...aba.mapa, [campo]: valor };
    setDiag(prev => prev?.map(a => a.nome === aba.nome ? { ...a, mapa, origem: { ...a.origem, [campo]: 'manual' } } : a) ?? prev);
    void salvar({ mapeamentoPorAba: { [aba.nome]: { [campo]: valor } }, colunasPorAba: { [aba.nome]: aba.colunas } })
      .then(() => carregarDiagnostico())
      .catch(() => setError('Não consegui salvar o ajuste desta aba.'));
  }

  async function handleImportar() {
    setError(''); setAviso(''); setResumo(''); setStatus('importing');
    try { await salvar({ ativo: true }); } catch (e) { setStatus('idle'); setError((e as Error).message); return; }
    const res = await fetch(`/api/clients/${clientId}/sheets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'importar' }),
    });
    const d = await res.json() as { ok?: boolean; erro?: string; aba?: string; abas?: string[]; linhas?: number; avisos?: string[] };
    setStatus('idle');
    if (!d.ok) { setError(d.erro ?? 'Erro ao importar.'); return; }
    setAtivo(true);
    const quantas = d.abas?.length ?? 1;
    setResumo(`Importado de ${quantas > 1 ? `${quantas} abas (${d.aba})` : `"${d.aba}"`} — ${d.linhas ?? 0} linhas.`);
    // ⚠️ Aba que ficou de fora aparece aqui: sem isso o gestor marca 6 abas, vê
    // "importado" e não descobre que 2 não entraram.
    if (d.avisos?.length) setAviso(d.avisos.join(' '));
    else onDone();
  }

  const busy = status !== 'idle';
  const temMapa = !!colunas && Object.values(colunas).some(Boolean);
  const avisosColunas = temMapa ? avisosDoMapeamento(colunas) : [];
  // ⚠️ Desmarcar o mês E não escolher aba nenhuma deixaria a rotina sem nada
  // para importar. Bloqueia aqui, com a frase, em vez de deixar o gestor sair
  // achando que configurou e descobrir pelo dado que parou de chegar.
  const semAba = abas.length > 0 && !seguirMes && abasFixas.length === 0;

  return (
    <>
      <div className="space-y-4 py-2">
        <p className="text-sm text-muted-foreground">
          Cole o link da planilha. Ela precisa estar como <strong>&quot;qualquer pessoa com o link pode visualizar&quot;</strong>.
          Uma vez configurada, a rotina importa <strong>1× por dia</strong>, sozinha.
        </p>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">URL da Planilha</label>
          <input
            type="url" placeholder="https://docs.google.com/spreadsheets/d/..."
            value={url} onChange={e => { setUrl(e.target.value); setError(''); }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <label className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/20 p-3 cursor-pointer">
          <input type="checkbox" checked={fatura} onChange={e => setFatura(e.target.checked)} className="mt-0.5" />
          <span className="text-xs">
            <b>Esta planilha é a fonte de faturamento do cliente</b>
            <span className="block text-muted-foreground mt-0.5">
              Marque só se o valor fechado dela for a receita real. Se o cliente já tem
              outro relatório de vendas, deixe desmarcado — senão o mesmo faturamento conta duas vezes.
            </span>
          </span>
        </label>

        {abas.length > 0 ? (
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">Abas que a rotina importa</p>
              <span className="text-[10px] text-muted-foreground/70">{abas.length} na planilha</span>
            </div>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={seguirMes} onChange={e => setSeguirMes(e.target.checked)} className="mt-0.5" />
              <span className="text-xs">
                <b>Acompanhar o mês atual</b>
                {abaDoMes ? <span className="text-muted-foreground"> — hoje é <b className="text-foreground">{abaDoMes}</b></span>
                          : <span className="text-amber-400/90"> — a aba deste mês ainda não existe na planilha</span>}
                <span className="block text-muted-foreground mt-0.5">
                  Vira o mês, a rotina troca de aba sozinha. Desmarque só se quiser importar
                  exatamente as abas escolhidas abaixo, e mais nenhuma.
                </span>
              </span>
            </label>
            <div className="max-h-44 overflow-y-auto rounded border border-border/60 bg-background/40 p-1.5">
              {abas.map(a => {
                const marcada = abasFixas.includes(a);
                const ehDoMes = seguirMes && a === abaDoMes;
                return (
                  <label key={a} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs cursor-pointer hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={marcada || ehDoMes}
                      disabled={ehDoMes}
                      onChange={e => setAbasFixas(prev => e.target.checked ? [...prev, a] : prev.filter(x => x !== a))}
                    />
                    <span className={ehDoMes ? 'text-muted-foreground' : ''}>{a}</span>
                    {ehDoMes && <span className="text-[10px] text-muted-foreground/70">(mês atual)</span>}
                  </label>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              Marque abas de meses anteriores para trazer o histórico. Até {MAX_ABAS_POR_RODADA} abas por rodada.
            </p>
            {semAba && (
              <p className="text-xs text-destructive">
                Escolha ao menos uma aba, ou marque &quot;acompanhar o mês atual&quot; — do jeito que está, a rotina não tem o que importar.
              </p>
            )}
          </div>
        ) : abaDoMes && (
          <p className="text-xs text-muted-foreground">
            Aba do mês: <b className="text-foreground">{abaDoMes}</b>
          </p>
        )}
        {temMapa && (
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">Colunas reconhecidas</p>
              {cabecalho.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setEditandoColunas(v => !v)}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  {editandoColunas ? 'Concluir' : 'Ajustar'}
                </button>
              ) : (
                <span className="text-[10px] text-muted-foreground/70">Reanalise para poder ajustar</span>
              )}
            </div>

            {!editandoColunas ? (
              <div className="flex flex-wrap gap-1.5">
                {camposPreenchidos(colunas).map((campo) => {
                  const v = colunas![campo.chave];
                  return (
                    <span key={campo.chave} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground" title={campo.ajuda}>
                      {campo.rotulo}: <b className="text-foreground">{Array.isArray(v) ? v.join(' · ') : v}</b>
                    </span>
                  );
                })}
              </div>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {CAMPOS.map((campo) => {
                  const v = colunas?.[campo.chave] ?? null;
                  const marcadas = Array.isArray(v) ? v : [];
                  return (
                    <div key={campo.chave} className="rounded border border-border/60 bg-background/40 p-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-semibold text-foreground">
                          {campo.rotulo}
                          {campo.essencial && <span className="ml-1 text-[9px] font-normal uppercase tracking-widest text-primary">essencial</span>}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{campo.ajuda}</p>
                      {campo.lista ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {cabecalho.map((col) => {
                            const on = marcadas.some(m => m === col || m.trim() === col.trim());
                            return (
                              <button
                                key={col}
                                type="button"
                                onClick={() => trocarColuna(campo.chave, on ? marcadas.filter(m => m !== col && m.trim() !== col.trim()) : [...marcadas, col])}
                                className={cn(
                                  'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
                                  on ? 'border-primary/50 bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40',
                                )}
                              >
                                {col}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <select
                          value={typeof v === 'string' ? v : ''}
                          onChange={(e) => trocarColuna(campo.chave, e.target.value || null)}
                          className="mt-1.5 h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground"
                        >
                          <option value="">— não usar —</option>
                          {cabecalho.map((col) => <option key={col} value={col}>{col}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {avisosColunas.map((a) => (
              <p key={a} className="text-[11px] leading-snug text-amber-400/90">{a}</p>
            ))}
          </div>
        )}
        {/* ── Colunas aba a aba ───────────────────────────────────────────
            ⚠️ Existe porque o de-para é POR COLUNA: a aba de 2024 chama a data
            de "Data Entrada" e a de hoje chama de "DATA". O automático resolve a
            maioria; aqui o gestor conserta o que sobrou, sem mexer na planilha. */}
        {temMapa && (
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">Colunas aba a aba</p>
              <button
                type="button"
                onClick={() => diag ? setDiag(null) : void carregarDiagnostico()}
                disabled={busy}
                className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
              >
                {status === 'analyzing' && !diag ? 'Lendo…' : diag ? 'Fechar' : 'Conferir abas'}
              </button>
            </div>

            {!diag ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Veja o que cada aba entrega e aponte a coluna certa quando o nome for diferente do padrão.
              </p>
            ) : diag.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Nenhuma aba encontrada.</p>
            ) : (
              <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                {[...diag].sort((a, b) => Number(a.ok) - Number(b.ok) || Number(b.escolhida) - Number(a.escolhida)).map((aba) => {
                  const aberta = abaAberta === aba.nome;
                  const pendencias = aba.ok ? aba.faltam.length : aba.faltamEssenciais.length;
                  return (
                    <div key={aba.nome} className={cn('rounded border bg-background/40', aba.ok ? 'border-border' : 'border-destructive/50')}>
                      <button
                        type="button"
                        onClick={() => setAbaAberta(aberta ? null : aba.nome)}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                      >
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', aba.ok ? 'bg-emerald-400' : 'bg-destructive')} />
                        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{aba.nome}</span>
                        {!aba.escolhida && <span className="shrink-0 text-[9px] uppercase tracking-widest text-muted-foreground/70">não marcada</span>}
                        <span className={cn('shrink-0 text-[10px]', aba.ok ? 'text-muted-foreground' : 'text-destructive')}>
                          {aba.ok ? (pendencias ? `faltam ${pendencias}` : 'completa') : `falta ${aba.faltamEssenciais.map(k => CAMPOS.find(c => c.chave === k)?.rotulo ?? k).join(', ')}`}
                        </span>
                      </button>
                      {aberta && (
                        <div className="space-y-1.5 border-t border-border/60 px-2 py-2">
                          {aba.colunas.length === 0 && (
                            <p className="text-[10px] leading-snug text-amber-400/90">
                              Esta aba não tem cabeçalho na primeira linha — normalmente é um título ocupando o lugar. Sem cabeçalho não há coluna para apontar.
                            </p>
                          )}
                          {CAMPOS.filter(c => !c.lista).map((campo) => {
                            const v = aba.mapa[campo.chave];
                            const marcado = typeof v === 'string' ? v : '';
                            const auto = aba.origem[campo.chave];
                            return (
                              <div key={campo.chave} className="flex items-center gap-2">
                                <span className="w-32 shrink-0 truncate text-[10px] text-muted-foreground" title={campo.ajuda}>
                                  {campo.rotulo}{campo.essencial && <span className="text-primary"> *</span>}
                                </span>
                                <select
                                  value={marcado}
                                  onChange={(e) => ajustarColunaDaAba(aba, campo.chave, e.target.value || null)}
                                  className={cn(
                                    'h-7 min-w-0 flex-1 rounded border bg-background px-1.5 text-[11px] text-foreground',
                                    campo.essencial && !marcado ? 'border-destructive/60' : 'border-border',
                                  )}
                                >
                                  <option value="">— não usar —</option>
                                  {aba.colunas.map(col => <option key={col} value={col}>{col}</option>)}
                                </select>
                                <span className="w-14 shrink-0 text-[9px] uppercase tracking-widest text-muted-foreground/60">
                                  {auto === 'manual' ? 'você' : auto === 'sinonimo' ? 'auto' : auto === 'padrao' ? '' : ''}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {resumo && <p className="text-xs text-emerald-400">{resumo}</p>}
        {aviso && <p className="text-xs text-amber-400/90">{aviso}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {cfg?.ultimoErro && !error && <p className="text-xs text-amber-400/80">Última rodada: {cfg.ultimoErro}</p>}
        {cfg?.ultimaSync && <p className="text-xs text-muted-foreground/70">Última importação: {new Date(cfg.ultimaSync).toLocaleString('pt-BR')}</p>}
        {status === 'analyzing' && <p className="text-xs text-muted-foreground/70">A IA está lendo as colunas da planilha...</p>}
        {status === 'importing' && <p className="text-xs text-muted-foreground/70">Importando a aba do mês...</p>}
      </div>
      <DialogFooter className="flex-wrap gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button variant="outline" onClick={handleAnalisar} disabled={busy || !url.trim()}>
          {status === 'analyzing' ? 'Analisando...' : temMapa ? 'Reanalisar colunas' : 'Analisar colunas'}
        </Button>
        <Button onClick={handleImportar} disabled={busy || !temMapa || semAba} className="bg-[#0F9D58] text-white hover:bg-[#0F9D58]/90">
          {status === 'importing' ? 'Importando...' : ativo ? 'Importar agora' : 'Importar e ativar rotina'}
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

// A descrição genérica do chooser fala de "ativos e contas", que não descreve
// uma planilha — o Sheets é um link, não uma conta de anúncio com ativos dentro.
const DESCRICAO_PLATAFORMA: Partial<Record<PlatformId, string>> = {
  google_sheets: 'Ler a planilha do cliente todo dia, como se fosse uma importação.',
};

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
                  {DESCRICAO_PLATAFORMA[platform] ?? 'Escolher ativos e contas vinculadas deste canal.'}
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


// ── GA4 (landing pages): vincula propriedades do Analytics ao cliente ─────────
// account_id = id numérico da propriedade; a rota /api/clients/[id]/ga4 soma
// todas as vinculadas (cliente com mais de uma LP).
function Ga4Content({
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
  const [conns, setConns] = useState<GoogleConnection[]>([]);
  const [propsByConn, setPropsByConn] = useState<Record<string, Ga4Property[]>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
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
      const all: GoogleConnection[] = connsRes.ok ? await connsRes.json() : [];
      const ga4Links = links.filter((l) => l.platform === 'ga4');
      setExistingLinks(ga4Links);
      setSelected(new Set(ga4Links.map((l) => l.accountId)));
      const ga4Conns = all.filter((c) => c.accountType === 'ga4');
      setConns(ga4Conns);
      const map: Record<string, Ga4Property[]> = {};
      const errs: Record<string, string> = {};
      await Promise.allSettled(
        ga4Conns.map(async (conn) => {
          const res = await fetch(`/api/google/ga4-properties?connectionId=${conn.id}`);
          const data = await res.json() as Ga4Property[] | { error?: string };
          if (res.ok) map[conn.id] = data as Ga4Property[];
          else errs[conn.id] = (data as { error?: string }).error ?? 'Erro ao listar propriedades';
        })
      );
      setPropsByConn(map);
      setErros(errs);
    } finally {
      setLoading(false);
    }
  }

  function toggle(propertyId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(propertyId)) next.delete(propertyId); else next.add(propertyId);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const existing = new Set(existingLinks.map((l) => l.accountId));
      await Promise.allSettled(
        [...selected]
          .filter((id) => !existing.has(id))
          .map((propertyId) => {
            for (const [connId, props] of Object.entries(propsByConn)) {
              const found = props.find((p) => p.propertyId === propertyId);
              if (found) {
                return addClientLink(clientId, {
                  platform: 'ga4',
                  connectionId: connId,
                  accountId: found.propertyId,
                  accountName: found.name,
                  currency: 'BRL',
                });
              }
            }
            return Promise.resolve();
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

  const total = Object.values(propsByConn).reduce((n, p) => n + p.length, 0);

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Carregando propriedades...
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        </DialogFooter>
      </>
    );
  }

  if (conns.length === 0 || total === 0) {
    return (
      <>
        <p className="text-sm text-muted-foreground py-6 text-center">
          {conns.length === 0
            ? 'Nenhuma conta Google Analytics conectada. Em Integrações, clique em "Website / Analytics" e conecte a conta Google que enxerga as propriedades das landing pages.'
            : 'A conta conectada não enxerga nenhuma propriedade GA4.'}
        </p>
        {Object.values(erros).map((e, i) => (
          <p key={i} className="flex items-start gap-2 text-xs text-red-400 px-1"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{e}</p>
        ))}
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
        {conns.map((conn) => {
          const props = sortByName(
            filterBySearch(propsByConn[conn.id] ?? [], search, (p) => [p.name, p.account, p.propertyId]),
            (p) => `${p.account} ${p.name}`,
            sortDirection,
          );
          if (props.length === 0) return null;
          return (
            <div key={conn.id}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                Google Analytics · {conn.email}
              </p>
              <div className="space-y-1">
                {props.map((p) => (
                  <button
                    key={p.propertyId}
                    onClick={() => toggle(p.propertyId)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                  >
                    {selected.has(p.propertyId)
                      ? <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                      : <Square className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <span className="text-sm flex-1 truncate">{p.name} <span className="text-muted-foreground">· {p.account}</span></span>
                    <span className="text-[10px] text-muted-foreground font-mono">{p.propertyId}</span>
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
        ) : activePlatform === 'ga4' ? (
          <Ga4Content clientId={clientId} onDone={closeDialog} onCancel={closeDialog} />
        ) : activePlatform === 'google_sheets' ? (
          <GoogleSheetsContent clientId={clientId} onDone={closeDialog} onCancel={closeDialog} />
        ) : (
          <GoogleAdsContent clientId={clientId} onDone={closeDialog} onCancel={closeDialog} />
        )}
      </DialogContent>
    </Dialog>
  );
}
