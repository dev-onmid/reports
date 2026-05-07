"use client";

import type React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileText,
  Plus,
  Users,
  WalletCards,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { mockClients, mockDashboardData } from '@/lib/mock-data';
import { useClients } from '@/lib/client-store';
import { PAYMENT_STATUS_OPTIONS, useInvestmentPayments, wasDispatched } from '@/lib/payment-store';
import type { PaymentStatus } from '@/lib/payment-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';

const STATUS_STYLES: Record<PaymentStatus, string> = {
  Pendente: 'bg-orange-500/20 text-orange-300 border-orange-400/30',
  Enviado: 'bg-sky-500/20 text-sky-300 border-sky-400/30',
  Pago: 'bg-primary/20 text-primary border-primary/30',
  'Em atraso': 'bg-red-500/20 text-red-300 border-red-400/30',
};

const STATUS_ICONS: Record<PaymentStatus, React.ComponentType<{ className?: string }>> = {
  Pendente: Clock3,
  Enviado: ArrowUpRight,
  Pago: CheckCircle2,
  'Em atraso': AlertTriangle,
};

const TOOLTIP_STYLE = {
  backgroundColor: '#1B1D24',
  borderColor: '#2A2D3A',
  borderRadius: '8px',
  color: '#F5F5F5',
  fontSize: '12px',
};

const CLIENT_RESULT_GOALS = [
  { type: 'Faturamento', target: 150000, realized: 38250, format: 'currency' as const },
  { type: 'Matrículas', target: 25, realized: 9, format: 'number' as const },
  { type: 'Leads', target: 300, realized: 128, format: 'number' as const },
];

const ZERO_CLIENT_RESULT_GOAL = { type: 'Faturamento', target: 0, realized: 0, format: 'currency' as const };

function formatDateBR(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function formatResultValue(value: number, format: 'currency' | 'number') {
  return format === 'currency' ? formatCurrencyBRL(value) : value.toLocaleString('pt-BR');
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = 'default',
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'primary' | 'warning' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
          <p className="mt-3 font-heading text-4xl leading-none tracking-wide text-foreground">{value}</p>
        </div>
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
            tone === 'primary' && 'border-primary/30 bg-primary/15 text-primary',
            tone === 'warning' && 'border-orange-400/30 bg-orange-500/15 text-orange-300',
            tone === 'danger' && 'border-red-400/30 bg-red-500/15 text-red-300',
            tone === 'default' && 'border-border bg-muted/40 text-muted-foreground',
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function GeneralDashboard() {
  const { clients } = useClients();
  const { payments } = useInvestmentPayments();
  const visibleClientIds = new Set(clients.map((client) => client.id));
  const visiblePayments = payments.filter((payment) => visibleClientIds.has(payment.clientId));

  const totalInvestment = visiblePayments.reduce((sum, payment) => sum + payment.amount, 0);
  const paidInvestment = visiblePayments
    .filter((payment) => payment.status === 'Pago')
    .reduce((sum, payment) => sum + payment.amount, 0);
  const overduePayments = visiblePayments.filter((payment) => payment.status === 'Em atraso');
  const pendingPayments = visiblePayments.filter((payment) => payment.status === 'Pendente');
  const activeClients = clients.filter((client) => client.status === 'Ativo').length;
  const clientResultSummary = clients.map((client, index) => {
    const isNewClient = !mockClients.some((item) => item.id === client.id);
    const goal = isNewClient ? ZERO_CLIENT_RESULT_GOAL : CLIENT_RESULT_GOALS[index % CLIENT_RESULT_GOALS.length];
    const clientPayments = payments.filter((payment) => payment.clientId === client.id);
    const investment = clientPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const progress = goal.target > 0 ? Math.min(Math.round((goal.realized / goal.target) * 100), 100) : 0;
    const status =
      progress >= 75 ? { label: 'No ritmo', color: '#55F52F', text: 'text-primary' } :
      progress >= 45 ? { label: 'Atenção', color: '#7B2CFF', text: 'text-secondary' } :
      { label: 'Crítico', color: '#EF4444', text: 'text-red-400' };

    return { client, goal, investment, progress, status };
  });

  const paymentStatusData = PAYMENT_STATUS_OPTIONS.map((status) => ({
    name: status,
    value: visiblePayments.filter((payment) => payment.status === status).length,
    amount: visiblePayments.filter((payment) => payment.status === status).reduce((sum, payment) => sum + payment.amount, 0),
    fill:
      status === 'Pago' ? '#55F52F' :
      status === 'Enviado' ? '#38BDF8' :
      status === 'Em atraso' ? '#EF4444' :
      '#F59E0B',
  }));

  const clientInvestmentData = clients.map((client) => {
    const clientPayments = payments.filter((payment) => payment.clientId === client.id);
    return {
      name: client.name,
      total: clientPayments.reduce((sum, payment) => sum + payment.amount, 0),
      pendente: clientPayments
        .filter((payment) => payment.status === 'Pendente' || payment.status === 'Em atraso')
        .reduce((sum, payment) => sum + payment.amount, 0),
    };
  });

  const nextPayments = [...visiblePayments]
    .filter((payment) => payment.status !== 'Pago')
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-4xl uppercase tracking-wider">Dashboard Geral</h1>
          <p className="mt-1 text-muted-foreground">
            Visão executiva dos clientes, relatórios e investimentos de mídia.
          </p>
        </div>
        <div className="flex gap-2">
          <Button render={<Link href="/relatorios/novo" />} nativeButton={false} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-2 h-4 w-4" />
            Novo Relatório
          </Button>
          <Button render={<Link href="/pagamentos" />} nativeButton={false} variant="outline">
            <WalletCards className="mr-2 h-4 w-4" />
            Pagamentos
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Clientes Ativos"
          value={`${activeClients}/${clients.length}`}
          detail="Base em operação com dashboards individuais."
          icon={Users}
          tone="primary"
        />
        <MetricCard
          title="Investimento Total"
          value={formatCurrencyBRL(totalInvestment)}
          detail={`${formatCurrencyBRL(paidInvestment)} já conciliados.`}
          icon={BarChart3}
        />
        <MetricCard
          title="Pendências"
          value={String(pendingPayments.length)}
          detail="Pix de investimento aguardando envio ou confirmação."
          icon={Clock3}
          tone="warning"
        />
        <MetricCard
          title="Em Atraso"
          value={String(overduePayments.length)}
          detail={overduePayments.length ? 'Exige atenção do time financeiro.' : 'Nenhum item crítico no momento.'}
          icon={AlertTriangle}
          tone={overduePayments.length ? 'danger' : 'primary'}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-2 w-fit rounded-lg border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
              Resultado Geral por Cliente
            </p>
            <h2 className="text-sm font-bold uppercase tracking-wider">Resumo de metas principais</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Visão rápida do resultado de cada cliente conforme a meta configurada.
            </p>
          </div>
          <Link href="/clientes" className="text-xs font-semibold text-primary hover:underline">
            Abrir clientes
          </Link>
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          {clientResultSummary.map(({ client, goal, investment, progress, status }) => (
            <Link
              key={client.id}
              href={`/clientes/${client.id}`}
              className="group overflow-hidden rounded-xl border border-border bg-background/60 transition-colors hover:border-primary/40"
            >
              <div className="h-1.5" style={{ backgroundColor: status.color }} />
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold">{client.name}</p>
                    <p className="text-xs text-muted-foreground">{client.segment}</p>
                  </div>
                  <span className={cn('shrink-0 rounded-full border border-current/25 px-2 py-1 text-[10px] font-bold uppercase tracking-wider', status.text)}>
                    {status.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Meta</p>
                    <p className="mt-1 text-sm font-semibold">{goal.type}</p>
                    <p className="font-heading text-2xl font-bold tracking-wide">{formatResultValue(goal.target, goal.format)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
                    <p className="mt-1 font-heading text-3xl font-bold tracking-wide" style={{ color: status.color }}>
                      {formatResultValue(goal.realized, goal.format)}
                    </p>
                    <p className="text-xs text-muted-foreground">{progress}% da meta</p>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    <span>Progresso</span>
                    <span>{formatCurrencyBRL(investment)} investidos</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: status.color }} />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider">Investimento por Cliente</h2>
              <p className="mt-1 text-xs text-muted-foreground">Total planejado e saldo ainda pendente.</p>
            </div>
            <Link href="/clientes" className="text-xs font-semibold text-primary hover:underline">
              Ver clientes
            </Link>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientInvestmentData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#2A2D3A" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#A0AEC0', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: '#A0AEC0', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => formatCurrencyBRL(Number(value)).replace(',00', '')}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={((value: unknown, name: unknown) => [
                    formatCurrencyBRL(Number(value ?? 0)),
                    name === 'total' ? 'Total' : 'Pendente',
                  ]) as any}
                />
                <Bar dataKey="total" fill="#55F52F" radius={[5, 5, 0, 0]} />
                <Bar dataKey="pendente" fill="#7B2CFF" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5">
            <h2 className="text-sm font-bold uppercase tracking-wider">Status dos Pagamentos</h2>
            <p className="mt-1 text-xs text-muted-foreground">Distribuição da carteira de investimento.</p>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={paymentStatusData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={3}>
                  {paymentStatusData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) => [`${value ?? 0} itens`]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid gap-2">
            {paymentStatusData.map((status) => (
              <div key={status.name} className="flex items-center justify-between gap-3 rounded-lg bg-background/60 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: status.fill }} />
                  <span className="text-xs font-semibold">{status.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatCurrencyBRL(status.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider">Próximos Pix</h2>
              <p className="mt-1 text-xs text-muted-foreground">Fila financeira ainda não quitada.</p>
            </div>
            <Link href="/pagamentos" className="text-xs font-semibold text-primary hover:underline">
              Abrir agenda
            </Link>
          </div>
          <div className="space-y-2">
            {nextPayments.map((payment) => {
              const Icon = STATUS_ICONS[payment.status];

              return (
                <div key={payment.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border', STATUS_STYLES[payment.status])}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{payment.destination}</p>
                      <p className="text-xs text-muted-foreground">
                        {payment.clientName} - {formatDateBR(payment.date)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <p className="text-sm font-bold">{formatCurrencyBRL(payment.amount)}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{payment.status}</p>
                    {wasDispatched(payment.status) && payment.status !== 'Enviado' && (
                      <p className="text-[9px] font-bold text-sky-400">✓ Enviado</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider">Performance de Leads</h2>
              <p className="mt-1 text-xs text-muted-foreground">Comparativo dos canais no período mockado.</p>
            </div>
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockDashboardData.newLeadsData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#2A2D3A" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#A0AEC0', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#A0AEC0', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="facebook" name="Facebook" fill="#55F52F" radius={[5, 5, 0, 0]} />
                <Bar dataKey="instagram" name="Instagram" fill="#7B2CFF" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
