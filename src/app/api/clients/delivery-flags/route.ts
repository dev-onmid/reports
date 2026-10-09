import type { NextRequest } from 'next/server';
import { escopoDoCliente } from '@/lib/acesso';
import { makeServerPool } from '@/lib/server-db';

/**
 * Quais clientes são de DELIVERY (Cardápio Web e/ou Anota AI conectados).
 *
 * O dashboard usa isso pra trocar o Funil de Performance pelo resumo de
 * delivery quando o cliente selecionado é de cardápio digital — o funil de CRM
 * não descreve o negócio deles (a receita vive nos pedidos, não em crm_leads).
 *
 * Não existe flag em `clients` de propósito: a fonte da verdade é a própria
 * conexão (mesma regra do painel em /api/clients/[id]/cardapioweb). Duas
 * queries baratas; sem tabela → objeto vazio, nunca 500.
 */
export async function GET(req: NextRequest) {
  const meus = escopoDoCliente(req.headers);
  const pool = makeServerPool();
  try {
    const flags: Record<string, true> = {};
    const [cw, anota] = await Promise.all([
      pool.query<{ client_id: string }>(
        `SELECT DISTINCT client_id FROM public.cardapioweb_connections WHERE active = true`
      ).catch(() => ({ rows: [] as { client_id: string }[] })),
      pool.query<{ client_id: string }>(
        `SELECT DISTINCT client_id FROM public.client_anota_ai_stores WHERE active = true`
      ).catch(() => ({ rows: [] as { client_id: string }[] })),
    ]);
    for (const r of [...cw.rows, ...anota.rows]) if (!meus || meus.includes(r.client_id)) flags[r.client_id] = true;
    return Response.json(flags);
  } catch {
    return Response.json({});
  } finally {
    await pool.end();
  }
}
