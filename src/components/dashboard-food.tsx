"use client";

// Blocos do MODO FOOD / DELIVERY do dashboard (seção 6 do briefing).
//
// Regra que atravessa o arquivo inteiro (seção 9): bloco sem integração ativa
// mostra ESTADO VAZIO explicando o que conectar — nunca zeros. Zeros mentem: no
// print 07 do briefing, o bloco Delivery com todos os contadores zerados sugeria
// operação parada, quando na verdade era integração ausente.
//
// Palette hardcoded do layout premium do dashboard (bg-[#05090B] etc.), NÃO os
// tokens do design system — é o padrão daquela tela.

import { useEffect, useMemo, useState } from 'react';
import {
  ShoppingBag, DollarSign, Receipt, Users, Package, MessageCircle, Info,
} from 'lucide-react';
import {
  calcularFaturamento, conversaoCatalogo, formatarMetrica, formatarVariacao,
  taxaFidelidade, taxaRecorrencia, taxaPassagem, variacao,
  ETAPAS_FUNIL_FOOD, FONTE_ETAPA_FOOD, ROTULO_ETAPA_FOOD, ROTULO_COMPONENTE,
  SEM_DADO,
  type ComponenteReceita, type FunilFood, type Metrica,
} from '@/lib/metricas-food';
import { cn } from '@/lib/utils';

// ────────────────────────────────────────────────────────── chrome comum

function Painel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[14px] border border-white/[0.08] bg-[#0b1216]', className)}>
      {children}
    </div>
  );
}

function TituloBloco({ children, fonte }: { children: React.ReactNode; fonte?: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-2">
      <h3 className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">{children}</h3>
      {fonte && <span className="text-[10px] text-[#9aa4aa]">· {fonte}</span>}
    </div>
  );
}

/**
 * Estado vazio honesto — o coração da seção 9. Diz O QUE falta e COMO ligar,
 * em vez de desenhar zeros que parecem operação parada.
 */
export function SemIntegracao({ titulo, oQueFalta, comoLigar }: {
  titulo: string; oQueFalta: string; comoLigar: string;
}) {
  return (
    <Painel className="p-5">
      <TituloBloco>{titulo}</TituloBloco>
      <div className="rounded-[10px] border border-dashed border-white/[0.12] bg-[#071014] px-4 py-6 text-center">
        <Info className="mx-auto mb-2 h-4 w-4 text-[#9aa4aa]" />
        <p className="text-[13px] text-[#dce4e8]">{oQueFalta}</p>
        <p className="mt-1 text-[11px] text-[#9aa4aa]">{comoLigar}</p>
      </div>
    </Painel>
  );
}

function Variacao({ v, menorMelhor }: { v: Metrica; menorMelhor?: boolean }) {
  if (v === null) return <span className="text-[10px] text-[#9aa4aa]">{SEM_DADO} vs anterior</span>;
  const bom = menorMelhor ? v < 0 : v > 0;
  return (
    <span className={cn('text-[10px] font-bold', bom ? 'text-[#6cff2f]' : 'text-red-400')}>
      {formatarVariacao(v)} <span className="font-normal text-[#9aa4aa]">vs período anterior</span>
    </span>
  );
}

// ──────────────────────────────────────────── 2. Resultado do negócio

export type ResultadoNegocio = {
  faturamento: number; pedidos: number; ticketMedio: number;
  varFaturamento: Metrica; varPedidos: Metrica; varTicket: Metrica;
};

export function ResultadoNegocioFood({ dados }: { dados: ResultadoNegocio }) {
  const cards = [
    { rotulo: 'Faturamento', valor: formatarMetrica(dados.faturamento, 'moeda'), v: dados.varFaturamento, icone: DollarSign },
    { rotulo: 'Pedidos', valor: formatarMetrica(dados.pedidos, 'inteiro'), v: dados.varPedidos, icone: ShoppingBag },
    { rotulo: 'Ticket médio', valor: formatarMetrica(dados.ticketMedio || null, 'moeda'), v: dados.varTicket, icone: Receipt },
  ];
  return (
    <Painel className="p-5">
      <TituloBloco fonte="pedidos do cardápio digital">Resultado do negócio</TituloBloco>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map(c => (
          <div key={c.rotulo} className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-4">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.07em] text-[#9aa4aa]">
              <c.icone className="h-3.5 w-3.5" /> {c.rotulo}
            </div>
            <p className="font-heading text-2xl leading-none text-[#f4f7f8]">{c.valor}</p>
            <div className="mt-2"><Variacao v={c.v} /></div>
          </div>
        ))}
      </div>
    </Painel>
  );
}

// ──────────────────────────────────────────── 3. Decomposição do faturamento

export type ValoresDecomposicao = Partial<Record<ComponenteReceita, number | null>>;

/**
 * Toggle por componente (print 01). Componente com valor `null` NÃO tem fonte no
 * nosso dado hoje (só temos total e descontos do Cardápio Web) — aparece
 * desabilitado e rotulado, em vez de somar zero e fingir que a taxa é zero.
 */
export function DecomposicaoReceitaCard({ valores }: { valores: ValoresDecomposicao }) {
  const ordem: ComponenteReceita[] = ['produtos', 'entrega', 'servico', 'adicionais', 'maquineta', 'descontos'];
  const disponiveis = ordem.filter(c => valores[c] !== null && valores[c] !== undefined);
  const [ligados, setLigados] = useState<ComponenteReceita[]>(disponiveis);

  useEffect(() => { setLigados(disponiveis); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [disponiveis.join(',')]);

  const total = calcularFaturamento(
    Object.fromEntries(ligados.map(c => [c, Number(valores[c] ?? 0)])) as Record<ComponenteReceita, number>,
    ligados,
  );

  return (
    <Painel className="p-5">
      <TituloBloco fonte="cada parcela entra ou sai do cálculo">Decomposição do faturamento</TituloBloco>
      <div className="space-y-1.5">
        {ordem.map(c => {
          const v = valores[c];
          const semFonte = v === null || v === undefined;
          const ligado = ligados.includes(c);
          return (
            <div key={c} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
              <button
                type="button"
                disabled={semFonte}
                onClick={() => setLigados(l => l.includes(c) ? l.filter(x => x !== c) : [...l, c])}
                className={cn(
                  'h-4 w-7 shrink-0 rounded-full transition-colors',
                  semFonte ? 'cursor-not-allowed bg-white/[0.06]' : ligado ? 'bg-[#6cff2f]' : 'bg-white/[0.15]',
                )}
                aria-label={`${ligado ? 'Remover' : 'Incluir'} ${ROTULO_COMPONENTE[c]}`}
              >
                <span className={cn('block h-3 w-3 rounded-full bg-white transition-transform', ligado && !semFonte ? 'translate-x-3.5' : 'translate-x-0.5')} />
              </button>
              <span className={cn('flex-1 text-[13px]', semFonte ? 'text-[#6b7478]' : 'text-[#dce4e8]')}>
                {ROTULO_COMPONENTE[c]}
              </span>
              {semFonte ? (
                <span className="text-[10px] text-[#6b7478]">sem fonte nesta integração</span>
              ) : (
                <span className={cn('text-[13px] font-bold', ligado ? 'text-[#f4f7f8]' : 'text-[#6b7478] line-through')}>
                  {formatarMetrica(Number(v), 'moeda')}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.08] pt-3">
        <span className="text-[11px] font-black uppercase tracking-[0.07em] text-[#9aa4aa]">Faturamento total</span>
        <span className="font-heading text-xl text-[#6cff2f]">{formatarMetrica(total, 'moeda')}</span>
      </div>
    </Painel>
  );
}

// ──────────────────────────────────────────── 4. Funil unificado (peça central)

/**
 * O bloco que justifica o produto: o Cardápio Web não enxerga o investimento e
 * nós não enxergamos o pedido. Aqui os dois lados se encontram.
 *
 * ⚠️ `visitantes_catalogo` costuma vir `null` — é a métrica que NENHUMA das duas
 * ferramentas cruza hoje. Quando falta, as taxas em volta viram "—" em vez de
 * 0%, e o degrau diz que falta integração.
 */
export function FunilUnificadoFood({ funil, investimento }: { funil: FunilFood; investimento: number }) {
  const receita = funil.receita ?? 0;
  const roasCalc = investimento > 0 ? receita / investimento : null;
  const custoPedido = (funil.pedidos ?? 0) > 0 ? investimento / (funil.pedidos as number) : null;

  return (
    <Painel className="p-5">
      <TituloBloco fonte="mídia × cardápio">Funil unificado</TituloBloco>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${ETAPAS_FUNIL_FOOD.length}, 1fr)` }}>
        {ETAPAS_FUNIL_FOOD.map((etapa, i) => {
          const valor = funil[etapa];
          const anterior = i > 0 ? ETAPAS_FUNIL_FOOD[i - 1] : null;
          const taxa = anterior ? taxaPassagem(funil, anterior, etapa) : null;
          return (
            <div key={etapa} className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-3 text-center">
              <p className="truncate text-[9px] font-black uppercase tracking-wider text-[#9aa4aa]">
                {ROTULO_ETAPA_FOOD[etapa]}
              </p>
              <p className={cn('mt-1.5 font-heading text-lg leading-none', valor === null ? 'text-[#6b7478]' : 'text-[#f4f7f8]')}>
                {valor === null
                  ? SEM_DADO
                  : formatarMetrica(valor, etapa === 'receita' ? 'moeda' : 'inteiro')}
              </p>
              <p className="mt-1 text-[8px] uppercase tracking-wide text-[#6b7478]">{FONTE_ETAPA_FOOD[etapa]}</p>
              {anterior && (
                <p className={cn('mt-1.5 text-[10px] font-bold', taxa === null ? 'text-[#6b7478]' : 'text-[#6cff2f]')}>
                  {taxa === null ? SEM_DADO : formatarMetrica(taxa, 'percentual')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {funil.visitantes_catalogo === null && (
        <p className="mt-3 rounded-[10px] border border-dashed border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-200">
          Visitantes do catálogo ainda não são coletados. É o elo que fecha o funil — sem ele, a
          conversão de catálogo e as taxas em volta ficam indisponíveis (não são zero).
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.07em] text-[#9aa4aa]">ROAS</p>
          <p className="mt-1 font-heading text-xl text-[#f4f7f8]">{formatarMetrica(roasCalc, 'multiplicador')}</p>
        </div>
        <div className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.07em] text-[#9aa4aa]">Custo por pedido</p>
          <p className="mt-1 font-heading text-xl text-[#f4f7f8]">{formatarMetrica(custoPedido, 'moeda')}</p>
        </div>
      </div>
    </Painel>
  );
}

// ──────────────────────────────────────────── 5. Clientes e retenção

const BALDES = [
  { chave: 'novo', rotulo: 'Novos' },
  { chave: 'recorrente', rotulo: 'Recorrentes' },
  { chave: 'reconquistado', rotulo: 'Reconquistados' },
  { chave: 'em_risco', rotulo: 'Em risco' },
  { chave: 'inativo', rotulo: 'Inativos' },
] as const;

export function ClientesRetencaoFood({ baldes, pedidos, clientesUnicos, clientesComDoisOuMais }: {
  baldes: Record<string, number>;
  pedidos: number;
  clientesUnicos: number;
  clientesComDoisOuMais: number | null;
}) {
  const recorrencia = taxaRecorrencia(pedidos, clientesUnicos);
  const fidelidade = clientesComDoisOuMais === null ? null : taxaFidelidade(clientesComDoisOuMais, clientesUnicos);

  return (
    <Painel className="p-5">
      <TituloBloco fonte="base do cardápio digital">Clientes e retenção</TituloBloco>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {BALDES.map(b => (
          <div key={b.chave} className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-3">
            <p className="text-[9px] font-black uppercase tracking-wider text-[#9aa4aa]">{b.rotulo}</p>
            <p className="mt-1 font-heading text-lg leading-none text-[#f4f7f8]">
              {formatarMetrica(baldes[b.chave] ?? 0, 'inteiro')}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.07em] text-[#9aa4aa]">Taxa de recorrência</p>
          <p className="mt-1 font-heading text-xl text-[#f4f7f8]">
            {recorrencia === null ? SEM_DADO : `${recorrencia.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} pedidos/cliente`}
          </p>
        </div>
        <div className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.07em] text-[#9aa4aa]">Taxa de fidelidade</p>
          <p className="mt-1 font-heading text-xl text-[#f4f7f8]">{formatarMetrica(fidelidade, 'percentual')}</p>
          {fidelidade === null && (
            <p className="mt-0.5 text-[10px] text-[#6b7478]">exige contagem de clientes com 2+ pedidos</p>
          )}
        </div>
      </div>
    </Painel>
  );
}

// ──────────────────────────────────────────── 6 e 8. Blocos ainda sem fonte

export function MixProdutosFood() {
  return (
    <SemIntegracao
      titulo="Mix de produtos"
      oQueFalta="Os itens de cada pedido ainda não são sincronizados — sem eles não há ranking de categoria nem de produto."
      comoLigar="Depende de trazer os itens do pedido na integração do cardápio. Margem só aparece com CMV cadastrado."
    />
  );
}

export function CampanhasWhatsappFood() {
  return (
    <SemIntegracao
      titulo="Campanhas WhatsApp"
      oQueFalta="As métricas de campanha do cardápio digital (envios, leituras, pedidos e receita por disparo) ainda não são lidas por aqui."
      comoLigar="Depende da integração de Food Marketing do cardápio digital."
    />
  );
}

// ──────────────────────────────────────────── orquestrador

export type DadosFood = {
  conectado: boolean;
  resultado: ResultadoNegocio;
  decomposicao: ValoresDecomposicao;
  funil: FunilFood;
  investimento: number;
  baldes: Record<string, number>;
  clientesUnicos: number;
  clientesComDoisOuMais: number | null;
};

/** Monta os dados do modo food a partir do que a rota de delivery devolve. */
export function useDadosFood(clientId: string | null, from: string, to: string, impressoes: number, cliques: number, investimento: number): DadosFood | null {
  const [bruto, setBruto] = useState<{
    conectado: boolean;
    kpis?: { atual: { receita: number; pedidos: number; ticketMedio: number; clientesUnicos: number; clientesNovos: number };
             variacao: { receita: number | null; pedidos: number | null; ticketMedio: number | null } };
    funil?: { periodo: Record<string, number> };
  } | null>(null);

  useEffect(() => {
    if (!clientId) { setBruto(null); return; }
    let vivo = true;
    setBruto(null);
    fetch(`/api/clients/${clientId}/cardapioweb?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (vivo) setBruto(d); })
      .catch(() => { if (vivo) setBruto(null); });
    return () => { vivo = false; };
  }, [clientId, from, to]);

  return useMemo(() => {
    if (!bruto) return null;
    const a = bruto.kpis?.atual;
    const v = bruto.kpis?.variacao;
    return {
      conectado: !!bruto.conectado,
      resultado: {
        faturamento: a?.receita ?? 0,
        pedidos: a?.pedidos ?? 0,
        ticketMedio: a?.ticketMedio ?? 0,
        varFaturamento: v?.receita ?? null,
        varPedidos: v?.pedidos ?? null,
        varTicket: v?.ticketMedio ?? null,
      },
      // Só `produtos` (o total sincronizado) tem fonte hoje. As taxas ficam
      // `null` de propósito — ver DecomposicaoReceitaCard.
      decomposicao: {
        produtos: a?.receita ?? 0,
        entrega: null, servico: null, adicionais: null, maquineta: null, descontos: null,
      },
      funil: {
        impressoes: impressoes || null,
        cliques: cliques || null,
        visitantes_catalogo: null, // não coletamos — o elo que falta
        pedidos: a?.pedidos ?? null,
        receita: a?.receita ?? null,
      },
      investimento,
      baldes: bruto.funil?.periodo ?? {},
      clientesUnicos: a?.clientesUnicos ?? 0,
      clientesComDoisOuMais: null, // exige contagem própria na rota
    };
  }, [bruto, impressoes, cliques, investimento]);
}

/** Conveniência para a tela: conversão do catálogo já com a regra de dado ausente. */
export function conversaoDoCatalogo(funil: FunilFood): Metrica {
  if (funil.pedidos === null || funil.visitantes_catalogo === null) return null;
  return conversaoCatalogo(funil.pedidos, funil.visitantes_catalogo);
}

export { variacao };
