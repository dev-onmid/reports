import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { agregarCatalogo, type NegocioRemoto } from '@/lib/sults';
import {
  amostrarNegociosSults, conexaoSults, ensureSultsSchema, validarTokenSults,
} from '@/lib/sults-server';
import { ensureSultsSyncSchema, sincronizarVoltaSults } from '@/lib/sults-sync';
import { processarFilaSults } from '@/lib/sults-motor';

/**
 * Configuração da integração SULTS por cliente.
 *
 * Auth pelo deny-by-default do proxy, como as demais subrotas de cliente.
 *
 * ⚠️ O token NUNCA volta ao browser — só mascarado. Mesma regra do ClickUp; o
 * Agendor vaza o dele num SELECT * e isso não deve ser copiado.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function mascarar(t: string | null): string | null {
  if (!t) return null;
  return t.length <= 10 ? '••••' : `${t.slice(0, 4)}••••••••${t.slice(-4)}`;
}

async function carregar(pool: ReturnType<typeof makeServerPool>, clientId: string) {
  const conn = await conexaoSults(pool, clientId);
  if (!conn) return { conectado: false as const };

  const { rows: [f] } = await pool.query<Record<string, string>>(
    `SELECT COUNT(*) FILTER (WHERE status IN ('pendente','erro'))::text fila,
            COUNT(*) FILTER (WHERE status = 'enviado')::text enviados,
            COUNT(*) FILTER (WHERE status = 'falha')::text falhas,
            COUNT(*) FILTER (WHERE status = 'descartado')::text descartados,
            COUNT(*) FILTER (WHERE status = 'enviando')::text presos
       FROM public.sults_envios WHERE client_id = $1`, [clientId],
  ).catch(() => ({ rows: [{}] }));

  const { rows: [v] } = await pool.query<Record<string, string>>(
    `SELECT (SELECT COUNT(*)::text FROM public.sults_negocios WHERE client_id = $1) negocios,
            (SELECT COUNT(*)::text FROM public.sults_movimentos WHERE client_id = $1) movimentos,
            -- Prova de que a ingestão chegou no CRM: são estes leads que a
            -- dashboard e o funil passam a enxergar.
            (SELECT COUNT(*)::text FROM public.crm_leads
              WHERE client_id = $1 AND external_id LIKE 'sults:%') leads_crm`,
    [clientId],
  ).catch(() => ({ rows: [{}] }));

  /**
   * Canais que ESTE cliente realmente tem — alimentam o menu do mapa de origem.
   *
   * ⚠️ `canal` e `origin` vêm separados de propósito: são dimensões diferentes
   * ('Formulário Meta' é canal, 'meta' é origin) e `origemSults` testa o canal
   * ANTES do origin. Fundir os dois no menu esconderia essa precedência de quem
   * está configurando.
   *
   * Minúsculas já aqui — é a forma com que a comparação acontece na hora do
   * envio, então é a forma que deve ser gravada.
   */
  const listaDe = async (coluna: 'canal' | 'origin') => {
    const { rows } = await pool.query<{ valor: string; qtd: string }>(
      `SELECT lower(trim(${coluna})) valor, COUNT(*)::text qtd
         FROM public.crm_leads
        WHERE client_id = $1 AND COALESCE(NULLIF(trim(${coluna}), ''), '') <> ''
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 30`,
      [clientId],
    ).catch(() => ({ rows: [] }));
    return rows;
  };
  const [canais, origins] = await Promise.all([listaDe('canal'), listaDe('origin')]);

  return {
    conectado: true as const,
    enabled: conn.enabled,
    sync_ativo: conn.sync_ativo !== false,
    ingerir_crm: conn.ingerir_crm === true,
    api_token_masked: mascarar(conn.api_token),
    responsavel_id: conn.responsavel_id,
    etapa_id: conn.etapa_id,
    funil_id: conn.funil_id ?? null,
    origem_id: conn.origem_id,
    campanha_id: conn.campanha_id,
    mapa_origem: conn.mapa_origem,
    desde: conn.desde,
    ultima_varredura_em: conn.ultima_varredura_em,
    ultimo_erro: conn.ultimo_erro,
    ultima_volta_em: conn.ultima_volta_em ?? null,
    ultimo_erro_volta: conn.ultimo_erro_volta ?? null,
    stats: { ...f, ...v },
    canais: { canal: canais, origin: origins },
    sync_pagina: conn.sync_pagina ?? 0,
    catalogo: conn.catalogo ?? null,
    catalogo_em: conn.catalogo_em ?? null,
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pool = makeServerPool();
  try {
    await ensureSultsSyncSchema(pool);

    if (new URL(req.url).searchParams.get('catalogo')) {
      const conn = await conexaoSults(pool, id);
      if (!conn?.api_token) return Response.json({ erro: 'Conecte um token primeiro.' }, { status: 400 });
      const negocios = await amostrarNegociosSults(conn.api_token);
      const cat = agregarCatalogo(negocios as NegocioRemoto[]);
      // Guardado para a próxima abertura da tela não depender de 27 requisições
      // à API do cliente só para desenhar os menus.
      await pool.query(
        `UPDATE public.sults_connections
            SET catalogo = $2::jsonb, catalogo_em = NOW() WHERE client_id = $1`,
        [id, JSON.stringify(cat)],
      ).catch(() => null);
      return Response.json(cat);
    }

    return Response.json(await carregar(pool, id));
  } catch (err) {
    console.error('[sults config GET]', err);
    return Response.json({ conectado: false, erro: String(err) });
  } finally {
    await pool.end().catch(() => {});
  }
}

/** Conecta: valida o token contra a API antes de gravar qualquer coisa. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { apiToken?: string; acao?: string };

  // Rodar agora, sem esperar o cron. O orçamento é curto de propósito: quem
  // clicou está olhando a tela, e a rodada seguinte do cron continua de onde
  // esta parar (o cursor de página é retomável).
  if (body.acao === 'sincronizar' || body.acao === 'enviar') {
    const pool = makeServerPool();
    try {
      await ensureSultsSyncSchema(pool);
      const r = body.acao === 'sincronizar'
        ? await sincronizarVoltaSults(pool, { clientId: id, budgetMs: 40_000 })
        : await processarFilaSults(pool, { clientId: id, budgetMs: 40_000 });
      return Response.json({ ok: true, resultado: r.clientes[0] ?? null, ...(await carregar(pool, id)) });
    } catch (err) {
      return Response.json({ erro: String(err) }, { status: 500 });
    } finally {
      await pool.end().catch(() => {});
    }
  }

  const token = String(body.apiToken ?? '').trim();
  if (!token) return Response.json({ erro: 'Informe o token.' }, { status: 400 });

  const valido = await validarTokenSults(token);
  if (!valido.ok) return Response.json({ erro: valido.erro }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureSultsSyncSchema(pool);
    // ⚠️ Nasce DESLIGADA: sem responsável e etapa escolhidos o POST do SULTS
    // seria recusado, e a fila entraria em retry até o teto. Ligar é um passo
    // consciente, depois de configurar.
    await pool.query(
      `INSERT INTO public.sults_connections (client_id, api_token, enabled, desde)
       VALUES ($1, $2, FALSE, NOW())
       ON CONFLICT (client_id) DO UPDATE SET api_token = EXCLUDED.api_token`,
      [id, token],
    );
    return Response.json({ ok: true, ...(await carregar(pool, id)) });
  } catch (err) {
    console.error('[sults config POST]', err);
    return Response.json({ erro: String(err) }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}

const NUM = ['responsavel_id', 'etapa_id', 'funil_id', 'origem_id', 'campanha_id'] as const;
const BOOL = ['enabled', 'sync_ativo', 'ingerir_crm'] as const;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const c of NUM) {
    if (!(c in body)) continue;
    const v = body[c] === null || body[c] === '' ? null : Number(body[c]);
    if (v !== null && (!Number.isInteger(v) || v <= 0)) {
      return Response.json({ erro: `${c} inválido` }, { status: 400 });
    }
    vals.push(v); sets.push(`${c} = $${vals.length}`);
  }
  for (const c of BOOL) {
    if (!(c in body)) continue;
    vals.push(Boolean(body[c])); sets.push(`${c} = $${vals.length}`);
  }
  if ('mapa_origem' in body) {
    const m = body.mapa_origem;
    vals.push(m && typeof m === 'object' ? JSON.stringify(m) : null);
    sets.push(`mapa_origem = $${vals.length}::jsonb`);
  }
  // ⚠️ `desde` é o corte de histórico — recuar despeja a base do cliente no CRM
  // dele, e a API não publica DELETE de negócio. Só aceita data, nunca "tudo".
  if ('desde' in body) {
    const d = String(body.desde ?? '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return Response.json({ erro: 'desde inválido' }, { status: 400 });
    vals.push(d); sets.push(`desde = $${vals.length}::timestamptz`);
  }
  if (!sets.length) return Response.json({ erro: 'nada para atualizar' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureSultsSyncSchema(pool);
    const { rowCount } = await pool.query(
      `UPDATE public.sults_connections SET ${sets.join(', ')} WHERE client_id = $1`, vals,
    );
    if (!rowCount) return Response.json({ erro: 'conexão não encontrada' }, { status: 404 });
    return Response.json({ ok: true, ...(await carregar(pool, id)) });
  } catch (err) {
    console.error('[sults config PATCH]', err);
    return Response.json({ erro: String(err) }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}

/**
 * Desconecta. ⚠️ Apaga só a CONEXÃO — `sults_envios`, `sults_negocios` e
 * `sults_movimentos` ficam: são histórico do que já aconteceu, e apagá-los
 * faria um reconectar recriar negócios que já existem no CRM do cliente.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pool = makeServerPool();
  try {
    await ensureSultsSchema(pool);
    await pool.query(`DELETE FROM public.sults_connections WHERE client_id = $1`, [id]);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ erro: String(err) }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
