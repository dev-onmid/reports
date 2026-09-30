'use client';

import { useState, type ReactNode } from 'react';
import { Trophy } from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { T } from '@/lib/dashboard-tipografia';
import { MetaAdsMark, GoogleAdsMark } from '@/components/platform-logos';
import { Superficie } from './superficie';
import type {
  Plataforma, VendaPorCampanha, VendaPorConjunto, VendasPorAnuncio,
} from '@/app/api/crm/vendas-por-anuncio/route';

/**
 * Vendas e faturamento por ANÚNCIO — criativos, campanhas e conjuntos que
 * trouxeram o lead que comprou (CRM × rastreio). Os números da plataforma
 * dizem quem gerou lead barato; esta caixa diz quem gerou DINHEIRO.
 */

const VERDE = '#6cff2f';
// A aba Criativos saiu (30/09): o Funil de criativos mostra todos os anúncios, com
// prévia e o mesmo faturamento. Aqui ficam campanhas e conjuntos, que ele não cobre.
type Aba = 'campanhas' | 'conjuntos';

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
  dados, loading, investimentoDaCampanha,
}: {
  dados: VendasPorAnuncio | null;
  loading: boolean;
  /** Investimento da campanha no período (nome → R$), quando a plataforma informou. */
  investimentoDaCampanha: InvestimentoCampanha;
}) {
  const [aba, setAba] = useState<Aba>('campanhas');
  const titulo = 'Vendas e faturamento por campanha';
  const icone = <Trophy className="h-5 w-5" style={{ color: VERDE }} />;
  const temDados = !!dados && (dados.campanhas.length > 0 || dados.conjuntos.length > 0);

  if (!loading && !temDados) {
    return (
      <Superficie
        vazio titulo={titulo} icone={icone}
        avisoVazio="Nenhuma venda do período tem anúncio identificado no CRM."
      />
    );
  }

  const abas: Array<{ id: Aba; rotulo: string; n: number }> = [
    { id: 'campanhas', rotulo: 'Campanhas', n: dados?.campanhas.length ?? 0 },
    { id: 'conjuntos', rotulo: 'Conjuntos', n: dados?.conjuntos.length ?? 0 },
  ];

  const pctAtribuido = dados && dados.receitaTotal > 0 ? (dados.receitaAtribuida / dados.receitaTotal) * 100 : null;
  const ticket = dados && dados.vendasAtribuidas > 0 ? dados.receitaAtribuida / dados.vendasAtribuidas : null;

  return (
    <Superficie
      titulo={titulo}
      icone={icone}
      sub="o que cada campanha e conjunto trouxe em venda — cruzamento do CRM com o rastreio do lead"
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
