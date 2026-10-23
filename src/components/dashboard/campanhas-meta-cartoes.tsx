'use client';

import { useMemo, useState } from 'react';
import {
  BarChart3, Eye, ImageIcon, Megaphone, MessageCircle, MousePointerClick, Play, Receipt,
  ShoppingCart, Target, TrendingUp, UserPlus, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import type { CampaignPerformance } from '@/app/api/campaigns/route';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';
import type { VendasPorAnuncio } from '@/app/api/crm/vendas-por-anuncio/route';
import { descreverFontes, juntarFontes, totalDasFontes } from '@/lib/fonte-venda';
import {
  UNIDADE, desdeQuando, fraseDaCampanha, fraseDoCriativo, nomeLimpo, rankearAnuncios, resultadoDoAnuncio,
  tipoDaCampanha, type AnuncioDaCampanha, type NumerosCampanha, type TipoCampanha,
} from '@/lib/campanha-cartao';

/**
 * Campanhas Meta no formato do relatório impresso (slide "Campanhas Veiculadas
 * Meta Ads"): um cartão por campanha com o que aconteceu numa frase, as métricas
 * do OBJETIVO dela e os 3 melhores criativos. Substitui a tabela, que o Matheus
 * achou poluída (2026-10-23). A tabela com conjuntos e anúncios continua a um
 * clique ("Ver conjuntos e anúncios"), para quem precisa descer o nível.
 */

const CRIATIVOS_POR_CAMPANHA = 3;

const ESTILO: Record<TipoCampanha, { cor: string; icone: LucideIcon; rotulo: string }> = {
  vendas: { cor: '#6cff2f', icone: ShoppingCart, rotulo: 'Vendas' },
  mensagens: { cor: '#2dd4bf', icone: MessageCircle, rotulo: 'Mensagens' },
  leads: { cor: '#2dd4bf', icone: UserPlus, rotulo: 'Cadastros' },
  trafego: { cor: '#60a5fa', icone: MousePointerClick, rotulo: 'Tráfego' },
  alcance: { cor: '#fbbf24', icone: Megaphone, rotulo: 'Alcance' },
  engajamento: { cor: '#a78bfa', icone: TrendingUp, rotulo: 'Engajamento' },
};

const brl = (v: number) => (v > 0 ? formatCurrencyBRL(v) : '—');
const int = (v: number) => (v > 0 ? Math.round(v).toLocaleString('pt-BR') : '—');
const pctTxt = (v: number) => (v > 0 ? `${v.toFixed(2).replace('.', ',')}%` : '—');
const roasTxt = (v: number | null) => (v !== null && v > 0 ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x` : '—');

type Metrica = { icone: LucideIcon; rotulo: string; valor: string; dica?: string };

export function CampanhasMetaCartoes({ campanhas, criativos, vendas, comprasMeta, onPreview, tabela }: {
  campanhas: CampaignPerformance[];
  criativos: TopCreative[];
  /** Vendas do CRM por campanha (com as fontes). Null = dashboard sem receita. */
  vendas: VendasPorAnuncio | null;
  /** Cliente com cardápio: a compra atribuída pela Meta é venda (ver lib/fonte-venda). */
  comprasMeta: boolean;
  onPreview: (c: TopCreative) => void;
  /** A tabela detalhada (conjuntos e anúncios), aberta sob demanda. */
  tabela: React.ReactNode;
}) {
  const [verTabela, setVerTabela] = useState(false);
  const porCampanha = useMemo(() => {
    const m = new Map<string, TopCreative[]>();
    for (const c of criativos) {
      if (!c.campaignId) continue;
      const l = m.get(c.campaignId) ?? [];
      l.push(c);
      m.set(c.campaignId, l);
    }
    return m;
  }, [criativos]);
  const vendasCamp = useMemo(() => {
    const k = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
    const m = new Map((vendas?.campanhas ?? []).map((c) => [c.chave, c]));
    return (c: CampaignPerformance) => m.get(k(c.name)) ?? m.get(k(c.id));
  }, [vendas]);

  return (
    <div className="flex flex-col gap-3">
      {campanhas.map((c) => (
        <CartaoCampanha
          key={c.id}
          c={c}
          anuncios={porCampanha.get(c.id) ?? []}
          vendasCrm={vendas ? vendasCamp(c) ?? null : null}
          comReceita={!!vendas}
          comprasMeta={comprasMeta}
          onPreview={onPreview}
        />
      ))}
      <div>
        <button
          type="button"
          onClick={() => setVerTabela((v) => !v)}
          className="rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.04em] text-[#a7b0b6] ring-1 ring-white/[0.08] transition hover:text-white"
        >
          {verTabela ? 'Esconder conjuntos e anúncios' : 'Ver conjuntos e anúncios'}
        </button>
        {verTabela && <div className="mt-3">{tabela}</div>}
      </div>
    </div>
  );
}

function CartaoCampanha({ c, anuncios, vendasCrm, comReceita, comprasMeta, onPreview }: {
  c: CampaignPerformance;
  anuncios: TopCreative[];
  vendasCrm: VendasPorAnuncio['campanhas'][number] | null;
  comReceita: boolean;
  comprasMeta: boolean;
  onPreview: (c: TopCreative) => void;
}) {
  const n: NumerosCampanha = {
    investimento: c.spend,
    conversas: c.conversas ?? 0,
    leads: c.leadsFormulario ?? 0,
    compras: c.compras ?? 0,
    valorCompras: c.valorCompras ?? 0,
    cliques: c.clicks,
    impressoes: c.impressions,
    alcance: c.alcance ?? 0,
    frequencia: c.frequencia ?? 0,
  };
  const tipo = tipoDaCampanha(c.objetivoMeta, n.conversas, n.leads);
  const est = ESTILO[tipo];
  const u = UNIDADE[tipo];
  const resultado = tipo === 'mensagens' ? n.conversas : tipo === 'leads' ? n.leads : tipo === 'vendas' ? n.compras : 0;
  const custo = resultado > 0 ? n.investimento / resultado : 0;

  // Vendas que se somam (CRM por fonte + cardápio), como na tabela.
  const fontes = juntarFontes(
    vendasCrm?.fontes ?? (vendasCrm && (vendasCrm.vendas > 0 || vendasCrm.receita > 0) ? { crm: { vendas: vendasCrm.vendas, receita: vendasCrm.receita } } : null),
    comprasMeta && n.compras > 0 ? { cardapio: { vendas: n.compras, receita: n.valorCompras } } : null,
  );
  const tot = totalDasFontes(fontes);
  const dicaFontes = descreverFontes(fontes);
  const roas = tot.receita > 0 && n.investimento > 0 ? tot.receita / n.investimento : null;

  const verba: Metrica = {
    icone: Wallet, rotulo: 'Verba/dia',
    valor: c.dailyBudget != null ? `${c.lifetimeBudget ? '~' : ''}${formatCurrencyBRL(c.dailyBudget)}` : c.lifetimeBudget ? `${formatCurrencyBRL(c.lifetimeBudget)} total` : '—',
    dica: c.lifetimeBudget ? `Orçamento total de ${formatCurrencyBRL(c.lifetimeBudget)}` : c.budgetNosConjuntos ? 'Soma da verba dos conjuntos ativos' : undefined,
  };
  const investimento: Metrica = { icone: Wallet, rotulo: 'Investimento', valor: brl(n.investimento) };
  const vendasMetricas: Metrica[] = comReceita && tot.vendas > 0 ? [
    { icone: ShoppingCart, rotulo: 'Vendas', valor: int(tot.vendas), dica: dicaFontes },
    { icone: Receipt, rotulo: 'Faturamento', valor: tot.receita > 0 ? formatCurrencyBRL(tot.receita) : 'sem valor', dica: dicaFontes },
    { icone: TrendingUp, rotulo: 'ROAS', valor: roasTxt(roas), dica: 'Faturamento ÷ investimento' },
  ] : [];

  let linha1: Metrica[];
  let linha2: Metrica[];
  if (tipo === 'mensagens' || tipo === 'leads') {
    linha1 = [
      investimento,
      { icone: MessageCircle, rotulo: tipo === 'leads' ? 'Leads' : 'Conversas iniciadas', valor: int(resultado) },
      { icone: Target, rotulo: tipo === 'leads' ? 'Custo por lead' : 'Custo/conversa', valor: brl(custo) },
    ];
    linha2 = vendasMetricas.length ? vendasMetricas : [
      { icone: Users, rotulo: 'Pessoas atingidas', valor: int(n.alcance) },
      { icone: BarChart3, rotulo: 'Frequência', valor: n.frequencia > 0 ? n.frequencia.toFixed(2).replace('.', ',') : '—' },
      { icone: MousePointerClick, rotulo: 'Cliques', valor: int(n.cliques) },
    ];
  } else if (tipo === 'vendas') {
    linha1 = [
      investimento,
      { icone: ShoppingCart, rotulo: 'Compras registradas', valor: int(n.compras) },
      { icone: Target, rotulo: 'Custo por compra', valor: brl(custo) },
    ];
    linha2 = vendasMetricas.length ? vendasMetricas : [
      { icone: Receipt, rotulo: 'Valor de venda', valor: brl(n.valorCompras) },
      { icone: TrendingUp, rotulo: 'ROAS', valor: roasTxt(n.valorCompras > 0 && n.investimento > 0 ? n.valorCompras / n.investimento : null) },
      { icone: MousePointerClick, rotulo: 'Cliques', valor: int(n.cliques) },
    ];
  } else if (tipo === 'trafego') {
    linha1 = [investimento, { icone: MousePointerClick, rotulo: 'Cliques', valor: int(n.cliques) }, { icone: Target, rotulo: 'CPC', valor: brl(n.cliques > 0 ? n.investimento / n.cliques : 0) }];
    linha2 = [{ icone: Users, rotulo: 'Pessoas atingidas', valor: int(n.alcance) }, { icone: Eye, rotulo: 'Impressões', valor: int(n.impressoes) }, { icone: TrendingUp, rotulo: 'CTR', valor: pctTxt(c.ctr) }];
  } else {
    linha1 = [investimento, { icone: Users, rotulo: 'Pessoas atingidas', valor: int(n.alcance) }, { icone: Eye, rotulo: 'Impressões', valor: int(n.impressoes) }];
    linha2 = [{ icone: Target, rotulo: 'CPM', valor: brl(n.impressoes > 0 ? n.investimento / (n.impressoes / 1000) : 0) }, { icone: BarChart3, rotulo: 'Frequência', valor: n.frequencia > 0 ? n.frequencia.toFixed(2).replace('.', ',') : '—' }, { icone: MousePointerClick, rotulo: 'Cliques', valor: int(n.cliques) }];
  }

  const lista: Array<AnuncioDaCampanha & { c: TopCreative }> = anuncios.map((a) => ({
    id: a.adId, nome: a.adName, investimento: a.spend, leads: a.leads, compras: a.compras ?? 0,
    valorCompras: a.valorCompras ?? 0, cliques: a.clicks, impressoes: a.impressions, c: a,
  }));
  const ranking = rankearAnuncios(tipo, lista);
  const top = ranking.slice(0, CRIATIVOS_POR_CAMPANHA);
  const frase = fraseDaCampanha(tipo, n) + fraseDoCriativo(tipo, ranking[0], lista.length);
  const ativa = c.status === 'ACTIVE';
  const desde = desdeQuando(c.inicio);

  return (
    <div
      className="grid gap-5 rounded-[14px] border border-white/[0.07] bg-[#0d1519] p-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
      style={{ borderLeft: `4px solid ${est.cor}` }}
    >
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: `${est.cor}1f` }}>
            <est.icone className="h-[18px] w-[18px]" style={{ color: est.cor }} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-extrabold leading-tight text-[#f4f7f8]" title={c.name}>{nomeLimpo(c.name)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] font-bold">
              <span className="rounded-full px-2 py-0.5" style={{ background: `${est.cor}1a`, color: est.cor }}>{est.rotulo}</span>
              <span className={cn('rounded-full px-2 py-0.5', ativa ? 'bg-[#10b981]/15 text-[#34d399]' : 'bg-white/[0.06] text-[#a7b0b6]')}>
                {ativa ? 'Ativa' : 'Pausada'}
              </span>
              {verba.valor !== '—' && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[#c9d1d6]" title={verba.dica}>verba {verba.valor}{c.dailyBudget != null ? '/dia' : ''}</span>}
              {desde && <span className="text-[#7c868c]">{desde}</span>}
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-[#c9d1d6]">{frase}</p>
          </div>
        </div>
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <div className="grid grid-cols-3 gap-3">{linha1.map((m) => <MetricaItem key={m.rotulo} m={m} cor={est.cor} />)}</div>
          <div className="mt-3 grid grid-cols-3 gap-3">{linha2.map((m) => <MetricaItem key={m.rotulo} m={m} cor={est.cor} />)}</div>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[10.5px] font-black uppercase tracking-[0.05em]" style={{ color: est.cor }}>
          {lista.length > CRIATIVOS_POR_CAMPANHA ? `Melhores criativos · ${top.length} de ${lista.length} por ${u.varios}` : `Criativos · por ${u.varios}`}
        </p>
        {top.length > 0 ? (
          <div className="mt-2 grid grid-cols-3 gap-3">
            {top.map((a, i) => <CardCriativo key={a.id} a={a} pos={i} tipo={tipo} cor={est.cor} onPreview={onPreview} />)}
          </div>
        ) : (
          <div className="mt-2 flex h-[150px] items-center justify-center rounded-xl border border-dashed border-white/[0.1] text-[12px] text-[#7c868c]">
            Nenhum anúncio desta campanha teve entrega no período.
          </div>
        )}
      </div>
    </div>
  );
}

function MetricaItem({ m, cor }: { m: Metrica; cor: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2" title={m.dica}>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: `${cor}14` }}>
        <m.icone className="h-3.5 w-3.5" style={{ color: cor }} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold text-[#9aa4aa]">{m.rotulo}</p>
        <p className={cn('truncate text-[16px] font-extrabold leading-tight tabular-nums', m.valor === '—' ? 'text-[#4a545a]' : 'text-[#f4f7f8]')}>{m.valor}</p>
      </div>
    </div>
  );
}

function CardCriativo({ a, pos, tipo, cor, onPreview }: {
  a: AnuncioDaCampanha & { c: TopCreative }; pos: number; tipo: TipoCampanha; cor: string; onPreview: (c: TopCreative) => void;
}) {
  const [erro, setErro] = useState(false);
  const u = UNIDADE[tipo];
  const r = resultadoDoAnuncio(tipo, a);
  const capa = a.c.imageUrl ?? a.c.thumbnailUrl;
  const video = a.c.mediaType === 'video' || (a.c.views3s ?? 0) > 0;
  const custo = r > 0 && a.investimento > 0 ? a.investimento / r : 0;
  const linhaResultado = tipo === 'alcance' || tipo === 'engajamento'
    ? `${int(a.impressoes)} impressões`
    : r > 0 ? `${Math.round(r).toLocaleString('pt-BR')} ${r === 1 ? u.um : u.varios}` : `sem ${u.varios}`;
  const linhaCusto = tipo === 'alcance' || tipo === 'engajamento'
    ? (a.impressoes > 0 ? `CPM ${formatCurrencyBRL(a.investimento / (a.impressoes / 1000))}` : brl(a.investimento))
    : custo > 0 ? `${formatCurrencyBRL(custo)} ${u.custo}` : `${brl(a.investimento)} investidos`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={() => onPreview(a.c)}
        className="group relative h-[150px] overflow-hidden rounded-lg bg-[#071014] ring-1 ring-white/[0.06]"
        title="Ver o criativo"
      >
        {capa && !erro ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={capa} alt={a.nome} loading="lazy" onError={() => setErro(true)} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1 text-[10px] text-[#7c868c]"><ImageIcon className="h-5 w-5 opacity-40" />sem prévia</span>
        )}
        {video && capa && !erro && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 ring-1 ring-white/30"><Play className="h-3 w-3 fill-white text-white" /></span>
          </span>
        )}
        <span className="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-black text-black" style={{ background: pos === 0 ? cor : 'rgba(255,255,255,.75)' }}>{pos + 1}º</span>
      </button>
      <p className="truncate text-[11px] font-bold text-[#a7b0b6]" title={a.nome}>{nomeLimpo(a.nome)}</p>
      <p className="truncate text-[14px] font-black leading-tight" style={{ color: r > 0 ? cor : '#4a545a' }}>{linhaResultado}</p>
      <p className="truncate text-[11px] font-semibold text-[#c9d1d6]">{linhaCusto}</p>
      {tipo === 'vendas' && a.valorCompras > 0 && <p className="truncate text-[11px] font-semibold text-[#c9d1d6]">{formatCurrencyBRL(a.valorCompras)} em vendas</p>}
    </div>
  );
}
