// ── /api/integrations/google-conversoes ───────────────────────────────────────
// Máquina→máquina (mesmo contrato das outras /api/integrations/*): header
// x-onmid-secret = MAKE_INTEGRATION_SECRET. Consumidor: ~/Documents/lps/bin/gtag.
//
//   GET  ?cliente=<id ou nome>            → lista ações de conversão WEB ativas
//   POST { cliente, nome, categoria?, contagem?, valor? }
//        → cria a ação (idempotente por nome: se já existe, devolve a existente)
//   PATCH { cliente, conversao (id ou nome), principal?, pausar? }
//        → muda a ação que já existe. `principal: false` é a "Secundária
//          (nenhuma ação de lance)" do painel: continua contando no relatório
//          mas para de guiar o lance automático — é o certo para conversão que
//          ficou sem tag (apagar perderia o histórico). Devolve antes/depois.
//
// Ambiguidade de nome de cliente → 409 com os candidatos; sem conta Google Ads
// vinculada → 404. Registrada em INTEGRATION_PREFIXES no proxy.

import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  CATEGORIAS_ACEITAS, acharPorNome, atualizarConversao, criarConversao, listarConversoes,
  resolveGoogleAdsAccess, resolverCliente,
  type CategoriaConversao, type ConversaoGoogle, type NovaConversao,
} from '@/lib/google-conversion-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function segredoConfere(req: NextRequest): 'ok' | 'negado' | 'sem-segredo' {
  const esperado = process.env.MAKE_INTEGRATION_SECRET;
  if (!esperado) return 'sem-segredo';
  const a = Buffer.from(req.headers.get('x-onmid-secret') ?? '');
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'negado';
}

function autoriza(req: NextRequest): Response | null {
  const auth = segredoConfere(req);
  if (auth === 'sem-segredo') return Response.json({ erro: 'integracao_nao_configurada' }, { status: 503 });
  if (auth === 'negado') return Response.json({ erro: 'nao_autorizado' }, { status: 401 });
  return null;
}

async function contexto(pool: ReturnType<typeof makeServerPool>, ref: string) {
  const candidatos = await resolverCliente(pool, ref);
  if (candidatos.length === 0) return { erro: Response.json({ erro: 'cliente_nao_encontrado', cliente: ref }, { status: 404 }) };
  if (candidatos.length > 1) {
    return { erro: Response.json({ erro: 'cliente_ambiguo', candidatos }, { status: 409 }) };
  }
  const cliente = candidatos[0];
  const access = await resolveGoogleAdsAccess(pool, cliente.id);
  if (!access) {
    return { erro: Response.json({ erro: 'sem_conta_google_ads', cliente, dica: 'Conecte o Google Ads do cliente em Integrações no reports.' }, { status: 404 }) };
  }
  return { cliente, access };
}

export async function GET(req: NextRequest) {
  const neg = autoriza(req); if (neg) return neg;
  const ref = req.nextUrl.searchParams.get('cliente') ?? '';
  if (!ref.trim()) return Response.json({ erro: 'cliente_obrigatorio' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const ctx = await contexto(pool, ref);
    if ('erro' in ctx) return ctx.erro;
    const conversoes = await listarConversoes(ctx.access);
    if (!conversoes) return Response.json({ erro: 'google_ads_sem_resposta', cliente: ctx.cliente, conta: ctx.access.customerId }, { status: 502 });
    return Response.json({ cliente: ctx.cliente, conta: ctx.access.customerId, mcc: ctx.access.loginCustomerId ?? null, conversoes });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const neg = autoriza(req); if (neg) return neg;
  const body = await req.json().catch(() => null) as Partial<NovaConversao & { cliente: string; categoria: string }> | null;
  const ref = String(body?.cliente ?? '').trim();
  const nome = String(body?.nome ?? '').trim();
  if (!ref || !nome) return Response.json({ erro: 'cliente_e_nome_obrigatorios' }, { status: 400 });
  if (nome.length > 100) return Response.json({ erro: 'nome_muito_longo', max: 100 }, { status: 400 });
  const categoria = (body?.categoria ?? 'LEAD').toUpperCase();
  if (!(CATEGORIAS_ACEITAS as readonly string[]).includes(categoria)) {
    return Response.json({ erro: 'categoria_invalida', aceitas: CATEGORIAS_ACEITAS }, { status: 400 });
  }
  const contagem = body?.contagem === 'MANY_PER_CLICK' ? 'MANY_PER_CLICK' : 'ONE_PER_CLICK';
  const valor = Number(body?.valor ?? 0);

  const pool = makeServerPool();
  try {
    const ctx = await contexto(pool, ref);
    if ('erro' in ctx) return ctx.erro;

    const antes = await listarConversoes(ctx.access);
    if (!antes) return Response.json({ erro: 'google_ads_sem_resposta', cliente: ctx.cliente }, { status: 502 });
    const existente = acharPorNome(antes, nome);
    if (existente) return Response.json({ criada: false, cliente: ctx.cliente, conta: ctx.access.customerId, conversao: existente });

    const r = await criarConversao(ctx.access, { nome, categoria: categoria as CategoriaConversao, contagem, valor });
    if ('error' in r) return Response.json({ erro: 'google_ads_recusou', mensagem: r.error, cliente: ctx.cliente }, { status: 502 });

    // O snippet (AW-xxx/rótulo) só vem pela busca — relê a lista e acha pelo id.
    const idNovo = r.resourceName.split('/').pop() ?? '';
    const depois = (await listarConversoes(ctx.access)) ?? [];
    const conversao = depois.find(c => c.id === idNovo) ?? acharPorNome(depois, nome) ?? null;
    return Response.json({ criada: true, cliente: ctx.cliente, conta: ctx.access.customerId, resourceName: r.resourceName, conversao }, { status: 201 });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function PATCH(req: NextRequest) {
  const neg = autoriza(req); if (neg) return neg;
  const body = await req.json().catch(() => null) as
    { cliente?: string; conversao?: string; principal?: boolean; pausar?: boolean } | null;
  const ref = String(body?.cliente ?? '').trim();
  const alvo = String(body?.conversao ?? '').trim();
  if (!ref || !alvo) return Response.json({ erro: 'cliente_e_conversao_obrigatorios' }, { status: 400 });
  if (body?.principal === undefined && body?.pausar === undefined) {
    return Response.json({ erro: 'nada_para_alterar', dica: 'mande principal: true|false e/ou pausar: true|false' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const ctx = await contexto(pool, ref);
    if ('erro' in ctx) return ctx.erro;

    const antes = await listarConversoes(ctx.access);
    if (!antes) return Response.json({ erro: 'google_ads_sem_resposta', cliente: ctx.cliente }, { status: 502 });
    // aceita o id numérico ou o nome exato — o id é o que a listagem mostra
    const atual: ConversaoGoogle | undefined = antes.find(c => c.id === alvo) ?? acharPorNome(antes, alvo);
    if (!atual) {
      return Response.json({ erro: 'conversao_nao_encontrada', cliente: ctx.cliente, procurado: alvo,
        disponiveis: antes.map(c => ({ id: c.id, nome: c.nome, principal: c.principal })) }, { status: 404 });
    }
    if (body?.principal !== undefined && atual.principal === body.principal && body?.pausar === undefined) {
      return Response.json({ alterada: false, motivo: 'ja_estava_assim', cliente: ctx.cliente, conversao: atual });
    }

    const r = await atualizarConversao(ctx.access, atual.id, { principal: body?.principal, pausar: body?.pausar });
    if ('error' in r) return Response.json({ erro: 'google_ads_recusou', mensagem: r.error, cliente: ctx.cliente, conversao: atual }, { status: 502 });

    const depois = (await listarConversoes(ctx.access)) ?? [];
    return Response.json({
      alterada: true, cliente: ctx.cliente, conta: ctx.access.customerId,
      antes: { id: atual.id, nome: atual.nome, principal: atual.principal, status: atual.status },
      depois: depois.find(c => c.id === atual.id) ?? null,
    });
  } finally {
    await pool.end().catch(() => {});
  }
}
