export type Permission = {
  dashboard: boolean;
  clientes: boolean;
  relatorios: boolean;
  configuracoes: boolean;
  integracoes: boolean;
};

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

export const mockPermissions: Record<string, Permission> = {
  '1': { dashboard: true, clientes: true, relatorios: true, configuracoes: true, integracoes: true },
  '4': { dashboard: true, clientes: true, relatorios: true, configuracoes: true, integracoes: true },
  '2': { dashboard: true, clientes: true, relatorios: true, configuracoes: false, integracoes: false },
  '3': { dashboard: true, clientes: false, relatorios: false, configuracoes: false, integracoes: false },
};

export type ClientStatus = 'Ativo' | 'Alerta' | 'Arquivado' | 'Inativo';

export type Client = {
  id: string;
  name: string;
  segment: string;
  status: ClientStatus;
  gestor_id?: string;
  gestor_name?: string;
  ads_billing_mode?: 'prepaid' | 'card';
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
