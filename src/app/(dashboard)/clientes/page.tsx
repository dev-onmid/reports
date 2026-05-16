"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Archive, RotateCcw, ShieldAlert, Trash2, Plus, Power, PowerOff,
  Search, ArrowUpDown, ChevronDown, EyeOff, LayoutList, LayoutGrid,
  MoreHorizontal, SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { canManageClients, useClients } from '@/lib/client-store';
import { getAuthSession, verifyUserCredentials } from '@/lib/auth-store';
import { useInvestmentPayments } from '@/lib/payment-store';
import type { ClientStatus } from '@/lib/mock-data';
import { LinkAccountsDialog } from '@/components/link-accounts-dialog';
import { PlatformIconButton, ALL_PLATFORMS, type PlatformId } from '@/components/platform-icons';
import { ClientAvatar } from '@/components/client-avatar';
import { cn } from '@/lib/utils';

export default function ClientesPage() {
  const {
    clients, archivedClients, addClient, archiveClient,
    restoreClient, setClientStatus, deleteClient,
  } = useClients();
  const { setPayments } = useInvestmentPayments();

  const [dialogOpen, setDialogOpen]             = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen]   = useState(false);
  const [statusDialogOpen, setStatusDialogOpen]   = useState(false);
  const [showArchived, setShowArchived]           = useState(false);
  const [selectedClient, setSelectedClient]       = useState<{ id: string; name: string } | null>(null);
  const [pendingStatus, setPendingStatus]         = useState<ClientStatus | null>(null);
  const [linkDialogOpen, setLinkDialogOpen]       = useState(false);
  const [linkDialogClient, setLinkDialogClient]   = useState<{ id: string; name: string } | null>(null);
  const [linkDialogPlatform, setLinkDialogPlatform] = useState<PlatformId>('google_ads');
  const [currentRole, setCurrentRole]             = useState('');
  const [securityEmail, setSecurityEmail]         = useState('');
  const [securityPassword, setSecurityPassword]   = useState('');
  const [securityError, setSecurityError]         = useState('');
  const [securityLoading, setSecurityLoading]     = useState(false);
  const [name, setName]                           = useState('');
  const [segment, setSegment]                     = useState('');
  const [status, setStatus]                       = useState<ClientStatus>('Ativo');
  const [search, setSearch]                       = useState('');
  const [segmentFilter, setSegmentFilter]         = useState('');
  const [sortOrder, setSortOrder]                 = useState<'az' | 'za'>('az');
  const [menuId, setMenuId]                       = useState<string | null>(null);

  const isAdmin = canManageClients(currentRole);

  const allSegments = [...new Set(
    clients.map(c => c.segment).filter(Boolean)
  )].sort() as string[];

  const baseClients = showArchived ? archivedClients : clients;
  const displayedClients = baseClients
    .filter(c =>
      (c.name.toLowerCase().includes(search.toLowerCase()) || c.segment.toLowerCase().includes(search.toLowerCase())) &&
      (!segmentFilter || c.segment === segmentFilter)
    )
    .sort((a, b) => sortOrder === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));

  useEffect(() => {
    const session = getAuthSession();
    setCurrentRole(session?.role ?? '');
    setSecurityEmail(session?.email ?? '');
  }, []);

  function handleAddClient() {
    if (!name.trim() || !segment.trim()) return;
    addClient({ name, segment, status });
    setName(''); setSegment(''); setStatus('Ativo'); setDialogOpen(false);
  }

  function openArchiveDialog(client: { id: string; name: string }) {
    if (!isAdmin) return;
    setSelectedClient(client); setArchiveDialogOpen(true);
  }

  function openDeleteDialog(client: { id: string; name: string }) {
    if (!isAdmin) return;
    setSelectedClient(client); setDeleteDialogOpen(true);
  }

  function openStatusDialog(client: { id: string; name: string }, nextStatus: ClientStatus) {
    if (!isAdmin) return;
    const session = getAuthSession();
    setSelectedClient(client); setPendingStatus(nextStatus);
    setSecurityEmail(session?.email ?? ''); setSecurityPassword('');
    setSecurityError(''); setStatusDialogOpen(true);
  }

  function confirmArchiveClient() {
    if (!selectedClient || !isAdmin) return;
    archiveClient(selectedClient.id); setArchiveDialogOpen(false); setSelectedClient(null);
  }

  function confirmDeleteClient() {
    if (!selectedClient || !isAdmin) return;
    deleteClient(selectedClient.id);
    setPayments(prev => prev.filter(p => p.clientId !== selectedClient.id));
    setDeleteDialogOpen(false); setSelectedClient(null);
  }

  async function confirmStatusChange() {
    if (!selectedClient || !pendingStatus || !isAdmin) return;
    setSecurityLoading(true); setSecurityError('');
    try {
      const user = await verifyUserCredentials(securityEmail, securityPassword);
      if (!user || user.role !== 'Administrador') {
        setSecurityError('Usuário ou senha inválidos para administrador.'); return;
      }
      setClientStatus(selectedClient.id, pendingStatus);
      setStatusDialogOpen(false); setSelectedClient(null);
      setPendingStatus(null); setSecurityPassword('');
    } finally { setSecurityLoading(false); }
  }

  return (
    <div className="space-y-5">

      {/* ── HEADER ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading font-normal text-4xl uppercase leading-none tracking-wide text-foreground">Meus Clientes</h1>
          <div className="mt-1 h-[3px] w-14 rounded-full bg-violet-500" />
          <p className="mt-2 text-sm text-muted-foreground">
            Gerencie a base de clientes e acesse os dashboards individuais.
          </p>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Novo Cliente
        </button>
      </div>

      {/* ── TOOLBAR ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar cliente ou segmento..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Segment filter */}
        <div className="relative">
          <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <select
            value={segmentFilter}
            onChange={e => setSegmentFilter(e.target.value)}
            className="appearance-none rounded-lg border border-border bg-card pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary min-w-[170px]"
          >
            <option value="">Todos os segmentos</option>
            {allSegments.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Ocultos */}
        {isAdmin && (
          <button
            onClick={() => setShowArchived(prev => !prev)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              showArchived
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            )}
          >
            <EyeOff className="h-3.5 w-3.5" />
            {showArchived ? 'Ver ativos' : `Ocultos (${archivedClients.length})`}
          </button>
        )}

        {/* Sort */}
        <button
          onClick={() => setSortOrder(prev => prev === 'az' ? 'za' : 'az')}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          {sortOrder === 'az' ? 'A–Z' : 'Z–A'}
          <ChevronDown className="h-3 w-3" />
        </button>

        {/* View toggles */}
        <div className="flex items-center rounded-lg border border-border bg-card">
          <button className="flex h-9 w-9 items-center justify-center rounded-l-lg bg-primary/10 text-primary">
            <LayoutList className="h-4 w-4" />
          </button>
          <button className="flex h-9 w-9 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground transition-colors">
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── CLIENT LIST ── */}
      <div className="space-y-1">
        {displayedClients.map(cliente => (
          <div
            key={cliente.id}
            className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 hover:border-border/80 hover:bg-muted/20 transition-all"
          >
            {/* Avatar + name */}
            <Link href={`/clientes/${cliente.id}`} className="flex items-center gap-3 min-w-0 flex-1">
              <ClientAvatar clientId={cliente.id} name={cliente.name} size="md" />
              <div className="min-w-0">
                <p className="font-bold text-sm text-foreground truncate">{cliente.name}</p>
                <p className="text-xs text-muted-foreground truncate">{cliente.segment}</p>
              </div>
            </Link>

            {/* Right side */}
            <div className="flex items-center gap-4 shrink-0">
              {/* Status badge */}
              <span className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                cliente.status === 'Ativo'
                  ? 'bg-green-500/15 text-green-400'
                  : cliente.status === 'Inativo'
                  ? 'bg-orange-500/15 text-orange-400'
                  : 'bg-muted text-muted-foreground'
              )}>
                <span className={cn('h-1.5 w-1.5 rounded-full', cliente.status === 'Ativo' ? 'bg-green-400' : cliente.status === 'Inativo' ? 'bg-orange-400' : 'bg-gray-500')} />
                {cliente.status}
              </span>

              {/* Ver dashboard */}
              {!showArchived && (
                <Link
                  href={`/dashboard?client=${cliente.id}`}
                  className="text-sm font-medium text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
                >
                  Ver dashboard →
                </Link>
              )}

              {/* Platform icons */}
              {!showArchived && (
                <div className="flex items-center gap-0.5">
                  {ALL_PLATFORMS.map(p => (
                    <PlatformIconButton
                      key={p}
                      platform={p}
                      size="sm"
                      onClick={e => {
                        e.preventDefault();
                        setLinkDialogClient(cliente);
                        setLinkDialogPlatform(p);
                        setLinkDialogOpen(true);
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Archived actions */}
              {isAdmin && showArchived && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openStatusDialog(cliente, 'Ativo')}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Power className="h-3.5 w-3.5" /> Ativar
                  </button>
                  {cliente.status === 'Arquivado' && (
                    <button
                      onClick={() => restoreClient(cliente.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                    </button>
                  )}
                </div>
              )}

              {/* ⋮ Menu */}
              {isAdmin && (
                <div className="relative">
                  <button
                    onClick={() => setMenuId(menuId === cliente.id ? null : cliente.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuId === cliente.id && (
                    <div className="absolute right-0 top-8 z-50 min-w-[160px] rounded-lg border border-border bg-popover shadow-xl py-1">
                      {!showArchived && (
                        <>
                          <button
                            onClick={() => { openStatusDialog(cliente, 'Inativo'); setMenuId(null); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-orange-400 hover:bg-orange-500/10 transition-colors"
                          >
                            <PowerOff className="h-3.5 w-3.5" /> Desativar
                          </button>
                          <button
                            onClick={() => { openArchiveDialog(cliente); setMenuId(null); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors"
                          >
                            <Archive className="h-3.5 w-3.5" /> Ocultar
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => { openDeleteDialog(cliente); setMenuId(null); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Excluir
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {displayedClients.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <p className="text-sm font-semibold text-muted-foreground">
              {showArchived ? 'Nenhum cliente oculto.' : 'Nenhum cliente encontrado.'}
            </p>
          </div>
        )}
      </div>

      {/* ── DIALOGS (sem alteração) ── */}

      {/* Novo cliente */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Novo Cliente</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="client-name">Nome do cliente</Label>
              <Input id="client-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Clínica Nova Vida" className="bg-background" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-segment">Segmento</Label>
              <Input id="client-segment" value={segment} onChange={e => setSegment(e.target.value)} placeholder="Ex: Saúde" className="bg-background" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-status">Status</Label>
              <select id="client-status" value={status} onChange={e => setStatus(e.target.value as ClientStatus)}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="Ativo">Ativo</option>
                <option value="Alerta">Alerta</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleAddClient} disabled={!name.trim() || !segment.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Plus className="w-4 h-4 mr-1" /> Criar Cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status change */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingStatus === 'Ativo' ? <Power className="h-5 w-5 text-primary" /> : <PowerOff className="h-5 w-5 text-orange-400" />}
              {pendingStatus === 'Ativo' ? 'Ativar cliente' : 'Desativar cliente'}
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-background/60 p-4 text-sm">
            <p className="font-semibold">{pendingStatus === 'Ativo' ? 'Ativar' : 'Desativar'} {selectedClient?.name}?</p>
            <p className="mt-2 text-muted-foreground">
              {pendingStatus === 'Ativo'
                ? 'O cliente volta a aparecer na Dashboard, relatórios, pagamentos e demais áreas do sistema.'
                : 'O cliente fica oculto da Dashboard, relatórios, pagamentos e demais áreas do sistema até ser ativado novamente.'}
            </p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="status-email">Usuário do sistema</Label>
              <Input id="status-email" value={securityEmail} onChange={e => setSecurityEmail(e.target.value)} placeholder="email do administrador" className="bg-background" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status-password">Senha</Label>
              <Input id="status-password" type="password" value={securityPassword} onChange={e => setSecurityPassword(e.target.value)} placeholder="senha do administrador" className="bg-background" />
            </div>
            {securityError && <p className="text-xs font-semibold text-destructive">{securityError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>Cancelar</Button>
            <Button onClick={confirmStatusChange} disabled={securityLoading || !securityEmail.trim() || !securityPassword}
              className={pendingStatus === 'Ativo' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-orange-500 text-white hover:bg-orange-500/90'}>
              {securityLoading ? 'Validando...' : pendingStatus === 'Ativo' ? 'Ativar cliente' : 'Desativar cliente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive */}
      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-orange-400" /> Ocultar cliente
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-orange-400/30 bg-orange-500/10 p-4 text-sm">
            <p className="font-semibold">Ocultar {selectedClient?.name}?</p>
            <p className="mt-2 text-muted-foreground">Ele deixa de aparecer em relatórios, pagamentos e dashboards gerais, mas pode ser restaurado depois.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDialogOpen(false)}>Cancelar</Button>
            <Button onClick={confirmArchiveClient} className="bg-orange-500 text-white hover:bg-orange-500/90">Ocultar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" /> Excluir definitivamente
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold">Excluir {selectedClient?.name}?</p>
            <p className="mt-2 text-muted-foreground">Essa ação remove o cliente e os Pix vinculados a ele neste sistema. Não dá para desfazer.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancelar</Button>
            <Button onClick={confirmDeleteClient} className="bg-destructive text-white hover:bg-destructive/90">Excluir de vez</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {linkDialogClient && (
        <LinkAccountsDialog
          clientId={linkDialogClient.id}
          clientName={linkDialogClient.name}
          platform={linkDialogPlatform}
          open={linkDialogOpen}
          onOpenChange={v => { setLinkDialogOpen(v); if (!v) setLinkDialogClient(null); }}
        />
      )}
    </div>
  );
}
