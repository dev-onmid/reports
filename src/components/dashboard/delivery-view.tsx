// Blocos do dashboard de Delivery.
//
// Antes este arquivo montava a tela em JSX fixo. Agora ele EXPÕE os blocos
// individualmente (`blocosDelivery`), e quem decide posição, tamanho, ordem e
// visibilidade é o modelo editável (src/lib/dashboard-modelo.ts) renderizado
// pelo ModeloEditor. Sem essa separação não haveria como arrastar nem ocultar
// nada — layout fixo não é editável por definição.
//
// Presentational puro: recebe `DadosDelivery` e devolve nós. Não busca nada.

import {
  BarChart3, Users, Wallet, ShoppingBag, Receipt, UserPlus, Repeat, Clock, Target,
} from 'lucide-react';
import { Chapter, KpiCard, Mini, Gauge, Ring, Heatmap, Card, BlocoVazio, fmt } from '@/components/dashboard';
import type { BlocoId } from '@/lib/dashboard-modelo';
import { CLASSE_FUNDO, type DadosDelivery } from '@/types/dashboard';
import { cn } from '@/lib/utils';

const ROTULO_CANAL: Record<string, string> = {
  meta: 'Meta Ads', google: 'Google Ads', instagram: 'Instagram',
  whatsapp: 'WhatsApp', organico: 'Orgânico / Direto',
};

/** Títulos vêm do modelo (podem ter sido renomeados), então entram por prop. */
export type TitulosBlocos = Partial<Record<BlocoId, string>>;

export function blocosDelivery(
  dados: DadosDelivery,
  titulos: TitulosBlocos = {},
): Partial<Record<BlocoId, React.ReactNode>> {
  const { vendas, variacao, serie, heatmap, clientes, saldos } = dados;

  if (dados.fonte.status === 'sem_integracao') {
    return {
      vendas: (
        <BlocoVazio
          titulo="Delivery"
          oQueFalta="Este cliente ainda não tem o cardápio digital conectado."
          comoLigar={dados.fonte.comoConectar}
        />
      ),
    };
  }

  const serieReceita = serie.map((p) => p.receita);
  const seriePedidos = serie.map((p) => p.pedidos);
  const baseTotal = clientes.ativos + clientes.emRisco + clientes.inativos;
  const totalRecorrencia = clientes.recorrencia.reduce((s, f) => s + f.clientes, 0);
  const t = (id: BlocoId, padrao: string) => titulos[id] ?? padrao;

  return {
    vendas: (
      <Card className="h-full">
        <Chapter
          icon={BarChart3}
          titulo={t('vendas', 'Vendas')}
          nivel="secao"
          sub={`${dados.periodo.de.split('-').reverse().join('/')} a ${dados.periodo.ate.split('-').reverse().join('/')} · ${vendas.dias} dias`}
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard icon={Wallet} label="Receita" valor={fmt.brl(vendas.receita)}
            delta={variacao.receita} spark={serieReceita} />
          <KpiCard icon={ShoppingBag} tom="blue" label="Pedidos" valor={fmt.int(vendas.pedidos)}
            delta={variacao.pedidos} spark={seriePedidos} />
          <KpiCard icon={Receipt} tom="orange" label="Ticket médio" valor={fmt.brl(vendas.ticket)}
            delta={variacao.ticket} />
          <KpiCard icon={UserPlus} tom="secondary" label="Novos clientes" valor={fmt.int(vendas.novosClientes)} />
        </div>
      </Card>
    ),

    quando_vendem: (
      <Card className="h-full">
        <Chapter icon={Clock} titulo={t('quando_vendem', 'Quando vendem')} nivel="secao"
          sub="Pedidos por dia da semana e faixa de horário" />
        <Heatmap dados={heatmap} />
      </Card>
    ),

    ritmo: (
      <Card className="h-full">
        <Chapter icon={Target} titulo={t('ritmo', 'Ritmo')} nivel="secao" sub="Média diária no período" />
        <div className="grid gap-2 sm:grid-cols-2">
          <Mini label="Receita/dia" icon={Wallet}
            valor={fmt.brl(vendas.dias ? vendas.receita / vendas.dias : null)} />
          <Mini label="Pedidos/dia" icon={ShoppingBag} tom="blue"
            valor={fmt.int(vendas.dias ? Math.round(vendas.pedidos / vendas.dias) : null)} />
        </div>
        {saldos.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {saldos.map((s) => (
              <Mini key={s.canal} label={`Saldo ${ROTULO_CANAL[s.canal]}`} tom="muted"
                valor={fmt.brl(s.saldo)}
                sub={s.diasRestantes === null ? 'sem ritmo para projetar' : `dura ~${Math.round(s.diasRestantes)} dias`} />
            ))}
          </div>
        )}
      </Card>
    ),

    base_clientes: (
      <Card className="h-full">
        <Chapter icon={Users} titulo={t('base_clientes', 'Situação da base')} nivel="secao" />
        {baseTotal === 0 ? (
          <BlocoVazio oQueFalta="Ainda não há base de clientes sincronizada no período." />
        ) : (
          <div className="flex items-center gap-4">
            <Gauge valor={clientes.ativos} max={baseTotal} unidade={fmt.compacto(clientes.ativos)} legenda="ATIVOS" />
            <div className="min-w-0 flex-1 space-y-2">
              <Mini label="Ativos" valor={fmt.int(clientes.ativos)} />
              <Mini label="Em risco" tom="orange" valor={fmt.int(clientes.emRisco)} sub="sem pedir há 30–60 dias" />
              <Mini label="Inativos" tom="destructive" valor={fmt.int(clientes.inativos)} sub="há mais de 60 dias" />
            </div>
          </div>
        )}
      </Card>
    ),

    recorrencia: (
      <Card className="h-full">
        <Chapter icon={Repeat} titulo={t('recorrencia', 'Recorrência')} nivel="secao"
          sub="Distribuição por número de pedidos" />
        {totalRecorrencia === 0 ? (
          <BlocoVazio oQueFalta="Sem histórico suficiente para distribuir a base por número de pedidos." />
        ) : (
          <div className="space-y-4">
            {clientes.recorrencia.map((f) => {
              const p = f.clientes / totalRecorrencia;
              return (
                <div key={f.nome} className="flex items-center gap-4">
                  {/* Anel maior: a leitura principal deste bloco é a proporção. */}
                  <Ring proporcao={p} tom={f.tom} size={72}>
                    <span className="font-heading text-base leading-none text-foreground">{fmt.pct(p)}</span>
                  </Ring>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm text-foreground">{f.nome}</span>
                      <span className="font-heading text-2xl leading-none text-foreground">{fmt.int(f.clientes)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div className={cn('h-full rounded-full', CLASSE_FUNDO[f.tom])}
                        style={{ width: `${Math.max(p * 100, 2)}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    ),
  };
}
