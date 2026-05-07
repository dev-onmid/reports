"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useClients } from '@/lib/client-store';
import { readCachedAdAccounts, readIntegrations, type CachedAdAccount } from '@/lib/integration-store';
import { useMetaAdsConnections } from '@/lib/meta-ads-store';
import {
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Eye,
  ArrowUpRight,
  DollarSign,
  Users,
  RefreshCw,
  Check,
  BarChart3,
  Download,
} from 'lucide-react';

type Period = 'last_7d' | 'last_30d' | 'last_month' | 'this_month' | 'custom';

const PERIOD_LABELS: Record<Period, string> = {
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
  last_month: 'Mês passado',
  this_month: 'Este mês',
  custom: 'Personalizado',
};

const META_DATE_PRESET: Record<Exclude<Period, 'custom'>, string> = {
  last_7d: 'last_7d',
  last_30d: 'last_30d',
  last_month: 'last_month',
  this_month: 'this_month',
};

type AccountInsights = {
  accountId: string;
  accountName: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  reach: number;
  cpm: number;
  cpc: number;
  ctr: number;
  currency: string;
};

type ReportData = {
  accounts: AccountInsights[];
  period: string;
  generatedAt: string;
};

async function fetchAccountInsights(
  accountId: string,
  accountName: string,
  currency: string,
  token: string,
  period: Period,
  dateFrom?: string,
  dateTo?: string,
): Promise<AccountInsights> {
  const fields = 'spend,impressions,clicks,reach,actions,cpm,cpc,ctr';
  let url = `https://graph.facebook.com/v21.0/${accountId}/insights?fields=${fields}&level=account&access_token=${token}`;

  if (period === 'custom' && dateFrom && dateTo) {
    url += `&time_range[since]=${dateFrom}&time_range[until]=${dateTo}`;
  } else {
    url += `&date_preset=${META_DATE_PRESET[period as Exclude<Period, 'custom'>] ?? 'last_30d'}`;
  }

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(`${accountName}: ${data.error.message}`);
  }

  const row = data.data?.[0] ?? {};

  type MetaAction = { action_type: string; value: string };
  const leads = (row.actions as MetaAction[] | undefined)
    ?.filter(
      a =>
        a.action_type === 'lead' ||
        a.action_type === 'offsite_conversion.fb_pixel_lead' ||
        a.action_type === 'onsite_conversion.lead_grouped',
    )
    .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0) ?? 0;

  return {
    accountId,
    accountName,
    spend: parseFloat(row.spend || '0'),
    impressions: parseInt(row.impressions || '0', 10),
    clicks: parseInt(row.clicks || '0', 10),
    leads,
    reach: parseInt(row.reach || '0', 10),
    cpm: parseFloat(row.cpm || '0'),
    cpc: parseFloat(row.cpc || '0'),
    ctr: parseFloat(row.ctr || '0'),
    currency,
  };
}

function formatCurrency(value: number, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR').format(value);
}

export default function NovoRelatorioPage() {
  const { clients } = useClients();
  const { getConnection } = useMetaAdsConnections();

  const [source, setSource] = useState<'account' | 'client'>('account');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period>('last_30d');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [observations, setObservations] = useState('');
  const [cachedAccounts, setCachedAccounts] = useState<CachedAdAccount[]>([]);
  const [isMetaConnected, setIsMetaConnected] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [generateError, setGenerateError] = useState('');

  useEffect(() => {
    const integrations = readIntegrations();
    setIsMetaConnected(integrations.meta.status === 'connected');
    setCachedAccounts(readCachedAdAccounts());
  }, []);

  const clientLinkedAccounts: CachedAdAccount[] = (() => {
    if (source !== 'client' || !selectedClientId) return [];
    const connection = getConnection(selectedClientId);
    if (!connection) return [];
    return cachedAccounts.filter(a => connection.accountIds.includes(a.id));
  })();

  const accountsForReport: CachedAdAccount[] =
    source === 'client'
      ? clientLinkedAccounts
      : cachedAccounts.filter(a => selectedAccountIds.includes(a.id));

  function toggleAccount(id: string) {
    setSelectedAccountIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  }

  const canGenerate = isMetaConnected && (
    source === 'client'
      ? !!selectedClientId && clientLinkedAccounts.length > 0
      : selectedAccountIds.length > 0
  ) && (period !== 'custom' || (!!dateFrom && !!dateTo));

  async function handleGenerate() {
    if (!canGenerate) return;
    setIsGenerating(true);
    setGenerateError('');
    setReportData(null);

    try {
      const integrations = readIntegrations();
      const token = integrations.meta.accessToken;

      const results = await Promise.all(
        accountsForReport.map(account =>
          fetchAccountInsights(account.id, account.name, account.currency, token, period, dateFrom, dateTo),
        ),
      );

      setReportData({
        accounts: results,
        period: period === 'custom' ? `${dateFrom} a ${dateTo}` : PERIOD_LABELS[period],
        generatedAt: new Date().toLocaleString('pt-BR'),
      });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Erro ao gerar relatório');
    } finally {
      setIsGenerating(false);
    }
  }

  const totals = reportData?.accounts.reduce(
    (acc, a) => ({
      spend: acc.spend + a.spend,
      impressions: acc.impressions + a.impressions,
      clicks: acc.clicks + a.clicks,
      leads: acc.leads + a.leads,
      reach: acc.reach + a.reach,
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, reach: 0 },
  ) ?? null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Criar Novo Relatório</h1>
        <p className="text-muted-foreground mt-1">
          Selecione as contas e período para gerar o relatório com dados reais do Meta.
        </p>
      </div>

      {!isMetaConnected && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm">
            Meta Ads não conectado.{' '}
            <Link href="/integracoes" className="underline font-medium">
              Conecte na página de Integrações
            </Link>{' '}
            para gerar relatórios com dados reais.
          </p>
        </div>
      )}

      <div className="grid gap-6">
        {/* Section 1: Source */}
        <Card>
          <CardHeader>
            <CardTitle>1. Fonte do Relatório</CardTitle>
            <CardDescription>
              Selecione contas diretamente da conexão global ou filtre por cliente cadastrado
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <button
                onClick={() => { setSource('account'); setSelectedClientId(''); }}
                className={`flex-1 flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left ${
                  source === 'account'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <BarChart3 className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="font-semibold text-sm">Contas de Anúncios</p>
                  <p className="text-xs text-muted-foreground">Qualquer conta da conexão global</p>
                </div>
              </button>
              <button
                onClick={() => { setSource('client'); setSelectedAccountIds([]); }}
                className={`flex-1 flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left ${
                  source === 'client'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <Users className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="font-semibold text-sm">Por Cliente</p>
                  <p className="text-xs text-muted-foreground">Contas vinculadas a um cliente</p>
                </div>
              </button>
            </div>

            {source === 'account' && (
              <div className="space-y-2">
                {cachedAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 rounded-lg bg-muted/30 text-center">
                    {isMetaConnected
                      ? 'Nenhuma conta encontrada. Acesse Integrações e carregue os ativos primeiro.'
                      : 'Conecte o Meta Ads para ver as contas disponíveis.'}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {cachedAccounts.map(account => {
                      const selected = selectedAccountIds.includes(account.id);
                      return (
                        <button
                          key={account.id}
                          onClick={() => toggleAccount(account.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                            selected
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/40'
                          }`}
                        >
                          <div
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                              selected ? 'bg-primary border-primary' : 'border-muted-foreground'
                            }`}
                          >
                            {selected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{account.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{account.id}</p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">{account.currency}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedAccountIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">{selectedAccountIds.length} conta(s) selecionada(s)</p>
                )}
              </div>
            )}

            {source === 'client' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <select
                    value={selectedClientId}
                    onChange={e => setSelectedClientId(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="" disabled>Selecione um cliente</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                {selectedClientId && (
                  clientLinkedAccounts.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-3 rounded-lg bg-muted/30">
                      Este cliente não tem contas de anúncios vinculadas.{' '}
                      <Link href={`/clientes/${selectedClientId}`} className="text-primary underline">
                        Configurar →
                      </Link>
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Contas vinculadas:</p>
                      {clientLinkedAccounts.map(a => (
                        <div
                          key={a.id}
                          className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-sm"
                        >
                          <Check className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-medium flex-1">{a.name}</span>
                          <span className="text-xs text-muted-foreground font-mono">{a.id}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 2: Period */}
        <Card>
          <CardHeader>
            <CardTitle>2. Período</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setPeriod(value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                    period === value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>De</Label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Até</Label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 3: AI */}
        <Card>
          <CardHeader>
            <CardTitle>3. Análise com IA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="ai-analysis"
                checked={aiEnabled}
                onChange={e => setAiEnabled(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="ai-analysis" className="flex items-center gap-2 cursor-pointer">
                Gerar análise automática com IA{' '}
                <Sparkles className="w-4 h-4 text-primary" />
              </Label>
            </div>
            <div className="space-y-2">
              <Label>Observações internas (opcional)</Label>
              <textarea
                value={observations}
                onChange={e => setObservations(e.target.value)}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Ex: Campanha pausada no dia 15. A IA considerará este contexto."
              />
            </div>
          </CardContent>
        </Card>

        {generateError && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{generateError}</p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button render={<Link href="/relatorios" />} nativeButton={false} variant="outline">
            Cancelar
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Buscando dados...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Gerar Relatório
              </>
            )}
          </Button>
        </div>

        {/* Report Result */}
        {reportData && totals && (
          <div className="space-y-6 pt-6 border-t border-border">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">Resultado do Relatório</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Período: <strong>{reportData.period}</strong> · Gerado em {reportData.generatedAt}
                </p>
              </div>
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Exportar PDF
              </Button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-2">
                    <DollarSign className="w-3.5 h-3.5" />
                    Investimento
                  </div>
                  <p className="text-2xl font-bold">{formatCurrency(totals.spend)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-2">
                    <Eye className="w-3.5 h-3.5" />
                    Impressões
                  </div>
                  <p className="text-2xl font-bold">{formatNumber(totals.impressions)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-2">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    Cliques
                  </div>
                  <p className="text-2xl font-bold">{formatNumber(totals.clicks)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-2">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Leads
                  </div>
                  <p className="text-2xl font-bold">{formatNumber(totals.leads)}</p>
                </CardContent>
              </Card>
            </div>

            {/* Per-account breakdown */}
            {reportData.accounts.length > 1 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Conta</th>
                      <th className="px-4 py-3 text-right">Investido</th>
                      <th className="px-4 py-3 text-right">Impressões</th>
                      <th className="px-4 py-3 text-right">Cliques</th>
                      <th className="px-4 py-3 text-right">Leads</th>
                      <th className="px-4 py-3 text-right">CPL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reportData.accounts.map(account => (
                      <tr key={account.accountId} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <p className="font-medium">{account.accountName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{account.accountId}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(account.spend, account.currency)}
                        </td>
                        <td className="px-4 py-3 text-right">{formatNumber(account.impressions)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(account.clicks)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(account.leads)}</td>
                        <td className="px-4 py-3 text-right">
                          {account.leads > 0
                            ? formatCurrency(account.spend / account.leads, account.currency)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/50 font-semibold">
                      <td className="px-4 py-3">Total</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.spend)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.impressions)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.clicks)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.leads)}</td>
                      <td className="px-4 py-3 text-right">
                        {totals.leads > 0 ? formatCurrency(totals.spend / totals.leads) : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Single account extra metrics */}
            {reportData.accounts.length === 1 && (() => {
              const a = reportData.accounts[0];
              return (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-1">CPL</p>
                    <p className="text-xl font-bold">
                      {a.leads > 0 ? formatCurrency(a.spend / a.leads, a.currency) : '—'}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-1">CPM</p>
                    <p className="text-xl font-bold">{formatCurrency(a.cpm, a.currency)}</p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-1">CTR</p>
                    <p className="text-xl font-bold">{a.ctr.toFixed(2)}%</p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-1">CPC</p>
                    <p className="text-xl font-bold">{formatCurrency(a.cpc, a.currency)}</p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-1">Alcance</p>
                    <p className="text-xl font-bold">{formatNumber(a.reach)}</p>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
