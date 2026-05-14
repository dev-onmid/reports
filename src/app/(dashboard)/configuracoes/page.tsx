"use client";

import { useEffect, useState } from 'react';
import {
  Plus, Trash2, ExternalLink, Users2, Shield, User, Mail,
  Edit2, Search, Filter, Download, Eye, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { mockUsers as initialUsers, mockPermissions as initialPermissions } from '@/lib/mock-data';
import type { User as UserType, Permission } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

const MODULES: { key: keyof Permission; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'relatorios', label: 'Relatórios' },
  { key: 'configuracoes', label: 'Configurações' },
  { key: 'integracoes', label: 'Integrações' },
];

const ROLES = ['Administrador', 'Usuário', 'Visualizador'];

const defaultPermission: Permission = {
  dashboard: true,
  clientes: false,
  relatorios: false,
  configuracoes: false,
  integracoes: false,
};
const emptyForm = { name: '', email: '', password: '', role: 'Usuário', status: 'Ativo' };

// Mock registration dates per id for display purposes
const MOCK_DATES: Record<string, string> = {
  '1': '10/01/2025',
  '4': '12/01/2025',
  '2': '18/01/2025',
  '3': '05/05/2026',
};

function getRegDate(id: string): string {
  return MOCK_DATES[id] ?? new Date().toLocaleDateString('pt-BR');
}

// Avatar color per first letter
function avatarColor(name: string): string {
  const letter = name.charAt(0).toUpperCase();
  if (['A', 'M'].includes(letter)) return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
  if (['J'].includes(letter)) return 'bg-zinc-700 text-zinc-300 border border-zinc-600';
  return 'bg-violet-500/20 text-violet-400 border border-violet-500/30';
}

// Role badge styles
function roleBadge(role: string) {
  if (role === 'Administrador')
    return { cls: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', Icon: Shield };
  if (role === 'Usuário')
    return { cls: 'bg-violet-500/10 text-violet-400 border border-violet-500/20', Icon: User };
  return { cls: 'bg-zinc-700/50 text-zinc-400 border border-zinc-600/50', Icon: Eye };
}

async function persistUser(user: UserType): Promise<boolean> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  return res.ok;
}

function persistPermission(userId: string, permission: Permission) {
  void fetch('/api/permissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...permission }),
  }).catch((e) => console.error('Erro ao salvar permissão:', e));
}

export default function ConfiguracoesPage() {
  const [users, setUsers] = useState<UserType[]>(initialUsers);
  const [permissions, setPermissions] = useState<Record<string, Permission>>(initialPermissions);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'usuarios' | 'permissoes' | 'legal'>('usuarios');
  const [search, setSearch] = useState('');

  // Load from database on mount
  useEffect(() => {
    void (async () => {
      const [usersRes, permsRes] = await Promise.allSettled([
        fetch('/api/users'),
        fetch('/api/permissions'),
      ]);
      if (usersRes.status === 'fulfilled' && usersRes.value.ok) {
        const data: UserType[] = await usersRes.value.json();
        if (data.length > 0) setUsers(data);
      }
      if (permsRes.status === 'fulfilled' && permsRes.value.ok) {
        const data: Record<string, Permission> = await permsRes.value.json();
        if (Object.keys(data).length > 0) setPermissions({ ...initialPermissions, ...data });
      }
    })();
  }, []);

  function openCreateDialog() {
    setEditingUserId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditDialog(user: UserType) {
    setEditingUserId(user.id);
    setForm({
      name: user.name,
      email: user.email,
      password: user.password,
      role: user.role,
      status: user.status,
    });
    setDialogOpen(true);
  }

  function handleSaveUser() {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) return;

    if (editingUserId) {
      const updated: UserType = {
        id: editingUserId,
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        status: form.status,
      };
      const snapshot = users;
      setUsers((prev) => prev.map((u) => u.id === editingUserId ? updated : u));
      setForm(emptyForm);
      setEditingUserId(null);
      setDialogOpen(false);
      void persistUser(updated).then((ok) => { if (!ok) setUsers(snapshot); });
      return;
    }

    const id = String(Date.now());
    const user: UserType = {
      id,
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
      status: form.status,
    };
    const snapshot = users;
    setUsers((prev) => [...prev, user]);
    setPermissions((prev) => ({ ...prev, [id]: defaultPermission }));
    setForm(emptyForm);
    setEditingUserId(null);
    setDialogOpen(false);
    void persistUser(user).then((ok) => {
      if (!ok) { setUsers(snapshot); return; }
      persistPermission(id, defaultPermission);
    });
  }

  function handleDeleteUser(id: string) {
    const snapshot = users;
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setPermissions((prev) => { const next = { ...prev }; delete next[id]; return next; });
    void fetch(`/api/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then((res) => { if (!res.ok) setUsers(snapshot); })
      .catch(() => setUsers(snapshot));
  }

  function togglePermission(userId: string, module: keyof Permission) {
    setPermissions((prev) => {
      const current = prev[userId] ?? defaultPermission;
      const next = { ...prev, [userId]: { ...current, [module]: !current[module] } };
      persistPermission(userId, next[userId]);
      return next;
    });
  }

  // Derived KPI values
  const totalUsers = users.length;
  const admins = users.filter((u) => u.role === 'Administrador').length;
  const activeUsers = users.filter((u) => u.status === 'Ativo').length;
  const pendingInvites = 1; // mocked

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const TABS = [
    { key: 'usuarios' as const, label: 'Usuários' },
    { key: 'permissoes' as const, label: 'Permissões' },
    { key: 'legal' as const, label: 'Legal' },
  ];

  return (
    <div className="space-y-6 pb-10">
      {/* ── HEADER ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-heading font-bold tracking-widest uppercase">
            CONFIGURAÇÕES
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie usuários e permissões do sistema.
          </p>
        </div>
        <button
          onClick={openCreateDialog}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-[0_0_16px_rgba(16,185,129,0.35)] transition-all"
        >
          <Plus className="w-4 h-4" />
          Novo Usuário
        </button>
      </div>

      {/* ── TABS (underline style) ── */}
      <div className="flex gap-6 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'pb-3 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'text-foreground border-b-2 border-emerald-500 -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════
          TAB: USUÁRIOS
      ══════════════════════════════════ */}
      {activeTab === 'usuarios' && (
        <div className="space-y-6">
          {/* ── KPI CARDS ── */}
          <div className="grid grid-cols-4 gap-4">
            {/* Card 1: Total */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="w-12 h-12 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Users2 className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-3xl font-bold leading-none">{totalUsers}</p>
                <p className="text-xs text-muted-foreground mt-1">Total de usuários</p>
              </div>
              <div>
                <span className="text-xs text-emerald-400 font-medium">↑ 33%</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">+1 nos últimos 30 dias</p>
              </div>
            </div>

            {/* Card 2: Admins */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                <Shield className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-3xl font-bold leading-none">{admins}</p>
                <p className="text-xs text-muted-foreground mt-1">Administradores</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground font-medium">— 0%</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">Sem alteração</p>
              </div>
            </div>

            {/* Card 3: Ativos */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                <User className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-3xl font-bold leading-none">{activeUsers}</p>
                <p className="text-xs text-muted-foreground mt-1">Usuários ativos</p>
              </div>
              <div>
                <span className="text-xs text-emerald-400 font-medium">↑ 50%</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">+1 nos últimos 30 dias</p>
              </div>
            </div>

            {/* Card 4: Convites */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="w-12 h-12 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Mail className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-3xl font-bold leading-none">{pendingInvites}</p>
                <p className="text-xs text-muted-foreground mt-1">Convite pendente</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground font-medium">— 0%</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">Sem alteração</p>
              </div>
            </div>
          </div>

          {/* ── USUÁRIOS CADASTRADOS CARD ── */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Card header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <p className="text-sm font-bold">Usuários cadastrados</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Lista de todos os usuários que possuem acesso ao sistema.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar usuário..."
                    className="pl-8 pr-3 h-8 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500 w-44"
                  />
                </div>
                {/* Filter button */}
                <button className="flex items-center gap-1.5 h-8 px-3 text-xs text-muted-foreground bg-background border border-border rounded-lg hover:text-foreground transition-colors">
                  <Filter className="w-3.5 h-3.5" />
                  Filtrar
                  <svg className="w-3 h-3 ml-0.5" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                  </svg>
                </button>
                {/* Download */}
                <button className="h-8 w-8 flex items-center justify-center text-muted-foreground bg-background border border-border rounded-lg hover:text-foreground transition-colors">
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Table */}
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Usuário</th>
                  <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</th>
                  <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Perfil</th>
                  <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((user) => {
                  const { cls: badgeCls, Icon: BadgeIcon } = roleBadge(user.role);
                  return (
                    <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                      {/* Avatar + name */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                              avatarColor(user.name)
                            )}
                          >
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{user.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              Cadastrado em {getRegDate(user.id)}
                            </p>
                          </div>
                        </div>
                      </td>
                      {/* Email */}
                      <td className="px-6 py-4 text-sm text-muted-foreground">{user.email}</td>
                      {/* Role badge */}
                      <td className="px-6 py-4">
                        <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', badgeCls)}>
                          <BadgeIcon className="w-3 h-3" />
                          {user.role}
                        </span>
                      </td>
                      {/* Status */}
                      <td className="px-6 py-4">
                        {user.status === 'Ativo' ? (
                          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                            Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground inline-block" />
                            Inativo
                          </span>
                        )}
                      </td>
                      {/* Actions */}
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditDialog(user)}
                            title="Editar"
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            title="Remover"
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Card footer / pagination */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Mostrando 1 a {filteredUsers.length} de {filteredUsers.length} usuários
              </p>
              <div className="flex items-center gap-1">
                <button className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-500 text-white text-xs font-semibold">
                  1
                </button>
                <button className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════
          TAB: PERMISSÕES
      ══════════════════════════════════ */}
      {activeTab === 'permissoes' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Usuário
                </th>
                {MODULES.map((m) => (
                  <th
                    key={m.key}
                    className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-center"
                  >
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                          avatarColor(user.name)
                        )}
                      >
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{user.name}</p>
                        <p className="text-[11px] text-muted-foreground">{user.role}</p>
                      </div>
                    </div>
                  </td>
                  {MODULES.map((m) => {
                    const enabled = permissions[user.id]?.[m.key] ?? defaultPermission[m.key];
                    return (
                      <td key={m.key} className="px-6 py-4 text-center">
                        <button
                          onClick={() => togglePermission(user.id, m.key)}
                          aria-label={`${enabled ? 'Desativar' : 'Ativar'} ${m.label} para ${user.name}`}
                          className={cn(
                            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                            enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                          )}
                        >
                          <span
                            className={cn(
                              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200',
                              enabled ? 'translate-x-5' : 'translate-x-0'
                            )}
                          />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════════════════════════════
          TAB: LEGAL
      ══════════════════════════════════ */}
      {activeTab === 'legal' && (
        <div className="space-y-6">
          {[
            {
              title: 'Política de Privacidade',
              description: 'Descreve como coletamos, usamos e protegemos os dados dos usuários.',
              url: 'https://post.onmid.app/privacy',
            },
            {
              title: 'Exclusão de Dados da Conta',
              description: 'Instruções e procedimento para solicitação de exclusão de dados pessoais.',
              url: 'https://post.onmid.app/data-deletion',
            },
          ].map(({ title, description, url }) => (
            <div key={url} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <p className="text-sm font-bold">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                </div>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir em nova aba
                </a>
              </div>
              <iframe
                src={url}
                title={title}
                className="w-full border-0 bg-white"
                style={{ height: '480px' }}
                loading="lazy"
              />
            </div>
          ))}
        </div>
      )}

      {/* ── DIALOG: Novo/Editar Usuário ── */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setForm(emptyForm);
            setEditingUserId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUserId ? 'Editar Usuário' : 'Criar Novo Usuário'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Nome</Label>
              <Input
                id="user-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nome completo"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="email@exemplo.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-password">Senha</Label>
              <Input
                id="user-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Defina a senha de acesso"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Perfil</Label>
              <Select value={form.role} onValueChange={(role) => role && setForm({ ...form, role })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <select
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value })}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="Ativo">Ativo</option>
                <option value="Inativo">Inativo</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                setForm(emptyForm);
                setEditingUserId(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveUser}
              disabled={!form.name.trim() || !form.email.trim() || !form.password.trim()}
              className="bg-emerald-500 hover:bg-emerald-400 text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]"
            >
              {editingUserId ? 'Salvar Usuário' : 'Criar Usuário'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
