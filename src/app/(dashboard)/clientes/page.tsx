"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Archive, RotateCcw, ShieldAlert, Trash2, Plus, Power, PowerOff,
  Search, ArrowUpDown, ChevronDown, EyeOff, LayoutList, LayoutGrid,
  MoreHorizontal, SlidersHorizontal, PiggyBank, History, UserCog, X,
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
import type { ClientStatus, DashboardType } from '@/lib/mock-data';
import { LinkAccountsDialog } from '@/components/link-accounts-dialog';
import { PlatformIconButton, ALL_PLATFORMS, type PlatformId } from '@/components/platform-icons';
import { ClientAvatar } from '@/components/client-avatar';
import { cn } from '@/lib/utils';

type ActivityLog = {
  id: string;
  platform: string;
  event_type: string;
  description: string;
  actor_name?: string;
  actor_source: string;
  campaign_name?: string;
  created_at: string;
};

export default function ClientesPage() {
  const {
    clients, archivedClients, archiveClient,
    restoreClient, setClientStatus, deleteClient, updateClientGestor, updateClientMeta,
  } = useClients();
  const { payments, loading: paymentsLoading, setPayments } = useInvestmentPayments();

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
  const [search, setSearch]                             = useState('');
  const [segmentFilter, setSegmentFilter]               = useState('');
  const [categories, setCategories]                     = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [gestorFilter, setGestorFilter]           = useState('');
  const [sortOrder, setSortOrder]                 = useState<'az' | 'za'>('az');
  const [menuId, setMenuId]                       = useState<string | null>(null);
  const [clientBalances, setClientBalances]        = useState<Record<string, { meta: number | null; google: number | null }>>({});
  const [balancesLoading, setBalancesLoading]      = useState(true);
  const [users, setUsers]                          = useState<{id: string; name: string; role: string}[]>([]);
  const [gestorClientId, setGestorClientId]        = useState<string | null>(null);
  const [selectedGestorId, setSelectedGestorId]    = useState('');
  const [activityClientId, setActivityClientId]    = useState<string | null>(null);
  const [activityLogs, setActivityLogs]            = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading]      = useState(false);
  const [selectedIds, setSelectedIds]              = useState<Set<string>>(new Set());
  const [bulkGestorId, setBulkGestorId]            = useState('');
  const [bulkCategoryId, setBulkCategoryId]        = useState('');
  const [bulkDashType, setBulkDashType]            = useState('');
  const [bulkConfirm, setBulkConfirm]              = useState<'delete' | 'archive' | 'inativar' | null>(null);
  const [inlineEdit, setInlineEdit]                = useState<{ id: string; field: 'category' | 'dashtype' } | null>(null);

  const isAdmin = canManageClients(currentRole);

  const allGestores = [...new Set(
    clients.map(c => c.gestor_name).filter(Boolean)
  )].sort() as string[];

  const baseClients = showArchived ? archivedClients : clients;
  const displayedClients = baseClients
    .filter(c => {
      const catLabel = c.category_name ?? c.segment;
      return (
        (c.name.toLowerCase().includes(search.toLowerCase()) || catLabel.toLowerCase().includes(search.toLowerCase())) &&
        (!segmentFilter || catLabel === segmentFilter) &&
        (!gestorFilter || c.gestor_name === gestorFilter)
      );
    })
    .sort((a, b) => sortOrder === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));

  const financialByClient = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const grouped: Record<string, { pending: number; overdue: number; month: number; nextDate: string | null }> = {};

    for (const payment of payments) {
      const current = grouped[payment.clientId] ?? { pending: 0, overdue: 0, month: 0, nextDate: null };
      if (payment.date.startsWith(monthKey)) current.month += payment.amount;
      if (payment.status === 'Em atraso') current.overdue += payment.amount;
      if (payment.status === 'Pendente') current.pending += payment.amount;
      if (payment.status !== 'Pago' && (!current.nextDate || payment.date < current.nextDate)) {
        current.nextDate = payment.date;
      }
      grouped[payment.clientId] = current;
    }

    return grouped;
  }, [payments]);

  useEffect(() => {
    queueMicrotask(() => {
      const session = getAuthSession();
      setCurrentRole(session?.role ?? '');
      setSecurityEmail(session?.email ?? '');
    });
    fetch('/api/users').then(r => r.ok ? r.json() : []).then(setUsers).catch(() => {});
    fetch('/api/clients/categories').then(r => r.ok ? r.json() : []).then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/clients/links').then(r => r.ok ? r.json() as Promise<Array<{ clientId: string; platform: string; accountId: string }>> : []),
      fetch('/api/meta/account-balances').then(r => r.ok ? r.json() as Promise<Array<{ id: string; balance: number | null }>> : []),
      fetch('/api/google/account-balances').then(r => r.ok ? r.json() as Promise<Array<{ id: string; balance: number | null }>> : []),
    ]).then(([links, metaBals, googleBals]) => {
      const metaMap = new Map(metaBals.map(b => [b.id, b.balance]));
      const googleMap = new Map(googleBals.map(b => [b.id, b.balance]));
      const result: Record<string, { meta: number | null; google: number | null }> = {};
      for (const link of links) {
        if (!result[link.clientId]) result[link.clientId] = { meta: null, google: null };
        if (link.platform === 'meta_ads') {
          const bal = metaMap.get(link.accountId);
          if (bal !== undefined && bal !== null) result[link.clientId].meta = (result[link.clientId].meta ?? 0) + bal;
        } else if (link.platform === 'google_ads') {
          const bal = googleMap.get(link.accountId);
          if (bal !== undefined && bal !== null) result[link.clientId].google = (result[link.clientId].google ?? 0) + bal;
        }
      }
      setClientBalances(result);
    }).catch(() => {}).finally(() => setBalancesLoading(false));
  }, []);

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

  function openGestorDialog(client: { id: string; name: string }) {
    const found = clients.find(c => c.id === client.id) ?? archivedClients.find(c => c.id === client.id);
    setSelectedGestorId(found?.gestor_id ?? '');
    setGestorClientId(client.id);
  }

  async function openActivityLog(clientId: string) {
    setActivityClientId(clientId);
    setActivityLoading(true);
    setActivityLogs([]);
    try {
      const res = await fetch(`/api/clients/${clientId}/activity`);
      if (res.ok) {
        const data: ActivityLog[] = await res.json();
        setActivityLogs(data);
      }
    } catch { /* ignore */ } finally {
      setActivityLoading(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(prev => prev.size === displayedClients.length ? new Set() : new Set(displayedClients.map(c => c.id)));
  }

  function clearSelection() { setSelectedIds(new Set()); setBulkConfirm(null); setBulkGestorId(''); setBulkCategoryId(''); setBulkDashType(''); }

  function bulkSetGestor() {
    if (!bulkGestorId || !isAdmin) return;
    selectedIds.forEach(id => updateClientGestor(id, bulkGestorId));
    clearSelection();
  }

  function bulkSetCategory() {
    if (!bulkCategoryId || !isAdmin) return;
    selectedIds.forEach(id => updateClientMeta(id, { category_id: bulkCategoryId }));
    clearSelection();
  }

  function bulkSetDashType() {
    if (!bulkDashType || !isAdmin) return;
    selectedIds.forEach(id => updateClientMeta(id, { dashboard_type: bulkDashType as DashboardType }));
    clearSelection();
  }

  function bulkSetStatus(status: ClientStatus) {
    if (!isAdmin) return;
    selectedIds.forEach(id => setClientStatus(id, status));
    clearSelection();
  }

  function bulkArchive() {
    if (!isAdmin) return;
    selectedIds.forEach(id => archiveClient(id));
    clearSelection();
  }

  function bulkDelete() {
    if (!isAdmin) return;
    selectedIds.forEach(id => {
      deleteClient(id);
      setPayments(prev => prev.filter(p => p.clientId !== id));
    });
    clearSelection();
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

  function platformColor(platform: string): string {
    if (platform === 'meta') return 'text-blue-400 bg-blue-400/10';
    if (platform === 'google') return 'text-red-400 bg-red-400/10';
    return 'text-muted-foreground bg-muted/30';
  }

  function formatCompactBRL(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  function formatShortDate(iso: string | null): string {
    if (!iso) return '';
    return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  }

  function getFinancialInfo(clientId: string, billingMode?: 'prepaid' | 'card') {
    const balances = clientBalances[clientId];
    const hasMeta = balances?.meta !== undefined && balances.meta !== null;
    const hasGoogle = balances?.google !== undefined && balances.google !== null;
    const hasBalance = hasMeta || hasGoogle;

    if (balancesLoading || paymentsLoading) {
      return { label: 'Financeiro', value: '', sub: '', tone: 'text-muted-foreground', loading: true };
    }

    if (hasBalance) {
      const meta = balances?.meta ?? 0;
      const google = balances?.google ?? 0;
      const parts = [
        hasMeta ? `Meta ${formatCompactBRL(meta)}` : null,
        hasGoogle ? `Google ${formatCompactBRL(google)}` : null,
      ].filter(Boolean).join(' · ');

      return {
        label: 'Saldo mídia',
        value: formatCompactBRL(meta + google),
        sub: parts,
        tone: meta + google > 0 ? 'text-emerald-400' : 'text-muted-foreground',
        loading: false,
      };
    }

    const finance = financialByClient[clientId];
    if (finance?.overdue) {
      return {
        label: 'Financeiro',
        value: formatCompactBRL(finance.overdue),
        sub: 'em atraso',
        tone: 'text-red-400',
        loading: false,
      };
    }
    if (finance?.pending) {
      return {
        label: 'Invest. pendente',
        value: formatCompactBRL(finance.pending),
        sub: finance.nextDate ? `próx. ${formatShortDate(finance.nextDate)}` : 'aguardando envio',
        tone: 'text-amber-400',
        loading: false,
      };
    }
    if (finance?.month) {
      return {
        label: 'Invest. mês',
        value: formatCompactBRL(finance.month),
        sub: 'agenda de mídia',
        tone: 'text-foreground',
        loading: false,
      };
    }

    return {
      label: 'Cobrança',
      value: billingMode === 'card' ? 'Cartão' : 'Pré-pago',
      sub: billingMode === 'card' ? 'sem saldo manual' : 'sem saldo vinculado',
      tone: 'text-muted-foreground',
      loading: false,
    };
  }

  return (
    <div className="space-y-5">

      {/* ── HEADER ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">Meus Clientes</h1>
          <div className="mt-1 h-[3px] w-14 rounded-full bg-violet-500" />
          <p className="mt-2 text-sm text-muted-foreground">
            Gerencie a base de clientes e acesse os dashboards individuais.
          </p>
        </div>
        <Link
          href="/clientes/novo"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Novo Cliente
        </Link>
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

        {/* Category filter */}
        <div className="relative">
          <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <select
            value={segmentFilter}
            onChange={e => setSegmentFilter(e.target.value)}
            className="appearance-none rounded-lg border border-border bg-card pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary min-w-[170px]"
          >
            <option value="">Todas as categorias</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>

        {/* Gestor filter */}
        {allGestores.length > 0 && (
          <div className="relative">
            <UserCog className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <select
              value={gestorFilter}
              onChange={e => setGestorFilter(e.target.value)}
              className="appearance-none rounded-lg border border-border bg-card pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary min-w-[160px]"
            >
              <option value="">Todos os gestores</option>
              {allGestores.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        )}

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
          <button className="flex h-9 w-9 items-center justify-center rounded-l-lg text-muted-foreground/50" title="Lista compacta">
            <LayoutList className="h-4 w-4" />
          </button>
          <button className="flex h-9 w-9 items-center justify-center rounded-r-lg bg-primary/10 text-primary" title="Cards compactos">
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── CLIENT LIST ── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {displayedClients.map(cliente => {
          const finance = getFinancialInfo(cliente.id, cliente.ads_billing_mode);

          return (
            <div
              key={cliente.id}
              className={cn(
                'group relative min-w-0 rounded-xl border bg-card p-4 transition-all',
                selectedIds.has(cliente.id)
                  ? 'border-primary/45 bg-primary/5 shadow-[0_0_0_1px_rgba(85,245,47,0.14)]'
                  : 'border-border hover:border-border/80 hover:bg-muted/15'
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(cliente.id)}
                  onChange={() => toggleSelect(cliente.id)}
                  onClick={e => e.stopPropagation()}
                  className={cn(
                    'mt-3 h-4 w-4 shrink-0 cursor-pointer rounded accent-primary transition-opacity',
                    selectedIds.has(cliente.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                />

                <Link href={`/clientes/${cliente.id}`} className="shrink-0">
                  <ClientAvatar clientId={cliente.id} name={cliente.name} size="md" />
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/clientes/${cliente.id}`}>
                        <p className="truncate text-sm font-bold text-foreground hover:text-primary transition-colors">{cliente.name}</p>
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {inlineEdit?.id === cliente.id && inlineEdit.field === 'category' ? (
                          <select
                            autoFocus
                            value={cliente.category_id ?? ''}
                            onChange={e => {
                              updateClientMeta(cliente.id, { category_id: e.target.value || undefined });
                              setInlineEdit(null);
                            }}
                            onBlur={() => setInlineEdit(null)}
                            className="rounded border border-primary/50 bg-background px-1 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="">Sem categoria</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setInlineEdit({ id: cliente.id, field: 'category' })}
                            className="max-w-[11rem] truncate rounded bg-muted/50 px-1.5 py-0.5 text-left text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                            title="Clique para alterar categoria"
                          >
                            {cliente.category_name ?? cliente.segment ?? '+ categoria'}
                          </button>
                        )}

                        {inlineEdit?.id === cliente.id && inlineEdit.field === 'dashtype' ? (
                          <select
                            autoFocus
                            value={cliente.dashboard_type ?? 'leads'}
                            onChange={e => {
                              updateClientMeta(cliente.id, { dashboard_type: e.target.value as DashboardType });
                              setInlineEdit(null);
                            }}
                            onBlur={() => setInlineEdit(null)}
                            className="rounded border border-primary/50 bg-background px-1 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="leads">Leads</option>
                            <option value="branding">Branding</option>
                            <option value="conversao">Conversão</option>
                          </select>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setInlineEdit({ id: cliente.id, field: 'dashtype' })}
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase transition-colors',
                              cliente.dashboard_type === 'leads' ? 'bg-violet-500/15 text-violet-400 hover:bg-violet-500/30' :
                              cliente.dashboard_type === 'branding' ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/30' :
                              'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30'
                            )}
                            title="Clique para alterar tipo de dashboard"
                          >
                            {cliente.dashboard_type === 'leads' ? 'Leads' : cliente.dashboard_type === 'branding' ? 'Branding' : 'Conversão'}
                          </button>
                        )}

                        {!showArchived && (
                          <div className="ml-1 flex items-center gap-1">
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
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
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

                      {isAdmin && (
                        <div className="relative">
                          <button
                            onClick={() => setMenuId(menuId === cliente.id ? null : cliente.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {menuId === cliente.id && (
                            <div className="absolute right-0 top-9 z-50 min-w-[160px] rounded-lg border border-border bg-popover py-1 shadow-xl">
                              {!showArchived && (
                                <>
                                  <button
                                    onClick={() => { openGestorDialog(cliente); setMenuId(null); }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted"
                                  >
                                    <UserCog className="h-3.5 w-3.5" /> Alterar Gestor
                                  </button>
                                  <button
                                    onClick={() => { void openActivityLog(cliente.id); setMenuId(null); }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted"
                                  >
                                    <History className="h-3.5 w-3.5" /> Log de Atividade
                                  </button>
                                  <button
                                    onClick={() => { openStatusDialog(cliente, 'Inativo'); setMenuId(null); }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-orange-400 transition-colors hover:bg-orange-500/10"
                                  >
                                    <PowerOff className="h-3.5 w-3.5" /> Desativar
                                  </button>
                                  <button
                                    onClick={() => { openArchiveDialog(cliente); setMenuId(null); }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted"
                                  >
                                    <Archive className="h-3.5 w-3.5" /> Ocultar
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => { openDeleteDialog(cliente); setMenuId(null); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Excluir
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <button
                      type="button"
                      className={cn(
                        'flex min-w-0 items-center gap-2 rounded-lg bg-muted/35 px-2.5 py-2 text-left transition-colors',
                        isAdmin && 'hover:bg-primary/10 hover:ring-1 hover:ring-primary/25'
                      )}
                      onClick={isAdmin ? () => openGestorDialog(cliente) : undefined}
                      title={isAdmin ? 'Alterar gestor' : undefined}
                    >
                      {cliente.gestor_name ? (
                        <>
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary ring-1 ring-primary/30">
                            {cliente.gestor_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Gestor</p>
                            <p className="truncate text-xs font-semibold text-foreground">{cliente.gestor_name}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <UserCog className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Gestor</p>
                            <p className={cn('text-xs', isAdmin ? 'text-primary' : 'text-muted-foreground')}>{isAdmin ? '+ Atribuir' : 'Sem gestor'}</p>
                          </div>
                        </>
                      )}
                    </button>

                    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/35 px-2.5 py-2">
                      <PiggyBank className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{finance.label}</p>
                        {finance.loading ? (
                          <div className="mt-1 h-3 w-24 animate-pulse rounded bg-muted" />
                        ) : (
                          <div className="flex min-w-0 items-baseline gap-2">
                            <p className={cn('truncate text-xs font-bold tabular-nums', finance.tone)}>{finance.value}</p>
                            {finance.sub && <p className="truncate text-[10px] text-muted-foreground">{finance.sub}</p>}
                          </div>
                        )}
                      </div>
                    </div>

                    {!showArchived ? (
                      <Link
                        href={`/dashboard?client=${cliente.id}`}
                        className="inline-flex h-full min-h-[48px] items-center justify-center rounded-lg border border-primary/35 bg-primary/10 px-3 text-xs font-bold text-primary transition-colors hover:bg-primary/20 sm:min-w-[118px]"
                      >
                        Ver dashboard
                      </Link>
                    ) : null}
                  </div>

                  {showArchived && isAdmin ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => openStatusDialog(cliente, 'Ativo')}
                          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Power className="h-3.5 w-3.5" /> Ativar
                        </button>
                        {cliente.status === 'Arquivado' && (
                          <button
                            onClick={() => restoreClient(cliente.id)}
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {displayedClients.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <p className="text-sm font-semibold text-muted-foreground">
              {showArchived ? 'Nenhum cliente oculto.' : 'Nenhum cliente encontrado.'}
            </p>
          </div>
        )}
      </div>

      {/* ── DIALOGS ── */}

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

      {/* Alterar Gestor */}
      <Dialog open={!!gestorClientId} onOpenChange={() => setGestorClientId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" /> Alterar Gestor
            </DialogTitle>
          </DialogHeader>
          <select
            value={selectedGestorId}
            onChange={e => setSelectedGestorId(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Sem gestor</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGestorClientId(null)}>Cancelar</Button>
            <Button onClick={() => {
              if (gestorClientId) {
                updateClientGestor(gestorClientId, selectedGestorId || null);
              }
              setGestorClientId(null);
            }}>Salvar</Button>
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

      {/* ── BULK ACTION BAR ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 w-max max-w-[calc(100vw-2rem)]">
          <div className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-card/95 px-4 py-3 shadow-2xl backdrop-blur-md ring-1 ring-white/5">
            {/* Count + select all */}
            <div className="flex items-center gap-2 border-r border-border pr-3">
              <input
                type="checkbox"
                checked={selectedIds.size === displayedClients.length}
                onChange={toggleSelectAll}
                className="h-4 w-4 cursor-pointer rounded accent-primary"
              />
              <span className="text-sm font-bold text-foreground whitespace-nowrap">
                {selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Gestor picker */}
            <div className="flex items-center gap-1.5 border-r border-border pr-3">
              <select
                value={bulkGestorId}
                onChange={e => setBulkGestorId(e.target.value)}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary max-w-[130px]"
              >
                <option value="">Atribuir gestor…</option>
                <option value="__none__">Remover gestor</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button
                onClick={bulkSetGestor}
                disabled={!bulkGestorId}
                className="h-8 rounded-lg bg-primary/10 px-2.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
              >
                Aplicar
              </button>
            </div>

            {/* Category picker */}
            <div className="flex items-center gap-1.5 border-r border-border pr-3">
              <select
                value={bulkCategoryId}
                onChange={e => setBulkCategoryId(e.target.value)}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary max-w-[140px]"
              >
                <option value="">Categoria…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                onClick={bulkSetCategory}
                disabled={!bulkCategoryId}
                className="h-8 rounded-lg bg-primary/10 px-2.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
              >
                Aplicar
              </button>
            </div>

            {/* Dashboard type picker */}
            <div className="flex items-center gap-1.5 border-r border-border pr-3">
              <select
                value={bulkDashType}
                onChange={e => setBulkDashType(e.target.value)}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary max-w-[130px]"
              >
                <option value="">Tipo dashboard…</option>
                <option value="leads">Leads</option>
                <option value="branding">Branding</option>
                <option value="conversao">Conversão</option>
              </select>
              <button
                onClick={bulkSetDashType}
                disabled={!bulkDashType}
                className="h-8 rounded-lg bg-primary/10 px-2.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
              >
                Aplicar
              </button>
            </div>

            {/* Status actions */}
            <div className="flex items-center gap-1.5 border-r border-border pr-3">
              {bulkConfirm === 'inativar' ? (
                <>
                  <span className="text-xs text-orange-400 font-medium">Desativar {selectedIds.size}?</span>
                  <button onClick={() => bulkSetStatus('Inativo')} className="h-8 rounded-lg bg-orange-500/10 px-2.5 text-xs font-bold text-orange-400 hover:bg-orange-500/20">Confirmar</button>
                  <button onClick={() => setBulkConfirm(null)} className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground">✕</button>
                </>
              ) : (
                <button onClick={() => setBulkConfirm('inativar')} className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Desativar
                </button>
              )}
              <button onClick={() => bulkSetStatus('Ativo')} className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                Ativar
              </button>
            </div>

            {/* Archive */}
            <div className="flex items-center gap-1.5 border-r border-border pr-3">
              {bulkConfirm === 'archive' ? (
                <>
                  <span className="text-xs text-yellow-400 font-medium">Arquivar {selectedIds.size}?</span>
                  <button onClick={bulkArchive} className="h-8 rounded-lg bg-yellow-500/10 px-2.5 text-xs font-bold text-yellow-400 hover:bg-yellow-500/20">Confirmar</button>
                  <button onClick={() => setBulkConfirm(null)} className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground">✕</button>
                </>
              ) : (
                <button onClick={() => setBulkConfirm('archive')} className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Arquivar
                </button>
              )}
            </div>

            {/* Delete */}
            <div className="flex items-center gap-1.5 border-r border-border pr-3">
              {bulkConfirm === 'delete' ? (
                <>
                  <span className="text-xs text-red-400 font-medium">Excluir {selectedIds.size}?</span>
                  <button onClick={bulkDelete} className="h-8 rounded-lg bg-red-500/10 px-2.5 text-xs font-bold text-red-400 hover:bg-red-500/20">Confirmar</button>
                  <button onClick={() => setBulkConfirm(null)} className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground">✕</button>
                </>
              ) : (
                <button onClick={() => setBulkConfirm('delete')} className="h-8 rounded-lg border border-red-500/30 px-2.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors">
                  Excluir
                </button>
              )}
            </div>

            {/* Clear */}
            <button onClick={clearSelection} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Activity Log Drawer */}
      {activityClientId && (
        <div className="fixed inset-y-0 right-0 z-50 w-96 bg-background border-l border-border shadow-2xl flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <History className="h-4 w-4 text-primary" /> Log de Atividade
            </h3>
            <Button variant="ghost" size="icon" onClick={() => setActivityClientId(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {activityLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Carregando...
              </div>
            ) : activityLogs.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                Nenhuma atividade registrada.
              </div>
            ) : (
              activityLogs.map(log => (
                <div key={log.id} className="flex gap-3">
                  <div className="mt-0.5 shrink-0">
                    <div className={cn('w-2 h-2 rounded-full mt-1.5', platformColor(log.platform).split(' ')[1] ?? 'bg-muted')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', platformColor(log.platform))}>
                        {log.platform.toUpperCase()}
                      </span>
                      <span className="text-xs font-medium text-foreground truncate">{log.description}</span>
                    </div>
                    {log.actor_name && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{log.actor_name}</p>
                    )}
                    {log.campaign_name && (
                      <p className="text-[10px] text-muted-foreground truncate">{log.campaign_name}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {log.created_at ? new Date(log.created_at).toLocaleString('pt-BR') : ''}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
