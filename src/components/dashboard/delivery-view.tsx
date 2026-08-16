// Composição do dashboard de Delivery — os capítulos do protótipo
// `docs/dashboard-delivery-v4.jsx` montados sobre os componentes tipados.
//
// Presentational puro: recebe `DadosDelivery` e renderiza. Não busca nada, não
// tem estado (o hover do Heatmap mora dentro do próprio Heatmap).
//
// O header e o nav de seções do protótipo foram descartados de propósito: esta
// view vive DENTRO do /dashboard, que já tem seletor de cliente, período e
// exportação — duas barras na mesma tela seria ruído.

import {
  BarChart3, Users, Wallet, ShoppingBag, Receipt, UserPlus, Repeat, Clock, Target,
} from 'lucide-react';
import {
  Chapter, KpiCard, Mini, Gauge, Ring, Heatmap, Card, BlocoVazio, fmt,
} from '@/components/dashboard';
import { CLASSE_FUNDO, type DadosDelivery } from '@/types/dashboard';
import { cn } from '@/lib/utils';

const ROTULO_CANAL: Record<string, string> = {
  meta: 'Meta Ads', google: 'Google Ads', instagram: 'Instagram',
  whatsapp: 'WhatsApp', organico: 'Orgânico / Direto',
};

export function DeliveryView({ dados }: { dados: DadosDelivery }) {
  const { vendas, variacao, serie, heatmap, clientes, canais, criativos, instagram, saldos } = dados;

  if (dados.fonte.status === 'sem_integracao') {
    return (
      <BlocoVazio
        titulo="Delivery"
        oQueFalta="Este cliente ainda não tem o cardápio digital conectado."
        comoLigar={dados.fonte.comoConectar}
      />
    );
  }

  const serieReceita = serie.map((p) => p.receita);
  const seriePedidos = serie.map((p) => p.pedidos);
  const baseTotal = clientes.ativos + clientes.emRisco + clientes.inativos;
  const totalRecorrencia = clientes.recorrencia.reduce((s, f) => s + f.clientes, 0);

  return (
    <div className="space-y-8">
      {/* ─────────────────────────────── VENDAS ─────────────────────────────── */}
      <section id="vendas">
        <Chapter
          icon={BarChart3}
          titulo="Vendas"
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

        <div className="mt-3 grid gap-3 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <Chapter icon={Clock} titulo="Quando vendem" nivel="secao"
              sub="Pedidos por dia da semana e faixa de horário" />
            <Heatmap dados={heatmap} />
          </Card>
          <Card>
            <Chapter icon={Target} titulo="Ritmo" nivel="secao" sub="Média diária no período" />
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
        </div>
      </section>

      {/* ────────────────────────────── CLIENTES ────────────────────────────── */}
      <section id="clientes">
        <Chapter icon={Users} titulo="Clientes" sub="Base e recorrência" />
        <div className="grid gap-3 xl:grid-cols-[1fr_1.3fr]">
          <Card>
            <Chapter icon={Users} titulo="Situação da base" nivel="secao" />
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

          <Card>
            <Chapter icon={Repeat} titulo="Recorrência" nivel="secao" sub="Distribuição por número de pedidos" />
            {totalRecorrencia === 0 ? (
              <BlocoVazio oQueFalta="Sem histórico suficiente para distribuir a base por número de pedidos." />
            ) : (
              <div className="space-y-4">
                {clientes.recorrencia.map((f) => {
                  const p = f.clientes / totalRecorrencia;
                  return (
                    <div key={f.nome} className="flex items-center gap-4">
                      {/* Anel maior (72px): a leitura principal deste bloco é a
                          proporção, não a contagem — vale o espaço. */}
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
        </div>
      </section>

      {/* O capítulo "Funil do catálogo" foi REMOVIDO a pedido do Matheus: com
          acessos/carrinho/checkout sem instrumentação, sobrava um degrau só
          (pedidos) e quatro tracejados — ocupava meia tela sem informar nada.
          Volta quando o catálogo for instrumentado. O componente Funnel e o
          tipo FunilCatalogo seguem no repo, prontos para isso. */}

      {/* O capítulo "Tráfego" foi REMOVIDO a pedido do Matheus: a faixa do Meta
          Ads repetia o "Resumo de Tráfego" que já existe acima na mesma tela, e
          Instagram e Criativos são presença/mídia, não venda — não pertencem a
          um painel de delivery. Os tipos (CanalTrafego, Criativo,
          PresencaInstagram) seguem no contrato, caso voltem.
          A dashboard de food fica em dois capítulos: Vendas e Clientes. */}
    </div>
  );
}
