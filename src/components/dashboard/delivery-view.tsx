// Elementos do dashboard de Delivery.
//
// ⚠️ Antes este arquivo devolvia 5 BLOCOS prontos (cada um com título + várias
// métricas dentro). Agora devolve um nó por ELEMENTO: a grade posiciona cada
// métrica individualmente, então um bloco pronto tornaria impossível mover só o
// "Receita" — que foi exatamente o pedido do Matheus.
//
// Presentational puro: recebe `DadosDelivery` e devolve nós. Não busca nada.
// Elemento sem fonte de dados simplesmente NÃO é devolvido — o editor mostra um
// espaço reservado e a tela publicada o omite.

import {
  BarChart3, Users, Wallet, ShoppingBag, Receipt, UserPlus, Repeat, Clock, Target,
  type LucideIcon,
} from 'lucide-react';
import { KpiCard, Mini, Gauge, Ring, Heatmap, InnerCard, Chapter, BlocoVazio, fmt } from '@/components/dashboard';
import { iconePorNome } from './controles-elemento';
import type { ElementoId } from '@/lib/dashboard-elementos';
import { estiloDe, type EstiloElemento, type EstilosPorElemento } from '@/lib/dashboard-elementos';
import { CLASSE_FUNDO, type DadosDelivery } from '@/types/dashboard';
import { cn } from '@/lib/utils';

const ROTULO_CANAL: Record<string, string> = {
  meta: 'Meta Ads', google: 'Google Ads', instagram: 'Instagram',
  whatsapp: 'WhatsApp', organico: 'Orgânico / Direto',
};

export type MapaElementos = Partial<Record<ElementoId, React.ReactNode>>;

/** Título de seção solto na grade — sem o card em volta, é só o cabeçalho. */
function Titulo({ estilo, padraoIcone, padraoTexto, sub }: {
  estilo: EstiloElemento; padraoIcone: LucideIcon; padraoTexto: string; sub?: string;
}) {
  return (
    <div className="flex h-full items-end">
      <Chapter
        icon={iconePorNome(estilo.icone, padraoIcone)}
        titulo={padraoTexto}
        sub={sub}
        nivel="secao"
        estilo={estilo}
      />
    </div>
  );
}

export function elementosDelivery(
  dados: DadosDelivery,
  estilos: EstilosPorElemento = {},
): MapaElementos {
  const e = (id: ElementoId) => estiloDe(estilos, id);
  const { vendas, variacao, serie, heatmap, clientes, saldos } = dados;

  if (dados.fonte.status === 'sem_integracao') return {};

  const serieReceita = serie.map((p) => p.receita);
  const seriePedidos = serie.map((p) => p.pedidos);
  const baseTotal = clientes.ativos + clientes.emRisco + clientes.inativos;
  const totalRecorrencia = clientes.recorrencia.reduce((s, f) => s + f.clientes, 0);
  const periodo = `${dados.periodo.de.split('-').reverse().join('/')} a ${dados.periodo.ate.split('-').reverse().join('/')} · ${vendas.dias} dias`;

  /** Cartão de métrica solto na grade — mesma superfície do card de Faturamento. */
  const kpi = (id: ElementoId, props: Omit<Parameters<typeof KpiCard>[0], 'estilo' | 'superficie' | 'className'>) => (
    <KpiCard
      {...props}
      icon={iconePorNome(e(id).icone, props.icon)}
      estilo={e(id)}
      superficie="card"
      className="h-full"
    />
  );

  const mini = (id: ElementoId, props: Omit<Parameters<typeof Mini>[0], 'estilo' | 'superficie' | 'className'>) => (
    <Mini
      {...props}
      icon={props.icon ? iconePorNome(e(id).icone, props.icon) : undefined}
      estilo={e(id)}
      superficie="card"
      className="h-full"
    />
  );

  const mapa: MapaElementos = {
    'vendas.titulo': <Titulo estilo={e('vendas.titulo')} padraoIcone={BarChart3} padraoTexto="Vendas" sub={periodo} />,
    'vendas.receita': kpi('vendas.receita', {
      icon: Wallet, label: 'Receita', valor: fmt.brl(vendas.receita), delta: variacao.receita, spark: serieReceita,
    }),
    'vendas.pedidos': kpi('vendas.pedidos', {
      icon: ShoppingBag, tom: 'blue', label: 'Pedidos', valor: fmt.int(vendas.pedidos), delta: variacao.pedidos, spark: seriePedidos,
    }),
    'vendas.ticket': kpi('vendas.ticket', {
      icon: Receipt, tom: 'orange', label: 'Ticket médio', valor: fmt.brl(vendas.ticket), delta: variacao.ticket,
    }),
    'vendas.novos': kpi('vendas.novos', {
      icon: UserPlus, tom: 'secondary', label: 'Novos clientes', valor: fmt.int(vendas.novosClientes),
    }),

    'quando_vendem.titulo': (
      <Titulo estilo={e('quando_vendem.titulo')} padraoIcone={Clock} padraoTexto="Quando vendem"
        sub="Pedidos por dia da semana e faixa de horário" />
    ),
    'quando_vendem.mapa': (
      <InnerCard superficie="card" className="h-full overflow-auto" style={{ ...(e('quando_vendem.mapa').corFundo ? { backgroundColor: e('quando_vendem.mapa').corFundo! } : {}) }}>
        <Heatmap dados={heatmap} />
      </InnerCard>
    ),

    'ritmo.titulo': <Titulo estilo={e('ritmo.titulo')} padraoIcone={Target} padraoTexto="Ritmo" sub="Média diária no período" />,
    'ritmo.receita_dia': mini('ritmo.receita_dia', {
      label: 'Receita/dia', icon: Wallet, valor: fmt.brl(vendas.dias ? vendas.receita / vendas.dias : null),
    }),
    'ritmo.pedidos_dia': mini('ritmo.pedidos_dia', {
      label: 'Pedidos/dia', icon: ShoppingBag, tom: 'blue',
      valor: fmt.int(vendas.dias ? Math.round(vendas.pedidos / vendas.dias) : null),
    }),

    'base_clientes.titulo': <Titulo estilo={e('base_clientes.titulo')} padraoIcone={Users} padraoTexto="Situação da base" />,
    'base_clientes.ativos': mini('base_clientes.ativos', { label: 'Ativos', valor: fmt.int(clientes.ativos) }),
    'base_clientes.risco': mini('base_clientes.risco', {
      label: 'Em risco', tom: 'orange', valor: fmt.int(clientes.emRisco), sub: 'sem pedir há 30–60 dias',
    }),
    'base_clientes.inativos': mini('base_clientes.inativos', {
      label: 'Inativos', tom: 'destructive', valor: fmt.int(clientes.inativos), sub: 'há mais de 60 dias',
    }),

    'recorrencia.titulo': (
      <Titulo estilo={e('recorrencia.titulo')} padraoIcone={Repeat} padraoTexto="Recorrência"
        sub="Distribuição por número de pedidos" />
    ),
  };

  // Saldo das contas: só existe quando há conta de anúncio vinculada.
  if (saldos.length > 0) {
    mapa['ritmo.saldos'] = (
      <InnerCard superficie="card" className="h-full overflow-auto" style={{ ...(e('ritmo.saldos').corFundo ? { backgroundColor: e('ritmo.saldos').corFundo! } : {}) }}>
        <div className="grid gap-2 sm:grid-cols-2">
          {saldos.map((s) => (
            <Mini key={s.canal} label={`Saldo ${ROTULO_CANAL[s.canal]}`} tom="muted" valor={fmt.brl(s.saldo)}
              sub={s.diasRestantes === null ? 'sem ritmo para projetar' : `dura ~${Math.round(s.diasRestantes)} dias`} />
          ))}
        </div>
      </InnerCard>
    );
  }

  // Medidor da base: sem base sincronizada não há proporção para desenhar.
  if (baseTotal > 0) {
    mapa['base_clientes.gauge'] = (
      <InnerCard superficie="card" className="flex h-full items-center justify-center" style={{ ...(e('base_clientes.gauge').corFundo ? { backgroundColor: e('base_clientes.gauge').corFundo! } : {}) }}>
        <Gauge valor={clientes.ativos} max={baseTotal} unidade={fmt.compacto(clientes.ativos)} legenda="ATIVOS" />
      </InnerCard>
    );
  }

  mapa['recorrencia.barras'] = totalRecorrencia === 0 ? (
    <InnerCard superficie="card" className="h-full">
      <BlocoVazio oQueFalta="Sem histórico suficiente para distribuir a base por número de pedidos." />
    </InnerCard>
  ) : (
    <InnerCard superficie="card" className="h-full overflow-auto" style={{ ...(e('recorrencia.barras').corFundo ? { backgroundColor: e('recorrencia.barras').corFundo! } : {}) }}>
      <div className="space-y-4">
        {clientes.recorrencia.map((f) => {
          const p = f.clientes / totalRecorrencia;
          const est = e('recorrencia.barras');
          return (
            <div key={f.nome} className="flex items-center gap-4">
              {/* Anel maior: a leitura principal deste bloco é a proporção. */}
              <Ring proporcao={p} tom={f.tom} size={est.tamanhoIcone ?? 72}>
                <span className="font-heading text-base leading-none text-foreground">{fmt.pct(p)}</span>
              </Ring>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-foreground">{f.nome}</span>
                  <span className="font-heading text-2xl leading-none text-foreground">{fmt.int(f.clientes)}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className={cn('h-full rounded-full', !est.corValor && CLASSE_FUNDO[f.tom])}
                    style={{ width: `${Math.max(p * 100, 2)}%`, ...(est.corValor ? { backgroundColor: est.corValor } : {}) }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </InnerCard>
  );

  return mapa;
}
