import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

/**
 * Desempenho comercial do período: quem vendeu mais e o que mais foi vendido.
 *
 * Alimenta os dois painéis pedidos pelo Matheus (espelhando o Agendor):
 *  • VENDEDORES — por responsável: ganhos, perdidos e novos, em valor e em
 *    quantidade;
 *  • CATEGORIAS — participação de cada categoria de produto.
 *
 * ⚠️ TRÊS RÉGUAS DE DATA na mesma rota, de propósito — é o que faz cada coluna
 * significar o que o nome diz:
 *  • ganho   → `fechado_em`  (mês do GANHO, igual ao card de Faturamento);
 *  • perdido → `perdido_em`  (mês da PERDA);
 *  • novo    → `lead_date/data` (mês da CRIAÇÃO do negócio).
 * Régua única faria "novos" contar quem foi ganho no período mas criado antes.
 *
 * ⚠️ Ganhos usam `valor_rs` (faturamento REAL). Perdidos e novos usam
 * `valor_negocio` (estimativa do CRM), que nunca entra em receita — ver
 * `NegocioAgendor.valorEstimado`. Somar as duas colunas na mesma métrica
 * misturaria dinheiro que entrou com dinheiro que talvez entre.
 *
 * GET ?clientIds=a,b&from=YYYY-MM-DD&to=YYYY-MM-DD
 */

type LinhaVendedor = {
  responsavel: string;
  ganhos: number; ganhos_valor: number;
  perdidos: number; perdidos_valor: number;
  novos: number; novos_valor: number;
};

type LinhaCategoria = { categoria: string; negocios: number; itens: number; valor: number };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  const clientIds = (sp.get('clientIds') ?? '').split(',').map(s => s.trim()).filter(Boolean);

  const vazio = { vendedores: [] as LinhaVendedor[], categorias: [] as LinhaCategoria[] };
  if (!from || !to || clientIds.length === 0) return Response.json(vazio);

  const pool = makeServerPool();
  try {
    const { rows: vendedores } = await pool.query<LinhaVendedor>(
      `SELECT responsavel,
              COUNT(*) FILTER (WHERE fechado_em BETWEEN $2::date AND $3::date)::int AS ganhos,
              COALESCE(SUM(COALESCE(valor_rs, 0)) FILTER (WHERE fechado_em BETWEEN $2::date AND $3::date), 0)::float AS ganhos_valor,
              COUNT(*) FILTER (WHERE perdido_em BETWEEN $2::date AND $3::date)::int AS perdidos,
              COALESCE(SUM(COALESCE(valor_negocio, 0)) FILTER (WHERE perdido_em BETWEEN $2::date AND $3::date), 0)::float AS perdidos_valor,
              COUNT(*) FILTER (WHERE COALESCE(lead_date, data) BETWEEN $2::date AND $3::date)::int AS novos,
              COALESCE(SUM(COALESCE(valor_negocio, 0)) FILTER (WHERE COALESCE(lead_date, data) BETWEEN $2::date AND $3::date), 0)::float AS novos_valor
         FROM public.crm_leads
        WHERE client_id = ANY($1)
          AND NULLIF(responsavel, '') IS NOT NULL
          AND COALESCE(registro_tipo, 'hibrido') <> 'venda'
        GROUP BY 1
       HAVING COUNT(*) FILTER (WHERE fechado_em BETWEEN $2::date AND $3::date) > 0
           OR COUNT(*) FILTER (WHERE perdido_em BETWEEN $2::date AND $3::date) > 0
           OR COUNT(*) FILTER (WHERE COALESCE(lead_date, data) BETWEEN $2::date AND $3::date) > 0
        ORDER BY ganhos_valor DESC, ganhos DESC
        LIMIT 40`,
      [clientIds, from, to],
    ).catch(() => ({ rows: [] as LinhaVendedor[] }));

    // Categorias: um negócio com 3 produtos conta 3 vezes na participação por
    // ITEM — é assim que o painel do Agendor mostra ("participação por
    // negócios" soma linha de produto, não negócio distinto).
    // ⚠️ Só negócio GANHO: "mais vendidas" é sobre o que foi vendido, não sobre
    // o que está no funil.
    const { rows: categorias } = await pool.query<LinhaCategoria>(
      `SELECT COALESCE(NULLIF(p->>'categoria', ''), 'Sem categoria') AS categoria,
              COUNT(*)::int AS negocios,
              -- negocios conta LINHA de produto; itens soma a quantidade. Sao
              -- coisas diferentes (um negocio de 500 canetas e 1 linha e 500
              -- itens) e o painel diz "itens vendidos", entao precisa da soma.
              COALESCE(SUM(COALESCE((p->>'quantidade')::numeric, 0)), 0)::float AS itens,
              COALESCE(SUM(COALESCE((p->>'valorTotal')::numeric, 0)), 0)::float AS valor
         FROM public.crm_leads l
        CROSS JOIN LATERAL jsonb_array_elements(l.produtos) AS p
        WHERE l.client_id = ANY($1)
          AND l.produtos IS NOT NULL
          AND l.fechado_em BETWEEN $2::date AND $3::date
        GROUP BY 1
        ORDER BY itens DESC, valor DESC
        LIMIT 60`,
      [clientIds, from, to],
    ).catch(() => ({ rows: [] as LinhaCategoria[] }));

    return Response.json({ vendedores, categorias });
  } catch (err) {
    console.error('[crm desempenho]', err);
    return Response.json(vazio);
  } finally {
    await pool.end();
  }
}
