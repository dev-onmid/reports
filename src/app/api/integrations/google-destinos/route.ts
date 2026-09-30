// ── GET /api/integrations/google-destinos?cliente=<id ou nome> ────────────────
// Máquina→máquina (header x-onmid-secret = MAKE_INTEGRATION_SECRET), mesmo
// contrato de /api/integrations/google-conversoes. Devolve as campanhas ATIVAS
// do Google Ads do cliente com as URLs finais para onde mandam o clique
// (Pesquisa/Display via ad_group_ad, Performance Max via asset_group), métricas
// de 30 dias, e uma visão invertida por destino. Consumidor:
// ~/Documents/lps/bin/gtag ads destinos — "cada destino tem rastreio?".

import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolveGoogleAdsAccess, resolverCliente } from '@/lib/google-conversion-actions';
import { listarDestinos, porDestino } from '@/lib/google-destinos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function segredoConfere(req: NextRequest): 'ok' | 'negado' | 'sem-segredo' {
  const esperado = process.env.MAKE_INTEGRATION_SECRET;
  if (!esperado) return 'sem-segredo';
  const a = Buffer.from(req.headers.get('x-onmid-secret') ?? '');
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'negado';
}

export async function GET(req: NextRequest) {
  const auth = segredoConfere(req);
  if (auth === 'sem-segredo') return Response.json({ erro: 'integracao_nao_configurada' }, { status: 503 });
  if (auth === 'negado') return Response.json({ erro: 'nao_autorizado' }, { status: 401 });
  const ref = req.nextUrl.searchParams.get('cliente') ?? '';
  if (!ref.trim()) return Response.json({ erro: 'cliente_obrigatorio' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const candidatos = await resolverCliente(pool, ref);
    if (candidatos.length === 0) return Response.json({ erro: 'cliente_nao_encontrado', cliente: ref }, { status: 404 });
    if (candidatos.length > 1) return Response.json({ erro: 'cliente_ambiguo', candidatos }, { status: 409 });
    const cliente = candidatos[0];
    const access = await resolveGoogleAdsAccess(pool, cliente.id);
    if (!access) return Response.json({ erro: 'sem_conta_google_ads', cliente, dica: 'Conecte o Google Ads do cliente em Integrações no reports.' }, { status: 404 });
    const campanhas = await listarDestinos(access);
    if (!campanhas) return Response.json({ erro: 'google_ads_sem_resposta', cliente, conta: access.customerId }, { status: 502 });
    return Response.json({ cliente, conta: access.customerId, periodo: 'LAST_30_DAYS', campanhas, destinos: porDestino(campanhas) });
  } finally {
    await pool.end().catch(() => {});
  }
}
