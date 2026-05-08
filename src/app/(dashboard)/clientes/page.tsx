"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Archive, RotateCcw, ShieldAlert, Trash2, Plus, Link2, RefreshCw, CheckSquare, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { canManageClients, useClients } from '@/lib/client-store';
import { getAuthSession } from '@/lib/auth-store';
import { useInvestmentPayments } from '@/lib/payment-store';
import type { ClientStatus } from '@/lib/mock-data';
import { loadClientLinks, addClientLink, removeClientLink, type ClientAccountLink } from '@/lib/client-links-store';
import type { GoogleConnection } from '@/lib/google-connections-store';

type AdsAccount = { id: string; name: string; status: string; isManager: boolean; mccId?: string; currency?: string };

function LinkAccountsDialog({ clientId, clientName, open, onOpenChange }: {
  clientId: string; clientName: string; open: boolean; onOpenChange: (v: boolean) => void;
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

      // Add new selections
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

      // Remove deselected
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

export default function ClientesPage() {
  const {
    clients,
    archivedClients,
    addClient,
    archiveClient,
    restoreClient,
    deleteClient,
  } = useClients();
  const { setPayments } = useInvestmentPayments();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string } | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDialogClient, setLinkDialogClient] = useState<{ id: string; name: string } | null>(null);
  const [currentRole, setCurrentRole] = useState('');
  const [name, setName] = useState('');
  const [segment, setSegment] = useState('');
  const [status, setStatus] = useState<ClientStatus>('Ativo');
  const isAdmin = canManageClients(currentRole);
  const displayedClients = showArchived ? archivedClients : clients;

  useEffect(() => {
    setCurrentRole(getAuthSession()?.role ?? '');
  }, []);

  function handleAddClient() {
    if (!name.trim() || !segment.trim()) return;

    addClient({ name, segment, status });
    setName('');
    setSegment('');
    setStatus('Ativo');
    setDialogOpen(false);
  }

  function openArchiveDialog(client: { id: string; name: string }) {
    if (!isAdmin) return;
    setSelectedClient(client);
    setArchiveDialogOpen(true);
  }

  function openDeleteDialog(client: { id: string; name: string }) {
    if (!isAdmin) return;
    setSelectedClient(client);
    setDeleteDialogOpen(true);
  }

  function confirmArchiveClient() {
    if (!selectedClient || !isAdmin) return;
    archiveClient(selectedClient.id);
    setArchiveDialogOpen(false);
    setSelectedClient(null);
  }

  function confirmDeleteClient() {
    if (!selectedClient || !isAdmin) return;
    deleteClient(selectedClient.id);
    setPayments((prev) => prev.filter((payment) => payment.clientId !== selectedClient.id));
    setDeleteDialogOpen(false);
    setSelectedClient(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-heading tracking-wider uppercase">Meus Clientes</h1>
          <p className="text-muted-foreground mt-1">Gerencie a base de clientes e acesse os dashboards individuais.</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => setShowArchived((prev) => !prev)}
            >
              {showArchived ? <RotateCcw className="w-4 h-4 mr-2" /> : <Archive className="w-4 h-4 mr-2" />}
              {showArchived ? 'Ver ativos' : `Arquivados (${archivedClients.length})`}
            </Button>
          )}
          <Button onClick={() => setDialogOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" />
            Novo Cliente
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {displayedClients.map((cliente) => (
          <div key={cliente.id} className="flex items-center justify-between gap-4 p-4 bg-card border border-border rounded-lg hover:border-primary/50 transition-colors">
            <Link href={`/clientes/${cliente.id}`} className="min-w-0 flex-1">
              <div>
                <h3 className="font-semibold">{cliente.name}</h3>
                <p className="text-sm text-muted-foreground">{cliente.segment}</p>
              </div>
            </Link>
            <div className="flex items-center gap-3">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  cliente.status === 'Ativo'
                    ? 'bg-primary/20 text-primary'
                    : cliente.status === 'Arquivado'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-orange-500/20 text-orange-500'
                }`}>
                  {cliente.status}
                </span>
                {!showArchived && <Link href={`/clientes/${cliente.id}`} className="text-sm text-muted-foreground hover:text-primary">Ver dashboard &rarr;</Link>}
                {!showArchived && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Vincular contas"
                    onClick={() => { setLinkDialogClient(cliente); setLinkDialogOpen(true); }}
                  >
                    <Link2 className="w-4 h-4" />
                  </Button>
                )}
                {isAdmin && !showArchived && (
                  <>
                    <Button variant="ghost" size="icon-sm" title="Arquivar cliente" onClick={() => openArchiveDialog(cliente)}>
                      <Archive className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title="Excluir cliente" className="text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => openDeleteDialog(cliente)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </>
                )}
                {isAdmin && showArchived && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => restoreClient(cliente.id)}>
                      <RotateCcw className="w-4 h-4 mr-1" />
                      Restaurar
                    </Button>
                    <Button variant="ghost" size="icon-sm" title="Excluir cliente" className="text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => openDeleteDialog(cliente)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </>
                )}
            </div>
          </div>
        ))}
        {displayedClients.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
            <p className="font-semibold text-muted-foreground">
              {showArchived ? 'Nenhum cliente arquivado.' : 'Nenhum cliente ativo cadastrado.'}
            </p>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Cliente</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="client-name">Nome do cliente</Label>
              <Input
                id="client-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex: Clínica Nova Vida"
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-segment">Segmento</Label>
              <Input
                id="client-segment"
                value={segment}
                onChange={(event) => setSegment(event.target.value)}
                placeholder="Ex: Saúde"
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-status">Status</Label>
              <select
                id="client-status"
                value={status}
                onChange={(event) => setStatus(event.target.value as ClientStatus)}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="Ativo">Ativo</option>
                <option value="Alerta">Alerta</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleAddClient}
              disabled={!name.trim() || !segment.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4 mr-1" />
              Criar Cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-orange-400" />
              Arquivar cliente
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-orange-400/30 bg-orange-500/10 p-4 text-sm">
            <p className="font-semibold">Arquivar {selectedClient?.name}?</p>
            <p className="mt-2 text-muted-foreground">
              Ele deixa de aparecer em relatórios, pagamentos e dashboards gerais, mas pode ser restaurado depois.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDialogOpen(false)}>Cancelar</Button>
            <Button onClick={confirmArchiveClient} className="bg-orange-500 text-white hover:bg-orange-500/90">
              Arquivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Excluir definitivamente
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold">Excluir {selectedClient?.name}?</p>
            <p className="mt-2 text-muted-foreground">
              Essa ação remove o cliente e os Pix vinculados a ele neste sistema. Não dá para desfazer.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancelar</Button>
            <Button onClick={confirmDeleteClient} className="bg-destructive text-white hover:bg-destructive/90">
              Excluir de vez
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {linkDialogClient && (
        <LinkAccountsDialog
          clientId={linkDialogClient.id}
          clientName={linkDialogClient.name}
          open={linkDialogOpen}
          onOpenChange={(v) => {
            setLinkDialogOpen(v);
            if (!v) setLinkDialogClient(null);
          }}
        />
      )}
    </div>
  );
}
