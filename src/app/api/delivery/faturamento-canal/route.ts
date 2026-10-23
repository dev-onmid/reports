import type { NextRequest } from 'next/server';
import { escopoDoCliente } from '@/lib/acesso';
import { makeServerPool } from '@/lib/server-db';
import { parseIsoDateRange } from '@/lib/optimizer-period-range';
import { leadContaSql } from '@/lib/lead-contagem';
import { getFreshMetaToken } from '@/lib/meta-token';
import { metaPurchases, type MetaAction } from '@/lib/meta-results';
import { lerPedidosDelivery } from '@/lib/delivery-orders';
import { noPeriodo, pedidoValido } from '@/lib/cardapioweb-recorrencia';
import { ROTULO_FONTE, ehFonte, fonteVendaSql } from '@/lib/fonte-venda';
import {
  campanhaDeOutraLoja, canalDoPedido, montarFaturamentoDelivery, palavrasDeOutrasLojas,
  type CanalDelivery, type EntradaFaturamentoDelivery,
} from '@/lib/faturamento-delivery';

/**
 * Faturamento por canal de quem tem CARDÁPIO conectado — pedidos (iFood ×
 * cardápio próprio), a parte do cardápio que a Meta atribuiu a anúncio por
 * plataforma, e as vendas do CRM pela fonte. Ver lib/faturamento-delivery.
 *
 * Cliente sem cardápio fica de fora (o card dele segue em /api/crm/por-canal).
 * A régua de data do CRM é a mesma de /api/crm/por-canal (mês do GANHO, só
 * negócio com valor); a dos pedidos é a do resumo de delivery (dia BRT).
 */

export const dynamic = 'force-dynamic';

export type FaturamentoCanalDelivery = { ok: boolean; origens: CanalDelivery[]; total: number; clientes: string[] };

const VAZIO: FaturamentoCanalDelivery = { ok: false, origens: [], total: 0, clientes: [] };

export async function GET(req: NextRequest) {
  const meus = escopoDoCliente(req.headers);
  const pedidos = (req.nextUrl.searchParams.get('clientIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const clientIds = meus ? pedidos.filter((id) => meus.includes(id)) : pedidos;
  const range = parseIsoDateRange(req.nextUrl.searchParams.get('from'), req.nextUrl.searchParams.get('to'));
  if (clientIds.length === 0 || !range) return Response.json(VAZIO);

  const pool = makeServerPool();
  try {
    // Só quem tem cardápio conectado (mesma régua de /api/clients/delivery-flags).
    const { rows: comCardapio } = await pool.query<{ client_id: string }>(
      `SELECT client_id FROM public.cardapioweb_connections WHERE active = true AND client_id = ANY($1)
        UNION SELECT client_id FROM public.client_anota_ai_stores WHERE active = true AND client_id = ANY($1)`,
      [clientIds],
    ).catch(() => ({ rows: [] as { client_id: string }[] }));
    const ids = [...new Set(comCardapio.map((r) => r.client_id))];
    if (ids.length === 0) return Response.json(VAZIO);

    const entrada: EntradaFaturamentoDelivery = { pedidos: {}, meta: {}, crm: {} };
    const periodo = { de: range.from, ate: range.to };

    // 1. Pedidos do cardápio, por canal de venda.
    for (const id of ids) {
      const { pedidos: lista } = await lerPedidosDelivery(pool, id);
      for (const p of lista) {
        if (!pedidoValido(p) || !noPeriodo(p.created_at, periodo)) continue;
        const canal = canalDoPedido(p.sales_channel);
        const a = entrada.pedidos[canal] ?? { receita: 0, pedidos: 0 };
        a.receita += Number(p.total) || 0;
        a.pedidos += 1;
        entrada.pedidos[canal] = a;
      }
    }

    // 2. Vendas ganhas no CRM, pela fonte (WhatsApp, planilha…).
    const VALOR = `COALESCE(NULLIF(l.revenue, 0), l.valor_rs, 0)`;
    const { rows: crm } = await pool.query<{ fonte: string; receita: number; vendas: number }>(
      `SELECT ${fonteVendaSql('l')} AS fonte, COALESCE(SUM(${VALOR}), 0)::float AS receita,
              COUNT(DISTINCT COALESCE(l.origem_lead_id::text, l.id::text))::int AS vendas
         FROM public.crm_leads l
        WHERE l.client_id = ANY($1) AND ${leadContaSql('l')} AND ${VALOR} > 0
          AND (COALESCE(l.fechado_em, l.lead_date, l.data) IS NULL
               OR COALESCE(l.fechado_em, l.lead_date, l.data) BETWEEN $2 AND $3)
        GROUP BY 1`,
      [ids, range.from, range.to],
    ).catch(() => ({ rows: [] as { fonte: string; receita: number; vendas: number }[] }));
    for (const r of crm) {
      const label = `${ROTULO_FONTE[ehFonte(r.fonte) ? r.fonte : 'crm']} · CRM`;
      const a = entrada.crm[label] ?? { receita: 0, vendas: 0 };
      a.receita += Number(r.receita) || 0;
      a.vendas += Number(r.vendas) || 0;
      entrada.crm[label] = a;
    }

    // 3. Compras atribuídas pela Meta, por plataforma, nas contas de cada loja.
    const { rows: links } = await pool.query<{ client_id: string; connection_id: string; account_id: string }>(
      `SELECT client_id, connection_id, account_id FROM public.client_account_links
        WHERE platform = 'meta_ads' AND client_id = ANY($1)`,
      [ids],
    ).catch(() => ({ rows: [] as { client_id: string; connection_id: string; account_id: string }[] }));
    const contas = [...new Set(links.map((l) => l.account_id))];
    const [{ rows: conexoes }, { rows: compartilham }, { rows: nomes }] = await Promise.all([
      pool.query(`SELECT * FROM public.meta_connections WHERE status = 'connected' AND id = ANY($1)`, [[...new Set(links.map((l) => l.connection_id))]]),
      pool.query<{ account_id: string; client_id: string; name: string }>(
        `SELECT l.account_id, l.client_id, c.name FROM public.client_account_links l JOIN public.clients c ON c.id = l.client_id
          WHERE l.platform = 'meta_ads' AND l.account_id = ANY($1)`, [contas]),
      pool.query<{ id: string; name: string }>(`SELECT id, name FROM public.clients WHERE id = ANY($1)`, [ids]),
    ]);
    const nomeDe = new Map(nomes.map((n) => [n.id, n.name]));
    // Campanha SEM nome de loja numa conta compartilhada: é da loja que tem os
    // leads dela no CRM (a "Aniversário" da PicoLocos só tem lead na Guanabara —
    // sem isto ela entrava nas duas lojas). Ninguém com lead → conta para todas.
    const clientesDaConta = [...new Set(compartilham.map((x) => x.client_id))];
    const { rows: donos } = await pool.query<{ client_id: string; campanha: string }>(
      `SELECT DISTINCT client_id, lower(btrim(campaign_name)) AS campanha FROM public.crm_leads
        WHERE client_id = ANY($1) AND NULLIF(btrim(campaign_name), '') IS NOT NULL`,
      [clientesDaConta],
    ).catch(() => ({ rows: [] as { client_id: string; campanha: string }[] }));
    const donosDe = new Map<string, Set<string>>();
    for (const d of donos) {
      const set = donosDe.get(d.campanha) ?? new Set<string>();
      set.add(d.client_id);
      donosDe.set(d.campanha, set);
    }
    const conexaoDe = new Map(conexoes.map((c) => [c.id as string, c]));
    const vistas = new Set<string>();
    for (const l of links) {
      const chave = `${l.account_id}:${l.client_id}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      const conn = conexaoDe.get(l.connection_id);
      if (!conn) continue;
      // Conta compartilhada: campanha com o nome da outra loja não é desta.
      const outras = compartilham.filter((x) => x.account_id === l.account_id && x.client_id !== l.client_id).map((x) => x.name);
      const palavras = palavrasDeOutrasLojas(nomeDe.get(l.client_id) ?? '', outras);
      const token = await getFreshMetaToken(conn);
      const node = l.account_id.startsWith('act_') ? l.account_id : `act_${l.account_id}`;
      const url = new URL(`https://graph.facebook.com/v21.0/${node}/insights`);
      url.searchParams.set('level', 'campaign');
      url.searchParams.set('breakdowns', 'publisher_platform');
      url.searchParams.set('fields', 'campaign_name,actions,action_values');
      url.searchParams.set('time_range', JSON.stringify({ since: range.from, until: range.to }));
      url.searchParams.set('limit', '500');
      url.searchParams.set('access_token', token);
      const res = await fetch(url.toString()).catch(() => null);
      if (!res?.ok) continue;
      const data = await res.json() as { data?: Array<{ campaign_name?: string; publisher_platform?: string; actions?: MetaAction[]; action_values?: MetaAction[] }> };
      for (const row of data.data ?? []) {
        if (campanhaDeOutraLoja(row.campaign_name ?? '', palavras)) continue;
        const dono = outras.length > 0 ? donosDe.get((row.campaign_name ?? '').trim().toLowerCase()) : undefined;
        if (dono && !dono.has(l.client_id)) continue;
        const c = metaPurchases(row.actions, row.action_values);
        if (c.compras <= 0 && c.valor <= 0) continue;
        const plat = row.publisher_platform ?? 'unknown';
        const a = entrada.meta[plat] ?? { receita: 0, compras: 0 };
        a.receita += c.valor;
        a.compras += c.compras;
        entrada.meta[plat] = a;
      }
    }

    const { origens, total } = montarFaturamentoDelivery(entrada);
    return Response.json({ ok: true, origens, total, clientes: ids } satisfies FaturamentoCanalDelivery);
  } catch (err) {
    console.error('[delivery/faturamento-canal]', err);
    return Response.json(VAZIO);
  } finally {
    await pool.end();
  }
}
