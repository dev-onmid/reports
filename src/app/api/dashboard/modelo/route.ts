import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized, requireAdmin } from '@/lib/api-auth';
import { normalizarSegmento } from '@/lib/dashboard-segmento';
import { modeloPadrao, normalizarModelo } from '@/lib/dashboard-modelo';

/**
 * Modelo editável do dashboard, POR SEGMENTO.
 *
 * ⚠️ Vive no BANCO, não em localStorage. O sistema de layout antigo deste repo
 * guardava tudo em localStorage — o que funcionava para preferência pessoal, mas
 * aqui o modelo é da AGÊNCIA: editar o de food muda o painel de todos os
 * restaurantes, para todo mundo do time. Preferência de navegador não sobrevive
 * a outro computador nem é compartilhável.
 *
 * GET  ?segmento=food → { modelo }   (qualquer usuário logado; a tela precisa ler)
 * PUT  { segmento, modelo }          (só Administrador — muda o painel de todos)
 */

async function ensureSchema(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.dashboard_modelos (
      segmento    TEXT PRIMARY KEY,
      layout      JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by  TEXT
    )
  `);
}

export async function GET(req: NextRequest) {
  if (!getSession(req)) return unauthorized();
  const segmento = normalizarSegmento(req.nextUrl.searchParams.get('segmento'));

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    const { rows } = await pool.query(
      'SELECT layout FROM public.dashboard_modelos WHERE segmento = $1 LIMIT 1',
      [segmento],
    );
    // `normalizarModelo` funde com o padrão do código: bloco novo entra, bloco
    // que saiu do código é descartado. Sem isso, uma feature nova ficaria
    // invisível para quem já salvou um modelo.
    return Response.json({ modelo: normalizarModelo(rows[0]?.layout ?? null, segmento) });
  } catch (err) {
    // Banco fora não pode derrubar o dashboard — cai no layout de fábrica.
    console.error('[dashboard modelo]', err);
    return Response.json({ modelo: modeloPadrao(segmento), erro: true });
  } finally {
    await pool.end();
  }
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  let body: { segmento?: unknown; modelo?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const segmento = normalizarSegmento(body.segmento);
  // Normaliza ANTES de gravar: o que entra no banco já é um modelo válido,
  // então nenhum consumidor futuro precisa desconfiar do conteúdo.
  const modelo = normalizarModelo(body.modelo, segmento);

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    await pool.query(
      `INSERT INTO public.dashboard_modelos (segmento, layout, updated_by)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (segmento) DO UPDATE
         SET layout = EXCLUDED.layout, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [segmento, JSON.stringify(modelo), admin.userId],
    );
    return Response.json({ ok: true, modelo });
  } catch (err) {
    console.error('[dashboard modelo PUT]', err);
    return Response.json({ error: 'Não foi possível salvar o modelo' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

/** Volta ao layout de fábrica: apaga a linha e o GET passa a devolver o padrão. */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const segmento = normalizarSegmento(req.nextUrl.searchParams.get('segmento'));

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    await pool.query('DELETE FROM public.dashboard_modelos WHERE segmento = $1', [segmento]);
    return Response.json({ ok: true, modelo: modeloPadrao(segmento) });
  } catch (err) {
    console.error('[dashboard modelo DELETE]', err);
    return Response.json({ error: 'Não foi possível restaurar o padrão' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
