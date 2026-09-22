'use client';

// "Ranking comercial" e "Categorias mais vendidas" — os dois painéis do CRM
// externo (Agendor) que o Matheus mandou como referência visual.
//
// ⚠️ As três colunas de vendedor têm réguas de data DIFERENTES (ganho pela data
// do ganho, perdido pela da perda, novo pela da criação) — a rota
// /api/crm/desempenho explica por quê. Aqui só se exibe.
//
// ⚠️ E os três valores NÃO são a mesma moeda: ganho é faturamento gravado,
// perdido e novo são a estimativa digitada no CRM. Por isso o ranking mostra
// só o faturamento em destaque e os outros dois como CONTAGEM nos selos —
// juntar tudo como dinheiro faria R$ 1,02 mi de "perdidos" parecer receita.

import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';

export type LinhaVendedor = {
  responsavel: string;
  ganhos: number; ganhos_valor: number;
  perdidos: number; perdidos_valor: number;
  novos: number; novos_valor: number;
};

export type LinhaCategoria = { categoria: string; negocios: number; itens: number; valor: number };

/** Quantos aparecem antes de "Ver tudo". */
const TOPO_RANKING = 4;
const TOPO_CATEGORIAS = 5;

/**
 * Paleta das categorias — os mesmos tons já usados nos degraus do funil, na
 * ordem da referência (verde, azul, roxo, laranja, rosa). Reaproveitar em vez
 * de inventar mantém a tela com uma linguagem de cor só.
 */
const CORES_CATEGORIA = ['#6cff2f', '#0ea5e9', '#7b2cff', '#f97316', '#ec4899'];
/** "Outras" não é uma categoria: fica em cinza e nunca consome um tom. */
const CINZA = '#6b7478';

const nf = new Intl.NumberFormat('pt-BR');
const pct = (v: number) => `${v.toFixed(1).replace('.', ',')}%`;

/**
 * Iniciais do avatar: primeira + última do nome completo, e só a PRIMEIRA
 * quando o nome tem uma palavra ("Jessica" → J, como na referência).
 */
function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0][0].toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

// ── Peças compartilhadas pelos dois cards ───────────────────────────────────

function Cartao({ titulo, acao, children }: {
  titulo: string; acao?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-[12px] border border-[#233038] bg-[#0B1115] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#F1F4F5]">{titulo}</h4>
        {acao}
      </div>
      {children}
    </section>
  );
}

/** Botão de rodapé — some para baixo com `mt-auto` para os dois cards fecharem na mesma altura. */
function BotaoRodape({ texto, onClick }: { texto: string; onClick: () => void }) {
  return (
    <div className="mt-auto pt-4">
      <button
        type="button"
        onClick={onClick}
        className="mx-auto flex h-[34px] w-full max-w-[300px] items-center justify-center gap-2 rounded-[10px] border border-[#28343B] bg-transparent px-4 text-[12px] font-medium text-[#87929B] transition-colors hover:border-[#6cff2f]/35 hover:text-[#F1F4F5]"
      >
        {texto} <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="flex-1 py-10 text-center text-[12px] text-[#87929B]">{texto}</p>;
}

function Esqueleto() {
  return <div className="h-[280px] animate-pulse rounded-[10px] bg-white/[0.04]" />;
}

// ── Ranking comercial ───────────────────────────────────────────────────────

type OrdemRanking = 'faturamento' | 'ganhos' | 'novos';
const ORDENS: Array<{ k: OrdemRanking; rotulo: string }> = [
  { k: 'faturamento', rotulo: 'Por faturamento' },
  { k: 'ganhos', rotulo: 'Por ganhos' },
  { k: 'novos', rotulo: 'Por novos' },
];

/** Medalha nos três primeiros; do 4º em diante, círculo neutro só com o número. */
const MEDALHA = [
  'border-amber-400/60 bg-amber-400/20 text-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.18)]',
  'border-slate-300/50 bg-slate-300/[0.16] text-slate-100',
  'border-orange-600/60 bg-orange-600/20 text-orange-200',
];

function Selo({ n, texto, tom }: { n: number; texto: string; tom: 'bom' | 'ruim' | 'novo' }) {
  // Zero perdido não é um alerta — fica neutro, como na referência.
  const neutro = tom === 'ruim' && n === 0;
  return (
    <span className={cn(
      'rounded-[5px] border px-1.5 py-[3px] text-[10px] font-semibold leading-none',
      neutro ? 'border-white/[0.10] bg-white/[0.04] text-[#87929B]'
        : tom === 'bom' ? 'border-[#6cff2f]/30 bg-[#6cff2f]/[0.08] text-[#6cff2f]'
        : tom === 'ruim' ? 'border-red-400/30 bg-red-400/[0.08] text-red-400'
        : 'border-[#38bdf8]/30 bg-[#38bdf8]/[0.08] text-[#38bdf8]',
    )}>
      {nf.format(n)} {texto}
    </span>
  );
}

export function VendedoresCard({ linhas, loading }: { linhas: LinhaVendedor[]; loading: boolean }) {
  const [ordem, setOrdem] = useState<OrdemRanking>('faturamento');
  const [tudo, setTudo] = useState(false);

  const metrica = (l: LinhaVendedor) =>
    ordem === 'faturamento' ? l.ganhos_valor : ordem === 'ganhos' ? l.ganhos : l.novos;

  const ordenadas = useMemo(
    () => [...linhas].sort((a, b) => metrica(b) - metrica(a) || b.ganhos_valor - a.ganhos_valor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linhas, ordem],
  );
  // ⚠️ Barra proporcional ao PRIMEIRO, não ao total: com um vendedor dominante
  // as demais viram fios invisíveis e o ranking deixa de comparar.
  const topo = ordenadas.length ? metrica(ordenadas[0]) : 0;
  const visiveis = tudo ? ordenadas : ordenadas.slice(0, TOPO_RANKING);

  const seletor = (
    <select
      value={ordem}
      onChange={(e) => setOrdem(e.target.value as OrdemRanking)}
      aria-label="Ordenar ranking"
      className="h-[34px] w-[150px] rounded-[6px] border border-[#233038] bg-[#111A20] px-2 text-[12px] text-[#87929B] outline-none [color-scheme:dark] focus:border-[#6cff2f]/40"
    >
      {ORDENS.map((o) => <option key={o.k} value={o.k}>{o.rotulo}</option>)}
    </select>
  );

  return (
    <Cartao titulo="Ranking comercial" acao={seletor}>
      {loading ? <Esqueleto />
        : ordenadas.length === 0 ? <Vazio texto="Nenhum negócio com responsável no período." />
        : (
          <div className="space-y-4">
            {visiveis.map((l, i) => (
              <div key={l.responsavel} className="flex items-start gap-3">
                <span className={cn(
                  'mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold',
                  MEDALHA[i] ?? 'border-[#28343B] bg-transparent text-[#87929B]',
                )}>
                  {i + 1}
                </span>
                <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#263038] text-[12px] font-bold text-[#F1F4F5]">
                  {iniciais(l.responsavel)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[14px] font-semibold text-[#F1F4F5]" title={l.responsavel}>
                      {l.responsavel}
                    </span>
                    <span className="shrink-0 text-[14px] font-bold text-[#F1F4F5]">
                      {formatCurrencyBRL(l.ganhos_valor)}
                    </span>
                  </div>
                  <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-[#172027]">
                    <div className="h-full rounded-full bg-[#6cff2f]"
                      style={{ width: `${topo > 0 ? Math.max((metrica(l) / topo) * 100, 1.5) : 0}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Selo n={l.ganhos} texto="ganhos" tom="bom" />
                    <Selo n={l.perdidos} texto="perdidos" tom="ruim" />
                    <Selo n={l.novos} texto="novos" tom="novo" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      {ordenadas.length > TOPO_RANKING && (
        <BotaoRodape
          texto={tudo ? 'Mostrar só o top 4' : 'Ver ranking completo'}
          onClick={() => setTudo((t) => !t)}
        />
      )}
      {/* ⚠️ Sem esta linha o valor de perdidos/novos é lido como dinheiro real.
          Só o faturamento acima é receita gravada. */}
      <p className="mt-3 text-[10px] leading-snug text-[#6b7478]">
        Valor = faturamento dos negócios ganhos. Perdidos e novos aparecem em quantidade porque o valor deles
        é estimativa do CRM.
      </p>
    </Cartao>
  );
}

// ── Categorias mais vendidas ────────────────────────────────────────────────

type EixoCategoria = 'itens' | 'valor';

export function CategoriasCard({ linhas, loading }: { linhas: LinhaCategoria[]; loading: boolean }) {
  const [eixo, setEixo] = useState<EixoCategoria>('itens');
  const [tudo, setTudo] = useState(false);

  const valorDe = (l: LinhaCategoria) => (eixo === 'itens' ? l.itens : l.valor);

  const { lista, total } = useMemo(() => {
    const ordenadas = [...linhas]
      .map((l) => ({ nome: l.categoria, valor: valorDe(l) }))
      .filter((l) => l.valor > 0)
      .sort((a, b) => b.valor - a.valor);
    const soma = ordenadas.reduce((s, l) => s + l.valor, 0);
    if (ordenadas.length <= TOPO_CATEGORIAS + 1) {
      return { lista: ordenadas, total: soma };
    }
    const cabeca = ordenadas.slice(0, TOPO_CATEGORIAS);
    const cauda = ordenadas.slice(TOPO_CATEGORIAS);
    // ⚠️ "Outras" leva o RESTO exato: se levasse só a soma da cauda visível, as
    // barras não fechariam com o total do topo.
    const comOutras = [...cabeca, {
      nome: `Outras ${cauda.length} categoria${cauda.length === 1 ? '' : 's'}`,
      valor: soma - cabeca.reduce((s, l) => s + l.valor, 0),
    }];
    // Recolhido: top 5 + "Outras". "Ver todas" abre a lista inteira — as barras
    // são identificadas pelo rótulo, então as que passam do 5º ficam em cinza
    // sem repetir tom.
    return { lista: tudo ? ordenadas : comOutras, total: soma };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, eixo, tudo]);

  const ehOutras = (nome: string) => nome.startsWith('Outras');
  /** Só as 5 primeiras ganham tom; o resto (e "Outras") fica cinza. */
  const corDe = (nome: string, i: number) =>
    ehOutras(nome) || i >= CORES_CATEGORIA.length ? CINZA : CORES_CATEGORIA[i];
  // Escala relativa ao MAIOR item exibido, para as barras menores continuarem
  // perceptíveis (uma barra de 7% sobre 100% seria um fio).
  const maior = lista.length ? Math.max(...lista.map((f) => f.valor)) : 0;
  const fmtTotal = eixo === 'itens' ? nf.format(Math.round(total)) : formatCurrencyBRL(total);

  const toggle = (
    <div className="flex items-center gap-1">
      {(['itens', 'valor'] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => setEixo(k)}
          className={cn(
            'rounded-[6px] px-2.5 py-[5px] text-[11px] transition-colors',
            eixo === k ? 'bg-[#6cff2f] font-bold text-black' : 'bg-[#172027] font-medium text-[#87929B] hover:text-[#F1F4F5]',
          )}
        >
          {k === 'itens' ? 'Por itens' : 'Por valor'}
        </button>
      ))}
    </div>
  );

  return (
    <Cartao titulo="Categorias mais vendidas" acao={toggle}>
      {loading ? <Esqueleto />
        : lista.length === 0 ? <Vazio texto="Nenhum produto lançado nos negócios ganhos do período." />
        : (
          // ⚠️ Era um donut: com uma categoria dominante ele virava um anel de
          // uma cor só. Barras horizontais ORDENADAS comparam por comprimento,
          // com rótulo, valor e % lado a lado.
          <div className="min-w-0">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#87929B]">
                Total {eixo === 'itens' ? 'de itens vendidos' : 'faturado'}
              </span>
              <span className="font-heading text-[22px] leading-none text-[#F1F4F5]">{fmtTotal}</span>
            </div>
            <ul className={cn('space-y-3', tudo && 'max-h-[260px] overflow-y-auto pr-1')}>
              {lista.map((f, i) => {
                const p = total > 0 ? (f.valor / total) * 100 : 0;
                const cor = corDe(f.nome, i);
                return (
                  <li key={f.nome} className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-[#dfe6ea]" title={f.nome}>{f.nome}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[#87929B]">
                        {eixo === 'itens' ? nf.format(Math.round(f.valor)) : formatCurrencyBRL(f.valor)}
                      </span>
                      <span className="w-[46px] shrink-0 text-right text-[12px] font-bold tabular-nums text-[#F1F4F5]">{pct(p)}</span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#172027]">
                      <div className="h-full rounded-full"
                        style={{ width: `${maior > 0 ? Math.max((f.valor / maior) * 100, 1.5) : 0}%`, backgroundColor: cor }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

      {linhas.length > TOPO_CATEGORIAS + 1 && (
        <BotaoRodape
          texto={tudo ? 'Mostrar só o top 5' : 'Ver todas as categorias'}
          onClick={() => setTudo((t) => !t)}
        />
      )}
      <p className="mt-3 text-[10px] leading-snug text-[#6b7478]">
        Só negócios ganhos no período · {eixo === 'itens' ? 'soma da quantidade de cada item' : 'soma do valor de cada item'}
      </p>
    </Cartao>
  );
}
