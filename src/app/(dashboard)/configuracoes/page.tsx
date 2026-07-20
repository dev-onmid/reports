"use client";

import { useEffect, useState } from 'react';
import {
  Plus, Trash2, ExternalLink, Users2, Shield, User, Mail,
  Edit2, Search, Filter, Download, Eye, ChevronLeft, ChevronRight,
  Sparkles, Bell, DollarSign, MessageCircle,
  LayoutDashboard, Users, TableProperties, FileText, BarChart3,
  WalletCards, Bot, ShieldCheck, Zap, Plug, ClipboardList, WandSparkles,
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
import { mockUsers as initialUsers, mockPermissions as initialPermissions, defaultPermission } from '@/lib/mock-data';
import type { User as UserType, Permission, Team } from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import { USD_TO_BRL } from '@/lib/ai-usage-config';

// Mirrors the sidebar nav order (src/components/layout/sidebar.tsx) so admins
// can grant access to exactly the items a user will see in the menu.
const MODULES: { key: keyof Permission; label: string; icon: React.ElementType }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'clientes', label: 'Clientes', icon: Users },
  { key: 'crm', label: 'CRM', icon: TableProperties },
  { key: 'relatorios', label: 'Relatórios', icon: FileText },
  { key: 'radar', label: 'Radar', icon: BarChart3 },
  { key: 'pagamentos', label: 'Pagamentos', icon: WalletCards },
  { key: 'disparos', label: 'Disparos', icon: MessageCircle },
  { key: 'otimizador', label: 'Otimizador', icon: WandSparkles },
  { key: 'luna_ia', label: 'Luna IA', icon: Bot },
  { key: 'cofre', label: 'Cofre', icon: ShieldCheck },
  { key: 'automacoes', label: 'Automações', icon: Zap },
  { key: 'integracoes', label: 'Integrações', icon: Plug },
  { key: 'logs', label: 'Logs', icon: ClipboardList },
];

const ROLES = ['Administrador', 'Usuário', 'Visualizador'];

const TEAMS: { value: Team; label: string }[] = [
  { value: 'onmid', label: 'Time Onmid' },
  { value: 'parceiro', label: 'Parceiro' },
];

const emptyForm = { name: '', email: '', password: '', role: 'Usuário', status: 'Ativo', team: 'onmid' as Team };

type AiUsageRow = {
  client_id: string;
  client_name: string;
  mes_ano: string;
  chamadas_ia: number;
  tokens_usados: number;
  custo_estimado_usd: number;
  ia_limite_chamadas_dia: number;
  chamadas_hoje: number;
};

type AiBillingSettings = {
  openai_credit_usd: number;
  claude_credit_usd: number;
  alert_enabled: boolean;
  alert_threshold_usd: number;
  alert_phone: string;
  zapi_client_id: string;
  last_alert_at: string | null;
};

type ZapiOption = {
  id: string;
  name: string;
  instance_id: string;
  active: boolean;
};

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
  const [users, setUsers] = useState<UserType[]>([]);
  const [permissions, setPermissions] = useState<Record<string, Permission>>(initialPermissions);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'usuarios' | 'permissoes' | 'ia' | 'otimizador' | 'legal'>('usuarios');

  // Otimizador WhatsApp config
  type OtimizadorWaConfig = {
    zapi_client_id: string | null;
    group_jid: string | null;
    ativo: boolean;
    notificar_crise_apenas: boolean;
    instances_disponiveis: { id: string; name: string; instance_id: string }[];
  };
  type WaGroup = { jid: string; nome: string; membros: number | null };
  const [otimizadorWa, setOtimizadorWa] = useState<OtimizadorWaConfig>({
    zapi_client_id: null, group_jid: null, ativo: false, notificar_crise_apenas: false, instances_disponiveis: [],
  });
  const [waGroups, setWaGroups] = useState<WaGroup[]>([]);
  const [waGroupsLoading, setWaGroupsLoading] = useState(false);
  const [otimizadorWaSaving, setOtimizadorWaSaving] = useState(false);
  const [otimizadorWaSaved, setOtimizadorWaSaved] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [aiUsage, setAiUsage] = useState<AiUsageRow[]>([]);
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  // Mês selecionado no histórico de uso de IA ('' = mais recente disponível)
  const [aiMonth, setAiMonth] = useState('');
  const [aiBilling, setAiBilling] = useState<AiBillingSettings>({
    openai_credit_usd: 0,
    claude_credit_usd: 0,
    alert_enabled: false,
    alert_threshold_usd: 2,
    alert_phone: '',
    zapi_client_id: '',
    last_alert_at: null,
  });
  const [zapiOptions, setZapiOptions] = useState<ZapiOption[]>([]);
  const [aiBillingSaving, setAiBillingSaving] = useState(false);
  const [aiBillingSaved, setAiBillingSaved] = useState<string | null>(null);

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

  useEffect(() => {
    if (activeTab !== 'ia') return;
    setAiUsageLoading(true);
    void fetch('/api/ai-usage/settings')
      .then((res) => res.ok ? res.json() as Promise<{ settings: AiBillingSettings; zapi_clients: ZapiOption[] }> : null)
      .then((data) => {
        if (!data) return;
        setAiBilling(data.settings);
        setZapiOptions(data.zapi_clients ?? []);
      })
      .catch(() => undefined);
    fetch('/api/crm/ai/usage')
      .then((res) => res.ok ? res.json() as Promise<AiUsageRow[]> : [])
      .then(setAiUsage)
      .catch(() => setAiUsage([]))
      .finally(() => setAiUsageLoading(false));
  }, [activeTab]);

  async function saveAiBilling() {
    setAiBillingSaving(true);
    setAiBillingSaved(null);
    try {
      const res = await fetch('/api/ai-usage/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiBilling),
      });
      const data = await res.json().catch(() => ({})) as { settings?: AiBillingSettings; error?: string };
      if (!res.ok || !data.settings) {
        setAiBillingSaved(data.error ?? 'Erro ao salvar configuração');
        return;
      }
      setAiBilling(data.settings);
      setAiBillingSaved('Configuração salva');
      setTimeout(() => setAiBillingSaved(null), 4000);
    } finally {
      setAiBillingSaving(false);
    }
  }

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
      password: '',  // API doesn't return password; leave blank to keep current
      role: user.role,
      status: user.status,
      team: user.team ?? 'onmid',
    });
    setDialogOpen(true);
  }

  function handleSaveUser() {
    if (!form.name.trim() || !form.email.trim()) return;
    // Password required only when creating; blank = keep current when editing
    if (!editingUserId && !form.password.trim()) return;

    if (editingUserId) {
      const updated: UserType = {
        id: editingUserId,
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        status: form.status,
        team: form.team,
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
      team: form.team,
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
    { key: 'ia' as const, label: 'Uso IA' },
    { key: 'otimizador' as const, label: 'Otimizador' },
    { key: 'legal' as const, label: 'Legal' },
  ];

  // Load Otimizador WA config when tab is active
  useEffect(() => {
    if (activeTab !== 'otimizador') return;
    void fetch('/api/otimizador/whatsapp-config')
      .then((res) => res.ok ? res.json() as Promise<OtimizadorWaConfig> : null)
      .then((data) => { if (data) setOtimizadorWa(data); })
      .catch(() => {});
  }, [activeTab]);

  return (
    <div className="space-y-6 pb-10">
      {/* ── HEADER ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">
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
            <div className="bg-card border border-border rounded-[var(--radius)] p-5 space-y-3">
              <div className="w-12 h-12 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Users2 className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{totalUsers}</p>
                <p className="text-xs text-muted-foreground mt-1">Total de usuários</p>
              </div>
              <div>
                <span className="text-xs text-emerald-400 font-medium">↑ 33%</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">+1 nos últimos 30 dias</p>
              </div>
            </div>

            {/* Card 2: Admins */}
            <div className="bg-card border border-border rounded-[var(--radius)] p-5 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                <Shield className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{admins}</p>
                <p className="text-xs text-muted-foreground mt-1">Administradores</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground font-medium">— 0%</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">Sem alteração</p>
              </div>
            </div>

            {/* Card 3: Ativos */}
            <div className="bg-card border border-border rounded-[var(--radius)] p-5 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                <User className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{activeUsers}</p>
                <p className="text-xs text-muted-foreground mt-1">Usuários ativos</p>
              </div>
              <div>
                <span className="text-xs text-emerald-400 font-medium">↑ 50%</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">+1 nos últimos 30 dias</p>
              </div>
            </div>

            {/* Card 4: Convites */}
            <div className="bg-card border border-border rounded-[var(--radius)] p-5 space-y-3">
              <div className="w-12 h-12 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Mail className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{pendingInvites}</p>
                <p className="text-xs text-muted-foreground mt-1">Convite pendente</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground font-medium">— 0%</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">Sem alteração</p>
              </div>
            </div>
          </div>

          {/* ── USUÁRIOS CADASTRADOS CARD ── */}
          <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
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
                  <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Equipe</th>
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
                      {/* Team badge */}
                      <td className="px-6 py-4">
                        <span className={cn(
                          'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
                          user.team === 'parceiro'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-zinc-700/50 text-zinc-400 border border-zinc-600/50',
                        )}>
                          {user.team === 'parceiro' ? 'Parceiro' : 'Time Onmid'}
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
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Escolha exatamente quais itens do menu cada pessoa pode acessar — independente do perfil dela.
          </p>
          {users.map((user) => {
            const { cls: badgeCls, Icon: BadgeIcon } = roleBadge(user.role);
            const userPermission = permissions[user.id] ?? defaultPermission;
            return (
              <div key={user.id} className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                  <div
                    className={cn(
                      'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                      avatarColor(user.name)
                    )}
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{user.name}</p>
                    <p className="text-[11px] text-muted-foreground">{user.email}</p>
                  </div>
                  <span className={cn('ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0', badgeCls)}>
                    <BadgeIcon className="w-3 h-3" />
                    {user.role}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-4">
                  {MODULES.map((m) => {
                    const enabled = userPermission[m.key] ?? defaultPermission[m.key];
                    return (
                      <button
                        key={m.key}
                        onClick={() => togglePermission(user.id, m.key)}
                        aria-pressed={enabled}
                        aria-label={`${enabled ? 'Desativar' : 'Ativar'} ${m.label} para ${user.name}`}
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                          enabled
                            ? 'border-emerald-500/30 bg-emerald-500/10'
                            : 'border-border bg-background hover:bg-muted/30'
                        )}
                      >
                        <m.icon className={cn('w-4 h-4 shrink-0', enabled ? 'text-emerald-400' : 'text-muted-foreground')} />
                        <span className={cn('text-xs font-medium flex-1 truncate', enabled ? 'text-foreground' : 'text-muted-foreground')}>
                          {m.label}
                        </span>
                        <span
                          className={cn(
                            'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200',
                            enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                          )}
                        >
                          <span
                            className={cn(
                              'inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200',
                              enabled ? 'translate-x-4' : 'translate-x-0'
                            )}
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════
          TAB: USO IA
      ══════════════════════════════════ */}
      {activeTab === 'ia' && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-[var(--radius)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold">Saldo e alertas das IAs</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Informe o crédito disponível nas plataformas e receba alerta quando o saldo estimado estiver baixo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void saveAiBilling()}
                disabled={aiBillingSaving}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 disabled:opacity-50"
              >
                {aiBillingSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-4">
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <DollarSign className="w-3.5 h-3.5" /> Crédito OpenAI (US$)
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={aiBilling.openai_credit_usd}
                  onChange={(e) => setAiBilling(prev => ({ ...prev, openai_credit_usd: Number(e.target.value) }))}
                  placeholder="0.00"
                />
              </label>
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <DollarSign className="w-3.5 h-3.5" /> Crédito Claude (US$)
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={aiBilling.claude_credit_usd}
                  onChange={(e) => setAiBilling(prev => ({ ...prev, claude_credit_usd: Number(e.target.value) }))}
                  placeholder="0.00"
                />
              </label>
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Bell className="w-3.5 h-3.5" /> Alertar abaixo de (US$)
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={aiBilling.alert_threshold_usd}
                  onChange={(e) => setAiBilling(prev => ({ ...prev, alert_threshold_usd: Number(e.target.value) }))}
                  placeholder="2.00"
                />
              </label>
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp de alerta
                </span>
                <Input
                  value={aiBilling.alert_phone}
                  onChange={(e) => setAiBilling(prev => ({ ...prev, alert_phone: e.target.value }))}
                  placeholder="5543999999999"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
              <label className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-3">
                <button
                  type="button"
                  onClick={() => setAiBilling(prev => ({ ...prev, alert_enabled: !prev.alert_enabled }))}
                  className={cn(
                    'relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors',
                    aiBilling.alert_enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
                      aiBilling.alert_enabled ? 'translate-x-5' : 'translate-x-0',
                    )}
                  />
                </button>
                <span className="text-xs font-semibold">Enviar alerta</span>
              </label>

              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Instância para envio</span>
                <Select
                  value={aiBilling.zapi_client_id || 'none'}
                  onValueChange={(value) => setAiBilling(prev => ({ ...prev, zapi_client_id: value === 'none' ? '' : String(value) }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a instância WhatsApp" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhuma</SelectItem>
                    {zapiOptions.map(option => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name} · {option.instance_id}{option.active ? '' : ' · inativa'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>Endpoint para automação: <span className="font-mono text-foreground">/api/ai-usage/alert-check</span></span>
              {aiBilling.last_alert_at && (
                <span>Último alerta: {new Date(aiBilling.last_alert_at).toLocaleString('pt-BR')}</span>
              )}
              {aiBillingSaved && <span className="text-primary font-semibold">{aiBillingSaved}</span>}
            </div>
          </div>

          {/* ── Histórico mensal de custo da IA por cliente ─────────────────
              Seletor de mês + evolução + tabela em US$ e R$ + export CSV —
              feito pra repassar o custo ao cliente, com meses anteriores. */}
          {(() => {
            const months = [...new Set(aiUsage.map(r => r.mes_ano))].sort().reverse();
            const selMonth = aiMonth && months.includes(aiMonth) ? aiMonth : (months[0] ?? '');
            const rows = aiUsage
              .filter(r => r.mes_ano === selMonth)
              .sort((a, b) => Number(b.custo_estimado_usd ?? 0) - Number(a.custo_estimado_usd ?? 0));
            const tCalls = rows.reduce((s, r) => s + Number(r.chamadas_ia ?? 0), 0);
            const tTokens = rows.reduce((s, r) => s + Number(r.tokens_usados ?? 0), 0);
            const tUsd = rows.reduce((s, r) => s + Number(r.custo_estimado_usd ?? 0), 0);
            const monthTotals = months.map(m => ({
              m,
              usd: aiUsage.filter(r => r.mes_ano === m).reduce((s, r) => s + Number(r.custo_estimado_usd ?? 0), 0),
            }));
            const maxMonthUsd = Math.max(0.0001, ...monthTotals.map(x => x.usd));
            const brl = (usd: number) => (usd * USD_TO_BRL).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
            const monthLabel = (m: string) => {
              const [y, mo] = m.split('-');
              const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
              return `${nomes[Number(mo) - 1] ?? mo}/${y}`;
            };
            const exportCsv = () => {
              const header = 'Cliente;Chamadas IA;Tokens;Custo (US$);Custo (R$)';
              const lines = rows.map(r => [
                `"${r.client_name}"`,
                r.chamadas_ia,
                r.tokens_usados,
                Number(r.custo_estimado_usd ?? 0).toFixed(4),
                (Number(r.custo_estimado_usd ?? 0) * USD_TO_BRL).toFixed(2).replace('.', ','),
              ].join(';'));
              const total = `"TOTAL";${tCalls};${tTokens};${tUsd.toFixed(4)};${(tUsd * USD_TO_BRL).toFixed(2).replace('.', ',')}`;
              const blob = new Blob(['﻿' + [header, ...lines, total].join('\n')], { type: 'text/csv;charset=utf-8' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `custo-ia-${selMonth}.csv`;
              a.click();
              URL.revokeObjectURL(a.href);
            };
            return (
              <>
                {/* Evolução mensal (clicável) */}
                {monthTotals.length > 0 && (
                  <div className="bg-card border border-border rounded-[var(--radius)] p-5">
                    <p className="text-sm font-bold">Evolução mensal do custo de IA (CRM)</p>
                    <p className="text-xs text-muted-foreground mt-0.5 mb-4">Clique num mês para ver o detalhamento por cliente. Câmbio de referência: R$ {USD_TO_BRL.toFixed(2)}.</p>
                    <div className="flex flex-wrap items-end gap-3">
                      {[...monthTotals].reverse().map(({ m, usd: mUsd }) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setAiMonth(m)}
                          className={cn(
                            'flex flex-col items-center gap-1.5 rounded-lg border px-3 pb-2 pt-3 transition-colors min-w-[76px]',
                            m === selMonth ? 'border-primary/50 bg-primary/10' : 'border-border bg-background hover:border-primary/30',
                          )}
                        >
                          <div className="flex h-16 w-8 items-end overflow-hidden rounded bg-muted/40">
                            <div
                              className={cn('w-full rounded-t', m === selMonth ? 'bg-primary' : 'bg-primary/40')}
                              style={{ height: `${Math.max(6, Math.round((mUsd / maxMonthUsd) * 100))}%` }}
                            />
                          </div>
                          <span className={cn('text-[11px] font-bold', m === selMonth ? 'text-primary' : 'text-muted-foreground')}>{monthLabel(m)}</span>
                          <span className="text-[10px] tabular-nums text-muted-foreground">{brl(mUsd)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* KPIs do mês selecionado */}
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="bg-card border border-border rounded-[var(--radius)] p-5 space-y-3">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-xl font-bold leading-none">{tCalls.toLocaleString('pt-BR')}</p>
                      <p className="text-xs text-muted-foreground mt-1">Chamadas em {selMonth ? monthLabel(selMonth) : '—'}</p>
                    </div>
                  </div>
                  <div className="bg-card border border-border rounded-[var(--radius)] p-5 space-y-3">
                    <div className="w-12 h-12 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-violet-400" />
                    </div>
                    <div>
                      <p className="text-xl font-bold leading-none">{tTokens.toLocaleString('pt-BR')}</p>
                      <p className="text-xs text-muted-foreground mt-1">Tokens em {selMonth ? monthLabel(selMonth) : '—'}</p>
                    </div>
                  </div>
                  <div className="bg-card border border-border rounded-[var(--radius)] p-5 space-y-3">
                    <div className="w-12 h-12 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xl font-bold leading-none">{brl(tUsd)}</p>
                      <p className="text-xs text-muted-foreground mt-1">Custo em {selMonth ? monthLabel(selMonth) : '—'} ({usd(tUsd)})</p>
                    </div>
                  </div>
                </div>

                {/* Tabela do mês por cliente */}
                <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
                    <div>
                      <p className="text-sm font-bold">Custo por cliente · {selMonth ? monthLabel(selMonth) : '—'}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Análises automáticas de conversa do CRM (Kanban/temperatura pela IA).</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={selMonth}
                        onChange={(e) => setAiMonth(e.target.value)}
                        className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={exportCsv}
                        disabled={rows.length === 0}
                        className="h-8 px-3 text-xs font-bold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        Exportar CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAiUsageLoading(true);
                          fetch('/api/crm/ai/usage')
                            .then((res) => res.ok ? res.json() as Promise<AiUsageRow[]> : [])
                            .then(setAiUsage)
                            .catch(() => setAiUsage([]))
                            .finally(() => setAiUsageLoading(false));
                        }}
                        className="h-8 px-3 text-xs text-muted-foreground bg-background border border-border rounded-lg hover:text-foreground transition-colors"
                      >
                        Atualizar
                      </button>
                    </div>
                  </div>
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente</th>
                        <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Chamadas</th>
                        <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Hoje</th>
                        <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Limite/dia</th>
                        <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Tokens</th>
                        <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Custo US$</th>
                        <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Custo R$</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {aiUsageLoading ? (
                        <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-muted-foreground">Carregando uso da IA...</td></tr>
                      ) : rows.length === 0 ? (
                        <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-muted-foreground">Nenhum uso registrado neste mês.</td></tr>
                      ) : rows.map((row) => (
                        <tr key={`${row.client_id}-${row.mes_ano}`} className="hover:bg-muted/30 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-semibold text-sm">{row.client_name}</p>
                            <p className="text-[11px] text-muted-foreground">{row.client_id}</p>
                          </td>
                          <td className="px-6 py-4 text-right font-semibold">{Number(row.chamadas_ia ?? 0).toLocaleString('pt-BR')}</td>
                          <td className="px-6 py-4 text-right text-muted-foreground">{Number(row.chamadas_hoje ?? 0).toLocaleString('pt-BR')}</td>
                          <td className="px-6 py-4 text-right text-muted-foreground">{Number(row.ia_limite_chamadas_dia ?? 500).toLocaleString('pt-BR')}</td>
                          <td className="px-6 py-4 text-right text-muted-foreground">{Number(row.tokens_usados ?? 0).toLocaleString('pt-BR')}</td>
                          <td className="px-6 py-4 text-right text-muted-foreground">{usd(Number(row.custo_estimado_usd ?? 0))}</td>
                          <td className="px-6 py-4 text-right font-semibold">{brl(Number(row.custo_estimado_usd ?? 0))}</td>
                        </tr>
                      ))}
                      {!aiUsageLoading && rows.length > 0 && (
                        <tr className="bg-muted/20">
                          <td className="px-6 py-3.5 text-xs font-bold uppercase tracking-wider">Total do mês</td>
                          <td className="px-6 py-3.5 text-right font-bold">{tCalls.toLocaleString('pt-BR')}</td>
                          <td className="px-6 py-3.5" />
                          <td className="px-6 py-3.5" />
                          <td className="px-6 py-3.5 text-right font-bold">{tTokens.toLocaleString('pt-BR')}</td>
                          <td className="px-6 py-3.5 text-right font-bold">{usd(tUsd)}</td>
                          <td className="px-6 py-3.5 text-right font-bold text-primary">{brl(tUsd)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ══════════════════════════════════
          TAB: OTIMIZADOR
      ══════════════════════════════════ */}
      {activeTab === 'otimizador' && (
        <div className="space-y-6">
          <div className="rounded-[var(--radius)] border border-border bg-card p-5 space-y-5">
            <div>
              <p className="text-sm font-semibold text-foreground">Relatórios via WhatsApp</p>
              <p className="text-xs text-muted-foreground mt-0.5">Após cada análise semanal, o sistema envia um resumo para o grupo configurado abaixo.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Instância Evolution</Label>
                <select
                  value={otimizadorWa.zapi_client_id ?? ''}
                  onChange={(e) => {
                    setOtimizadorWa((prev) => ({ ...prev, zapi_client_id: e.target.value || null, group_jid: null }));
                    setWaGroups([]);
                  }}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Selecione uma instância</option>
                  {otimizadorWa.instances_disponiveis.map((inst) => (
                    <option key={inst.id} value={inst.id}>{inst.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Grupo de destino</Label>
                <div className="flex gap-2">
                  <select
                    value={otimizadorWa.group_jid ?? ''}
                    onChange={(e) => setOtimizadorWa((prev) => ({ ...prev, group_jid: e.target.value || null }))}
                    className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    disabled={waGroups.length === 0}
                  >
                    <option value="">{waGroups.length === 0 ? 'Carregue os grupos primeiro' : 'Selecione um grupo'}</option>
                    {waGroups.map((g) => (
                      <option key={g.jid} value={g.jid}>{g.nome}{g.membros ? ` (${g.membros})` : ''}</option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!otimizadorWa.zapi_client_id || waGroupsLoading}
                    onClick={async () => {
                      if (!otimizadorWa.zapi_client_id) return;
                      setWaGroupsLoading(true);
                      try {
                        const res = await fetch(`/api/otimizador/whatsapp-groups?zapiClientId=${otimizadorWa.zapi_client_id}`);
                        if (res.ok) setWaGroups(await res.json() as WaGroup[]);
                      } finally {
                        setWaGroupsLoading(false);
                      }
                    }}
                  >
                    {waGroupsLoading ? '...' : 'Carregar'}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={otimizadorWa.ativo}
                  onChange={(e) => setOtimizadorWa((prev) => ({ ...prev, ativo: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-sm text-foreground">Ativar envio de relatórios</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={otimizadorWa.notificar_crise_apenas}
                  onChange={(e) => setOtimizadorWa((prev) => ({ ...prev, notificar_crise_apenas: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-sm text-foreground">Notificar apenas quando estado = CRISE</span>
              </label>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={async () => {
                  setOtimizadorWaSaving(true);
                  setOtimizadorWaSaved(null);
                  const res = await fetch('/api/otimizador/whatsapp-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      zapi_client_id: otimizadorWa.zapi_client_id,
                      group_jid: otimizadorWa.group_jid,
                      ativo: otimizadorWa.ativo,
                      notificar_crise_apenas: otimizadorWa.notificar_crise_apenas,
                    }),
                  });
                  setOtimizadorWaSaving(false);
                  setOtimizadorWaSaved(res.ok ? 'Configuração salva!' : 'Erro ao salvar.');
                  setTimeout(() => setOtimizadorWaSaved(null), 3000);
                }}
                disabled={otimizadorWaSaving}
              >
                {otimizadorWaSaving ? 'Salvando...' : 'Salvar'}
              </Button>
              {otimizadorWaSaved && <span className="text-xs text-primary">{otimizadorWaSaved}</span>}
            </div>
          </div>
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
            <div key={url} className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
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
              <Label htmlFor="user-password">
                Senha{editingUserId && <span className="ml-1 text-xs text-muted-foreground">(deixe em branco para manter)</span>}
              </Label>
              <Input
                id="user-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editingUserId ? 'Nova senha (opcional)' : 'Defina a senha de acesso'}
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
              <Label>Equipe</Label>
              <Select value={form.team} onValueChange={(team) => team && setForm({ ...form, team: team as Team })}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: Team) => TEAMS.find((t) => t.value === v)?.label ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TEAMS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Parceiro só vê as próprias instâncias e campanhas em Disparos — nunca as de outras pessoas.
              </p>
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
              disabled={!form.name.trim() || !form.email.trim() || (!editingUserId && !form.password.trim())}
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
