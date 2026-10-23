'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Filter, ImageIcon, Play } from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { T } from '@/lib/dashboard-tipografia';
import { GoogleAdsMark } from '@/components/platform-logos';
import { Superficie } from './superficie';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';
import type { EtapaDoCriativo, FunilDoCriativo } from '@/app/api/crm/funil-criativos/route';
import { objetivoDeVenda } from '@/lib/meta-results';
import { descreverFontes, fontesPresentes, juntarFontes, totalDasFontes, type VendasPorFonte } from '@/lib/fonte-venda';

/**
 * Funil de criativos — TODOS os anúncios, cada um com a prévia e o que
 * aconteceu com quem ele trouxe: cliques → leads → agendamento → comparecimento
 * → venda → faturamento, mais o gancho e a retenção do vídeo.
 *
 * Os números de plataforma (gasto, impressões, cliques, vídeo) vêm do Meta; os
 * do funil vêm do CRM pelo id do anúncio que ficou gravado no lead. Anúncio que
 * só existe no CRM (Google, ou só o nome no rastreio) entra sem prévia.
 *
 * As etapas do meio são as do FUNIL REAL do cliente (nome da coluna do Kanban),
 * não um "Agend. → Compar." fixo: delivery e vendas não têm agendamento.
 *
 * Vendas e faturamento SOMAM as fontes, cada uma identificada (lib/fonte-venda):
 * o CRM (WhatsApp, planilha, Datalytics, Agendor, SULTS…) e, para quem tem
 * cardápio conectado, o pedido do cardápio que a Meta atribuiu ao anúncio
 * (PicoLocos, out/2026: R$ 9,1 mil na Meta, "—" aqui quando só o CRM contava).
 */

const VERDE = '#6cff2f';

type Item = {
  chave: string;
  creative: TopCreative | null;
  nome: string;
  campanha: string | null;
  plataforma: 'meta' | 'google' | 'outro';
  gasto: number;
  impressoes: number;
  cliques: number;
  leadsPlataforma: number;
  crm: FunilDoCriativo | null;
  /** Vendas por fonte: as do CRM + o cardápio (compras da Meta), já somadas. */
  fontes: VendasPorFonte;
  /**
   * Campanha de VENDAS: o funil é o da compra no site/cardápio (pixel), não o do
   * CRM. "Leads → Em atendimento → Agendado" num anúncio de vendas do Anota Aí
   * não diz nada (print do Matheus, Ultimate Nacho: 32 vendas e "Leads 0").
   */
  funilCompra: { visitas: number; carrinho: number; checkout: number } | null;
  views3s: number;
  thruplays: number;
};

type Ordem = 'gasto' | 'leads' | 'vendas' | 'receita' | 'conversao' | 'retencao';
const ORDENS: Array<{ id: Ordem; rotulo: string }> = [
  { id: 'gasto', rotulo: 'Investimento' },
  { id: 'leads', rotulo: 'Leads' },
  { id: 'vendas', rotulo: 'Vendas' },
  { id: 'receita', rotulo: 'Faturamento' },
  { id: 'conversao', rotulo: 'Conversão' },
  { id: 'retencao', rotulo: 'Retenção' },
];

const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR');
const fmtPct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 ? 1 : 0 })}%`);
const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);
/** Moeda sem centavos — no card cabe "R$ 9.999", não "R$ 9.999,92". */
const moedaCurta = (n: number) => `R$ ${Math.round(n).toLocaleString('pt-BR')}`;
const compacto = (n: number) => (n >= 10_000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : fmtInt(n));

function montarItens(criativos: TopCreative[], crm: FunilDoCriativo[], comCompras: boolean): Item[] {
  const porAd = new Map(crm.filter(c => c.adId).map(c => [c.adId as string, c]));
  const usados = new Set<string>();
  const itens: Item[] = criativos.map(c => {
    const f = porAd.get(c.adId) ?? null;
    if (f) usados.add(f.chave);
    return {
      chave: `meta:${c.adId}`, creative: c, nome: c.adName, campanha: c.campaignName ?? null, plataforma: 'meta',
      gasto: c.spend, impressoes: c.impressions, cliques: c.clicks, leadsPlataforma: c.leads, crm: f,
      fontes: juntarFontes(fontesDoCrm(f), comCompras && (c.compras ?? 0) > 0 ? { cardapio: { vendas: c.compras ?? 0, receita: c.valorCompras ?? 0 } } : null),
      funilCompra: objetivoDeVenda(c.objective) ? { visitas: c.visitas ?? 0, carrinho: c.carrinho ?? 0, checkout: c.checkout ?? 0 } : null,
      views3s: c.views3s ?? 0, thruplays: c.thruplays ?? 0,
    };
  });
  // O que só o CRM conhece: anúncio de Google, rastreio só com o nome, ou
  // anúncio que trouxe venda no período mas já não veiculou nele.
  for (const f of crm) {
    if (usados.has(f.chave)) continue;
    itens.push({
      chave: `crm:${f.chave}`, creative: null, nome: f.nome, campanha: f.campanha, plataforma: f.plataforma,
      gasto: 0, impressoes: 0, cliques: 0, leadsPlataforma: 0, crm: f, fontes: juntarFontes(fontesDoCrm(f)), funilCompra: null, views3s: 0, thruplays: 0,
    });
  }
  return itens;
}

/** Rota antiga (sem `fontes`) cai inteira em "CRM". */
function fontesDoCrm(f: FunilDoCriativo | null): VendasPorFonte | null {
  if (!f) return null;
  return f.fontes ?? (f.vendas > 0 || f.receita > 0 ? { crm: { vendas: f.vendas, receita: f.receita } } : null);
}
const vendasDe = (i: Item) => totalDasFontes(i.fontes).vendas;
const receitaDe = (i: Item) => totalDasFontes(i.fontes).receita;
/** Venda pelo cardápio não passa por lead/etapa: a taxa dela é sobre o clique. */
const vendaPorClique = (i: Item) => !!i.funilCompra || (i.fontes.cardapio?.vendas ?? 0) > 0;

export function FunilCriativosPanel({ criativos, crm, loading, onPreview, receitaTotal = null, comCompras = false, etapas = [] }: {
  /** Soma as compras atribuídas pela Meta como fonte "Cardápio digital" — só cliente com cardápio conectado. */
  comCompras?: boolean;
  /** Etapas do meio do funil real do cliente (rota /api/crm/funil-criativos). */
  etapas?: EtapaDoCriativo[];
  /** Faturamento do período inteiro — o cabeçalho diz quanto dele veio de anúncio. */
  receitaTotal?: number | null;
  criativos: TopCreative[];
  crm: FunilDoCriativo[];
  loading: boolean;
  onPreview: (c: TopCreative) => void;
}) {
  const [ordem, setOrdem] = useState<Ordem>('gasto');
  const itens = useMemo(() => montarItens(criativos, crm, comCompras), [criativos, crm, comCompras]);
  // Com rastreio no CRM, o lead que vale é o do CRM (é dele que o funil segue);
  // sem nenhum, cai no número da plataforma, com o rótulo dizendo isso.
  const temCrm = crm.some(c => c.leads > 0 || c.vendas > 0);
  const leadsDe = (i: Item) => (temCrm ? i.crm?.leads ?? 0 : i.leadsPlataforma);

  const ordenados = useMemo(() => {
    const valor = (i: Item): number => {
      switch (ordem) {
        case 'leads': return leadsDe(i);
        case 'vendas': return vendasDe(i);
        case 'receita': return receitaDe(i);
        case 'conversao': return pct(vendasDe(i), vendaPorClique(i) ? i.cliques : leadsDe(i)) ?? -1;
        case 'retencao': return pct(i.thruplays, i.views3s) ?? -1;
        default: return i.gasto;
      }
    };
    return [...itens].sort((a, b) => valor(b) - valor(a) || b.gasto - a.gasto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, ordem, temCrm]);

  const titulo = 'Funil de criativos';
  const icone = <Filter className="h-5 w-5" style={{ color: VERDE }} />;
  if (!loading && itens.length === 0) {
    return <Superficie vazio titulo={titulo} icone={icone} avisoVazio="Nenhum criativo com veiculação ou lead no período." />;
  }

  const tot = itens.reduce((s, i) => ({
    leads: s.leads + leadsDe(i), vendas: s.vendas + vendasDe(i), receita: s.receita + receitaDe(i),
  }), { leads: 0, vendas: 0, receita: 0 });
  const comVendas = temCrm || tot.vendas > 0;

  return (
    <Superficie
      titulo={titulo}
      icone={icone}
      sub={loading && itens.length === 0 ? 'carregando os criativos…' : (
        <>
          {itens.length} criativos · {fmtInt(tot.leads)} leads{temCrm ? '' : ' (Meta)'}
          {comVendas && <> · {fmtInt(tot.vendas)} vendas · {formatCurrencyBRL(tot.receita)}</>}
          {/* Com as compras da Meta a soma pode passar do faturamento do CRM (a
              venda do cardápio não está nele): aí a % não diz nada e some. */}
          {comVendas && receitaTotal !== null && receitaTotal > 0 && tot.receita <= receitaTotal && (
            <> ({fmtPct((tot.receita / receitaTotal) * 100)} do faturamento de {formatCurrencyBRL(receitaTotal)})</>
          )}
        </>
      )}
      direita={(
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-white/[0.04] p-1 ring-1 ring-white/[0.06]">
          {ORDENS.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => setOrdem(o.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.06em] transition',
                ordem === o.id ? 'bg-[#6cff2f] text-black' : 'text-[#a7b0b6] hover:text-white',
              )}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      )}
    >
      {loading && itens.length === 0 ? (
        <div className="grid auto-cols-[540px] grid-flow-col grid-rows-2 gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[236px] animate-pulse rounded-xl bg-white/[0.04]" />)}
        </div>
      ) : (
        <>
          {/* Duas linhas fixas, rolando para o LADO — mesmo padrão dos "Melhores criativos". */}
          {/* Cada etapa do meio a mais alarga o card: o nome real da coluna ("Visita/reunião", "Em Atendimento") não cabe em 440. */}
          {/* Largura com folga (2026-10-23, "as box estão muito apertadas"): o rodapé
              cortava "FATURAME…" e "clique → v…" em 440px. Cresce com as etapas do funil. */}
          <div className={cn('grid grid-flow-col grid-rows-2 gap-4 overflow-x-auto pb-2', etapas.length >= 3 ? 'auto-cols-[620px]' : etapas.length === 2 ? 'auto-cols-[580px]' : 'auto-cols-[540px]')}>
            {ordenados.map((i, idx) => (
              <CardFunil key={i.chave} item={i} index={idx} leads={leadsDe(i)} temCrm={temCrm} etapas={etapas} cardapio={comCompras} onPreview={onPreview} />
            ))}
          </div>
          <p className={cn(T.nota, 'mt-2')}>
            Funil pelos leads criados no período (mesma régua do Funil de Performance); vendas e faturamento somam as fontes, cada uma identificada no card (CRM pela data do ganho; no delivery, o pedido do cardápio que a Meta atribuiu ao anúncio).
            Gancho = quem assistiu 3s ÷ impressões · Retenção = ThruPlay ÷ quem assistiu 3s (só vídeo).
          </p>
        </>
      )}
    </Superficie>
  );
}

function Miniatura({ item, index, onPreview }: { item: Item; index: number; onPreview: (c: TopCreative) => void }) {
  const [etapa, setEtapa] = useState<'principal' | 'reserva' | 'erro'>('principal');
  const c = item.creative;
  const principal = c?.imageUrl ?? c?.thumbnailUrl;
  const url = etapa === 'principal' ? principal : etapa === 'reserva' ? c?.thumbnailUrl : undefined;
  const video = !!c && (c.mediaType === 'video' || (c.views3s ?? 0) > 0);
  return (
    <button
      type="button"
      disabled={!c}
      onClick={() => c && onPreview(c)}
      className="group relative h-full w-[124px] shrink-0 overflow-hidden rounded-lg bg-[#071014] disabled:cursor-default"
      title={c ? 'Ver o criativo' : undefined}
    >
      {url && etapa !== 'erro' ? (
        <img
          src={url}
          alt={item.nome}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          onError={() => setEtapa(etapa === 'principal' && c?.thumbnailUrl && c.thumbnailUrl !== principal ? 'reserva' : 'erro')}
        />
      ) : (
        <span className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
          {item.plataforma === 'google' ? <GoogleAdsMark className="h-6 w-6 opacity-70" /> : <ImageIcon className="h-5 w-5 text-[#9aa4aa]/40" />}
          <span className="text-[9px] text-[#7c868c]">{item.plataforma === 'google' ? 'Pesquisa' : 'Sem prévia'}</span>
        </span>
      )}
      {video && url && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 ring-1 ring-white/30">
            <Play className="h-3 w-3 fill-white text-white" />
          </span>
        </span>
      )}
      <span className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/85 px-1 text-[10px] font-black text-white">{index + 1}</span>
    </button>
  );
}

const VALOR_DO_POSTO: Record<1 | 2 | 3, (f: FunilDoCriativo | null) => number> = {
  1: f => f?.engajados ?? 0,
  2: f => f?.agendamentos ?? 0,
  3: f => f?.comparecimentos ?? 0,
};

type EtapaCard = { rotulo: string; valor: number; taxa: number | null; dica: string; nota?: string | null };

/** Clique → abriu o cardápio/site → carrinho → checkout → compra, cada taxa sobre a anterior. */
function etapasDeCompra(item: Item, vendas: number, cardapio: boolean, fontesDica: string): EtapaCard[] {
  const fc = item.funilCompra!;
  const lista: Array<{ rotulo: string; valor: number; dica: string }> = [
    { rotulo: 'Cliques', valor: item.cliques, dica: 'CTR: cliques ÷ impressões' },
    { rotulo: cardapio ? 'Abriu o cardápio' : 'Visitas', valor: fc.visitas, dica: `${cardapio ? 'Abriram o cardápio' : 'Visitas na página'} ÷ cliques` },
    { rotulo: 'Carrinho', valor: fc.carrinho, dica: 'Adicionaram ao carrinho ÷ abriram' },
    { rotulo: 'Checkout', valor: fc.checkout, dica: 'Iniciaram o checkout ÷ carrinho' },
    { rotulo: 'Vendas', valor: vendas, dica: `Compras ÷ checkout${fontesDica}` },
  ];
  return lista.map((e, i) => ({
    ...e,
    taxa: i === 0 ? pct(item.cliques, item.impressoes) : pct(e.valor, lista[i - 1].valor),
  }));
}

function CardFunil({ item, index, leads, temCrm, etapas, cardapio, onPreview }: {
  item: Item; index: number; leads: number; temCrm: boolean; etapas: EtapaDoCriativo[]; cardapio: boolean; onPreview: (c: TopCreative) => void;
}) {
  const f = item.crm;
  const vendas = vendasDe(item);
  const receita = receitaDe(item);
  const porClique = vendaPorClique(item);
  const origemVendas = descreverFontes(item.fontes);
  const fontes = fontesPresentes(item.fontes);
  // CRM rastreando menos leads que o Meta reportou (lead que não passou pelo
  // WhatsApp rastreado): em vez de só "0%", mostra o número da plataforma.
  const notaLeads = temCrm && item.leadsPlataforma > leads ? `Meta ${compacto(item.leadsPlataforma)}` : null;
  const etapasDoCard: EtapaCard[] = [
    { rotulo: 'Cliques', valor: item.cliques, taxa: pct(item.cliques, item.impressoes), dica: 'CTR: cliques ÷ impressões' },
    { rotulo: 'Leads', valor: leads, taxa: pct(leads, item.cliques), nota: notaLeads, dica: temCrm ? `Leads no CRM ÷ cliques${item.leadsPlataforma ? ` · o Meta reportou ${fmtInt(item.leadsPlataforma)}` : ''}` : 'Leads reportados pelo Meta ÷ cliques' },
  ];
  // Etapas do meio: só as que existem no funil do cliente, com o nome da coluna.
  // A taxa de cada uma é sobre a etapa anterior que aparece no card.
  let anterior = { valor: leads, nome: 'leads' };
  const meio: Array<{ valor: number; nome: string }> = [];
  for (const e of etapas) {
    const valor = VALOR_DO_POSTO[e.posto](f);
    etapasDoCard.push({ rotulo: e.rotulo, valor, taxa: pct(valor, anterior.valor), dica: `${e.rotulo} ÷ ${anterior.nome}` });
    anterior = { valor, nome: e.rotulo };
    meio.push(anterior);
  }
  // Venda sobre a última etapa do meio que teve gente (sem nenhuma: sobre os leads).
  const base = [...meio].reverse().find(m => m.valor > 0) ?? { valor: leads, nome: 'leads' };
  const fontesDica = origemVendas ? `\n${origemVendas}` : '';
  etapasDoCard.push(porClique
    ? { rotulo: 'Vendas', valor: vendas, taxa: pct(vendas, item.cliques), dica: `Vendas ÷ cliques (no cardápio a venda não passa por lead)${fontesDica}` }
    : { rotulo: 'Vendas', valor: vendas, taxa: pct(vendas, base.valor), dica: `Vendas ÷ ${base.nome}${fontesDica}` });
  // Campanha de vendas troca a escada inteira pela da compra.
  const funil = item.funilCompra ? etapasDeCompra(item, vendas, cardapio, fontesDica) : etapasDoCard;
  const conversao = porClique ? pct(vendas, item.cliques) : pct(vendas, leads);
  // Funil de compra com só o cardápio de fonte: a linha repetiria o "Vendas".
  const mostrarFontes = fontes.length > 1 || (fontes.length === 1 && !(item.funilCompra && fontes[0].fonte === 'cardapio'));
  const gancho = pct(item.views3s, item.impressoes);
  const retencao = pct(item.thruplays, item.views3s);
  const roas = item.gasto > 0 && receita > 0 ? receita / item.gasto : null;

  return (
    <div className="flex h-[236px] gap-4 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.05]">
      <Miniatura item={item} index={index} onPreview={onPreview} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={cn('truncate', T.listaRotulo)} title={item.nome}>{item.nome}</p>
            <p className="truncate text-[10px] text-[#7c868c]" title={item.campanha ?? undefined}>
              {item.impressoes > 0 ? `${compacto(item.impressoes)} impressões` : 'sem veiculação no período'}
              {item.campanha ? ` · ${item.campanha}` : ''}
            </p>
          </div>
          {item.gasto > 0 && (
            <span className="shrink-0 rounded bg-[#172027] px-1.5 py-0.5 text-[10px] font-black tabular-nums text-[#dce4e8]" title="Investimento no período">
              {moedaCurta(item.gasto)}
            </span>
          )}
        </div>

        {/* O funil do criativo em uma linha: valor da etapa e, embaixo, quanto passou da anterior. */}
        <div className="mt-2 flex items-stretch">
          {funil.map((e, i) => (
            <div key={e.rotulo} className="flex min-w-0 flex-1 items-stretch">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 self-center text-[#3d474d]" />}
              <div className="min-w-0 flex-1 text-center" title={e.dica}>
                <p className={cn('font-heading text-[22px] leading-none tabular-nums', e.valor > 0 ? 'text-[#f4f7f8]' : 'text-[#4a545a]')}>{compacto(e.valor)}</p>
                {/* Nome real da coluna do cliente: quebra em 2 linhas em vez de virar "ENGA…". */}
                <p className="mt-0.5 line-clamp-2 min-h-[2.2em] text-[9.5px] font-bold leading-[1.1] [overflow-wrap:normal] text-[#9aa4aa]">{e.rotulo}</p>
                {e.nota
                  ? <p className="truncate text-[10px] font-bold tabular-nums text-[#a7b0b6]">{e.nota}</p>
                  : <p className={cn('text-[10px] font-bold tabular-nums', e.taxa !== null && e.valor > 0 ? 'text-[#6cff2f]/85' : 'text-[#4a545a]')}>{fmtPct(e.taxa)}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* De onde vieram as vendas — cada fonte com o seu número. */}
        {mostrarFontes && (
          <p className="mt-1.5 truncate text-[10px] text-[#9aa4aa]" title={origemVendas}>
            {fontes.map((p, i) => (
              <span key={p.fonte}>
                {i > 0 && <span className="text-[#3d474d]"> · </span>}
                {p.rotulo} <span className="font-bold tabular-nums text-[#dce4e8]">{fmtInt(p.vendas)}</span>
                {p.receita > 0 && <span className="tabular-nums"> ({moedaCurta(p.receita)})</span>}
              </span>
            ))}
          </p>
        )}

        {/* Resultado do criativo: faturamento, conversão e a leitura do vídeo. */}
        <div className="mt-auto grid grid-cols-4 gap-3 border-t border-white/[0.06] pt-2.5">
          <Kpi rotulo="Faturamento" valor={receita > 0 ? moedaCurta(receita) : '—'} forte={receita > 0}
            nota={roas !== null ? `ROAS ${roas.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x` : undefined} />
          <Kpi rotulo="Conversão" valor={fmtPct(conversao)} nota={porClique ? 'clique → venda' : 'lead → venda'} dica={porClique ? 'Vendas ÷ cliques' : 'Vendas ÷ leads'} />
          <Kpi rotulo="Gancho" valor={item.views3s > 0 ? fmtPct(gancho) : '—'} nota={item.views3s > 0 ? 'viram 3s' : 'imagem'} />
          <Kpi rotulo="Retenção" valor={item.views3s > 0 ? fmtPct(retencao) : '—'} nota={item.views3s > 0 ? 'até o ThruPlay' : 'imagem'} barra={item.views3s > 0 ? retencao : null} />
        </div>
      </div>
    </div>
  );
}

function Kpi({ rotulo, valor, nota, forte, barra, dica }: { rotulo: string; valor: string; nota?: string; forte?: boolean; barra?: number | null; dica?: string }) {
  return (
    <div className="min-w-0" title={dica}>
      <p className="truncate text-[9px] font-black uppercase tracking-[0.02em] text-[#9aa4aa]">{rotulo}</p>
      <p className={cn('truncate text-[15px] font-black tabular-nums', forte ? 'text-[#6cff2f]' : 'text-[#f4f7f8]')} title={valor}>{valor}</p>
      {typeof barra === 'number' ? (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, barra)}%`, background: VERDE }} />
        </div>
      ) : nota ? <p className="truncate text-[9px] text-[#7c868c]">{nota}</p> : null}
    </div>
  );
}
