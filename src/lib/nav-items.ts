import {
  LayoutDashboard, Users, FileText, Plug, WalletCards, ClipboardList,
  BarChart3, MessageCircle, TableProperties, Zap, Bot, ShieldCheck,
} from 'lucide-react';
import type { Permission } from '@/lib/mock-data';

export type NavItem = {
  name: string;
  href: string;
  icon: React.ElementType;
  key: keyof Permission;
  /** Short caption shown under the title on the home page's quick-access tiles. */
  desc: string;
};

// Single source of truth for the 12 permission-gated modules. Used by the sidebar
// (src/components/layout/sidebar.tsx) and the home page quick-access grid so they
// can never drift apart. The always-visible "Início" entry lives in the sidebar.
export const NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard',   href: '/dashboard',   icon: LayoutDashboard, key: 'dashboard',   desc: 'Visão geral' },
  { name: 'Clientes',    href: '/clientes',    icon: Users,           key: 'clientes',    desc: 'Sua carteira' },
  { name: 'CRM',         href: '/crm',         icon: TableProperties, key: 'crm',         desc: 'Funil e atendimento' },
  { name: 'Relatórios',  href: '/relatorios',  icon: FileText,        key: 'relatorios',  desc: 'Entregas e PDFs' },
  { name: 'Radar',       href: '/resultados',  icon: BarChart3,       key: 'radar',       desc: 'Resultados' },
  { name: 'Pagamentos',  href: '/pagamentos',  icon: WalletCards,     key: 'pagamentos',  desc: 'Investimento em mídia' },
  { name: 'Disparos',    href: '/disparos',    icon: MessageCircle,   key: 'disparos',    desc: 'Campanhas WhatsApp' },
  { name: 'Luna IA',     href: '/agente',      icon: Bot,             key: 'luna_ia',     desc: 'Assistente' },
  { name: 'Cofre',       href: '/vault',       icon: ShieldCheck,     key: 'cofre',       desc: 'Credenciais' },
  { name: 'Automações',  href: '/automacoes',  icon: Zap,             key: 'automacoes',  desc: 'Fluxos automáticos' },
  { name: 'Integrações', href: '/integracoes', icon: Plug,            key: 'integracoes', desc: 'Conexões' },
  { name: 'Logs',        href: '/logs',        icon: ClipboardList,   key: 'logs',        desc: 'Auditoria' },
];
