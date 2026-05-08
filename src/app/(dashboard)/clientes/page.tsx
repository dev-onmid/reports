"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Archive, RotateCcw, ShieldAlert, Trash2, Plus } from 'lucide-react';
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
import { LinkAccountsDialog } from '@/components/link-accounts-dialog';
import { PlatformIconButton, ALL_PLATFORMS, type PlatformId } from '@/components/platform-icons';

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
  const [linkDialogPlatform, setLinkDialogPlatform] = useState<PlatformId>('google_ads');
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
                  <div className="flex items-center gap-1">
                    {ALL_PLATFORMS.map((p) => (
                      <PlatformIconButton
                        key={p}
                        platform={p}
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          setLinkDialogClient(cliente);
                          setLinkDialogPlatform(p);
                          setLinkDialogOpen(true);
                        }}
                      />
                    ))}
                  </div>
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
          platform={linkDialogPlatform}
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
