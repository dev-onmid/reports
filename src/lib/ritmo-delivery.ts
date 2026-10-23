import type { DadosDelivery } from '@/types/dashboard';

/**
 * Leitura do bloco "Ritmo" do delivery — média diária, projeção do mês e o pico
 * da semana (pedido do Matheus, 2026-10-23: o bloco tinha 2 números soltos e
 * metade da altura vazia ao lado do mapa de horários).
 *
 * Pura. A média diária usa os dias DECORRIDOS (`vendas.dias`, já cortado em hoje
 * pelo adaptador) e o comparativo usa os dias da janela anterior — comparar a
 * receita de 23 dias com a de um mês cheio pela soma mentiria; por dia, não.
 */

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pctVar = (atual: number, antes: number) => {
  if (!(antes > 0)) return null;
  const v = ((atual - antes) / antes) * 100;
  return `${v >= 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
};

export type RitmoDelivery = {
  receitaDia: number | null;
  pedidosDia: number | null;
  subReceita?: string;
  subPedidos?: string;
  /** Só quando o período termina no mês corrente e o mês ainda não acabou. */
  projecao: { valor: number; sub: string } | null;
  /** Alternativa à projeção em período fechado: o dia que mais faturou. */
  melhorDia: { receita: number; sub: string } | null;
  pico: { valor: string; sub: string } | null;
};

export function ritmoDoPeriodo(d: DadosDelivery, hojeIso: string = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })): RitmoDelivery {
  const { vendas, anterior } = d;
  const receitaDia = vendas.dias > 0 ? vendas.receita / vendas.dias : null;
  const pedidosDia = vendas.dias > 0 ? vendas.pedidos / vendas.dias : null;
  const diasAnt = anterior?.dias ?? vendas.dias;
  const recAntDia = anterior && diasAnt > 0 ? anterior.receita / diasAnt : 0;
  const pedAntDia = anterior && diasAnt > 0 ? anterior.pedidos / diasAnt : 0;
  const vR = receitaDia !== null ? pctVar(receitaDia, recAntDia) : null;
  const vP = pedidosDia !== null ? pctVar(pedidosDia, pedAntDia) : null;

  // Projeção: janela que termina no mês de hoje e ainda tem dia pela frente.
  let projecao: RitmoDelivery['projecao'] = null;
  const [ay, am] = d.periodo.ate.split('-').map(Number);
  const [hy, hm, hd] = hojeIso.split('-').map(Number);
  if (receitaDia !== null && ay === hy && am === hm) {
    const ultimoDia = new Date(Date.UTC(hy, hm, 0)).getUTCDate();
    const faltam = ultimoDia - hd;
    if (faltam > 0 && d.periodo.de.startsWith(`${hy}-${String(hm).padStart(2, '0')}`)) {
      projecao = {
        valor: vendas.receita + receitaDia * faltam,
        sub: `no ritmo atual, até ${String(ultimoDia).padStart(2, '0')}/${String(hm).padStart(2, '0')} · faltam ${faltam} ${faltam === 1 ? 'dia' : 'dias'}`,
      };
    }
  }

  let melhorDia: RitmoDelivery['melhorDia'] = null;
  const top = [...d.serie].sort((a, b) => b.receita - a.receita)[0];
  if (top && top.receita > 0) {
    const dow = new Date(`${top.data}T12:00:00Z`).getUTCDay();
    melhorDia = { receita: top.receita, sub: `${DIAS[dow]}, ${top.label} · ${top.pedidos} ${top.pedidos === 1 ? 'pedido' : 'pedidos'}` };
  }

  let pico: RitmoDelivery['pico'] = null;
  const { faixas, matriz } = d.heatmap;
  const total = matriz.flat().reduce((a, b) => a + b, 0);
  if (total > 0) {
    const porDia = DIAS.map((_, di) => matriz.reduce((s, l) => s + (l[di] ?? 0), 0));
    const porHora = matriz.map((l) => l.reduce((a, b) => a + b, 0));
    const di = porDia.indexOf(Math.max(...porDia));
    const hi = porHora.indexOf(Math.max(...porHora));
    const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
    pico = {
      valor: `${DIAS_CURTO[di]} · ${faixas[hi]}`,
      sub: `${DIAS[di]} concentra ${pct(porDia[di])} dos pedidos; ${faixas[hi]}, ${pct(porHora[hi])}`,
    };
  }

  return {
    receitaDia,
    pedidosDia,
    subReceita: vR ? `${vR} vs ${brl(recAntDia)}/dia no período anterior` : undefined,
    subPedidos: vP ? `${vP} vs ${Math.round(pedAntDia).toLocaleString('pt-BR')}/dia no período anterior` : undefined,
    projecao,
    melhorDia,
    pico,
  };
}
