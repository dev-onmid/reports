"use client";

import { type ElementType, type ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, TrendingUp, Users, Target, RefreshCw,
  Eye, Calendar, ShoppingBag, CheckCircle2, ChevronRight, Info, DollarSign, Users2,
  SlidersHorizontal, ArrowUp, ArrowDown,
} from 'lucide-react';
import { useInvestmentPayments } from '@/lib/payment-store';
import { clientResults, type ClientFunnel } from '@/lib/client-results-store';
import { useClients } from '@/lib/client-store';
import { ClientAvatar } from '@/components/client-avatar';
import { ResultsTabs } from '@/components/results-tabs';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import {
  ordenarLinhas, filtrarLinhas, categoriasDisponiveis, proximaOrdem,
  situacaoDaMeta, temAlgumaMeta, METRICAS,
  totaisSemDuplicar, compartilhamentoDeConta, chaveConta, mediana,
  type ColunaRadar, type FonteRadar, type DirecaoOrdem, type FiltroSituacao, type MetricaRadar,
} from '@/lib/radar-tabela';

type ApiMetrics = {
  meta: { spend: number; impressions: number; clicks: number; leads: number; cpl: number } | null;
  google: { cost: number; impressions: number; clicks: number; cpc: number; conversions: number; cpa: number } | null;
  crm?: { revenue: number; sales: number; leads: number; ticket: number } | null;
};

type GoalConfig = { type: string; target: number; targetAlcance?: number };
type FunnelStage = { id: string; name: string; conversion: number };
type ClientPlanningConfig = { tkm: number; cplMeta: number; stages: FunnelStage[] };

const DEFAULT_STAGES: FunnelStage[] = [
  { id: 's5', name: '5º — Contatos (Leads)', conversion: 50 },
  { id: 's4', name: '4º — Qualificados', conversion: 100 },
  { id: 's3', name: '3º — Agendamentos', conversion: 50 },
  { id: 's2', name: '2º — Comparecimentos', conversion: 47 },
  { id: 's1', name: '1º — Fechamentos (Vendas)', conversion: 0 },
];

// ⚠️ ZERO = "sem meta cadastrada", e é o padrão de propósito. Antes eram
// 9000/30, então TODO cliente sem planejamento era julgado no Radar contra uma
// meta que ninguém definiu — e aparecia vermelho por não bater um número
// inventado. Métrica sem meta agora sai do julgamento e fica só como
// performance (o número cru, em cinza).
const DEFAULT_CLIENT_PLANNING: ClientPlanningConfig = {
  tkm: 0,
  cplMeta: 0,
  stages: DEFAULT_STAGES,
};

function readGoalFromStorage(clientId: string): GoalConfig | null {
  try {
    const stored = localStorage.getItem(`clientGoal_${clientId}`);
    if (!stored) return null;
    return JSON.parse(stored) as GoalConfig;
  } catch { return null; }
}

function readPlanningFromStorage(clientId: string): ClientPlanningConfig {
  try {
    const stored = localStorage.getItem(`clientPlanning_${clientId}`);
    if (!stored) return DEFAULT_CLIENT_PLANNING;
    const parsed = JSON.parse(stored) as Partial<ClientPlanningConfig>;
    // Não coagir 0 para o padrão: zero salvo é a forma de dizer "sem meta".
    const tkm = Number(parsed.tkm);
    const cplMeta = Number(parsed.cplMeta);
    return {
      tkm: Number.isFinite(tkm) && tkm >= 0 ? tkm : DEFAULT_CLIENT_PLANNING.tkm,
      cplMeta: Number.isFinite(cplMeta) && cplMeta >= 0 ? cplMeta : DEFAULT_CLIENT_PLANNING.cplMeta,
      stages: sanitizePlanningStages(parsed.stages),
    };
  } catch { return DEFAULT_CLIENT_PLANNING; }
}

function sanitizePlanningStages(stages: unknown): FunnelStage[] {
  if (!Array.isArray(stages) || stages.length === 0) return DEFAULT_STAGES;
  return DEFAULT_STAGES.map((fallback, index) => {
    const source = stages[index] as Partial<FunnelStage> | undefined;
    return {
      id: source?.id ?? fallback.id,
      name: source?.name ?? fallback.name,
      conversion: Number.isFinite(Number(source?.conversion)) ? Number(source?.conversion) : fallback.conversion,
    };
  });
}

function computeFunnel(stages: FunnelStage[], metaRS: number, ticket: number): number[] {
  const values = new Array(stages.length).fill(0);
  if (metaRS <= 0 || ticket <= 0 || stages.length === 0) return values;

  values[stages.length - 1] = Math.ceil(metaRS / ticket);
  for (let i = stages.length - 2; i >= 0; i -= 1) {
    const conversion = Math.max(0.01, (stages[i].conversion || 0) / 100);
    values[i] = Math.ceil(values[i + 1] / conversion);
  }

  return values;
}

function plannedFunnelFromGoal(goal: GoalConfig | null, stages: FunnelStage[], ticket: number): number[] {
  const values = new Array(stages.length).fill(0);
  const target = Number(goal?.target ?? 0);
  if (!goal || target <= 0 || stages.length === 0) return values;

  if (goal.type === 'leads') {
    values[0] = Math.ceil(target);
    for (let i = 1; i < stages.length; i += 1) {
      const conversion = Math.max(0, (stages[i - 1].conversion || 0) / 100);
      values[i] = Math.ceil(values[i - 1] * conversion);
    }
    return values;
  }

  if (goal.type === 'revenue') return computeFunnel(stages, target, ticket);

  values[stages.length - 1] = Math.ceil(target);
  for (let i = stages.length - 2; i >= 0; i -= 1) {
    const conversion = Math.max(0.01, (stages[i].conversion || 0) / 100);
    values[i] = Math.ceil(values[i + 1] / conversion);
  }
  return values;
}

function funnelArrayToObject(values: number[]): ClientFunnel {
  return {
    contatos: values[0] ?? 0,
    qualificados: values[1] ?? 0,
    agendamentos: values[2] ?? 0,
    comparecimentos: values[3] ?? 0,
    fechamentos: values[4] ?? 0,
  };
}

function calcPct(atual: number, meta: number, inverse = false): number | null {
  if (meta === 0) return null; // sem meta definida → sem cor
  if (atual === 0) return 0;
  const raw = inverse ? (meta / atual) * 100 : (atual / meta) * 100;
  // % REAL (ex.: 132%) — antes saía travado em 100 e quem passou muito da meta
  // empatava com quem bateu no limite, inclusive na ordenação. Não há barra
  // proporcional nesta tela; se surgir, ela é que deve limitar a 100.
  return Math.round(raw);
}

/** Lead de Google vem fracionado (atribuição) — na tela é sempre inteiro. */
function fmtLeads(n: number): string {
  return Math.round(n).toLocaleString('pt-BR');
}

const NEUTRAL_COLORS = {
  badge:  'bg-muted/30 border-border text-muted-foreground',
  text:   'text-foreground', bar: 'bg-muted', border: 'border-l-border',
};

function pctColors(pct: number | null) {
  if (pct === null) return NEUTRAL_COLORS;
  if (pct >= 75) return {
    badge:  'bg-emerald-500/15 border-emerald-400/30 text-emerald-300',
    text:   'text-emerald-300', bar: 'bg-emerald-500', border: 'border-l-emerald-500',
  };
  if (pct >= 30) return {
    badge:  'bg-orange-500/15 border-orange-400/30 text-orange-300',
    text:   'text-orange-300', bar: 'bg-orange-400', border: 'border-l-orange-400',
  };
  return {
    badge:  'bg-red-500/15 border-red-400/30 text-red-300',
    text:   'text-red-300', bar: 'bg-red-500', border: 'border-l-red-500',
  };
}

function MetricCell({ value, pct, format = 'currency', loading = false }: {
  value: number; pct: number | null; format?: 'currency' | 'number'; loading?: boolean;
}) {
  const c = pctColors(pct);
  if (loading) return <span className="text-muted-foreground/40 text-sm">…</span>;
  if (value === 0) {
    return <span className={cn('text-sm font-bold', pct === null ? 'text-muted-foreground/40' : c.text)}>—</span>;
  }
  return (
    <p className={cn('text-sm font-bold whitespace-nowrap', c.text)}>
      {format === 'currency' ? formatCurrencyBRL(value) : value.toLocaleString('pt-BR')}
    </p>
  );
}

/** Primeiro e último dia do mês corrente no fuso de quem está olhando. */
function janelaDoMes() {
  const hoje = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    from: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
    to: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)),
  };
}

const FUNNEL_KEYS: (keyof ClientFunnel)[] = ['contatos', 'qualificados', 'agendamentos', 'comparecimentos', 'fechamentos'];
const FUNNEL_LABELS = ['Cont.', 'Qualif.', 'Agend.', 'Comp.', 'Fecha.'];
const FUNNEL_ICONS = [Eye, Users2, Calendar, ShoppingBag, CheckCircle2];
const ZERO_FUNNEL: ClientFunnel = { contatos: 0, qualificados: 0, agendamentos: 0, comparecimentos: 0, fechamentos: 0 };

function ResultKpiCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
  title,
}: {
  label: string;
  value: string;
  icon: ElementType;
  color: string;
  sub?: ReactNode;
  title?: string;
}) {
  return (
    <div
      className="relative min-h-[170px] overflow-hidden rounded-[var(--radius)] border border-border bg-card px-7 py-7"
      title={title}
      style={{
        background: `radial-gradient(circle at 11% 36%, ${color}18, transparent 31%), linear-gradient(145deg, rgba(17,22,35,0.92), rgba(8,11,18,0.97))`,
        boxShadow: `0 0 30px ${color}0d, inset 0 0 0 1px rgba(255,255,255,0.025)`,
      }}
    >
      <div className="flex items-start gap-6">
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border"
          style={{
            color,
            borderColor: `${color}38`,
            background: `radial-gradient(circle, ${color}30 0%, ${color}16 72%)`,
            boxShadow: `0 0 24px ${color}22`,
          }}
        >
          <Icon className="h-8 w-8" />
        </span>
        <div className="min-w-0 pt-1">
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5" style={{ color }} />
            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
          </div>
          <p className="mt-3 font-heading font-normal text-xl leading-none tabular-nums" style={{ color }}>
            {value}
          </p>
          {sub && <div className="mt-3 text-xs font-semibold text-muted-foreground">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

export default function ResultadosPage() {
  const { clients } = useClients();
  const { payments } = useInvestmentPayments();
  const [apiMetricsByClient, setApiMetricsByClient] = useState<Record<string, ApiMetrics>>({});
  // Funil REALIZADO por cliente, do /api/crm/summary (contagem cumulativa por
  // etapa semântica) — antes esta coluna vinha de mocks hardcoded em
  // client-results-store e ficava zerada pra todo cliente real.
  const [funilByClient, setFunilByClient] = useState<Record<string, ClientFunnel>>({});
  // Constante durante a sessão: recalcular a cada render refaria o fetch sem motivo.
  const mesAtual = useMemo(() => janelaDoMes(), []);
  // Snapshot do Monitor de Redes Sociais — é dele que sai o resultado das metas
  // de rede social. ⚠️ Uma query só; resolver 40 contas ao vivo na Graph custaria
  // dezenas de chamadas por abertura da tela.
  const [socialByClient, setSocialByClient] = useState<Record<string, { ganho: number | null; alcance: number | null }>>({});
  useEffect(() => {
    // ⚠️ O funil PRECISA da mesma janela do resto da linha. Sem `from`/`to` a
    // rota devolve a base HISTÓRICA inteira: a Incorpast mostrava 1.764 contatos
    // ao lado de 362 leads do mês — dois períodos diferentes na mesma linha,
    // parecendo erro de cálculo. Mês corrente no fuso do usuário, que é o mesmo
    // recorte de `period=this_month` das métricas.
    fetch(`/api/crm/summary?from=${mesAtual.from}&to=${mesAtual.to}`)
      .then(r => r.ok ? r.json() as Promise<{ clientId: string; funil: ClientFunnel }[]> : [])
      .then(data => {
        const map: Record<string, ClientFunnel> = {};
        for (const item of data) map[item.clientId] = item.funil;
        setFunilByClient(map);
      })
      .catch(() => setFunilByClient({}));

    fetch('/api/social-monitor')
      .then(r => r.ok ? r.json() as Promise<{ snapshots: { clientId: string; followersGained28d: number | null; reach28d: number | null }[] }> : { snapshots: [] })
      .then(({ snapshots }) => {
        const map: Record<string, { ganho: number | null; alcance: number | null }> = {};
        for (const s of snapshots ?? []) map[s.clientId] = { ganho: s.followersGained28d ?? null, alcance: s.reach28d ?? null };
        setSocialByClient(map);
      })
      .catch(() => setSocialByClient({}));
  }, [mesAtual.from, mesAtual.to]);
  const [goalsByClient, setGoalsByClient] = useState<Record<string, GoalConfig | null>>({});
  const [planningByClient, setPlanningByClient] = useState<Record<string, ClientPlanningConfig>>({});
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  // Contas de anúncio vinculadas por cliente — só para apontar quem divide
  // conta com quem (ver `compartilhamentoDeConta`). Uma chamada para todos.
  const [contasByClient, setContasByClient] = useState<Record<string, string[]>>({});
  useEffect(() => {
    fetch('/api/clients/links')
      .then(r => r.ok ? r.json() as Promise<{ clientId: string; platform: string; accountId: string }[]> : [])
      .then(links => {
        const map: Record<string, string[]> = {};
        for (const l of links) {
          if (!l?.clientId || !l.accountId || (l.platform !== 'meta_ads' && l.platform !== 'google_ads')) continue;
          (map[l.clientId] ??= []).push(chaveConta(l.platform, String(l.accountId)));
        }
        setContasByClient(map);
      })
      .catch(() => setContasByClient({}));
  }, []);

  // Filtro e ordenação da tabela (só apresentação — os KPIs do topo continuam
  // somando a carteira inteira, senão o "total" mudaria conforme o filtro).
  const [categoria, setCategoria] = useState('');
  const [metrica, setMetrica] = useState<MetricaRadar>('resultado');
  const [situacao, setSituacao] = useState<FiltroSituacao>('todas');
  const [ordem, setOrdem] = useState<{ coluna: ColunaRadar | null; direcao: DirecaoOrdem }>(
    { coluna: null, direcao: 'desc' },
  );
  const [verSemMeta, setVerSemMeta] = useState(false);

  // useClients() não expõe flag de carregamento: sem isto o cabeçalho da tabela
  // fica flutuando sozinho enquanto /api/clients responde. Considera carregado
  // assim que chega o 1º cliente e, no máximo, após a janela do fetch inicial —
  // senão carteira genuinamente vazia nunca mostraria o estado vazio.
  const [loadingClients, setLoadingClients] = useState(true);
  useEffect(() => { if (clients.length > 0) setLoadingClients(false); }, [clients]);
  useEffect(() => {
    const t = setTimeout(() => setLoadingClients(false), 4000);
    return () => clearTimeout(t);
  }, []);

  // Load goals and planning: localStorage first, then DB
  useEffect(() => {
    if (clients.length === 0) return;
    const goals: Record<string, GoalConfig | null> = {};
    const planning: Record<string, ClientPlanningConfig> = {};
    for (const c of clients) {
      goals[c.id] = readGoalFromStorage(c.id);
      planning[c.id] = readPlanningFromStorage(c.id);
    }
    setGoalsByClient(goals);
    setPlanningByClient(planning);

    const ids = clients.map(c => c.id).join(',');
    fetch(`/api/clients/bulk-settings?clientIds=${ids}`)
      .then(r => r.json())
      .then((data: { goals: Record<string, GoalConfig>; planning: Record<string, ClientPlanningConfig> }) => {
        if (Object.keys(data.goals).length > 0) {
          setGoalsByClient(prev => ({ ...prev, ...data.goals }));
        }
        if (Object.keys(data.planning).length > 0) {
          setPlanningByClient(prev => ({ ...prev, ...data.planning }));
        }
      })
      .catch(() => {});
  }, [clients]);

  // Fetch real metrics for all clients
  useEffect(() => {
    if (clients.length === 0) return;
    setLoadingMetrics(true);
    Promise.allSettled(
      clients.map(async (c) => {
        // ⚠️ `this_month`, não o default `last_30d` da rota: a meta desta tela é
        // MENSAL, e comparar "meta de setembro" com "últimos 30 dias" mistura
        // o mês passado no resultado — no dia 14 a janela começava em 15/08.
        // É a mesma janela padrão da Dashboard, de propósito.
        const res = await fetch(`/api/clients/${c.id}/metrics?period=this_month`);
        const data: ApiMetrics = res.ok ? await res.json() : { meta: null, google: null, crm: null };
        return [c.id, data] as const;
      })
    ).then((results) => {
      const map: Record<string, ApiMetrics> = {};
      for (const r of results) {
        if (r.status === 'fulfilled') map[r.value[0]] = r.value[1];
      }
      setApiMetricsByClient(map);
    }).finally(() => setLoadingMetrics(false));
  }, [clients]);

  const rows = clients.map((client) => {
    const hardcoded = clientResults.find((r) => r.clientId === client.id);
    const api = apiMetricsByClient[client.id];
    const goal = goalsByClient[client.id];
    const planning = planningByClient[client.id] ?? DEFAULT_CLIENT_PLANNING;
    const plannedFunil = funnelArrayToObject(plannedFunnelFromGoal(goal, planning.stages, planning.tkm));
    const hasPlannedFunil = FUNNEL_KEYS.some((key) => plannedFunil[key] > 0);

    // ⚠️ Pagamento ≠ investimento em anúncio. Esta soma é de TODO o histórico de
    // Pix da tela de Pagamentos (sem janela de data), então ficava ao lado de um
    // CPL de 30 dias sem nenhuma relação com ele: Meta Pizzaria mostrava
    // R$ 5.750,00 tendo gasto R$ 457,64. Continua na tela, mas como o que é —
    // "enviado ao cliente" — e nunca mais como o investimento que gera o CPL.
    const clientPayments = payments.filter((p) => p.clientId === client.id);
    const dispatchedInvest = clientPayments
      .filter((p) => p.status === 'Pago' || p.status === 'Enviado')
      .reduce((s, p) => s + p.amount, 0);

    // ── Métricas: MESMA régua da Dashboard (dashboard/page.tsx) ─────────────
    // ⚠️ Antes cada número vinha de uma plataforma diferente na MESMA linha:
    // `leads` só do Meta, `cac` só do Google, e `investimento` era a soma dos
    // PAGAMENTOS cadastrados. Medido em 14/09: a Londrigifts aparecia com 0
    // leads tendo 403 conversões no Google, e a Incorpast com "R$ 0,00
    // investido" ao lado de um CPL de R$ 4,73 — tendo gasto R$ 5.692,05 em
    // anúncio. Números que não se explicam entre si na própria linha.
    const gastoMeta   = api?.meta?.spend ?? 0;
    const gastoGoogle = api?.google?.cost ?? 0;
    const gastoAnuncio = gastoMeta + gastoGoogle;

    // Conversão do Google conta como lead — é o que a Dashboard soma, e cliente
    // que só roda Google apareceria zerado de outro jeito.
    const leadsApi = api ? (api.meta?.leads ?? 0) + (api.google?.conversions ?? 0) : null;
    const leads = leadsApi ?? hardcoded?.leads ?? 0;
    const cpl = leads > 0 && gastoAnuncio > 0 ? gastoAnuncio / leads : (api ? 0 : hardcoded?.cpl ?? 0);

    // ⚠️ CAC é gasto ÷ VENDA FECHADA, que é o que o próprio cabeçalho promete.
    // Vinha do `cpa` do Google (custo ÷ conversão do Google), então dizia
    // R$ 42,77 para um cliente com 11 vendas reais e R$ 5.692 gastos — CAC de
    // R$ 517. Sem venda no período fica 0 e a célula mostra "—": inventar um
    // CAC sem denominador seria pior que não ter.
    const vendas = api?.crm?.sales ?? 0;
    const cac = vendas > 0 && gastoAnuncio > 0 ? gastoAnuncio / vendas : (api ? 0 : hardcoded?.cac ?? 0);
    const resultado = api?.crm?.revenue ?? hardcoded?.resultado ?? 0;

    // ── Meta de REDES SOCIAIS ──────────────────────────────────────────────
    // Ela substitui META/RESULTADO/% da linha: para esse cliente o que se cobra
    // é seguidor e alcance, não faturamento. O alcance vira a 2ª linha da célula
    // de resultado — a tabela não tem coluna para ele e inventar uma quebraria
    // o cabeçalho de todos os outros clientes.
    const ehSocial = goal?.type === 'social';
    const social = socialByClient[client.id];
    const metaSeguidores = ehSocial ? (goal?.target ?? 0) : 0;
    const metaAlcance = ehSocial ? (goal?.targetAlcance ?? 0) : 0;
    const seguidores = ehSocial ? (social?.ganho ?? 0) : 0;
    const alcance = ehSocial ? (social?.alcance ?? 0) : 0;
    const pctAlcance = ehSocial ? calcPct(alcance, metaAlcance) : null;

    // "Sem meta" é declaração explícita do gestor: nada é cobrado deste cliente,
    // nem o que estiver parado no planejamento.
    const semMetaDeclarada = goal?.type === 'none';

    // Goals: prefer localStorage config, fallback to hardcoded
    const metaTarget = goal?.type === 'revenue'
      ? goal.target
      : hasPlannedFunil && plannedFunil.fechamentos > 0
        ? plannedFunil.fechamentos * planning.tkm
        : hardcoded?.meta ?? 0;
    const metaLeads = (hasPlannedFunil ? plannedFunil.contatos : null) ?? hardcoded?.metaLeads ?? 0;
    const metaCpl = planning.cplMeta || hardcoded?.metaCpl || 0;
    // Real primeiro; o mock só sobrevive como fallback dos ids fictícios de demo.
    const funil = funilByClient[client.id] ?? hardcoded?.funil ?? ZERO_FUNNEL;
    const metaFunil = hasPlannedFunil ? plannedFunil : hardcoded?.metaFunil ?? ZERO_FUNNEL;
    const metaFunnelSales = metaFunil.fechamentos;
    const metaCacFromPlanning = metaLeads > 0 && metaCpl > 0 && metaFunnelSales > 0
      ? (metaLeads * metaCpl) / metaFunnelSales
      : 0;
    const metaCacBruto = metaCacFromPlanning || hardcoded?.metaCac || 0;

    // "Sem meta" zera TUDO que é cobrança; os números medidos continuam iguais.
    const metaTargetFinal = semMetaDeclarada ? 0 : (ehSocial ? metaSeguidores : metaTarget);
    const resultadoFinal  = ehSocial ? seguidores : resultado;
    const metaLeadsFinal  = semMetaDeclarada ? 0 : metaLeads;
    const metaCplFinal    = semMetaDeclarada ? 0 : metaCpl;
    const metaCac         = semMetaDeclarada ? 0 : metaCacBruto;
    const metaFunilFinal  = semMetaDeclarada ? ZERO_FUNNEL : metaFunil;

    const pctResult = calcPct(resultadoFinal, metaTargetFinal);
    const pctLeads  = calcPct(leads, metaLeadsFinal);
    const pctCpl    = calcPct(cpl, metaCplFinal, true);
    const pctCac    = calcPct(cac, metaCac, true);
    const funnelPcts = FUNNEL_KEYS.map((k) => calcPct(funil[k], metaFunilFinal[k]));

    const fonte: FonteRadar = {
      id: client.id,
      nome: client.name,
      meta: api?.meta ? { gasto: api.meta.spend ?? 0, leads: api.meta.leads ?? 0 } : null,
      google: api?.google ? { gasto: api.google.cost ?? 0, leads: api.google.conversions ?? 0 } : null,
      extraGasto: api ? 0 : gastoAnuncio,
      extraLeads: api ? 0 : leads,
      contas: contasByClient[client.id] ?? [],
    };

    return {
      client, hardcoded, api, fonte,
      leads, cpl, cac,
      resultado: resultadoFinal,
      metaTarget: metaTargetFinal,
      metaLeads: metaLeadsFinal, metaCpl: metaCplFinal, metaCac,
      funil, metaFunil: metaFunilFinal, funnelPcts,
      ehSocial, alcance, pctAlcance,
      metaAlcance: semMetaDeclarada ? 0 : metaAlcance,
      totalInvest: gastoAnuncio, dispatchedInvest, gastoMeta, gastoGoogle,
      pctResult, pctLeads, pctCpl, pctCac,
      gestor: hardcoded?.gestor ?? '',
      // Campos planos que `radar-tabela` consome (ordenar/filtrar).
      nome: client.name,
      categoria: client.segment ?? '',
      investimento: gastoAnuncio,
      fechamentos: funil.fechamentos,
      pctFechamentos: funnelPcts[FUNNEL_KEYS.length - 1] ?? null,
    };
  });

  // ⚠️ O universo do Radar são os clientes COM alguma meta. Quem não tem meta
  // nenhuma não é caso desta tela — vira uma linha de traços que não informa
  // nada e ainda suja os totais. Fica atrás do atalho "ver os sem meta".
  const comMeta = rows.filter(temAlgumaMeta);
  const semMeta = rows.filter((r) => !temAlgumaMeta(r));
  const base = verSemMeta ? semMeta : comMeta;

  const categorias = categoriasDisponiveis(base);
  const linhas = ordenarLinhas(
    filtrarLinhas(base, { categoria, metrica, situacao }),
    ordem.coluna, ordem.direcao,
  );
  const filtrando = categoria !== '' || situacao !== 'todas';

  // Somam o universo da tela (clientes com meta), NÃO o recorte do filtro —
  // filtro é lente de leitura; o total precisa fechar com as linhas que a tela
  // se propõe a acompanhar.
  // ⚠️ Só metas em DINHEIRO entram nos totais de R$. Meta de rede social é
  // contada em seguidores — somá-la aqui viraria "R$ 1.000" de mentira no card.
  const emReais   = comMeta.filter((r) => !r.ehSocial);
  const totMeta   = emReais.reduce((s, r) => s + r.metaTarget, 0);
  const totResult = emReais.reduce((s, r) => s + r.resultado, 0);
  // Agora soma GASTO de anúncio do mês — antes somava todo o histórico de Pix,
  // o que dava R$ 834 mil ao lado de um CPL de 30 dias.
  // ⚠️ Conta compartilhada entre clientes entra UMA vez (ver radar-tabela).
  // As linhas seguem mostrando o número da conta inteira em cada cliente.
  const dedup = totaisSemDuplicar(comMeta.map((r) => r.fonte));
  const totLeads  = dedup.leads;
  const totInvest = dedup.investimento;
  const compartilhaCom = compartilhamentoDeConta(rows.map((r) => r.fonte));
  const overallPct = calcPct(totResult, totMeta);
  // ⚠️ A soma é dominada por quem tem a maior meta (uma meta de R$ 1,2 mi
  // engole o resto). A MEDIANA do % por cliente diz como a carteira anda.
  const comMetaEmReais = emReais.filter((r) => r.metaTarget > 0);
  const pctMediana = mediana(
    comMetaEmReais.map((r) => r.pctResult).filter((p): p is number => p !== null),
  );
  const pctMedianaInt = pctMediana === null ? null : Math.round(pctMediana);
  const overC = pctColors(pctMedianaInt ?? overallPct);
  const subMeta = `${comMetaEmReais.length} cliente(s) com meta em R$`;
  const tituloMeta = 'Soma das metas em R$. Uma meta muito grande domina esta soma — por isso o % da carteira ao lado usa a mediana dos clientes.';

  return (
    <div className="space-y-6 pb-8">
      <ResultsTabs />

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">Radar Geral</h1>
          <p className="mt-4 text-lg font-medium text-muted-foreground">
            Métricas reais das contas vinculadas no mês atual — leads, gasto e CPL somando Meta Ads e Google Ads.
          </p>
        </div>
        <div
          className={cn(
            'mt-2 flex h-11 items-center gap-3 rounded-[var(--radius)] border border-border bg-card px-5 text-sm font-bold text-muted-foreground shadow-[0_0_22px_rgba(15,23,42,0.18)]',
            !loadingMetrics && 'opacity-70',
          )}
        >
          <span className={cn('h-2 w-2 rounded-full bg-primary', loadingMetrics && 'animate-pulse shadow-[0_0_12px_rgba(85,245,47,0.55)]')} />
          {loadingMetrics ? 'Atualizando métricas...' : 'Métricas atualizadas'}
          <RefreshCw className={cn('h-4 w-4', loadingMetrics && 'animate-spin')} />
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {([
          { label: 'META TOTAL',      value: formatCurrencyBRL(totMeta),      Icon: Target,     color: '#8b5cf6',
            sub: subMeta, title: tituloMeta },
          { label: 'RESULTADO TOTAL', value: formatCurrencyBRL(totResult),     Icon: TrendingUp,
            color: overallPct === null && pctMedianaInt === null ? '#94a3b8' : overC.text === 'text-emerald-300' ? '#22c55e' : overC.text === 'text-orange-300' ? '#fb923c' : '#ef4444',
            sub: (
              <>
                {pctMedianaInt !== null && <p><span className="text-foreground">{pctMedianaInt}%</span> — mediana dos clientes</p>}
                {overallPct !== null && <p className="mt-0.5 opacity-80">{overallPct}% da soma das metas</p>}
                <p className="mt-0.5 opacity-80">{subMeta}</p>
              </>
            ),
            title: 'Mediana do % de cada cliente com meta em R$ — a soma das metas é dominada pela maior delas, então o % da soma aparece só como referência.' },
          { label: 'TOTAL DE LEADS',  value: fmtLeads(totLeads), Icon: Users,      color: '#2f85ff',
            sub: dedup.contasCompartilhadas > 0 ? `${dedup.contasCompartilhadas} conta(s) compartilhada(s) contada(s) uma vez` : undefined,
            title: 'Leads das plataformas no mês (Meta + conversões do Google, arredondadas). Conta de anúncio ligada a mais de um cliente entra uma vez só.' },
          { label: 'INVESTIMENTO',    value: formatCurrencyBRL(totInvest),     Icon: DollarSign, color: '#f5d000',
            sub: dedup.contasCompartilhadas > 0 ? `${dedup.contasCompartilhadas} conta(s) compartilhada(s) contada(s) uma vez` : undefined,
            title: 'Gasto em anúncio no mês (Meta + Google). Conta de anúncio ligada a mais de um cliente entra uma vez só.' },
        ] as { label: string; value: string; Icon: ElementType; color: string; sub?: ReactNode; title?: string }[]).map(({ label, value, Icon, color, sub, title }) => (
          <ResultKpiCard key={label} label={label} value={value} icon={Icon} color={color} sub={sub} title={title} />
        ))}
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          <Info className="h-4 w-4" />
          Legenda
        </span>
        {([
          { label: '≥ 75% da meta',  bg: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300' },
          { label: '30 – 74% da meta', bg: 'bg-orange-500/15 border-orange-400/30 text-orange-300' },
          { label: '< 30% da meta',  bg: 'bg-red-500/15 border-red-400/30 text-red-300' },
        ]).map(({ label, bg }) => (
          <span key={label} className={cn('rounded-full border px-5 py-2 text-sm font-bold', bg)}>
            {label}
          </span>
        ))}
        <span className="flex items-center gap-2 text-sm font-semibold italic text-muted-foreground/70">
          <TrendingUp className="h-4 w-4" />
          CPL e CAC: menor = melhor
        </span>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card px-4 py-3">
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filtrar
        </span>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Categoria
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2 text-xs font-semibold text-foreground [color-scheme:dark]"
          >
            <option value="">Todas ({base.length})</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c} ({base.filter((r) => r.categoria === c).length})
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Métrica
          <select
            value={metrica}
            onChange={(e) => setMetrica(e.target.value as MetricaRadar)}
            className="h-9 rounded-lg border border-border bg-background px-2 text-xs font-semibold text-foreground [color-scheme:dark]"
          >
            {METRICAS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Situação
          <select
            value={situacao}
            onChange={(e) => setSituacao(e.target.value as FiltroSituacao)}
            className="h-9 rounded-lg border border-border bg-background px-2 text-xs font-semibold text-foreground [color-scheme:dark]"
          >
            <option value="todas">Todas</option>
            <option value="abaixo">Não está batendo a meta (&lt; 75%)</option>
            <option value="critico">Só o crítico (&lt; 30%)</option>
            <option value="ok">Batendo a meta (≥ 75%)</option>
            <option value="sem_meta">Sem meta definida</option>
          </select>
        </label>

        <span className="text-xs font-semibold text-muted-foreground">
          {linhas.length} de {base.length} clientes
        </span>

        {(filtrando || ordem.coluna) && (
          <button
            onClick={() => { setCategoria(''); setSituacao('todas'); setOrdem({ coluna: null, direcao: 'desc' }); }}
            className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Cliente sem meta nenhuma sai da tela — mas fica declarado, com atalho.
          Sumir em silêncio é como um cliente passa meses sem meta cadastrada. */}
      {(semMeta.length > 0 || verSemMeta) && (
        <div className={cn(
          'flex flex-wrap items-center gap-3 rounded-[var(--radius)] border px-4 py-2.5 text-xs',
          verSemMeta ? 'border-amber-400/30 bg-amber-500/[0.07]' : 'border-border bg-card',
        )}>
          <Target className={cn('h-3.5 w-3.5', verSemMeta ? 'text-amber-300' : 'text-muted-foreground')} />
          <span className="text-muted-foreground">
            {verSemMeta
              ? <><strong className="text-amber-200">{semMeta.length}</strong> cliente(s) sem meta nenhuma cadastrada — configure em Cliente › Planejamento.</>
              : <><strong className="text-foreground">{semMeta.length}</strong> cliente(s) fora do Radar por não ter meta nenhuma cadastrada.</>}
          </span>
          <button
            onClick={() => { setVerSemMeta((v) => !v); setCategoria(''); setSituacao('todas'); }}
            className="rounded-lg border border-border px-3 py-1 font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            {verSemMeta ? 'Voltar ao Radar' : 'Ver quem são'}
          </button>
        </div>
      )}

      {/* ── Table ──
          Cabeçalho fixo: um único container com overflow-auto (x+y) faz o scroll
          interno da tabela — evitar overflow-x-auto isolado, que por spec do CSS
          força overflow-y:auto também e quebra o sticky do thead contra o scroll
          da página (o header "gruda" num scroll-container que nunca rola de fato). */}
      <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
        <div className="max-h-[65vh] overflow-auto">
          <table className="min-w-[1100px] w-full">
            <thead>
              <tr className="border-b border-border">
                {([
                  { label: 'CLIENTE', info: '', sort: 'cliente' as ColunaRadar, padrao: 'asc' as DirecaoOrdem },
                  { label: 'META', info: '', sort: 'meta' as ColunaRadar },
                  { label: 'RESULTADO', info: '', sort: 'resultado' as ColunaRadar },
                  { label: '%', info: '', sort: 'pct' as ColunaRadar },
                  { label: 'LEADS', info: 'Leads das PLATAFORMAS no mês: resultados do Meta Ads + conversões do Google Ads. Não é o mesmo número do funil ao lado, que conta quem entrou no CRM por qualquer caminho (WhatsApp, indicação, orgânico).', sort: 'leads' as ColunaRadar },
                  { label: 'CPL', info: 'CPL — gasto em anúncio (Meta + Google) ÷ leads do período. Menor = melhor.', sort: 'cpl' as ColunaRadar, padrao: 'asc' as DirecaoOrdem },
                  { label: 'CAC', info: 'CAC — gasto em anúncio (Meta + Google) ÷ vendas fechadas no CRM. Sem venda no período aparece "—". Menor = melhor.', sort: 'cac' as ColunaRadar, padrao: 'asc' as DirecaoOrdem },
                  { label: 'FUNIL', info: 'Funil do CRM no mês: todo lead cadastrado, venha de anúncio ou não — por isso costuma ser maior que a coluna LEADS. Ordena pelo último degrau (fechamentos).', sort: 'fechamentos' as ColunaRadar },
                  { label: 'INVESTIMENTO', info: 'Investimento — o que as contas de anúncio REALMENTE gastaram no mês (Meta + Google). É este número que divide os leads no CPL. Abaixo, o Pix já enviado ao cliente, que é outra coisa.', sort: 'investimento' as ColunaRadar },
                  { label: '', info: '' },
                ] as { label: string; info: string; sort?: ColunaRadar; padrao?: DirecaoOrdem }[]).map((col) => {
                  const ativa = col.sort && ordem.coluna === col.sort;
                  const Seta = ordem.direcao === 'asc' ? ArrowUp : ArrowDown;
                  const conteudo = (
                    <span className={cn('flex items-center gap-1', ativa && 'text-primary')} title={col.info || undefined}>
                      {col.label}
                      {col.info && <Info className="w-3 h-3 opacity-50" />}
                      {ativa && <Seta className="w-3 h-3" />}
                    </span>
                  );
                  return (
                    <th key={col.label} className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-border">
                      {col.sort ? (
                        <button
                          type="button"
                          onClick={() => setOrdem((o) => proximaOrdem(o, col.sort!, col.padrao ?? 'desc'))}
                          title={col.info || `Ordenar por ${col.label.toLowerCase()}`}
                          className="uppercase tracking-widest hover:text-foreground transition-colors"
                        >
                          {conteudo}
                        </button>
                      ) : conteudo}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loadingClients && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">Carregando clientes…</td></tr>
              )}
              {!loadingClients && base.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {verSemMeta ? 'Todos os clientes têm meta cadastrada.' : 'Nenhum cliente com meta cadastrada.'}
                </td></tr>
              )}
              {!loadingClients && base.length > 0 && linhas.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Nenhum cliente nesse recorte. <button onClick={() => { setCategoria(''); setSituacao('todas'); }} className="font-bold text-primary hover:underline">Limpar filtros</button>
                </td></tr>
              )}
              {linhas.map((row) => {
                const resultC = pctColors(row.pctResult);
                const leadsC = pctColors(row.pctLeads);
                const semMetaResultado = situacaoDaMeta(row.pctResult) === 'sem_meta';
                return (
                  <tr key={row.client.id} className={cn('border-l-[3px] hover:bg-muted/20 transition-colors', resultC.border)}>
                    <td className="px-4 py-3">
                      <Link href={`/clientes/${row.client.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <ClientAvatar clientId={row.client.id} name={row.client.name} size="sm" />
                        <div>
                          <p className="text-sm font-bold">{row.client.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{row.client.segment}</p>
                          {(compartilhaCom[row.client.id]?.length ?? 0) > 0 && (
                            <span
                              className="mt-1 inline-block rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                              title="Mesma conta de anúncio: o gasto e os leads desta linha são os da conta inteira e aparecem também no outro cliente. Nos cards do topo ela entra uma vez só."
                            >
                              conta compartilhada com {compartilhaCom[row.client.id].join(', ')}
                            </span>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold whitespace-nowrap">
                      {row.metaTarget > 0
                        ? (row.ehSocial
                            ? <>{row.metaTarget.toLocaleString('pt-BR')} <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">seguidores</span></>
                            : formatCurrencyBRL(row.metaTarget))
                        : <span className="text-muted-foreground/40">—</span>}
                      {row.ehSocial && row.metaAlcance > 0 && (
                        <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
                          {row.metaAlcance.toLocaleString('pt-BR')} de alcance
                        </p>
                      )}
                    </td>
                    {/* ⚠️ Sem meta ≠ falhou. Sem meta o valor aparece em cinza (só
                        performance) e o % vira "—" neutro — antes ia vermelho, o que
                        acusava de reprovado quem ninguém tinha medido. */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className={cn(
                        'text-sm font-bold',
                        row.resultado > 0 ? (semMetaResultado ? 'text-foreground' : resultC.text) : 'text-muted-foreground/40',
                      )}>
                        {row.resultado > 0
                          ? (row.ehSocial ? `+${row.resultado.toLocaleString('pt-BR')}` : formatCurrencyBRL(row.resultado))
                          : '—'}
                      </p>
                      {row.ehSocial && (
                        <p className={cn('mt-0.5 text-[11px] font-semibold', pctColors(row.pctAlcance).text)}>
                          {row.alcance > 0 ? row.alcance.toLocaleString('pt-BR') : '—'} de alcance
                          {row.pctAlcance !== null && <span className="ml-1 opacity-80">({row.pctAlcance}%)</span>}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {semMetaResultado ? (
                        <span className="text-sm font-bold text-muted-foreground/40" title="Sem meta definida no planejamento do cliente">—</span>
                      ) : (
                        <span className={cn('text-sm font-bold', resultC.text)}>{row.pctResult}%</span>
                      )}
                    </td>
                    <td
                      className={cn('px-4 py-3 text-sm font-bold', row.pctLeads === null ? 'text-blue-400' : leadsC.text)}
                      title={row.metaLeads > 0 ? `Meta: ${fmtLeads(row.metaLeads)} leads` : undefined}
                    >
                      {row.leads > 0 ? fmtLeads(row.leads) : '0'}
                    </td>
                    <td className="px-4 py-3">
                      <MetricCell value={row.cpl} pct={row.pctCpl} loading={loadingMetrics && !apiMetricsByClient[row.client.id]} />
                    </td>
                    <td className="px-4 py-3">
                      <MetricCell value={row.cac} pct={row.pctCac} loading={loadingMetrics && !apiMetricsByClient[row.client.id]} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-0.5">
                        {FUNNEL_KEYS.map((key, idx) => {
                          const FunnelIcon = FUNNEL_ICONS[idx];
                          const c = pctColors(row.funnelPcts[idx]);
                          const hasStageGoal = row.metaFunil[key] > 0;
                          const hasStageValue = row.funil[key] > 0;
                          return (
                            <span
                              key={key}
                              className="flex items-center gap-0.5"
                              title={hasStageGoal ? `Meta ${FUNNEL_LABELS[idx]}: ${row.metaFunil[key].toLocaleString('pt-BR')}` : undefined}
                            >
                              <span className="flex flex-col items-center min-w-[36px]">
                                <span className={cn('text-[10px] font-bold mb-0.5 tabular-nums', hasStageGoal || hasStageValue ? c.text : 'text-muted-foreground/30')}>
                                  {hasStageValue ? row.funil[key] : '—'}
                                </span>
                                <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center', hasStageGoal || hasStageValue ? 'bg-muted/40' : 'bg-muted/20')}>
                                  <FunnelIcon className={cn('w-3.5 h-3.5', hasStageGoal || hasStageValue ? c.text : 'text-muted-foreground/25')} />
                                </span>
                                <span className="text-[8px] text-muted-foreground/40 mt-0.5 whitespace-nowrap">{FUNNEL_LABELS[idx]}</span>
                              </span>
                              {idx < FUNNEL_KEYS.length - 1 && (
                                <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/20 shrink-0 mb-3" />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-bold whitespace-nowrap">{formatCurrencyBRL(row.totalInvest)}</p>
                      {/* A composição explica o CPL ao lado: é este gasto dividido pelos leads. */}
                      {row.totalInvest > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-nowrap">
                          {[row.gastoMeta > 0 ? `Meta ${formatCurrencyBRL(row.gastoMeta)}` : null,
                            row.gastoGoogle > 0 ? `Google ${formatCurrencyBRL(row.gastoGoogle)}` : null]
                            .filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {row.dispatchedInvest > 0 && (
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5 whitespace-nowrap">{formatCurrencyBRL(row.dispatchedInvest)} em Pix enviado</p>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <Link
                        href={`/clientes/${row.client.id}`}
                        aria-label={`Abrir ${row.client.name}`}
                        title={`Abrir ${row.client.name}`}
                        className="flex h-8 w-8 items-center justify-center text-muted-foreground/40 transition-colors hover:text-foreground"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
