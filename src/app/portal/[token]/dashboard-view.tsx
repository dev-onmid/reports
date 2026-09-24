'use client';

// ── Portal do cliente: a dashboard ───────────────────────────────────────────
//
// Alimentada pelas MESMAS rotas da dashboard interna, através da ponte por
// token (src/lib/portal-dados.ts). Nenhum número é recalculado aqui: se esta
// tela somasse por conta própria, o cliente e a agência veriam valores
// diferentes e a conversa viraria sobre qual das duas está certa.
//
// Cada bloco carrega e falha SOZINHO. Uma conta de anúncio com token vencido
// derruba só o bloco de mídia; o resto da página fica de pé. É o mesmo
// comportamento da dashboard interna — faltar um bloco é melhor que uma tela
// inteira de erro para o cliente.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Donut } from '@/components/dashboard/donut';
import {
  BadgeDollarSign, BarChart3, Users, MousePointerClick, Target, TrendingUp,
  Globe, Megaphone, ShoppingBag, Eye, RefreshCw,
} from 'lucide-react';

// ── Paleta do portal (não é a da dashboard interna: superfície mais clara e
//    layout de leitura, não de operação) ──────────────────────────────────────
const CARD = '#17181d';
const BORDA = '#22242a';
const VERDE = '#55f52f';
const AZUL = '#3ba9f2';
const ROXO = '#a855f7';
const LARANJA = '#f2a93c';
const MUDO = '#8a9188';
const PALETA = [VERDE, AZUL, ROXO, LARANJA, '#ec4899', '#14b8a6'];

// ── Tipos das fontes (shape real, conferido contra a produção) ───────────────
type Metricas = {
  google: { cost: number; impressions: number; clicks: number; conversions: number; cpc: number; cpa: number } | null;
  meta: { spend: number; reach: number; impressions: number; clicks: number; leads: number; conversations: number; cpl: number } | null;
  crm: { revenue: number; sales: number; leads: number; ticket: number } | null;
  daily: Array<{
    date: string;
    google?: { cost: number; clicks: number; conversions: number };
    meta?: { spend: number; clicks: number; leads: number };
    crm?: { revenue: number; sales: number; leads: number };
  }>;
};
type Campanha = {
  id: string; name: string; platform: string; status: string; objective: string;
  spend: number; impressions: number; clicks: number; leads: number; cpl: number; ctr: number;
};
type Degrau = { label: string; color: string; index: number; alcancaram: number; atuais: number };
type FunilCliente = {
  funil: { contatos: number; qualificados: number; agendamentos: number; comparecimentos: number; fechamentos: number; receita: number };
  funilStages: { degraus: Degrau[] } | null;
};
type Canais = {
  leads?: Array<{ label: string; leads: number }>;
  origens?: Array<{ label: string; valor: number }>;
  total?: number; leadsTotal?: number;
};
type Comercial = {
  vendedores: Array<{ responsavel: string; ganhos: number; ganhos_valor: number; perdidos: number; novos: number }>;
  categorias: Array<{ label: string; itens: number; valor: number }>;
};
type Instagram = {
  username: string; picture?: string; followers: number; followersGained: number;
  reach: number; views: number; profileViews: number; accountsEngaged: number; totalInteractions: number;
};
type Ga4Janela = { sessoes: number; usuarios: number; novos: number; engajadas: number; contatos: number; taxaContato: number };
type Ga4 = {
  atual: Ga4Janela; anterior?: Ga4Janela;
  origens?: Array<{ origem: string; midia: string; sessoes: number; contatos: number }>;
  audiencia?: { dispositivos?: Array<{ valor: string; sessoes: number }> };
};
type Criativo = { ad_key: string; ad_name: string | null; campaign_name: string | null; leads: number; vendas: number; receita: number };

// ── Período ──────────────────────────────────────────────────────────────────
const PERIODOS = [
  { id: 'last_7d', rotulo: '7 dias' },
  { id: 'last_30d', rotulo: '30 dias' },
  { id: 'this_month', rotulo: 'Mês atual' },
  { id: 'last_month', rotulo: 'Mês passado' },
] as const;
type PeriodoId = (typeof PERIODOS)[number]['id'];

function iso(d: Date) { return d.toISOString().slice(0, 10); }

/** Janela local em BRT-ish: as rotas do CRM exigem from/to, as de mídia usam
 *  `period`. Mandamos os dois e cada fonte pega o que entende. */
function janelaDe(p: PeriodoId): { from: string; to: string } {
  const hoje = new Date();
  if (p === 'this_month') {
    return { from: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), to: iso(hoje) };
  }
  if (p === 'last_month') {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return { from: iso(ini), to: iso(fim) };
  }
  const dias = p === 'last_7d' ? 7 : 30;
  const ini = new Date(hoje); ini.setDate(ini.getDate() - (dias - 1));
  return { from: iso(ini), to: iso(hoje) };
}

// ── Formatação ───────────────────────────────────────────────────────────────
const nf = new Intl.NumberFormat('pt-BR');
const cf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function brl(v: number) { return cf.format(v); }
function num(v: number) { return nf.format(Math.round(v)); }
function pct(v: number) { return `${(v * 100).toFixed(1).replace('.', ',')}%`; }
/** Sem denominador o certo é travessão, nunca 0% — zero afirmaria que houve
 *  medição e deu zero. */
function razao(a: number, b: number, fmt: (n: number) => string) { return b > 0 ? fmt(a / b) : '—'; }

// ── Peças visuais ────────────────────────────────────────────────────────────
function Secao({ titulo, sub }: { titulo: string; sub?: string }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline gap-2 first:mt-0">
      <h2 className="text-sm font-black uppercase tracking-wide text-white">{titulo}</h2>
      {sub && <span className="text-[11px] text-[#8a9188]">{sub}</span>}
    </div>
  );
}

function Bloco({ titulo, icone: Icone, cor = VERDE, direita, children }: {
  titulo?: string; icone?: React.ElementType; cor?: string;
  direita?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border p-4" style={{ borderColor: BORDA, background: CARD }}>
      {titulo && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: MUDO }}>
            {Icone && <Icone className="h-3.5 w-3.5" style={{ color: cor }} />} {titulo}
          </p>
          {direita}
        </div>
      )}
      {children}
    </section>
  );
}

function Kpi({ rotulo, valor, sub, icone: Icone, cor = VERDE }: {
  rotulo: string; valor: string; sub?: string; icone: React.ElementType; cor?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border p-3.5" style={{ borderColor: BORDA, background: CARD }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: MUDO }}>{rotulo}</p>
        <Icone className="h-3.5 w-3.5 shrink-0" style={{ color: cor }} />
      </div>
      <p className="mt-1.5 truncate text-lg font-bold tabular-nums" style={{ color: cor }} title={valor}>{valor}</p>
      {sub && <p className="mt-0.5 truncate text-[10px]" style={{ color: MUDO }}>{sub}</p>}
    </div>
  );
}

/** Ranking simples. Barra (não donut) porque aqui a leitura é de ordem, não de
 *  composição. */
function Barras({ itens, formatar, cor = VERDE }: {
  itens: Array<{ label: string; valor: number }>; formatar: (n: number) => string; cor?: string;
}) {
  const max = Math.max(1, ...itens.map(i => i.valor));
  return (
    <div className="space-y-2">
      {itens.map(i => (
        <div key={i.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-xs font-semibold text-[#c9cec7] sm:w-40" title={i.label}>{i.label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: '#22242a' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, (i.valor / max) * 100)}%`, background: cor }} />
          </div>
          <span className="w-16 shrink-0 text-right text-xs font-bold tabular-nums text-white">{formatar(i.valor)}</span>
        </div>
      ))}
    </div>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-xs" style={{ color: MUDO }}>{children}</p>;
}

// ── Página ───────────────────────────────────────────────────────────────────
export function DashboardPortal({ token }: { token: string }) {
  const [periodo, setPeriodo] = useState<PeriodoId>('last_30d');
  const [carregando, setCarregando] = useState(true);

  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [campanhas, setCampanhas] = useState<Campanha[] | null>(null);
  const [funil, setFunil] = useState<FunilCliente | null>(null);
  const [canais, setCanais] = useState<Canais | null>(null);
  const [comercial, setComercial] = useState<Comercial | null>(null);
  const [ig, setIg] = useState<Instagram | null>(null);
  const [ga4, setGa4] = useState<Ga4 | null>(null);
  const [criativos, setCriativos] = useState<Criativo[] | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { from, to } = janelaDe(periodo);
    const qs = new URLSearchParams({ period: periodo, from, to, dateFrom: from, dateTo: to });
    const buscar = async <T,>(r: string): Promise<T | null> => {
      try {
        const res = await fetch(`/api/portal/${token}/dados?r=${r}&${qs}`);
        if (!res.ok) return null;
        return (await res.json()) as T;
      } catch { return null; }
    };

    // Todas em paralelo: um bloco lento não segura os outros na tela.
    const [m, c, f, k, cm, s, g, cr] = await Promise.all([
      buscar<Metricas>('metricas'),
      buscar<Campanha[]>('campanhas'),
      buscar<FunilCliente[]>('funil'),
      buscar<Canais>('canais'),
      buscar<Comercial>('comercial'),
      buscar<Array<{ instagram: Instagram | null }>>('social'),
      buscar<{ ga4: Ga4 | null }>('landing'),
      buscar<{ creatives: Criativo[] }>('criativos'),
    ]);

    setMetricas(m);
    setCampanhas(Array.isArray(c) ? c : null);
    setFunil(Array.isArray(f) && f.length ? f[0] : null);
    setCanais(k);
    setComercial(cm);
    setIg(Array.isArray(s) && s.length ? s[0]?.instagram ?? null : null);
    setGa4(g?.ga4 ?? null);
    setCriativos(cr?.creatives ?? null);
    setCarregando(false);
  }, [token, periodo]);

  useEffect(() => { void carregar(); }, [carregar]);

  // ── Números do topo ────────────────────────────────────────────────────────
  const inv = (metricas?.meta?.spend ?? 0) + (metricas?.google?.cost ?? 0);
  const leadsMidia = (metricas?.meta?.leads ?? 0) + (metricas?.google?.conversions ?? 0);
  const cliques = (metricas?.meta?.clicks ?? 0) + (metricas?.google?.clicks ?? 0);
  const impressoes = (metricas?.meta?.impressions ?? 0) + (metricas?.google?.impressions ?? 0);
  const receita = metricas?.crm?.revenue ?? 0;
  const vendas = metricas?.crm?.sales ?? 0;

  const serie = useMemo(() => (metricas?.daily ?? []).map(d => ({
    dia: d.date.slice(8, 10) + '/' + d.date.slice(5, 7),
    investimento: (d.meta?.spend ?? 0) + (d.google?.cost ?? 0),
    leads: (d.meta?.leads ?? 0) + (d.google?.conversions ?? 0),
  })), [metricas]);

  const temMidia = inv > 0 || (campanhas?.length ?? 0) > 0;
  const degraus = funil?.funilStages?.degraus ?? [];
  const dispositivos = ga4?.audiencia?.dispositivos ?? [];

  if (carregando && !metricas) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-24 animate-pulse rounded-xl" style={{ background: CARD }} />)}
      </div>
    );
  }

  return (
    <div>
      {/* Período */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: BORDA, background: CARD }}>
          {PERIODOS.map(p => (
            <button key={p.id} onClick={() => setPeriodo(p.id)}
              className="rounded-md px-2.5 py-1 text-xs font-bold transition-colors"
              style={periodo === p.id ? { background: VERDE, color: '#000' } : { color: '#9aa1a6' }}>
              {p.rotulo}
            </button>
          ))}
        </div>
        <button onClick={() => void carregar()} className="rounded-lg border p-1.5 transition-colors hover:text-white"
          style={{ borderColor: BORDA, color: '#9aa1a6' }} aria-label="Atualizar">
          <RefreshCw className={`h-3.5 w-3.5 ${carregando ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Resultado ───────────────────────────────────────────────────────── */}
      <Secao titulo="Resultado" sub="o que o investimento gerou" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Investimento" valor={inv > 0 ? brl(inv) : '—'} icone={BadgeDollarSign} cor={LARANJA} />
        <Kpi rotulo="Leads" valor={leadsMidia > 0 ? num(leadsMidia) : '—'} icone={Users} cor={VERDE} />
        <Kpi rotulo="Custo por lead" valor={razao(inv, leadsMidia, brl)} icone={Target} cor={AZUL} />
        <Kpi rotulo="Cliques" valor={cliques > 0 ? num(cliques) : '—'} sub={impressoes > 0 ? `${num(impressoes)} impressões` : undefined} icone={MousePointerClick} cor={AZUL} />
        <Kpi rotulo="Faturamento" valor={receita > 0 ? brl(receita) : '—'} sub={vendas > 0 ? `${num(vendas)} venda${vendas !== 1 ? 's' : ''}` : undefined} icone={TrendingUp} cor={VERDE} />
        <Kpi rotulo="Ticket médio" valor={razao(receita, vendas, brl)} icone={ShoppingBag} cor={ROXO} />
      </div>

      {serie.length > 1 && (
        <div className="mt-3">
          <Bloco titulo="Dia a dia" icone={BarChart3}>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gInv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={LARANJA} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={LARANJA} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fill: '#9aa4aa', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis yAxisId="l" tick={{ fill: '#9aa4aa', fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fill: '#9aa4aa', fontSize: 10 }} tickLine={false} axisLine={false} width={34} />
                  <Tooltip
                    contentStyle={{ background: '#0b1216', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: '#f4f7f8' }}
                    formatter={(v, n) => [n === 'investimento' ? brl(Number(v)) : num(Number(v)), n === 'investimento' ? 'Investimento' : 'Leads']}
                  />
                  <Area yAxisId="l" type="monotone" dataKey="investimento" stroke={LARANJA} strokeWidth={2} fill="url(#gInv)" isAnimationActive={false} />
                  <Line yAxisId="r" type="monotone" dataKey="leads" stroke={VERDE} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Bloco>
        </div>
      )}

      {/* ── Mídia paga ──────────────────────────────────────────────────────── */}
      {temMidia && (
        <>
          <Secao titulo="Mídia paga" sub="Meta Ads e Google Ads" />
          <div className="space-y-3">
            <Bloco titulo="Campanhas" icone={Megaphone}>
              {!campanhas?.length ? <Vazio>Nenhuma campanha no período.</Vazio> : (
                <>
                {/* Celular: um cartão por campanha. A tabela rolando de lado é
                    o jeito mais rápido de o cliente desistir da tela — e é no
                    celular que ele abre o link. */}
                <div className="space-y-2 sm:hidden">
                  {[...campanhas].sort((a, b) => b.spend - a.spend).map(c => (
                    <div key={`m-${c.platform}-${c.id}`} className="rounded-lg border p-3" style={{ borderColor: BORDA }}>
                      <p className="truncate text-xs font-bold text-white" title={c.name}>{c.name}</p>
                      <p className="mt-0.5 text-[10px]" style={{ color: MUDO }}>
                        {c.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}
                        {c.status && c.status !== 'ACTIVE' && c.status !== 'ENABLED' ? ' · pausada' : ''}
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        {[
                          { r: 'Investido', v: brl(c.spend), cor: '#fff' },
                          { r: 'Leads', v: num(c.leads), cor: '#fff' },
                          { r: 'Custo/lead', v: razao(c.spend, c.leads, brl), cor: c.leads > 0 ? VERDE : MUDO },
                        ].map(x => (
                          <div key={x.r}>
                            <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: MUDO }}>{x.r}</p>
                            <p className="truncate text-xs font-bold tabular-nums" style={{ color: x.cor }}>{x.v}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden sm:block">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: MUDO }} className="text-left text-[10px] font-bold uppercase tracking-wider">
                        <th className="px-1 pb-2">Campanha</th>
                        <th className="px-1 pb-2 text-right">Investido</th>
                        <th className="px-1 pb-2 text-right">Leads</th>
                        <th className="px-1 pb-2 text-right">Custo/lead</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...campanhas].sort((a, b) => b.spend - a.spend).map(c => (
                        <tr key={`${c.platform}-${c.id}`} className="border-t" style={{ borderColor: BORDA }}>
                          <td className="max-w-[240px] px-1 py-2">
                            <p className="truncate font-semibold text-white" title={c.name}>{c.name}</p>
                            <p className="text-[10px]" style={{ color: MUDO }}>
                              {c.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}
                              {c.status && c.status !== 'ACTIVE' && c.status !== 'ENABLED' ? ' · pausada' : ''}
                            </p>
                          </td>
                          <td className="px-1 py-2 text-right tabular-nums text-white">{brl(c.spend)}</td>
                          <td className="px-1 py-2 text-right tabular-nums text-white">{num(c.leads)}</td>
                          <td className="px-1 py-2 text-right tabular-nums" style={{ color: c.leads > 0 ? VERDE : MUDO }}>
                            {razao(c.spend, c.leads, brl)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </Bloco>

            {!!criativos?.length && (
              <Bloco titulo="Anúncios com mais resultado" icone={Eye}>
                <Barras
                  itens={[...criativos].sort((a, b) => b.leads - a.leads).slice(0, 6)
                    .map(c => ({ label: c.ad_name ?? c.ad_key, valor: c.leads }))}
                  formatar={num}
                />
              </Bloco>
            )}
          </div>
        </>
      )}

      {/* ── Landing page ────────────────────────────────────────────────────── */}
      {ga4?.atual && (
        <>
          <Secao titulo="Landing page" sub="o que acontece depois do clique" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi rotulo="Sessões" valor={num(ga4.atual.sessoes)} icone={Globe} cor={AZUL} />
            <Kpi rotulo="Pessoas" valor={num(ga4.atual.usuarios)} sub={`${num(ga4.atual.novos)} novas`} icone={Users} cor={AZUL} />
            <Kpi rotulo="Engajaram" valor={razao(ga4.atual.engajadas, ga4.atual.sessoes, pct)} icone={MousePointerClick} cor={ROXO} />
            <Kpi rotulo="Contatos" valor={num(ga4.atual.contatos)} sub={ga4.atual.sessoes > 0 ? `${pct(ga4.atual.contatos / ga4.atual.sessoes)} das sessões` : undefined} icone={Target} cor={VERDE} />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {dispositivos.length > 0 && (
              <Bloco titulo="Por dispositivo" icone={BarChart3}>
                <div className="flex flex-wrap items-center justify-center gap-5">
                  <Donut
                    tamanho={150} espessura={26} corSuperficie={CARD}
                    centroTitulo="Sessões" centroValor={num(dispositivos.reduce((a, d) => a + d.sessoes, 0))}
                    formatar={num}
                    fatias={dispositivos.slice(0, 5).map((d, i) => ({
                      label: d.valor === 'mobile' ? 'Celular' : d.valor === 'desktop' ? 'Computador' : d.valor,
                      valor: d.sessoes, cor: PALETA[i % PALETA.length],
                    }))}
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {dispositivos.slice(0, 5).map((d, i) => (
                      <div key={d.valor} className="flex items-center gap-2 text-xs">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PALETA[i % PALETA.length] }} />
                        <span className="min-w-0 flex-1 truncate text-[#c9cec7]">
                          {d.valor === 'mobile' ? 'Celular' : d.valor === 'desktop' ? 'Computador' : d.valor}
                        </span>
                        <span className="tabular-nums font-bold text-white">{num(d.sessoes)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Bloco>
            )}
            {!!ga4.origens?.length && (
              <Bloco titulo="De onde vieram" icone={Globe}>
                <Barras
                  cor={AZUL}
                  itens={ga4.origens.slice(0, 6).map(o => ({
                    label: `${o.origem}${o.midia && o.midia !== '(none)' ? ` · ${o.midia}` : ''}`, valor: o.sessoes,
                  }))}
                  formatar={num}
                />
              </Bloco>
            )}
          </div>
        </>
      )}

      {/* ── Social ──────────────────────────────────────────────────────────── */}
      {ig && (
        <>
          <Secao titulo="Social" sub="Instagram orgânico" />
          <Bloco>
            <div className="mb-4 flex items-center gap-3">
              {ig.picture && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ig.picture} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" loading="lazy" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">@{ig.username}</p>
                <p className="text-[11px]" style={{ color: MUDO }}>
                  {num(ig.followers)} seguidores
                  {ig.followersGained ? ` · ${ig.followersGained > 0 ? '+' : ''}${num(ig.followersGained)} no período` : ''}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi rotulo="Alcance" valor={num(ig.reach)} icone={Eye} cor={ROXO} />
              <Kpi rotulo="Visualizações" valor={num(ig.views)} icone={BarChart3} cor={ROXO} />
              <Kpi rotulo="Interações" valor={num(ig.totalInteractions)} icone={MousePointerClick} cor={AZUL} />
              <Kpi rotulo="Visitas ao perfil" valor={num(ig.profileViews)} icone={Users} cor={AZUL} />
            </div>
          </Bloco>
        </>
      )}

      {/* ── Comercial ───────────────────────────────────────────────────────── */}
      {(degraus.length > 0 || !!canais?.leads?.length || !!comercial?.vendedores?.length) && (
        <>
          <Secao titulo="Comercial" sub="o que aconteceu com os contatos" />
          <div className="space-y-3">
            {degraus.length > 0 && (
              <Bloco titulo="Funil" icone={TrendingUp}>
                {/* Funil em trapézios: a largura é proporcional ao degrau, com
                    piso visual para o último degrau não sumir. */}
                <div className="space-y-1.5">
                  {degraus.map(d => {
                    const topo = degraus[0]?.alcancaram || 1;
                    const largura = Math.max(26, Math.round((d.alcancaram / topo) * 100));
                    return (
                      <div key={`${d.index}-${d.label}`} className="flex flex-col items-center">
                        <div className="flex h-10 items-center justify-between gap-3 rounded-md px-3 transition-all"
                          style={{ width: `${largura}%`, background: `${d.color}22`, border: `1px solid ${d.color}55` }}>
                          <span className="min-w-0 truncate text-[11px] font-bold text-white" title={d.label}>{d.label}</span>
                          <span className="shrink-0 text-sm font-black tabular-nums" style={{ color: d.color }}>{num(d.alcancaram)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Bloco>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              {!!canais?.leads?.length && (
                <Bloco titulo="Leads por canal" icone={Users}>
                  <div className="flex flex-wrap items-center justify-center gap-5">
                    <Donut
                      tamanho={150} espessura={26} corSuperficie={CARD}
                      centroTitulo="Leads" centroValor={num(canais.leads.reduce((a, c) => a + c.leads, 0))}
                      formatar={num}
                      fatias={canais.leads.slice(0, 5).map((c, i) => ({ label: c.label, valor: c.leads, cor: PALETA[i % PALETA.length] }))}
                    />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {canais.leads.slice(0, 6).map((c, i) => (
                        <div key={c.label} className="flex items-center gap-2 text-xs">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PALETA[i % PALETA.length] }} />
                          <span className="min-w-0 flex-1 truncate text-[#c9cec7]" title={c.label}>{c.label}</span>
                          <span className="tabular-nums font-bold text-white">{num(c.leads)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Bloco>
              )}

              {!!canais?.origens?.length && (
                <Bloco titulo="Faturamento por canal" icone={BadgeDollarSign} cor={LARANJA}>
                  <Barras cor={LARANJA} formatar={brl}
                    itens={canais.origens.slice(0, 6).map(o => ({ label: o.label, valor: o.valor }))} />
                </Bloco>
              )}
            </div>

            {!!comercial?.vendedores?.length && (
              <Bloco titulo="Quem atendeu" icone={Users}>
                <div className="space-y-2 sm:hidden">
                  {[...comercial.vendedores].sort((a, b) => b.ganhos_valor - a.ganhos_valor).map(v => (
                    <div key={`m-${v.responsavel}`} className="rounded-lg border p-3" style={{ borderColor: BORDA }}>
                      <p className="truncate text-xs font-bold text-white" title={v.responsavel}>{v.responsavel}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        {[
                          { r: 'Ganhos', v: num(v.ganhos), cor: '#fff' },
                          { r: 'Faturado', v: v.ganhos_valor > 0 ? brl(v.ganhos_valor) : '—', cor: v.ganhos_valor > 0 ? VERDE : MUDO },
                          { r: 'Novos', v: num(v.novos), cor: '#fff' },
                        ].map(x => (
                          <div key={x.r}>
                            <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: MUDO }}>{x.r}</p>
                            <p className="truncate text-xs font-bold tabular-nums" style={{ color: x.cor }}>{x.v}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden sm:block">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: MUDO }} className="text-left text-[10px] font-bold uppercase tracking-wider">
                        <th className="px-1 pb-2">Responsável</th>
                        <th className="px-1 pb-2 text-right">Ganhos</th>
                        <th className="px-1 pb-2 text-right">Faturado</th>
                        <th className="px-1 pb-2 text-right">Novos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...comercial.vendedores].sort((a, b) => b.ganhos_valor - a.ganhos_valor).map(v => (
                        <tr key={v.responsavel} className="border-t" style={{ borderColor: BORDA }}>
                          <td className="max-w-[200px] truncate px-1 py-2 font-semibold text-white" title={v.responsavel}>{v.responsavel}</td>
                          <td className="px-1 py-2 text-right tabular-nums text-white">{num(v.ganhos)}</td>
                          <td className="px-1 py-2 text-right tabular-nums" style={{ color: v.ganhos_valor > 0 ? VERDE : MUDO }}>
                            {v.ganhos_valor > 0 ? brl(v.ganhos_valor) : '—'}
                          </td>
                          <td className="px-1 py-2 text-right tabular-nums text-white">{num(v.novos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Perdidos e novos são estimativa digitada no CRM, não receita
                    — por isso só a coluna de ganhos aparece em dinheiro. */}
                <p className="mt-2 text-[10px]" style={{ color: MUDO }}>
                  Faturado conta só negócio ganho no período.
                </p>
              </Bloco>
            )}
          </div>
        </>
      )}

      {!temMidia && !ga4?.atual && !ig && degraus.length === 0 && !carregando && (
        <Bloco><Vazio>Ainda não há dados para este período.</Vazio></Bloco>
      )}
    </div>
  );
}
