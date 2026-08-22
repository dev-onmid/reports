import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureCardapioWebSchema, getConnection } from '@/lib/cardapioweb';
import { ensureAnotaAiSchema, listarLojas, garantirWebhookToken } from '@/lib/anotaai';
import { lerPedidosDelivery } from '@/lib/delivery-orders';
import { optimizerDateRangeForPeriod } from '@/lib/optimizer-period-range';
import { autoPreviousPeriod } from '@/lib/delivery-report-builder';
import type { OptimizerPeriodKey } from '@/lib/otimizador-legado';
import {
  agruparPorCliente, agregarFunil, sugerirRegua, normalizarRegua, normalizarTelefoneBR,
  resumoPeriodo, agregarCupons, variacao, funilEm, limitesBRT, noPeriodo,
  serieDiaria, heatmapPedidos, distribuicaoFrequencia,
  type ClienteDelivery, type Periodo,
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
    await Promise.all([ensureCardapioWebSchema(pool), ensureAnotaAiSchema(pool)]);
    await garantirWebhookToken(pool, clientId);
    const [conn, lojasAnota] = await Promise.all([
      getConnection(pool, clientId),
      listarLojas(pool, clientId),
    ]);
    // O painel existe se QUALQUER plataforma estiver conectada — um cliente
    // pode usar só Anota AI, só Cardápio Web, ou os dois.
    if (!conn && lojasAnota.length === 0) return Response.json({ conectado: false });

    const regua = normalizarRegua({
      janelaDias: conn?.janela_dias, inatividadeDias: conn?.inatividade_dias,
    });

    const { periodo, chave } = resolverPeriodo(req);
    // `autoPreviousPeriod` sabe que mês-calendário compara com o mês anterior
    // inteiro (julho → junho), e não com "31 dias atrás" — a correção do bug
    // que rotulava o comparativo de julho como "Maio".
    const anterior = autoPreviousPeriod(periodo.de, periodo.ate);

    // Uma leitura só para as duas plataformas — ver delivery-orders.ts.
    const { pedidos, fontes } = await lerPedidosDelivery(pool, clientId);

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

    // Agregado em JS e não em SQL: os pedidos vêm de duas tabelas, e um GROUP BY
    // por tabela voltaria a dividir o que a camada de leitura acabou de unir.
    const canaisMap = new Map<string, { receita: number; pedidos: number }>();
    for (const o of pedidos) {
      if (o.status === 'canceled' || !noPeriodo(o.created_at, periodo)) continue;
      const k = o.sales_channel ?? 'desconhecido';
      const cur = canaisMap.get(k) ?? { receita: 0, pedidos: 0 };
      cur.receita += Number(o.total) || 0;
      cur.pedidos += 1;
      canaisMap.set(k, cur);
    }
    const canais = [...canaisMap.entries()]
      .map(([sales_channel, v]) => ({ sales_channel, ...v }))
      .sort((a, b) => b.receita - a.receita);

    return Response.json({
      conectado: true,
      merchant: conn ? { id: conn.merchant_id, nome: conn.merchant_name } : null,
      // `webhookToken` vai junto porque é o valor que a tela manda copiar pro
      // Portal de Integração. Sem ele o campo aparecia vazio e o webhook ficava
      // sem autenticação — a tela pedia algo que ela mesma não fornecia.
      lojasAnotaAi: lojasAnota.map(l => ({
        id: l.id, nome: l.store_name, storeId: l.store_id, webhookToken: l.webhook_token,
      })),
      fontes,
      regua,
      reguaSugerida: sugerirRegua(clientesHoje),
      periodo: { ...periodo, chave },
      anterior: { de: anterior.from, ate: anterior.to },
      sincronizacao: {
        historico_concluido: conn?.historico_concluido ?? true,
        ultima_sync_em: conn?.ultima_sync_em ?? null,
        ultimo_erro: conn?.ultimo_erro ?? null,
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
      // Séries derivadas dos pedidos do período (sparkline + mapa de horários) e
      // distribuição da base por frequência (retenção). Tudo BRT, calculado nas
      // funções puras de cardapioweb-recorrencia.
      serie: serieDiaria(pedidos, periodo),
      heatmap: heatmapPedidos(pedidos, periodo),
      // Frequência é sobre o estado de HOJE (base inteira), como o funil de ação.
      frequencia: distribuicaoFrequencia(clientesHoje),
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
