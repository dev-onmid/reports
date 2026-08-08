import {
  LayoutDashboard, Users, FileText, WalletCards,
  BarChart3, MessageCircle, TableProperties, Zap, Bot, ShieldCheck, WandSparkles,
  Download, History, Gift,
} from 'lucide-react';
import type { Permission } from '@/lib/mock-data';

export type NavItem = {
  name: string;
  href: string;
  icon: React.ElementType;
  key: keyof Permission;
  /** Short caption shown under the title on the home page's quick-access tiles. */
  desc: string;
  /** Aparece no menu mobile (drawer). Telas densas de desktop ficam de fora. */
  mobile?: boolean;
  /** Itens agrupados sob "Ferramentas" na sidebar (grid do Início segue flat). */
  group?: 'ferramentas';
};

// Single source of truth for the permission-gated modules. Used by the sidebar
// (src/components/layout/sidebar.tsx) and the home page quick-access grid so they
// can never drift apart. The always-visible "Início" entry lives in the sidebar.
// Itens com `group: 'ferramentas'` são renderizados pela sidebar dentro do grupo
// colapsável "Ferramentas" (decisão do Matheus, 2026-08-07) — a permissão continua
// sendo a de cada item, o grupo é só apresentação.
export const NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard',   href: '/dashboard',   icon: LayoutDashboard, key: 'dashboard',   desc: 'Visão geral', mobile: true },
  { name: 'Clientes',    href: '/clientes',    icon: Users,           key: 'clientes',    desc: 'Sua carteira' },
  { name: 'CRM',         href: '/crm',         icon: TableProperties, key: 'crm',         desc: 'Funil e atendimento' },
  { name: 'Relatórios',  href: '/relatorios',  icon: FileText,        key: 'relatorios',  desc: 'Entregas e PDFs', mobile: true },
  { name: 'Radar',       href: '/resultados',  icon: BarChart3,       key: 'radar',       desc: 'Resultados', mobile: true },
  // Histórico manual de otimizações por conta — reusa a flag `otimizador`.
  // Virou aba principal (pedido do Matheus, 2026-08-08; antes estava em Ferramentas).
  { name: 'Histórico',   href: '/otimizacoes', icon: History,         key: 'otimizador',  desc: 'Otimizações por conta' },
  { name: 'Pagamentos',  href: '/pagamentos',  icon: WalletCards,     key: 'pagamentos',  desc: 'Investimento em mídia', mobile: true },
  { name: 'Luna IA',     href: '/agente',      icon: Bot,             key: 'luna_ia',     desc: 'Assistente', mobile: true },
  // Integrações e Logs saíram do menu (2026-08-07): viraram abas de Configurações
  // (?tab=integracoes / ?tab=logs); as rotas antigas redirecionam pra lá.
  // ── Grupo Ferramentas ──
  { name: 'Automações',      href: '/automacoes',                icon: Zap,           key: 'automacoes', desc: 'Fluxos automáticos',            group: 'ferramentas' },
  { name: 'Cofre',           href: '/vault',                     icon: ShieldCheck,   key: 'cofre',      desc: 'Credenciais',                   group: 'ferramentas' },
  { name: 'Otimizador',      href: '/otimizador',                icon: WandSparkles,  key: 'otimizador', desc: 'Ações de tráfego',              group: 'ferramentas' },
  { name: 'Disparos',        href: '/disparos',                  icon: MessageCircle, key: 'disparos',   desc: 'Campanhas WhatsApp',            group: 'ferramentas' },
  { name: 'Biblioteca Meta', href: '/ferramentas/biblioteca-meta', icon: Download,    key: 'radar',      desc: 'Baixar criativos de anúncios',  group: 'ferramentas' },
  { name: 'Sorteador',       href: '/ferramentas/sorteador',       icon: Gift,        key: 'radar',      desc: 'Sorteios de comentários IG/FB', group: 'ferramentas' },
];
