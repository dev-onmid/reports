import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureCardapioWebSchema, getConnection } from '@/lib/cardapioweb';
import { optimizerDateRangeForPeriod } from '@/lib/optimizer-period-range';
import { autoPreviousPeriod } from '@/lib/delivery-report-builder';
import type { OptimizerPeriodKey } from '@/lib/optimizer';
import {
  agruparPorCliente, agregarFunil, sugerirRegua, normalizarRegua, normalizarTelefoneBR,
  resumoPeriodo, agregarCupons, variacao, funilEm, limitesBRT,
  type PedidoComDesconto, type ClienteDelivery, type Periodo,
} from '@/lib/cardapioweb-recorrencia';

/**
 * Dados do dashboard de delivery.
 *
 * Leitura pura do que já foi sincronizado — nenhuma chamada ao Cardápio Web
 * aqui. A tela nunca pode depender de um rate limit de 5 req/min pra renderizar.
 *
 * ⚠️ Duas naturezas de número convivem, e a distinção é deliberada:
 *  - **KPIs e cupons** são SOMA sobre o intervalo escolhido;
 *  - **funil** é uma FOTO no fim do intervalo (quem estava em risco naquele
 *    dia), comparada com a foto no fim do intervalo anterior.
 * Tratar as duas como a mesma coisa é o erro clássico desse tipo de painel.
 */

const CANAIS_MARKETPLACE = new Set(['ifood']);

const PERIODOS_VALIDOS: OptimizerPeriodKey[] = [
  'last_7d', 'last_30d', 'this_month', 'last_month', 'last_90d',
];

function resolverPeriodo(req: NextRequest): { periodo: Periodo; chave: string } {
  const de = req.nextUrl.searchParams.get('from');
  const ate = req.nextUrl.searchParams.get('to');
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (de && ate && iso.test(de) && iso.test(ate) && de <= ate) {
    return { periodo: { de, ate }, chave: 'custom' };
  }
  const p = req.nextUrl.searchParams.get('period') as OptimizerPeriodKey | null;
  const chave = p && PERIODOS_VALIDOS.includes(p) ? p : 'last_30d';
  // Reusa o resolvedor do Otimizador: já é BRT e já trata mês-calendário.
  const r = optimizerDateRangeForPeriod(chave);
  return { periodo: { de: r.dateFrom, ate: r.dateTo }, chave };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await ctx.params;

  const pool = makeServerPool();
  try {
    await ensureCardapioWebSchema(pool);
    const conn = await getConnection(pool, clientId);
    if (!conn) return Response.json({ conectado: false });

    const regua = normalizarRegua({
      janelaDias: conn.janela_dias, inatividadeDias: conn.inatividade_dias,
    });

    const { periodo, chave } = resolverPeriodo(req);
    // `autoPreviousPeriod` sabe que mês-calendário compara com o mês anterior
    // inteiro (julho → junho), e não com "31 dias atrás" — a correção do bug
    // que rotulava o comparativo de julho como "Maio".
    const anterior = autoPreviousPeriod(periodo.de, periodo.ate);

    const { rows: pedidos } = await pool.query<PedidoComDesconto & { order_id: string }>(
      `SELECT order_id, customer_id, customer_name, customer_phone,
              total::float8 AS total, status, sales_channel, created_at, discounts
         FROM public.cardapioweb_orders
        WHERE client_id = $1
        ORDER BY created_at ASC`,
      [clientId],
    );

    const agora = new Date().toISOString();
    // Funil de HOJE é o que orienta ação (quem ligar agora); o do período é o
    // que mostra evolução.
    const clientesHoje = agruparPorCliente(pedidos, regua, agora);
    const funilHoje = agregarFunil(clientesHoje);

    const fimDoPeriodo = limitesBRT(periodo.de, periodo.ate).fimExclusivo;
    const fimDoAnterior = limitesBRT(anterior.from, anterior.to).fimExclusivo;
    const funilPeriodo = funilEm(pedidos, regua, fimDoPeriodo);
    const funilAnterior = funilEm(pedidos, regua, fimDoAnterior);

    const kpiAtual = resumoPeriodo(pedidos, periodo);
    const kpiAnterior = resumoPeriodo(pedidos, { de: anterior.from, ate: anterior.to });

    const { rows: canais } = await pool.query<{ sales_channel: string | null; receita: number; pedidos: number }>(
      `SELECT sales_channel, COALESCE(SUM(total),0)::float8 AS receita, COUNT(*)::int AS pedidos
         FROM public.cardapioweb_orders
        WHERE client_id = $1 AND status <> 'canceled'
          AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
        GROUP BY sales_channel ORDER BY receita DESC`,
      [clientId, limitesBRT(periodo.de, periodo.ate).inicio, fimDoPeriodo],
    );

    return Response.json({
      conectado: true,
      merchant: { id: conn.merchant_id, nome: conn.merchant_name },
      regua,
      reguaSugerida: sugerirRegua(clientesHoje),
      periodo: { ...periodo, chave },
      anterior: { de: anterior.from, ate: anterior.to },
      sincronizacao: {
        historico_concluido: conn.historico_concluido,
        ultima_sync_em: conn.ultima_sync_em,
        ultimo_erro: conn.ultimo_erro,
        total_pedidos: pedidos.length,
      },
      kpis: {
        atual: kpiAtual,
        anterior: kpiAnterior,
        variacao: {
          receita: variacao(kpiAtual.receita, kpiAnterior.receita),
          pedidos: variacao(kpiAtual.pedidos, kpiAnterior.pedidos),
          ticketMedio: variacao(kpiAtual.ticketMedio, kpiAnterior.ticketMedio),
          clientesUnicos: variacao(kpiAtual.clientesUnicos, kpiAnterior.clientesUnicos),
          clientesNovos: variacao(kpiAtual.clientesNovos, kpiAnterior.clientesNovos),
        },
      },
      funil: { hoje: funilHoje, periodo: funilPeriodo, anterior: funilAnterior },
      cupons: agregarCupons(pedidos, periodo),
      canais: canais.map(c => ({
        canal: c.sales_channel ?? 'desconhecido',
        marketplace: CANAIS_MARKETPLACE.has((c.sales_channel ?? '').toLowerCase()),
        receita: c.receita,
        pedidos: c.pedidos,
      })),
      // Ação é sempre sobre o estado de HOJE, não sobre o do período escolhido.
      emRisco: clientesHoje.filter(c => c.etapa === 'em_risco').slice(0, 50),
      inativos: clientesHoje.filter(c => c.etapa === 'inativo').slice(0, 50),
      atribuicao: await receitaPorCampanha(pool, clientId, clientesHoje),
    });
  } catch (err) {
    return Response.json(
      { conectado: false, error: err instanceof Error ? err.message : 'Falha ao montar o painel.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}

/**
 * Casa o cliente de delivery com o lead do CRM pelo TELEFONE e soma a receita
 * por campanha — deixa de ser "o anúncio trouxe 40 leads" e passa a ser "o
 * anúncio trouxe R$ 3.200 em pedidos".
 *
 * ⚠️ A taxa de casamento vai junto de propósito: sem ela, uma atribuição
 * parcial parece completa e o gestor decide orçamento com metade da base.
 */
async function receitaPorCampanha(
  pool: ReturnType<typeof makeServerPool>, clientId: string, clientes: ClienteDelivery[],
) {
  const comFone = clientes.filter(c => c.telefone);
  if (comFone.length === 0) {
    return { casados: 0, total: clientes.length, taxa: 0, campanhas: [] as unknown[] };
  }

  const { rows: leads } = await pool.query<{
    numero: string | null; campanha: string | null; origin: string | null;
  }>(
    `SELECT numero, campaign_name AS campanha, origin
       FROM public.crm_leads
      WHERE client_id = $1 AND numero IS NOT NULL`,
    [clientId],
  ).catch(() => ({ rows: [] as { numero: string | null; campanha: string | null; origin: string | null }[] }));

  const porFone = new Map<string, { campanha: string | null; origin: string | null }>();
  for (const l of leads) {
    const n = normalizarTelefoneBR(l.numero);
    if (n && !porFone.has(n)) porFone.set(n, { campanha: l.campanha, origin: l.origin });
  }

  const acc = new Map<string, { campanha: string; clientes: number; receita: number; pedidos: number }>();
  let casados = 0;
  for (const c of comFone) {
    const m = porFone.get(c.telefone!);
    if (!m) continue;
    casados++;
    const chave = m.campanha?.trim() || (m.origin ? `(sem campanha · ${m.origin})` : '(sem campanha)');
    const cur = acc.get(chave) ?? { campanha: chave, clientes: 0, receita: 0, pedidos: 0 };
    cur.clientes += 1;
    cur.receita += c.receita;
    cur.pedidos += c.pedidos;
    acc.set(chave, cur);
  }

  return {
    casados,
    total: comFone.length,
    taxa: comFone.length ? casados / comFone.length : 0,
    campanhas: [...acc.values()]
      .map(c => ({ ...c, ticketMedio: c.pedidos ? c.receita / c.pedidos : 0 }))
      .sort((a, b) => b.receita - a.receita),
  };
}
