"use client";

// Bloco "Landing page" do dashboard: o que o GA4 das LPs conta (ver
// src/lib/ga4-landing.ts). Só apresentação — dados chegam prontos da rota
// /api/clients/[id]/ga4, já consolidados quando o cliente tem mais de uma LP.
// Quatro abas: Visão geral · Tráfego pago · Audiência · Comportamento.
// Blocos sem dado no período não aparecem (LP sem formulário não mostra funil,
// propriedade sem Google Signals não mostra idade/gênero).
//
// ⚠️ A linguagem visual é a MESMA das primeiras lâminas do dashboard, de
// propósito (pedido do Matheus): cards no verde da marca (#6cff2f) com badge de
// ícone e número em `font-heading` (padrão QuickMetricCard), donut de composição
// na paleta categórica validada do dashboard (idêntica à CanalDonutCard) e
// superfície de card #111a20 sobre o painel (padrão MiniPlatformMetric). Nada de
// amber. A paleta do donut é a mesma já validada em produção — não inventar tom.

import { useState, type ReactNode, type ElementType } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip,
} from 'recharts';
import {
  MousePointerClick, MessagesSquare, Percent, MessageCircle, Phone,
  ClipboardList, Sparkles, Clock, UserPlus, Files, PlayCircle, DollarSign,
} from 'lucide-react';
import type { Ga4Celula, Ga4Consolidado, Ga4Linha, Ga4Seg, Ga4Totais } from '@/lib/ga4-landing';

// Paleta categórica idêntica à da CanalDonutCard do dashboard — 8 tons validados
// contra a superfície do painel (banda de luminosidade, piso de croma, separação
// sob daltonismo, contraste ≥ 3:1). Do 8º canal em diante vira "Outros".
const CORES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const CINZA = '#6b7478';
const MAX_FATIAS = 7;

const cx = (...a: Array<string | false | undefined>) => a.filter(Boolean).join(' ');

const fmtN = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR');
const fmtPct = (n: number) => `${((Number.isFinite(n) ? n : 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const fmtBRL = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const div = (a: number, b: number) => (b > 0 ? a / b : 0);
function fmtTempo(seg: number) {
  const s = Math.round(Number.isFinite(seg) ? seg : 0);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// Tradução dos valores padrão do GA4
const CANAIS: Record<string, string> = {
  'Paid Search': 'Pesquisa paga', 'Paid Social': 'Social pago', 'Paid Other': 'Outros pagos', 'Paid Shopping': 'Shopping pago', 'Paid Video': 'Vídeo pago',
  'Cross-network': 'Performance Max / rede cruzada', 'Display': 'Display', 'Organic Search': 'Busca orgânica', 'Organic Social': 'Social orgânico',
  'Organic Shopping': 'Shopping orgânico', 'Organic Video': 'Vídeo orgânico', 'Direct': 'Direto', 'Referral': 'Outros sites', 'Email': 'E-mail',
  'SMS': 'SMS', 'AI Assistant': 'Assistentes de IA (ChatGPT etc.)', 'Unassigned': 'Não identificado', '(other)': 'Outros',
};
const DISPOSITIVOS: Record<string, string> = { mobile: 'Celular', desktop: 'Computador', tablet: 'Tablet', 'smart tv': 'TV' };
const NOVOS: Record<string, string> = { new: 'Novos', returning: 'Recorrentes' };
const GENEROS: Record<string, string> = { female: 'Mulheres', male: 'Homens' };
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const traduz = (mapa: Record<string, string>) => (s: Ga4Seg): Ga4Seg => ({ ...s, valor: mapa[s.valor] ?? s.valor });

/** Superfície de card sobre o painel — mesmo tom do MiniPlatformMetric do dashboard. */
function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-[12px] border border-white/[0.07] bg-[#111a20]/80 p-4', className)}>{children}</div>;
}

/** Título de seção no padrão do dashboard (text-sm black uppercase), com dica opcional. */
function Titulo({ children, dica, icon: Icon }: { children: ReactNode; dica?: string; icon?: ElementType }) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">
        {Icon && <Icon className="h-4 w-4 text-[#6cff2f]" />}
        {children}
      </div>
      {dica && <p className="mt-0.5 text-[10px] text-[#7c868c]">{dica}</p>}
    </div>
  );
}

function Delta({ atual, anterior, inverter = false }: { atual: number; anterior: number; inverter?: boolean }) {
  if (!anterior || !Number.isFinite(atual) || !Number.isFinite(anterior)) return <span className="text-[10px] text-[#7c868c]">—</span>;
  const d = (atual - anterior) / anterior;
  const bom = inverter ? d < 0 : d > 0;
  const cor = d === 0 ? 'text-[#a7b0b6]' : bom ? 'text-[#6cff2f]' : 'text-red-400';
  return <span className={`text-[11px] font-bold ${cor}`}>{d > 0 ? '+' : ''}{(d * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>;
}

/** Card de KPI no padrão QuickMetricCard do dashboard: badge de ícone verde,
 * valor em font-heading e variação vs período anterior. */
function Kpi({ rotulo, valor, atual, anterior, sub, icon: Icon, inverter }: {
  rotulo: string; valor: string; atual: number; anterior: number; sub?: string; icon: ElementType; inverter?: boolean;
}) {
  return (
    <div className="rounded-[12px] border border-white/[0.07] bg-[#111a20]/80 p-3.5 min-w-0">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#6cff2f]/20 bg-[#6cff2f]/10 text-[#6cff2f]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-black uppercase tracking-[0.06em] text-[#9aa4aa]">{rotulo}</p>
          <p className="mt-1.5 font-heading text-2xl leading-none text-[#f4f7f8] tabular-nums">{valor}</p>
          <p className="mt-1 flex items-center gap-1.5">
            <Delta atual={atual} anterior={anterior} inverter={inverter} />
            <span className="text-[10px] font-medium text-[#7c868c]">vs período anterior</span>
          </p>
          {sub && <p className="mt-0.5 truncate text-[10px] text-[#7c868c]">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Cor por NOME do rótulo (não por posição): trocar o período reordena as fatias,
 * e cor por rank faria a mesma origem mudar de cor a cada filtro. Mesma regra da
 * CanalDonutCard — hash escolhe o tom, colisão cai no próximo livre; "Outros" é cinza.
 */
function coresPorLabel(labels: string[]): Record<string, string> {
  const usados = new Set<number>();
  const out: Record<string, string> = {};
  for (const label of [...labels].sort()) {
    if (label.startsWith('Outros')) { out[label] = CINZA; continue; }
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
    let slot = h % CORES.length;
    for (let t = 0; t < CORES.length && usados.has(slot); t++) slot = (slot + 1) % CORES.length;
    usados.add(slot);
    out[label] = CORES[slot];
  }
  return out;
}

type Fatia = { label: string; valor: number };

/**
 * Donut de composição — mesma linguagem da CanalDonutCard do dashboard: anel com
 * total no miolo, gap de 2px na cor da superfície entre fatias, legenda com % e
 * valor (rótulo direto = codificação secundária além da cor). "Outros" absorve a
 * diferença até o total, como no dashboard, senão a soma das fatias não fecha.
 */
function DonutComposicao({ titulo, dica, fatias: brutas, total }: {
  titulo: string; dica?: string; fatias: Fatia[]; total: number;
}) {
  const positivas = brutas.filter(f => f.valor > 0).sort((a, b) => b.valor - a.valor);
  if (positivas.length === 0 || total <= 0) return null;
  const cabe = positivas.length <= CORES.length;
  const cabeca = cabe ? positivas : positivas.slice(0, MAX_FATIAS);
  const cauda = cabe ? [] : positivas.slice(MAX_FATIAS);
  const somaCabeca = cabeca.reduce((s, o) => s + o.valor, 0);
  const resto = Math.max(0, total - somaCabeca);
  const fatias: Fatia[] = resto > 0
    ? [...cabeca, { label: cauda.length > 0 ? `Outros (${cauda.length}+)` : 'Outros', valor: resto }]
    : cabeca;
  const cores = coresPorLabel(fatias.map(f => f.label));
  return (
    <Card>
      <Titulo dica={dica} icon={DollarSign}>{titulo}</Titulo>
      <div className="mt-1 flex flex-col items-center gap-4">
        <div className="relative h-[150px] w-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={fatias} dataKey="valor" nameKey="label" innerRadius={44} outerRadius={72} paddingAngle={0}
                stroke="#111a20" strokeWidth={2} isAnimationActive={false}>
                {fatias.map(f => <Cell key={f.label} fill={cores[f.label]} />)}
              </Pie>
              <RTooltip
                contentStyle={{ background: '#0b1216', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: '#f4f7f8' }} itemStyle={{ color: '#dce4e8' }}
                formatter={(v) => fmtN(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#9aa4aa]">Total</span>
            <span className="font-heading text-lg leading-tight text-[#f4f7f8]">{fmtN(total)}</span>
          </div>
        </div>
        <div className="w-full space-y-1.5">
          {fatias.map(o => (
            <div key={o.label} className="flex items-baseline gap-2">
              <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: cores[o.label] }} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#dce4e8]">{o.label}</span>
              <span className="shrink-0 text-[10px] text-[#9aa4aa]">{((o.valor / total) * 100).toFixed(1).replace('.', ',')}%</span>
              <span className="shrink-0 text-xs font-bold text-[#f4f7f8]">{fmtN(o.valor)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Barras({ titulo, dica, linhas, total, rotuloValor }: { titulo: string; dica?: string; linhas: Ga4Linha[]; total: number; rotuloValor?: (v: string) => string }) {
  const max = Math.max(1, ...linhas.map(l => l.n));
  return (
    <Card>
      <Titulo dica={dica}>{titulo}</Titulo>
      {linhas.length === 0 ? (
        <p className="text-xs text-[#7c868c]">Sem dado no período.</p>
      ) : (
        <ul className="space-y-1.5">
          {linhas.map(l => (
            <li key={l.valor} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[#dce4e8]">{rotuloValor ? rotuloValor(l.valor) : l.valor}</span>
                <span className="shrink-0 tabular-nums text-[#9aa4aa]">{fmtN(l.n)}{total > 0 && <span className="ml-1 text-[#6c767c]">({fmtPct(l.n / total)})</span>}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/[0.06]"><div className="h-1.5 rounded-full bg-[#6cff2f]" style={{ width: `${(l.n / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Coluna = 'sessoes' | 'engaj' | 'tempo' | 'conv' | 'wa' | 'form' | 'tel' | 'taxa' | 'custo' | 'cliques' | 'cpa';
const CABECALHO: Record<Coluna, string> = {
  sessoes: 'Sessões', engaj: 'Engaj.', tempo: 'Tempo', conv: 'Conv.', wa: 'WhatsApp', form: 'Formulário', tel: 'Telefone',
  taxa: 'Converteu', custo: 'Custo', cliques: 'Cliques', cpa: 'Custo/conv.',
};
const POR_TIPO: Coluna[] = ['wa', 'form', 'tel'];
const contatosSeg = (s: Ga4Seg) => s.whatsapp + s.formulario + s.telefone;
function celula(c: Coluna, s: Ga4Seg) {
  switch (c) {
    case 'sessoes': return fmtN(s.sessoes);
    case 'engaj': return fmtPct(div(s.engajadas, s.sessoes));
    case 'tempo': return fmtTempo(div(s.tempo, s.sessoes));
    case 'conv': return fmtN(s.conversoes);
    case 'wa': return fmtN(s.whatsapp);
    case 'form': return fmtN(s.formulario);
    case 'tel': return fmtN(s.telefone);
    case 'taxa': return fmtPct(div(s.sessoesConv, s.sessoes));
    case 'custo': return s.custo ? fmtBRL(s.custo) : '—';
    case 'cliques': return s.cliques ? fmtN(s.cliques) : '—';
    case 'cpa': return s.custo && s.sessoesConv ? fmtBRL(s.custo / s.sessoesConv) : '—';
  }
}

/**
 * Tabela de cortes: sessões, engajamento, tempo médio, contatos por tipo e taxa (+ custo no Google Ads).
 * WhatsApp / Formulário / Telefone = eventos-chave separados pelo nome; coluna sem nenhum
 * contato some. Se a propriedade não tem conversão classificável, cai para "Conv." (todos
 * os eventos-chave). "Converteu" = % das sessões com ao menos um evento-chave.
 */
function TabelaSeg({ titulo, dica, linhas, colunas: pedidas = ['sessoes', 'engaj', 'tempo', 'wa', 'form', 'tel', 'taxa'], rotulo = 'Nome', altura, semCard = false }: {
  titulo: string; dica?: string; linhas: Ga4Seg[]; colunas?: Coluna[]; rotulo?: string; altura?: number; semCard?: boolean;
}) {
  if (linhas.length === 0) return null;
  const soma = (c: Coluna) => linhas.reduce((t, s) => t + (c === 'wa' ? s.whatsapp : c === 'form' ? s.formulario : s.telefone), 0);
  let colunas = pedidas.filter(c => !POR_TIPO.includes(c) || soma(c) > 0);
  if (pedidas.some(c => POR_TIPO.includes(c)) && !colunas.some(c => POR_TIPO.includes(c))) {
    const i = pedidas.findIndex(c => POR_TIPO.includes(c));
    colunas = [...colunas.slice(0, i), 'conv', ...colunas.slice(i)];
  }
  const corpo = (
    <>
      <Titulo dica={dica}>{titulo}</Titulo>
      <div className="overflow-x-auto overflow-y-auto" style={altura ? { maxHeight: altura } : undefined}>
        <table className="w-full text-xs">
          <thead className={altura ? 'sticky top-0 bg-[#111a20]' : undefined}>
            <tr className="text-[10px] uppercase tracking-wider text-[#7c868c]">
              <th className="text-left font-bold pb-1 pr-2">{rotulo}</th>
              {colunas.map(c => <th key={c} className="text-right font-bold pb-1 pl-2 whitespace-nowrap">{CABECALHO[c]}</th>)}
            </tr>
          </thead>
          <tbody>
            {linhas.map(s => (
              <tr key={`${s.valor}|${s.sub ?? ''}`} className="border-t border-white/[0.06]">
                <td className="py-1.5 pr-2 max-w-[260px]">
                  <div className="truncate text-[#dce4e8]" title={s.valor}>{s.valor}</div>
                  {s.sub && <div className="truncate text-[10px] text-[#6c767c]" title={s.sub}>{s.sub}</div>}
                </td>
                {colunas.map(c => (
                  <td key={c} className={`py-1.5 pl-2 text-right tabular-nums whitespace-nowrap ${c === 'conv' || c === 'cpa' || POR_TIPO.includes(c) ? 'font-bold text-[#dce4e8]' : 'text-[#9aa4aa]'}`}>{celula(c, s)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
  return semCard ? <div className="min-w-0">{corpo}</div> : <Card>{corpo}</Card>;
}

/**
 * Palavras-chave / termos pesquisados: TODOS os que trouxeram contato (por tipo),
 * e à parte os que gastam visitas sem trazer nenhum.
 */
function ListaBusca({ titulo, rotulo, linhas, dica }: { titulo: string; rotulo: string; linhas: Ga4Seg[]; dica?: string }) {
  if (linhas.length === 0) return null;
  const temTipo = linhas.some(s => contatosSeg(s) > 0);
  const total = (s: Ga4Seg) => (temTipo ? contatosSeg(s) : s.conversoes);
  const com = linhas.filter(s => total(s) > 0).sort((a, b) => total(b) - total(a) || b.sessoes - a.sessoes);
  const sem = linhas.filter(s => total(s) === 0 && s.sessoes >= 10).sort((a, b) => b.sessoes - a.sessoes).slice(0, 15);
  return (
    <Card className="min-w-0 space-y-4">
      <TabelaSeg titulo={`${titulo} que trouxeram contato (${com.length})`} rotulo={rotulo} linhas={com} dica={dica}
        colunas={['sessoes', 'wa', 'form', 'tel', 'taxa']} altura={420} semCard />
      {com.length === 0 && <p className="text-xs text-[#7c868c]">{titulo}: nenhum contato no período.</p>}
      <TabelaSeg titulo={`${titulo} sem nenhum contato`} rotulo={rotulo} linhas={sem} colunas={['sessoes', 'engaj', 'tempo']}
        dica="10+ visitas pagas e zero contato — candidatas a pausar ou negativar." semCard />
    </Card>
  );
}

/** Grade dia da semana × hora: cor = sessões ou conversões. */
function MapaSemanaHora({ celulas }: { celulas: Ga4Celula[] }) {
  const [modo, setModo] = useState<'sessoes' | 'conversoes'>('conversoes');
  if (celulas.length === 0) return null;
  const grade = new Map(celulas.map(c => [`${c.dia}|${c.hora}`, c]));
  const max = Math.max(1, ...celulas.map(c => c[modo]));
  const porHora = Array.from({ length: 24 }, (_, h) => celulas.filter(c => c.hora === h).reduce((s, c) => s + c[modo], 0));
  const pico = porHora.indexOf(Math.max(...porHora));
  return (
    <Card className="min-w-0 md:col-span-2 xl:col-span-3">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <Titulo dica={`No fuso horário da propriedade GA4. Pico de ${modo === 'sessoes' ? 'visitas' : 'conversões'}: ${pico}h.`}>Dia da semana e hora</Titulo>
        <div className="flex overflow-hidden rounded-md border border-white/10 text-[10px] font-bold">
          {(['conversoes', 'sessoes'] as const).map(m => (
            <button key={m} type="button" onClick={() => setModo(m)} className={`px-2 py-1 ${modo === m ? 'bg-[#6cff2f] text-black' : 'text-[#9aa4aa]'}`}>{m === 'sessoes' ? 'Visitas' : 'Conversões'}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: '32px repeat(24, minmax(0, 1fr))' }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-[9px] text-[#6c767c]">{h % 3 === 0 ? h : ''}</div>)}
          {DIAS.map((d, dia) => (
            <div key={d} className="contents">
              <div className="text-[10px] leading-4 text-[#9aa4aa]">{d}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const c = grade.get(`${dia}|${h}`);
                const v = c?.[modo] ?? 0;
                return (
                  <div key={h} className="h-4 rounded-[2px]" title={`${d} ${h}h · ${fmtN(c?.sessoes ?? 0)} visitas · ${fmtN(c?.conversoes ?? 0)} conversões`}
                    style={{ background: v > 0 ? `rgba(108,255,47,${0.12 + 0.88 * (v / max)})` : 'rgba(255,255,255,0.04)' }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Funil({ f }: { f: Ga4Consolidado['comportamento']['funil'] }) {
  if (f.formInicio + f.leadForm + f.leadConfirmado === 0) return null;
  const etapas = [
    { rotulo: 'Visitaram a página', n: f.visitantes },
    { rotulo: 'Começaram o formulário', n: f.formInicio },
    { rotulo: 'Enviaram', n: f.leadForm },
    ...(f.leadConfirmado > 0 ? [{ rotulo: 'Chegaram na página de obrigado', n: f.leadConfirmado }] : []),
  ];
  const max = Math.max(1, f.visitantes);
  return (
    <Card>
      <Titulo dica="Pessoas (não cliques) em cada etapa do formulário.">Funil do formulário</Titulo>
      <ul className="space-y-1.5">
        {etapas.map((e, i) => (
          <li key={e.rotulo} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[#dce4e8]">{e.rotulo}</span>
              <span className="shrink-0 tabular-nums text-[#9aa4aa]">{fmtN(e.n)}{i > 0 && <span className="ml-1 text-[#6c767c]">({fmtPct(div(e.n, etapas[i - 1].n))} da etapa anterior)</span>}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-white/[0.06]"><div className="h-1.5 rounded-full bg-[#6cff2f]" style={{ width: `${Math.min(100, (e.n / max) * 100)}%` }} /></div>
          </li>
        ))}
      </ul>
      {f.formErro > 0 && <p className="mt-2 text-[10px] text-amber-300">{fmtN(f.formErro)} pessoa(s) viram erro ao enviar.</p>}
    </Card>
  );
}

export function resumoTotais(t: Ga4Totais) {
  return `${fmtN(t.sessoes)} sessões · ${fmtN(t.contatos)} contatos · ${fmtPct(t.taxaContato)}`;
}

/**
 * Divisor de seção — não há abas: as quatro seções ficam SOLTAS na dashboard,
 * uma sob a outra (pedido do Matheus: "não quero nada escondido para ficar
 * clicando"). O rótulo verde discreto separa as lâminas sem competir com o
 * título "Landing page" do painel; seção sem dado nenhum nem aparece.
 */
function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pt-1">
        <span className="h-3.5 w-1 rounded-full bg-[#6cff2f]" />
        <h4 className="text-xs font-black uppercase tracking-[0.12em] text-[#9aa4aa]">{titulo}</h4>
      </div>
      {children}
    </section>
  );
}

export function Ga4LandingPanel({ dados, loading, aviso }: { dados: Ga4Consolidado | null; loading: boolean; aviso?: string }) {
  if (loading) return <p className="px-4 pb-4 text-xs text-[#9aa4aa]">Carregando Google Analytics…</p>;
  if (!dados) return <p className="px-4 pb-4 text-xs text-[#9aa4aa]">{aviso ?? 'Sem propriedade GA4 vinculada a este cliente.'}</p>;
  const { atual: a, anterior: b } = dados;
  const totalContatos = a.contatos || 1;
  const { pago, audiencia: au, comportamento: co } = dados;
  // Rolagem e seções: % das pessoas que visitaram
  const visitantes = a.usuarios;
  const semCusto = pago.googleAds.length > 0 && pago.googleAds.every(g => !g.custo);
  // Tem pesquisa paga mas nenhuma linha do Google Ads = propriedade sem vínculo com o Ads
  const semVinculoAds = pago.googleAds.length === 0 && pago.canais.some(c => c.valor === 'Paid Search' || c.valor === 'Cross-network');

  // Composição de "de onde vêm os contatos" (donut na linguagem da CanalDonutCard).
  // Sem contatos no período, cai para a composição de sessões pra não ficar vazio.
  const origContato = dados.origens.map(o => ({ label: `${o.origem} / ${o.midia}`, valor: o.contatos }));
  const temContato = origContato.some(f => f.valor > 0);
  const origSessao = dados.origens.map(o => ({ label: `${o.origem} / ${o.midia}`, valor: o.sessoes }));

  // Seção sem dado nenhum não aparece — nada de lâmina vazia.
  const temPago = pago.canais.length + pago.googleAds.length + pago.campanhas.length + pago.palavras.length + pago.termos.length > 0;
  const temAudiencia = au.dispositivos.length + au.cidades.length + au.novosRecorrentes.length + au.idades.length + au.generos.length + au.semanaHora.length > 0;
  const temComportamento = co.rolagem.length + co.secoes.length + co.paginasEntrada.length + co.videos.length + (co.funil.formInicio + co.funil.leadForm + co.funil.leadConfirmado) > 0;

  return (
    <div className="px-4 pb-4 space-y-6">
      <Secao titulo="Visão geral">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            <Kpi rotulo="Sessões" valor={fmtN(a.sessoes)} atual={a.sessoes} anterior={b.sessoes} sub={`${fmtN(a.usuarios)} usuários`} icon={MousePointerClick} />
            <Kpi rotulo="Contatos" valor={fmtN(a.contatos)} atual={a.contatos} anterior={b.contatos} sub="WhatsApp + telefone + formulário" icon={MessagesSquare} />
            <Kpi rotulo="Taxa de contato" valor={fmtPct(a.taxaContato)} atual={a.taxaContato} anterior={b.taxaContato} sub="contatos por sessão" icon={Percent} />
            <Kpi rotulo="WhatsApp" valor={fmtN(a.whatsapp)} atual={a.whatsapp} anterior={b.whatsapp} icon={MessageCircle} />
            <Kpi rotulo="Telefone" valor={fmtN(a.telefone)} atual={a.telefone} anterior={b.telefone} icon={Phone} />
            <Kpi rotulo={a.leadForm > 0 ? 'Formulários' : 'Cliques em botões'} valor={fmtN(a.leadForm > 0 ? a.leadForm : a.cta)} atual={a.leadForm > 0 ? a.leadForm : a.cta} anterior={a.leadForm > 0 ? b.leadForm : b.cta} icon={ClipboardList} />
            <Kpi rotulo="Engajamento" valor={fmtPct(div(a.engajadas, a.sessoes))} atual={div(a.engajadas, a.sessoes)} anterior={div(b.engajadas, b.sessoes)} sub="sessões com +10s ou interação" icon={Sparkles} />
            <Kpi rotulo="Tempo médio" valor={fmtTempo(div(a.tempo, a.sessoes))} atual={div(a.tempo, a.sessoes)} anterior={div(b.tempo, b.sessoes)} sub="engajado, por sessão" icon={Clock} />
            <Kpi rotulo="Visitantes novos" valor={fmtPct(div(a.novos, a.usuarios))} atual={div(a.novos, a.usuarios)} anterior={div(b.novos, b.usuarios)} sub={`${fmtN(a.novos)} primeira visita`} icon={UserPlus} />
            <Kpi rotulo="Páginas vistas" valor={fmtN(a.pageviews)} atual={a.pageviews} anterior={b.pageviews} sub={`${div(a.pageviews, a.sessoes).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por sessão`} icon={Files} />
            {a.video > 0 && <Kpi rotulo="Vídeos assistidos" valor={fmtN(a.video)} atual={a.video} anterior={b.video} sub="plays" icon={PlayCircle} />}
          </div>

          {dados.propriedades.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {dados.propriedades.map(p => (
                <span key={p.propertyId} className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] text-[#a7b0b6]">
                  <span className="font-bold text-[#dce4e8]">{p.nome}</span> · {resumoTotais(p.atual)}
                </span>
              ))}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <DonutComposicao
              titulo={temContato ? 'De onde vêm os contatos' : 'De onde vêm as sessões'}
              dica={temContato ? 'Origem / mídia que mais trouxe contato.' : 'Origem / mídia com mais sessões.'}
              fatias={temContato ? origContato : origSessao}
              total={temContato ? a.contatos : a.sessoes} />
            <Barras titulo="Onde clicam para falar" linhas={dados.posicoes} total={totalContatos} />
            {dados.detalhes.map(d => (
              <Barras key={d.param} titulo={d.rotulo} linhas={d.linhas} total={d.param === 'cta_id' ? a.cta : a.whatsapp} />
            ))}
          </div>
      </Secao>

      {temPago && (
        <Secao titulo="Tráfego pago">
        <div className="grid gap-4 xl:grid-cols-2">
          {semVinculoAds && (
            <p className="rounded-lg border border-amber-300/30 bg-amber-300/[0.06] px-3 py-2 text-[11px] text-amber-200 xl:col-span-2">
              Esta propriedade GA4 não está vinculada ao Google Ads: custo por campanha, palavras-chave e termos pesquisados não aparecem.
              Vincule em GA4 → Administrador → Vinculações de produtos → Google Ads.
            </p>
          )}
          <TabelaSeg titulo="Qualidade por canal" rotulo="Canal" linhas={pago.canais.map(traduz(CANAIS))}
            dica="Engajamento e tempo mostram se o clique é de gente interessada." />
          <TabelaSeg titulo="Campanhas do Google Ads" rotulo="Campanha" linhas={pago.googleAds}
            colunas={['custo', 'cliques', 'sessoes', 'engaj', 'wa', 'form', 'tel', 'taxa', 'cpa']}
            dica={semCusto ? 'Custo vazio: a propriedade GA4 não está vinculada ao Google Ads.' : 'Custo e cliques do Google Ads; conversões pelo GA4. Custo/conv. = custo ÷ sessões que converteram.'} />
          <TabelaSeg titulo="Todas as campanhas (UTM)" rotulo="Campanha" linhas={pago.campanhas}
            dica="Inclui Meta Ads e outras origens — só aparece o que tem utm_campaign no link." />
          <ListaBusca titulo="Palavras-chave" rotulo="Palavra-chave" linhas={pago.palavras} />
          <ListaBusca titulo="Termos pesquisados" rotulo="O que a pessoa digitou" linhas={pago.termos}
            dica="O Google esconde termos de pouco volume e da Performance Max — a soma fica abaixo do total." />
        </div>
        </Secao>
      )}

      {temAudiencia && (
        <Secao titulo="Audiência">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TabelaSeg titulo="Dispositivo" rotulo="Aparelho" linhas={au.dispositivos.map(traduz(DISPOSITIVOS))} colunas={['sessoes', 'engaj', 'wa', 'form', 'tel', 'taxa']} />
          <TabelaSeg titulo="Novos x recorrentes" rotulo="Visitante" linhas={au.novosRecorrentes.map(traduz(NOVOS))} colunas={['sessoes', 'engaj', 'wa', 'form', 'tel', 'taxa']}
            dica="Recorrente convertendo mais = remarketing vale a pena." />
          <TabelaSeg titulo="Cidades" rotulo="Cidade" linhas={au.cidades} colunas={['sessoes', 'engaj', 'wa', 'form', 'tel', 'taxa']} />
          <TabelaSeg titulo="Idade" rotulo="Faixa" linhas={au.idades} colunas={['sessoes', 'wa', 'form', 'tel', 'taxa']} />
          <TabelaSeg titulo="Gênero" rotulo="Gênero" linhas={au.generos.map(traduz(GENEROS))} colunas={['sessoes', 'wa', 'form', 'tel', 'taxa']} />
          {au.idades.length + au.generos.length === 0 && (
            <p className="text-[10px] text-[#7c868c] md:col-span-2 xl:col-span-3">Idade e gênero não aparecem: o GA4 esconde com pouco volume ou sem Google Signals ligado.</p>
          )}
          <MapaSemanaHora celulas={au.semanaHora} />
        </div>
        </Secao>
      )}

      {temComportamento && (
        <Secao titulo="Comportamento">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Barras titulo="Até onde rolam" dica="% dos visitantes que chegaram a cada ponto da página." linhas={co.rolagem} total={visitantes} rotuloValor={v => `${v}% da página`} />
          <Barras titulo="Seções vistas" dica="% dos visitantes que viram cada seção." linhas={co.secoes} total={visitantes} />
          <Funil f={co.funil} />
          <TabelaSeg titulo="Página de entrada" rotulo="Página" linhas={co.paginasEntrada} colunas={['sessoes', 'engaj', 'tempo', 'wa', 'form', 'tel', 'taxa']} />
          {co.videos.length > 0 && <Barras titulo="Vídeos assistidos" linhas={co.videos} total={a.video} />}
        </div>
        </Secao>
      )}
    </div>
  );
}
