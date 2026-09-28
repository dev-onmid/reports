'use client';

import { useState, type ReactNode } from 'react';
import { ImageIcon, Trophy } from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { T } from '@/lib/dashboard-tipografia';
import { MetaAdsMark, GoogleAdsMark } from '@/components/platform-logos';
import { Superficie } from './superficie';
import type {
  Plataforma, VendaPorCampanha, VendaPorConjunto, VendaPorCriativo, VendasPorAnuncio,
} from '@/app/api/crm/vendas-por-anuncio/route';

/**
 * Vendas e faturamento por ANÚNCIO — criativos, campanhas e conjuntos que
 * trouxeram o lead que comprou (CRM × rastreio). Os números da plataforma
 * dizem quem gerou lead barato; esta caixa diz quem gerou DINHEIRO.
 */

const VERDE = '#6cff2f';
type Aba = 'criativos' | 'campanhas' | 'conjuntos';

const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR');
const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

function Marca({ p }: { p: Plataforma }) {
  if (p === 'meta') return <MetaAdsMark className="h-3.5 w-3.5 shrink-0 text-[#168BFF]" />;
  if (p === 'google') return <GoogleAdsMark className="h-3.5 w-3.5 shrink-0" />;
  return null;
}

/** Conversão lead → venda. Sem lead no período não inventa taxa. */
function conversao(vendas: number, leads: number): string {
  return leads > 0 ? fmtPct((vendas / leads) * 100) : '—';
}

export type InvestimentoCampanha = (nome: string) => number | null;

export function VendasPorAnuncioPanel({
  dados, loading, renderCriativo, investimentoDaCampanha,
}: {
  dados: VendasPorAnuncio | null;
  loading: boolean;
  /** Card com o preview do anúncio (o mesmo de "Melhores criativos"); null = sem preview. */
  renderCriativo: (c: VendaPorCriativo, index: number) => ReactNode | null;
  /** Investimento da campanha no período (nome → R$), quando a plataforma informou. */
  investimentoDaCampanha: InvestimentoCampanha;
}) {
  const [aba, setAba] = useState<Aba>('criativos');
  const titulo = 'Vendas e faturamento por anúncio';
  const icone = <Trophy className="h-5 w-5" style={{ color: VERDE }} />;
  const temDados = !!dados && (dados.criativos.length > 0 || dados.campanhas.length > 0 || dados.conjuntos.length > 0);

  if (!loading && !temDados) {
    return (
      <Superficie
        vazio titulo={titulo} icone={icone}
        avisoVazio="Nenhuma venda do período tem anúncio identificado no CRM."
      />
    );
  }

  const abas: Array<{ id: Aba; rotulo: string; n: number }> = [
    { id: 'criativos', rotulo: 'Criativos', n: dados?.criativos.length ?? 0 },
    { id: 'campanhas', rotulo: 'Campanhas', n: dados?.campanhas.length ?? 0 },
    { id: 'conjuntos', rotulo: 'Conjuntos', n: dados?.conjuntos.length ?? 0 },
  ];

  const pctAtribuido = dados && dados.receitaTotal > 0 ? (dados.receitaAtribuida / dados.receitaTotal) * 100 : null;
  const ticket = dados && dados.vendasAtribuidas > 0 ? dados.receitaAtribuida / dados.vendasAtribuidas : null;

  return (
    <Superficie
      titulo={titulo}
      icone={icone}
      sub="o que cada criativo, campanha e conjunto trouxe em venda — cruzamento do CRM com o rastreio do lead"
      direita={(
        <div className="flex rounded-lg bg-white/[0.04] p-1 ring-1 ring-white/[0.06]">
          {abas.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.06em] transition',
                aba === a.id ? 'bg-[#6cff2f] text-black' : 'text-[#a7b0b6] hover:text-white',
              )}
            >
              {a.rotulo}{a.n > 0 && <span className="ml-1.5 opacity-60">{a.n}</span>}
            </button>
          ))}
        </div>
      )}
    >
      {loading && !temDados ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[340px] w-[220px] shrink-0 animate-pulse rounded-xl bg-white/[0.04]" />
          ))}
        </div>
      ) : dados && (
        <div className="space-y-4">
          {/* Resumo: quanto do faturamento dá para rastrear até um anúncio. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Resumo
              rotulo="Faturamento atribuído"
              valor={formatCurrencyBRL(dados.receitaAtribuida)}
              nota={pctAtribuido !== null
                ? `${fmtPct(pctAtribuido)} de ${formatCurrencyBRL(dados.receitaTotal)} faturados no período`
                : 'sem faturamento no período'}
              barra={pctAtribuido}
            />
            <Resumo rotulo="Vendas atribuídas" valor={fmtInt(dados.vendasAtribuidas)} nota="clientes que compraram vindos de anúncio" />
            <Resumo rotulo="Ticket médio atribuído" valor={ticket !== null ? formatCurrencyBRL(ticket) : '—'} nota="faturamento ÷ vendas atribuídas" />
          </div>

          {aba === 'criativos' && <Criativos lista={dados.criativos} renderCriativo={renderCriativo} />}
          {aba === 'campanhas' && <TabelaCampanhas lista={dados.campanhas} investimentoDaCampanha={investimentoDaCampanha} />}
          {aba === 'conjuntos' && <TabelaConjuntos lista={dados.conjuntos} />}

          <p className={T.nota}>
            Venda conta uma vez por cliente (entrada e parcela da mesma compra somam no faturamento, não nas vendas).
            Faturamento pela data do ganho; leads pela data de entrada.
          </p>
        </div>
      )}
    </Superficie>
  );
}

function Resumo({ rotulo, valor, nota, barra }: { rotulo: string; valor: string; nota: string; barra?: number | null }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.05]">
      <p className={T.kpiRotulo}>{rotulo}</p>
      <p className={cn(T.kpiValor, 'mt-2')}>{valor}</p>
      {typeof barra === 'number' && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, barra)}%`, background: VERDE }} />
        </div>
      )}
      <p className={cn(T.nota, 'mt-2')}>{nota}</p>
    </div>
  );
}

function Criativos({ lista, renderCriativo }: {
  lista: VendaPorCriativo[];
  renderCriativo: (c: VendaPorCriativo, index: number) => ReactNode | null;
}) {
  if (lista.length === 0) return <p className="py-6 text-center text-sm text-[#9aa4aa]">Nenhum criativo com venda no período.</p>;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {lista.map((c, i) => renderCriativo(c, i) ?? <CardSemPreview key={c.chave} c={c} index={i} />)}
    </div>
  );
}

/** Anúncio sem preview (Google, ou só o nome veio no rastreio): mesmo tamanho do card com imagem. */
function CardSemPreview({ c, index }: { c: VendaPorCriativo; index: number }) {
  return (
    <div className="w-[220px] shrink-0 overflow-hidden rounded-xl bg-white/[0.03] ring-1 ring-white/[0.05]">
      <div className="relative flex flex-col items-center justify-center gap-2 bg-[#071014]" style={{ aspectRatio: '4/5' }}>
        {c.plataforma === 'google' ? <GoogleAdsMark className="h-8 w-8 opacity-70" /> : <ImageIcon className="h-6 w-6 text-[#9aa4aa]/40" />}
        <span className="px-4 text-center text-[10px] text-[#7c868c]">
          {c.plataforma === 'google' ? 'Anúncio de pesquisa' : 'Prévia indisponível'}
        </span>
        <span className="absolute bottom-2 left-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/85 text-[10px] font-black text-white">{index + 1}</span>
        <span className="absolute right-2 top-2 rounded bg-[#6cff2f] px-1.5 py-0.5 text-[9px] font-black text-black">
          {c.receita > 0 ? formatCurrencyBRL(c.receita) : 'sem valor'}
        </span>
      </div>
      <div className="p-2.5">
        {c.campanha && (
          <p className="mb-1 truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-[#6cff2f]/70" title={c.campanha}>{c.campanha}</p>
        )}
        <p className={cn('mb-2 truncate', T.listaRotulo)} title={c.nome}>{c.nome}</p>
        <MetricasVenda c={c} />
      </div>
    </div>
  );
}

/** As linhas de métrica de venda — as mesmas no card com e sem preview. */
export function MetricasVenda({ c, investimento }: { c: Pick<VendaPorCriativo, 'receita' | 'vendas' | 'leads'>; investimento?: number | null }) {
  const linhas: Array<[string, string]> = [
    ['Faturamento', c.receita > 0 ? formatCurrencyBRL(c.receita) : 'sem valor'],
    ['Vendas', fmtInt(c.vendas)],
    ['Leads', c.leads > 0 ? fmtInt(c.leads) : '—'],
    ['Conversão', conversao(c.vendas, c.leads)],
  ];
  if (investimento && investimento > 0) linhas.push(['ROAS', `${(c.receita / investimento).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x`]);
  return (
    <dl className="space-y-1 text-[11px]">
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} className="flex items-baseline justify-between gap-2">
          <dt className="font-black uppercase tracking-[0.06em] text-[#9aa4aa]">{rotulo}</dt>
          <dd className={cn('whitespace-nowrap font-black tabular-nums', rotulo === 'Faturamento' ? 'text-[#6cff2f]' : 'text-[#f4f7f8]')}>{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Posicao({ i }: { i: number }) {
  return (
    <span className={cn(
      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black',
      i === 0 ? 'bg-[#6cff2f] text-black' : 'bg-white/[0.06] text-[#dce4e8]',
    )}>{i + 1}</span>
  );
}

function BarraReceita({ valor, max }: { valor: number; max: number }) {
  return (
    <div className="min-w-0">
      {/* Venda fechada sem valor no CRM: "R$ 0,00" pareceria erro de soma. */}
      {valor > 0
        ? <p className="whitespace-nowrap text-right text-sm font-black tabular-nums text-[#f4f7f8]">{formatCurrencyBRL(valor)}</p>
        : <p className="whitespace-nowrap text-right text-xs font-semibold text-[#7c868c]" title="Venda marcada como fechada no CRM, sem valor lançado">sem valor lançado</p>}
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full" style={{ width: `${max > 0 && valor > 0 ? Math.max(3, (valor / max) * 100) : 0}%`, background: VERDE }} />
      </div>
    </div>
  );
}

const Num = ({ children, forte }: { children: ReactNode; forte?: boolean }) => (
  <span className={cn('whitespace-nowrap text-right tabular-nums', T.tabelaCel, forte ? 'font-black text-[#6cff2f]' : 'font-semibold text-[#dce4e8]')}>{children}</span>
);

const COLS_CAMPANHA = 'grid-cols-[28px_minmax(220px,1fr)_minmax(150px,190px)_repeat(5,minmax(76px,auto))]';
const COLS_CONJUNTO = 'grid-cols-[28px_minmax(240px,1fr)_minmax(150px,190px)_repeat(4,minmax(76px,auto))]';

function TabelaCampanhas({ lista, investimentoDaCampanha }: { lista: VendaPorCampanha[]; investimentoDaCampanha: InvestimentoCampanha }) {
  if (lista.length === 0) return <p className="py-6 text-center text-sm text-[#9aa4aa]">Nenhuma campanha com venda no período.</p>;
  const max = Math.max(...lista.map(c => c.receita));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        <div className={cn('grid items-center gap-3 border-b border-white/[0.06] px-2 pb-2', COLS_CAMPANHA, T.tabelaCab)}>
          <span>#</span><span>Campanha</span><span className="text-right">Faturamento</span>
          <span className="text-right">Vendas</span><span className="text-right">Leads</span>
          <span className="text-right">Conversão</span><span className="text-right">Investimento</span><span className="text-right">ROAS</span>
        </div>
        {lista.map((c, i) => {
          const inv = investimentoDaCampanha(c.nome);
          return (
            <div key={c.chave} className={cn('grid items-center gap-3 border-b border-white/[0.04] px-2 py-2.5 last:border-0', COLS_CAMPANHA)}>
              <Posicao i={i} />
              <div className="flex min-w-0 items-center gap-2">
                <Marca p={c.plataforma} />
                <span className={cn('truncate', T.listaRotulo)} title={c.nome}>{c.nome}</span>
              </div>
              <BarraReceita valor={c.receita} max={max} />
              <Num>{fmtInt(c.vendas)}</Num>
              <Num>{c.leads > 0 ? fmtInt(c.leads) : '—'}</Num>
              <Num>{conversao(c.vendas, c.leads)}</Num>
              <Num>{inv && inv > 0 ? formatCurrencyBRL(inv) : '—'}</Num>
              <Num forte={!!inv && inv > 0}>
                {inv && inv > 0 ? `${(c.receita / inv).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x` : '—'}
              </Num>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TabelaConjuntos({ lista }: { lista: VendaPorConjunto[] }) {
  if (lista.length === 0) return <p className="py-6 text-center text-sm text-[#9aa4aa]">Nenhum conjunto com venda no período.</p>;
  const max = Math.max(...lista.map(c => c.receita));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[780px]">
        <div className={cn('grid items-center gap-3 border-b border-white/[0.06] px-2 pb-2', COLS_CONJUNTO, T.tabelaCab)}>
          <span>#</span><span>Conjunto</span><span className="text-right">Faturamento</span>
          <span className="text-right">Vendas</span><span className="text-right">Leads</span>
          <span className="text-right">Conversão</span><span className="text-right">Ticket</span>
        </div>
        {lista.map((c, i) => (
          <div key={c.chave} className={cn('grid items-center gap-3 border-b border-white/[0.04] px-2 py-2.5 last:border-0', COLS_CONJUNTO)}>
            <Posicao i={i} />
            <div className="flex min-w-0 items-center gap-2">
              <Marca p={c.plataforma} />
              <div className="min-w-0">
                <p className={cn('truncate', T.listaRotulo)} title={c.nome}>{c.nome}</p>
                {c.campanha && <p className="truncate text-[10px] text-[#7c868c]" title={c.campanha}>{c.campanha}</p>}
              </div>
            </div>
            <BarraReceita valor={c.receita} max={max} />
            <Num>{fmtInt(c.vendas)}</Num>
            <Num>{c.leads > 0 ? fmtInt(c.leads) : '—'}</Num>
            <Num>{conversao(c.vendas, c.leads)}</Num>
            <Num>{c.vendas > 0 && c.receita > 0 ? formatCurrencyBRL(c.receita / c.vendas) : '—'}</Num>
          </div>
        ))}
      </div>
    </div>
  );
}
