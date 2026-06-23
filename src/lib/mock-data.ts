// One key per item in the sidebar (src/components/layout/sidebar.tsx), plus the
// legacy `configuracoes` flag which isn't tied to a nav item.
export type Permission = {
  dashboard: boolean;
  clientes: boolean;
  crm: boolean;
  relatorios: boolean;
  radar: boolean;
  pagamentos: boolean;
  disparos: boolean;
  luna_ia: boolean;
  cofre: boolean;
  automacoes: boolean;
  integracoes: boolean;
  logs: boolean;
  configuracoes: boolean;
};

export const PERMISSION_KEYS = [
  'dashboard', 'clientes', 'crm', 'relatorios', 'radar', 'pagamentos',
  'disparos', 'luna_ia', 'cofre', 'automacoes', 'integracoes', 'logs', 'configuracoes',
] as const satisfies readonly (keyof Permission)[];

// New users get the bare minimum until an admin grants more in Configurações > Permissões.
export const defaultPermission: Permission = {
  dashboard: true,
  clientes: false,
  crm: false,
  relatorios: false,
  radar: false,
  pagamentos: false,
  disparos: false,
  luna_ia: false,
  cofre: false,
  automacoes: false,
  integracoes: false,
  logs: false,
  configuracoes: false,
};

// Used only when /api/permissions itself is unreachable (DB outage, network error).
// Fail OPEN here — an infra hiccup shouldn't make the whole menu vanish for every
// user. Fail CLOSED (defaultPermission) only applies when the request succeeds and
// simply has no row for that user yet, which is the real "not granted" state.
export const allPermission: Permission = Object.fromEntries(
  PERMISSION_KEYS.map((key) => [key, true]),
) as Permission;

export type User = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  status: string;
};

export const mockUsers: User[] = [
  { id: '1', name: 'Admin', email: 'admin@onmid.com', password: 'admin123', role: 'Administrador', status: 'Ativo' },
  { id: '4', name: 'Matheus', email: 'matheus@onmid.com.br', password: '1234', role: 'Administrador', status: 'Ativo' },
  { id: '2', name: 'Maria Silva', email: 'maria@onmid.com', password: 'maria123', role: 'Usuário', status: 'Ativo' },
  { id: '3', name: 'João Costa', email: 'joao@onmid.com', password: 'joao123', role: 'Visualizador', status: 'Inativo' },
];

const adminPermission: Permission = { ...defaultPermission, clientes: true, crm: true, relatorios: true, radar: true, pagamentos: true, disparos: true, luna_ia: true, cofre: true, automacoes: true, integracoes: true, logs: true, configuracoes: true };

export const mockPermissions: Record<string, Permission> = {
  '1': adminPermission,
  '4': adminPermission,
  '2': { ...defaultPermission, clientes: true, crm: true, relatorios: true, radar: true, pagamentos: true, luna_ia: true, cofre: true },
  '3': { ...defaultPermission },
};

export type ClientStatus = 'Ativo' | 'Alerta' | 'Arquivado' | 'Inativo';

export type DashboardType = 'leads' | 'branding' | 'conversao';

export type Client = {
  id: string;
  name: string;
  segment: string;
  status: ClientStatus;
  gestor_id?: string;
  gestor_name?: string;
  ads_billing_mode?: 'prepaid' | 'card';
  category_id?: string;
  category_name?: string;
  dashboard_type?: DashboardType;
  onboarding_completed?: boolean;
};

export const mockClients: Client[] = [
  { id: '1', name: 'Tech Solutions', segment: 'Tecnologia', status: 'Ativo' },
  { id: '2', name: 'OdontoPrime', segment: 'Saúde', status: 'Ativo' },
  { id: '3', name: 'Bella Imóveis', segment: 'Imobiliária', status: 'Alerta' },
];

export const mockDashboardData = {
  salesTargets: {
    marketing: { value: 700, max: 1000, label: 'Marketing Channels', color: 'bg-secondary' },
    leads: { value: 600, max: 1000, label: 'Leads & Conversions', color: 'bg-primary' },
    reasons: { value: 500, max: 1000, label: 'Reasons Not Booked', color: 'bg-orange-500' },
  },
  newLeadsData: [
    { name: 'Sat', facebook: 49, instagram: 15 },
    { name: 'Sun', facebook: 82, instagram: 20 },
    { name: 'Mon', facebook: 70, instagram: 24 },
    { name: 'Tue', facebook: 79, instagram: 28 },
    { name: 'Wed', facebook: 71, instagram: 76 },
    { name: 'Thu', facebook: 76, instagram: 71 },
  ],
  marketingChannelData: [
    { name: 'Facebook', value: 15.1, fill: '#55F52F' },
    { name: 'Instagram', value: 11.6, fill: '#7B2CFF' },
  ],
  statsData: [
    { name: 'W1', value: 15 },
    { name: 'W2', value: 20 },
    { name: 'W3', value: 10 },
    { name: 'W4', value: 25 },
    { name: 'W5', value: 18 },
    { name: 'W6', value: 28 },
  ]
};
