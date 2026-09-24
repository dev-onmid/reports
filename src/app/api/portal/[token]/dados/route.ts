import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolvePortalToken } from '@/lib/crm-portal';
import { internalHeaders } from '@/lib/session';
import { FONTES, fonteValida } from '@/lib/portal-dados';
import { getCached, setCached, TTL_15MIN } from '@/lib/api-cache';

// ── Portal do cliente: dados da dashboard (read-only) ────────────────────────
//
// GET ?r=<chave>&period=&from=&to=…  →  a resposta da rota interna, recortada
// no cliente do token. As travas e o porquê de não ser um encaminhamento livre
// estão em src/lib/portal-dados.ts.
//
// Esta rota não decide privacidade: ela só executa a allowlist. Campo novo que
// não pode chegar ao cliente se resolve na rota de origem ou no `filtrar` da
// fonte, nunca com um `if` aqui.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function origem(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://reports.onmid.app')
    .trim().replace(/\/$/, '');
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const chave = req.nextUrl.searchParams.get('r');

  if (!fonteValida(chave)) {
    return Response.json({ error: 'Dado não disponível neste link' }, { status: 404 });
  }

  const pool = makeServerPool();
  try {
    const ctx = await resolvePortalToken(pool, token);
    if (!ctx) return Response.json({ error: 'Link inválido ou revogado' }, { status: 404 });

    const fonte = FONTES[chave];
    const caminho = fonte.path(ctx.clientId, req.nextUrl.searchParams);

    // Cache de 15 min por (cliente, fonte, janela). Três das rotas de origem
    // (campanhas, social, criativos) batem na Meta/Google a cada chamada e não
    // têm cache próprio — sem isto, um cliente trocando de período ou dando
    // F5 consome a cota de API da conta dele. A chave leva o client_id, nunca
    // o token: dois tokens do mesmo cliente compartilham o cache, e um token
    // novo não herda cache de cliente nenhum.
    const chaveCache = `portal:${ctx.clientId}:${caminho}`;
    const emCache = getCached(chaveCache);
    if (emCache) return Response.json(emCache.data);

    const alvo = `${origem()}${caminho}`;
    const r = await fetch(alvo, { headers: internalHeaders(), cache: 'no-store' });
    if (!r.ok) {
      // O corpo da rota interna pode carregar detalhe operacional (nome de
      // conta, id de conexão, motivo de token expirado) — o cliente recebe só
      // o fato de que aquele bloco não carregou.
      console.error(`[portal dados] ${chave} → HTTP ${r.status} (cliente ${ctx.clientId})`);
      return Response.json({ error: 'Não foi possível carregar agora' }, { status: 502 });
    }

    const json = await r.json();
    const saida = fonte.filtrar ? fonte.filtrar(json, ctx.clientId) : json;
    setCached(chaveCache, saida, TTL_15MIN);
    return Response.json(saida);
  } catch (err) {
    console.error('[portal dados]', err);
    return Response.json({ error: 'Erro ao carregar' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
