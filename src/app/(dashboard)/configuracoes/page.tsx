"use client";

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ExternalLink } from 'lucide-react';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { mockUsers as initialUsers, mockPermissions as initialPermissions } from '@/lib/mock-data';
import type { User, Permission } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

const MODULES: { key: keyof Permission; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'relatorios', label: 'Relatórios' },
  { key: 'configuracoes', label: 'Configurações' },
  { key: 'integracoes', label: 'Integrações' },
];

const ROLES = ['Administrador', 'Usuário', 'Visualizador'];

const defaultPermission: Permission = { dashboard: true, clientes: false, relatorios: false, configuracoes: false, integracoes: false };
const emptyForm = { name: '', email: '', password: '', role: 'Usuário', status: 'Ativo' };

async function persistUser(user: User): Promise<boolean> {
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
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [permissions, setPermissions] = useState<Record<string, Permission>>(initialPermissions);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  // Load from database on mount
  useEffect(() => {
    void (async () => {
      const [usersRes, permsRes] = await Promise.allSettled([
        fetch('/api/users'),
        fetch('/api/permissions'),
      ]);
      if (usersRes.status === 'fulfilled' && usersRes.value.ok) {
        const data: User[] = await usersRes.value.json();
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

  function openEditDialog(user: User) {
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
      const updated: User = { id: editingUserId, name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role, status: form.status };
      const snapshot = users;
      setUsers((prev) => prev.map((u) => u.id === editingUserId ? updated : u));
      setForm(emptyForm);
      setEditingUserId(null);
      setDialogOpen(false);
      void persistUser(updated).then((ok) => { if (!ok) setUsers(snapshot); });
      return;
    }

    const id = String(Date.now());
    const user: User = { id, name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role, status: form.status };
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-heading tracking-wider uppercase">Configurações</h1>
        <p className="text-muted-foreground mt-1">Gerencie usuários e permissões do sistema.</p>
      </div>

      <Tabs defaultValue="usuarios">
        <TabsList>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="permissoes">Permissões</TabsTrigger>
          <TabsTrigger value="legal">Legal</TabsTrigger>
        </TabsList>

        {/* ── USUÁRIOS ── */}
        <TabsContent value="usuarios" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={openCreateDialog}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="w-4 h-4 mr-2" />
              Novo Usuário
            </Button>
          </div>

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium">
                <tr>
                  <th className="px-6 py-4">Nome</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Perfil</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4 font-medium">{user.name}</td>
                    <td className="px-6 py-4 text-muted-foreground">{user.email}</td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          'px-2 py-1 rounded-full text-xs font-medium',
                          user.role === 'Administrador'
                            ? 'bg-primary/20 text-primary'
                            : user.role === 'Usuário'
                            ? 'bg-blue-500/20 text-blue-500'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          'px-2 py-1 rounded-full text-xs font-medium',
                          user.status === 'Ativo'
                            ? 'bg-primary/20 text-primary'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => openEditDialog(user)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Remover"
                          className="text-destructive/70 hover:text-destructive"
                          onClick={() => handleDeleteUser(user.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── PERMISSÕES ── */}
        <TabsContent value="permissoes" className="mt-6">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium">
                <tr>
                  <th className="px-6 py-4">Usuário</th>
                  {MODULES.map((m) => (
                    <th key={m.key} className="px-6 py-4 text-center">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.role}</div>
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
                              enabled ? 'bg-primary' : 'bg-muted-foreground/30'
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
        </TabsContent>
        {/* ── LEGAL ── */}
        <TabsContent value="legal" className="mt-6 space-y-6">
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
        </TabsContent>
      </Tabs>

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
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
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
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {editingUserId ? 'Salvar Usuário' : 'Criar Usuário'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
