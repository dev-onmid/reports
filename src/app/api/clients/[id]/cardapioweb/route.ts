import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureCardapioWebSchema, getConnection } from '@/lib/cardapioweb';
import {
  agruparPorCliente, agregarFunil, sugerirRegua, normalizarRegua, normalizarTelefoneBR,
  type PedidoAgrupavel, type ClienteDelivery,
} from '@/lib/cardapioweb-recorrencia';

/**
 * Dados do dashboard de delivery de um cliente.
 *
 * Leitura pura do que já foi sincronizado — nenhuma chamada ao Cardápio Web
 * aqui. Quem fala com a API é o sync-cron; a tela nunca pode depender de um
 * rate limit de 5 req/min para renderizar.
 */

/** Canais que NÃO são o cardápio próprio do lojista. */
const CANAIS_MARKETPLACE = new Set(['ifood']);

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

    const { rows: pedidos } = await pool.query<PedidoAgrupavel & { order_id: string }>(
      `SELECT order_id, customer_id, customer_name, customer_phone,
              total::float8 AS total, status, sales_channel, created_at
         FROM public.cardapioweb_orders
        WHERE client_id = $1
        ORDER BY created_at ASC`,
      [clientId],
    );

    const agora = new Date().toISOString();
    const clientes = agruparPorCliente(pedidos, regua, agora);
    const funil = agregarFunil(clientes);

    // KPIs de 30 dias em BRT: `created_at` é timestamptz e a sessão do Postgres
    // roda em UTC — cortar por data crua jogaria os pedidos da noite pro dia
    // seguinte. Mesmo cuidado do creative-library e do tracking/leads.
    const { rows: kpi } = await pool.query<{
      receita_30d: number; pedidos_30d: number; ticket_30d: number;
    }>(
      `SELECT COALESCE(SUM(total),0)::float8 AS receita_30d,
              COUNT(*)::int                  AS pedidos_30d,
              COALESCE(AVG(total),0)::float8 AS ticket_30d
         FROM public.cardapioweb_orders
        WHERE client_id = $1 AND status <> 'canceled'
          AND created_at >= (NOW() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '30 days'`,
      [clientId],
    );

    // Cardápio próprio vs marketplace. Receita de iFood não é resultado da mídia
    // da agência — somar tudo infla o retorno e leva a decisão errada.
    const { rows: canais } = await pool.query<{ sales_channel: string | null; receita: number; pedidos: number }>(
      `SELECT sales_channel, COALESCE(SUM(total),0)::float8 AS receita, COUNT(*)::int AS pedidos
         FROM public.cardapioweb_orders
        WHERE client_id = $1 AND status <> 'canceled'
        GROUP BY sales_channel ORDER BY receita DESC`,
      [clientId],
    );

    const atribuicao = await receitaPorCampanha(pool, clientId, clientes);

    return Response.json({
      conectado: true,
      merchant: { id: conn.merchant_id, nome: conn.merchant_name },
      regua,
      reguaSugerida: sugerirRegua(clientes),
      sincronizacao: {
        historico_concluido: conn.historico_concluido,
        ultima_sync_em: conn.ultima_sync_em,
        ultimo_erro: conn.ultimo_erro,
        total_pedidos: pedidos.length,
      },
      kpis: {
        receita30d: kpi[0]?.receita_30d ?? 0,
        pedidos30d: kpi[0]?.pedidos_30d ?? 0,
        ticketMedio30d: kpi[0]?.ticket_30d ?? 0,
        clientesAtivos: funil.etapas.recorrente.clientes + funil.etapas.novo.clientes + funil.etapas.reconquistado.clientes,
        totalClientes: funil.totalClientes,
      },
      funil,
      canais: canais.map(c => ({
        canal: c.sales_channel ?? 'desconhecido',
        marketplace: CANAIS_MARKETPLACE.has((c.sales_channel ?? '').toLowerCase()),
        receita: c.receita,
        pedidos: c.pedidos,
      })),
      // Quem precisa de ação primeiro: sumidos com maior valor histórico.
      emRisco: clientes.filter(c => c.etapa === 'em_risco').slice(0, 50),
      inativos: clientes.filter(c => c.etapa === 'inativo').slice(0, 50),
      atribuicao,
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
 * por campanha.
 *
 * É a resposta que a agência não tinha: deixa de ser "o anúncio trouxe 40
 * leads" e passa a ser "o anúncio trouxe R$ 3.200 em pedidos".
 *
 * ⚠️ A taxa de casamento vai junto na resposta de propósito. Sem ela, uma
 * atribuição parcial parece completa — e o gestor decide orçamento com um
 * número que só cobre metade da base.
 */
async function receitaPorCampanha(
  pool: ReturnType<typeof makeServerPool>, clientId: string, clientes: ClienteDelivery[],
) {
  const comFone = clientes.filter(c => c.telefone);
  if (comFone.length === 0) {
    return { casados: 0, total: clientes.length, taxa: 0, campanhas: [] as unknown[] };
  }

  // Traz os leads do cliente e normaliza no NOSSO lado: o `numero` do CRM tem
  // formato irregular (com/sem DDI, com/sem 9º dígito) e casar no SQL exigiria
  // repetir a mesma normalização em expressão — a lib já é testada.
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
    // First-touch vence: o primeiro lead com aquele telefone define a origem.
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
