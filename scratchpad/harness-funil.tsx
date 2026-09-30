import React, { Fragment, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronDown, BarChart3, Funnel, CircleCheck, CircleArrowUp, CircleAlert, CircleMinus, Info } from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { T } from '@/lib/dashboard-tipografia';
import { ETAPAS_FUNIL } from '@/lib/funil-etapas';
import { SUPERFICIE, GrupoTitulo } from '@/components/dashboard/superficie';
import { IconeBadge } from '@/components/dashboard/indicador-card';
import { CLASSE_STATUS_CPL, ROTULO_STATUS_CPL, TEXTO_STATUS_CPL, type StatusCpl } from '@/lib/dashboard-metas';
void Fragment; void Info; void CLASSE_STATUS_CPL; void ROTULO_STATUS_CPL;
type PremiumMetricFormat = 'currency' | 'number' | 'percent' | 'times';
function premiumValue(value: number | null | undefined, format: PremiumMetricFormat = 'number', digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (format === 'currency') return formatCurrencyBRL(value);
  if (format === 'percent') return `${value.toFixed(digits).replace('.', ',')}%`;
  if (format === 'times') return `${value.toFixed(2).replace('.', ',')}x`;
  // ⚠️ Arredonda: o formato 'number' desta tela é sempre CONTAGEM (leads,
  // cliques, impressões, alcance, pedidos) e contagem não tem casa decimal.
  //
  // O Google Ads devolve `metrics.conversions` como DOUBLE de propósito —
  // atribuição não-último-clique divide o crédito de uma conversão entre os
  // pontos de contato, então uma campanha fica com uma fração dela. Medido em
  // produção na Londrigifts: 253,998318 + 139,166666 + 6 + 26,331404 + 2 =
  // 427,496388. Somado ao Meta, o card de Leads mostrava "376,998" como se
  // fosse gente. O número é REAL; o que não fazia sentido era exibi-lo assim.
  // A precisão continua inteira em tudo que é conta (CPL, taxas, séries).
  return Math.round(value).toLocaleString('pt-BR');
}
function PremiumPanel({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={cn(SUPERFICIE, className)} style={style}>
      {children}
    </section>
  );
}
const FUNNEL_STEP_COLORS = ['#6cff2f', '#0ea5e9', '#7b2cff', '#f97316', '#ec4899', '#f59e0b', '#84cc16'];

/**
 * Semi-degrau entre duas faixas do funil — as linhas cinza da planilha do
 * Matheus (Perca · Em atendimento · Não compareceram · Faltam comparecer):
 * quem saiu ou ficou parado entre o degrau `apos` e o seguinte. O % é a fatia
 * do degrau de cima, para ler "40 dos 121 leads se perderam" de relance.
 */
type SemiDegrau = { apos: number; rotulo: string; valor: number; tom: 'ruim' | 'neutro' | 'bom' };

/** Valores do funil de UM canal, alinhados aos degraus exibidos (mesma ordem de `steps`). */
type FunilDoCanal = { canal: string; valores: number[] };

function SimpleFunnel({ steps, totalRate, fonteLabel, onStageClick, todosClicaveis, semiDegraus, porCanal }: {
  steps: Array<{
    label: string; actual: number; planned: number; color: string;
    /** Quebra explicativa (ex: quantos ainda vêm × quantos furaram). */
    detalhes?: Array<{ texto: string; tom: 'bom' | 'ruim' | 'neutro' }>;
  }>;
  /** Linhas intermediárias (planilha): viram chips na passagem logo abaixo do degrau `apos`. */
  semiDegraus?: SemiDegrau[];
  totalRate: string;
  /** De onde vem o topo ("fonte: CRM" / "estimado por anúncios" / mistas). */
  fonteLabel?: string;
  /** Abre a lista de leads do degrau. Índice mapeia em ETAPAS_FUNIL (0=contato…4=fechamento). */
  onStageClick?: (index: number) => void;
  /** Funil personalizado pelo Kanban: TODOS os degraus são clicáveis (não só os 5 semânticos). */
  todosClicaveis?: boolean;
  /** Funil de cada canal (seletor "Todos os canais" do mock). Vazio = sem seletor. */
  porCanal?: FunilDoCanal[];
}) {
  const [canal, setCanal] = useState('');
  if (!steps.length) return null;
  const filtro = canal ? porCanal?.find(c => c.canal === canal) ?? null : null;
  // Com canal escolhido os números vêm do funil daquele canal; chips, semi-degraus
  // e clique (a lista de leads não filtra por canal) ficam só em "Todos os canais".
  const valores = steps.map((st, i) => (filtro ? filtro.valores[i] ?? 0 : st.actual));
  const podeClicar = (i: number) => !filtro && !!onStageClick && (todosClicaveis || !!ETAPAS_FUNIL[i]);
  const n = steps.length;
  const taxaGeral = filtro
    ? (valores[0] > 0 ? premiumValue((valores[n - 1] / valores[0]) * 100, 'percent') : '—')
    : totalRate;
  // Forma do mock: funil CLÁSSICO, largura cai por igual a cada faixa (de 100% a ~40%);
  // o número real está escrito na faixa — a proporção de volume está nas passagens ao lado.
  const passo = 60 / n;
  const larg = (i: number) => 100 - i * passo;
  // Chips de cada passagem (i → i+1): detalhes do degrau i e semi-degraus depois dele;
  // os do último degrau vão na última passagem (a que chega nele).
  const alvo = (i: number) => Math.min(i, n - 2);
  const chipsDa = (t: number) => filtro ? [] : [
    ...(semiDegraus ?? []).filter(sd => alvo(sd.apos) === t).map(sd => ({
      texto: `${Math.round(sd.valor).toLocaleString('pt-BR')} ${sd.rotulo.toLowerCase()}`, tom: sd.tom,
    })),
    ...steps.flatMap((st, i) => (alvo(i) === t ? st.detalhes ?? [] : [])),
  ];

  return (
    <PremiumPanel className="flex flex-col p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconeBadge icone={Funnel} />
          <div className="min-w-0">
            <h3 className={T.cardTitulo}>Funil de performance</h3>
            {fonteLabel && <p className={cn('mt-1', T.cardSub)}>{fonteLabel}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#a7b0b6]" title="Último degrau ÷ topo do funil">
            Conversão geral: <b className="text-[#6cff2f]">{taxaGeral}</b>
          </span>
          {porCanal && porCanal.length > 0 && (
            <label className="relative">
              <select
                value={canal}
                onChange={e => setCanal(e.target.value)}
                className="h-10 appearance-none rounded-lg border border-white/[0.1] bg-white/[0.03] pl-4 pr-9 text-sm text-[#dce4e8] focus:outline-none"
                title="Funil só com os leads do canal escolhido (CRM)"
              >
                <option value="">Todos os canais</option>
                {porCanal.map(c => <option key={c.canal} value={c.canal}>{c.canal}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a7b0b6]" />
            </label>
          )}
        </div>
      </div>

      <div className="grid flex-1 items-stretch gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Faixas do funil */}
        <div className="flex flex-col justify-center gap-1.5">
          {steps.map((step, i) => {
            const clicavel = podeClicar(i);
            const cima = larg(i);
            const baixo = larg(i + 1);
            const cor = step.color || FUNNEL_STEP_COLORS[i % FUNNEL_STEP_COLORS.length];
            const clip = `polygon(${50 - cima / 2}% 0, ${50 + cima / 2}% 0, ${50 + baixo / 2}% 100%, ${50 - baixo / 2}% 100%)`;
            return (
              <div
                key={step.label}
                onClick={clicavel ? () => onStageClick!(i) : undefined}
                role={clicavel ? 'button' : undefined}
                tabIndex={clicavel ? 0 : undefined}
                onKeyDown={clicavel ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStageClick!(i); }
                } : undefined}
                title={clicavel ? `Ver os leads de ${step.label.toLowerCase()}` : undefined}
                className={cn('group relative h-[68px]', clicavel && 'cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6cff2f]')}
                style={{ filter: `drop-shadow(0 0 12px ${cor}55)` }}
              >
                <div
                  className={cn('absolute inset-0 transition-[filter] duration-200', clicavel && 'group-hover:brightness-125')}
                  style={{ clipPath: clip, background: `linear-gradient(180deg, ${cor} 0%, ${cor}cc 100%)` }}
                />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none">
                  <span className="font-heading text-[28px] text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.55)' }}>
                    {Math.round(valores[i]).toLocaleString('pt-BR')}
                  </span>
                  <span className="mt-1 text-xs font-black uppercase tracking-[0.06em] text-white/95" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
                    {step.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Passagens entre degraus: % de conversão, queda e chips */}
        {n > 1 && (
          <div className="relative flex flex-col rounded-xl border border-white/[0.07] bg-white/[0.015]">
            {steps.slice(1).map((step, k) => {
              const i = k + 1;
              const prev = steps[k];
              const pct = valores[k] > 0 ? (valores[i] / valores[k]) * 100 : 0;
              const plannedPct = !filtro && prev.planned > 0 ? (step.planned / prev.planned) * 100 : null;
              const gargalo = plannedPct !== null && plannedPct > 0 && pct < plannedPct * 0.85;
              const queda = pct - 100;
              const cor = step.color || FUNNEL_STEP_COLORS[i % FUNNEL_STEP_COLORS.length];
              const chips = chipsDa(k);
              return (
                <div key={step.label} className={cn('relative flex flex-1 items-center gap-4 px-4 py-3', k > 0 && 'border-t border-white/[0.06]')}>
                  {/* Linha vertical que liga os pontos (a linha do tempo do mock) */}
                  <span className={cn('absolute left-[27px] w-px bg-white/[0.1]', k === 0 ? 'top-1/2 bottom-0' : k === n - 2 ? 'top-0 bottom-1/2' : 'inset-y-0')} />
                  <span className="relative z-[1] h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: cor, boxShadow: `0 0 10px ${cor}` }} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className={cn('font-heading text-2xl leading-none tabular-nums', gargalo ? 'text-red-400' : 'text-[#6cff2f]')} title="Conversão do degrau anterior para este">
                        {valores[k] > 0 ? `${pct.toFixed(1).replace('.', ',')}%` : '—'}
                      </span>
                      {plannedPct !== null && plannedPct > 0 && (
                        <span className={T.nota} title="Conversão planejada para este degrau">meta {plannedPct.toFixed(0)}%</span>
                      )}
                      {gargalo && <span className="text-[11px] font-black text-red-400" title="Abaixo de 85% da conversão planejada">⚠ gargalo</span>}
                    </p>
                    <p className="mt-1 text-sm text-[#c7d0d5]">de {prev.label.toLowerCase()} para {step.label.toLowerCase()}</p>
                    {chips.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {chips.map(d => (
                          <span
                            key={d.texto}
                            className={cn(
                              'rounded px-1.5 py-px text-[10px] font-bold leading-tight',
                              d.tom === 'bom' ? 'bg-[#6cff2f]/12 text-[#6cff2f]'
                                : d.tom === 'ruim' ? 'bg-red-400/12 text-red-400'
                                : 'bg-white/[0.06] text-[#9aa4aa]',
                            )}
                          >
                            {d.texto}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {valores[k] > 0 && (
                    <span
                      className={cn('shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold tabular-nums', queda < 0 ? 'bg-red-500/[0.14] text-red-400' : 'bg-white/[0.06] text-[#dce4e8]')}
                      title="Quanto caiu (ou subiu) em relação ao degrau anterior"
                    >
                      {queda > 0 ? '+' : ''}{queda.toFixed(1).replace('.', ',')}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PremiumPanel>
  );
}

/** Selo de CPL contra a meta (régua única: dashboard-metas.ts). */
function StatusCplPill({ status, titulo }: { status: StatusCpl; titulo?: string }) {
  return (
    <span className={cn('whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-[0.04em]', CLASSE_STATUS_CPL[status])} title={titulo}>
      {ROTULO_STATUS_CPL[status]}
    </span>
  );
}

type LinhaCanal = {
  channel: string; logo: ReactNode;
  investment: string; impressions: string; clicks: string; ctr: string; cpc: string; cpm: string;
  leads: string; cpl: string; cplNum: number; status: StatusCpl;
};

/** Cartão de status do CPL (mock): ícone em círculo + rótulo + explicação. */
const STATUS_CPL_CARTAO: Record<StatusCpl, { icone: React.ElementType; rotulo: string; sub: string; cor: string }> = {
  na_meta: { icone: CircleCheck, rotulo: 'Bom', sub: 'Abaixo da meta', cor: '#6cff2f' },
  atencao: { icone: CircleAlert, rotulo: 'Atenção', sub: 'Perto da meta', cor: '#f5b83d' },
  acima: { icone: CircleArrowUp, rotulo: 'Acima', sub: 'Acima da meta', cor: '#ff5a5a' },
  sem_meta: { icone: CircleMinus, rotulo: 'Sem meta', sub: 'Cadastre no planejamento', cor: '#a7b0b6' },
  sem_lead: { icone: CircleArrowUp, rotulo: 'Sem lead', sub: 'Gastou 2× a meta', cor: '#ff5a5a' },
  sem_lead_baixo: { icone: CircleMinus, rotulo: 'Sem lead', sub: 'Pouco gasto ainda', cor: '#a7b0b6' },
  sem_dado: { icone: CircleMinus, rotulo: '—', sub: 'Sem investimento', cor: '#7c868c' },
};

function CartaoStatusCpl({ status, titulo }: { status: StatusCpl; titulo?: string }) {
  const c = STATUS_CPL_CARTAO[status];
  const Icone = c.icone;
  return (
    <span className="inline-flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left" style={{ background: `${c.cor}14`, boxShadow: `inset 0 0 0 1px ${c.cor}2e` }} title={titulo}>
      <Icone className="h-7 w-7 shrink-0" style={{ color: c.cor }} />
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-bold" style={{ color: c.cor === '#a7b0b6' || c.cor === '#7c868c' ? '#dce4e8' : c.cor }}>{c.rotulo}</span>
        <span className="block truncate text-[11px] text-[#a7b0b6]">{c.sub}</span>
      </span>
    </span>
  );
}

/**
 * Resumo por Canal (mock de 24/09) — TRANSPOSTO: métricas nas linhas, canais (+ Total)
 * nas colunas; cabeçalho em faixa, rótulos em caixa normal, CPL colorido pelo status e
 * a última linha com cartões de status do CPL contra a meta do planejamento.
 */
function ChannelSummaryTable({ rows, total, metaCpl }: {
  rows: LinhaCanal[];
  total: LinhaCanal;
  metaCpl: number;
}) {
  // ⚠️ A linha "Conversão" saiu: dividia leads do Meta pelo ALCANCE e
  // conversões do Google pelos CLIQUES — duas taxas sem relação lado a lado.
  const colunas = [...rows, total];
  const metricas: Array<{ rotulo: string; valor: (l: LinhaCanal) => ReactNode }> = [
    { rotulo: 'Investimento', valor: l => l.investment },
    { rotulo: 'Impressões', valor: l => l.impressions },
    { rotulo: 'Cliques', valor: l => l.clicks },
    { rotulo: 'CTR', valor: l => l.ctr },
    { rotulo: 'CPC', valor: l => l.cpc },
    // CPM logo acima de Leads (pedido do Matheus, 2026-09-24): CPL subindo com CPM
    // estável é criativo; com CPM subindo é leilão.
    { rotulo: 'CPM', valor: l => l.cpm },
    { rotulo: 'Leads', valor: l => l.leads },
    { rotulo: 'CPL', valor: l => <span className={cn('font-bold', TEXTO_STATUS_CPL[l.status])}>{l.cpl}</span> },
  ];
  return (
    <PremiumPanel className="flex flex-col p-5">
      <div className="mb-5 flex items-center gap-3">
        <IconeBadge icone={BarChart3} />
        <div className="min-w-0">
          <h3 className={T.cardTitulo}>Resumo por canal</h3>
          <p className={cn('mt-1', T.cardSub)}>Meta Ads, Google Ads e o total no período.</p>
        </div>
      </div>
      <div className="flex-1 overflow-x-auto">
        <table className="w-full min-w-[440px] text-left text-sm tabular-nums">
          <thead>
            <tr className="bg-white/[0.04] text-[11px] font-black uppercase tracking-[0.08em] text-[#a7b0b6]">
              <th className="rounded-l-lg py-2.5 pl-4 pr-2">Métrica</th>
              {colunas.map((c, i) => (
                <th key={c.channel} className={cn('py-2.5 pl-3 pr-4 text-right', i === colunas.length - 1 && 'rounded-r-lg')}>
                  <span className="inline-flex items-center justify-end gap-1.5">{c.logo}{c.channel}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {metricas.map(m => (
              <tr key={m.rotulo}>
                <td className="py-2.5 pl-4 pr-2 font-semibold text-[#dce4e8]">{m.rotulo}</td>
                {colunas.map(c => (
                  <td key={c.channel} className="whitespace-nowrap py-2.5 pl-3 pr-4 text-right text-[#f4f7f8]">{m.valor(c)}</td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="py-3 pl-4 pr-2 font-semibold text-[#dce4e8]">
                Status CPL
                {metaCpl > 0 && <span className="block text-[11px] font-normal text-[#7c868c]">meta {premiumValue(metaCpl, 'currency')}</span>}
              </td>
              {colunas.map(c => (
                <td key={c.channel} className="py-3 pl-3 pr-2">
                  <CartaoStatusCpl
                    status={c.status}
                    titulo={metaCpl > 0 && c.cplNum > 0 ? `${(c.cplNum / metaCpl).toFixed(2).replace('.', ',')}× a meta de CPL` : undefined}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </PremiumPanel>
  );
}

function TituloSecao({ titulo, sub, direita }: { titulo: string; sub?: string; direita?: ReactNode }) {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="h-8 w-1.5 rounded-full bg-[#6cff2f]" />
      <h2 className={T.secao}>{titulo}</h2>
      {sub && <span className={T.secaoSub}>{sub}</span>}
      <span className="h-px min-w-[40px] flex-1 bg-white/[0.08]" />
      {direita}
    </div>
  );
}
const Meta = () => <span style={{color:'#168BFF',fontWeight:900}}>∞</span>;
const G = () => <span style={{color:'#4285F4',fontWeight:900}}>G</span>;
const steps = [
  { label: 'Leads', actual: 168, planned: 0, color: '#7dd3fc', detalhes: [{ texto: '38 sem resposta', tom: 'neutro' as const }] },
  { label: 'Engajados', actual: 70, planned: 0, color: '#0ea5e9' },
  { label: 'Negociação', actual: 67, planned: 0, color: '#8b5cf6', detalhes: [{ texto: '53 sem data', tom: 'neutro' as const }, { texto: '100% compareceram', tom: 'bom' as const }] },
  { label: 'Visita/Reunião', actual: 14, planned: 0, color: '#f59e0b' },
  { label: 'Fechado', actual: 14, planned: 0, color: '#10b981', detalhes: [{ texto: '14 de leads do período', tom: 'bom' as const }, { texto: '11 de leads anteriores', tom: 'neutro' as const }] },
];
const semis: SemiDegrau[] = [
  { apos: 0, rotulo: 'Perca', valor: 0, tom: 'ruim' }, { apos: 1, rotulo: 'Em atendimento', valor: 3, tom: 'neutro' },
  { apos: 2, rotulo: 'Não compareceram', valor: 0, tom: 'ruim' }, { apos: 3, rotulo: 'Faltam comparecer', valor: 0, tom: 'bom' },
];
const porCanal = [{ canal: 'Google', valores: [80, 40, 38, 9, 9] }, { canal: 'Instagram', valores: [60, 22, 21, 4, 4] }];
const linha = (channel: string, logo: ReactNode, inv: string, imp: string, cli: string, ctr: string, cpc: string, cpm: string, leads: string, cpl: string, cplNum: number, status: StatusCpl): LinhaCanal => ({ channel, logo, investment: inv, impressions: imp, clicks: cli, ctr, cpc, cpm, leads, cpl, cplNum, status });
function App() {
  return (
    <div style={{ padding: 24, background: '#05090B' }} className="flex flex-col gap-4">
      <TituloSecao titulo="Mídia paga" sub="Meta Ads e Google Ads" />
      <GrupoTitulo titulo="Campanhas na página" sub="o que o GA4 viu de cada campanha e palavra-chave" />
      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <SimpleFunnel steps={steps} totalRate="8,33%" fonteLabel="fonte: CRM" onStageClick={() => {}} todosClicaveis semiDegraus={semis} porCanal={porCanal} />
        <ChannelSummaryTable metaCpl={7} rows={[
          linha('Meta Ads', <Meta />, 'R$ 1.212,01', '82.971', '2.236', '2,69%', 'R$ 0,54', 'R$ 14,61', '120', 'R$ 10,10', 10.1, 'atencao'),
          linha('Google Ads', <G />, 'R$ 818,78', '3.825', '493', '12,89%', 'R$ 1,66', 'R$ 214,06', '16', 'R$ 51,17', 51.17, 'acima'),
        ]} total={linha('Total', null, 'R$ 2.030,79', '86.796', '2.729', '3,14%', 'R$ 0,74', 'R$ 23,40', '136', 'R$ 14,93', 14.93, 'acima')} />
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
