import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { sanitizeJsonValue } from '@/lib/delivery-report-builder';

// Sorteador — histórico de sorteios realizados (transparência: quem sorteou,
// quando, com quais regras e quem ganhou). Registro imutável; DELETE só
// autor/admin — mesmo racional do histórico de otimizações.

let schemaEnsured = false;
async function ensureSchema(pool: Pool) {
  if (schemaEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.sorteio_registros (
      id BIGSERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      rede TEXT NOT NULL,
      post_id TEXT,
      post_permalink TEXT,
      post_legenda TEXT,
      total_comentarios INT NOT NULL DEFAULT 0,
      total_participantes INT NOT NULL DEFAULT 0,
      total_chances INT NOT NULL DEFAULT 0,
      regras JSONB,
      ganhadores JSONB,
      suplentes JSONB,
      excluidos JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sorteio_registros_client
      ON public.sorteio_registros (client_id, created_at DESC);
  `);
  schemaEnsured = true;
}

const COLS = `id, client_id, user_id, user_name, rede, post_id, post_permalink, post_legenda,
  total_comentarios, total_participantes, total_chances, regras, ganhadores, suplentes, excluidos, created_at`;

export async function GET(req: NextRequest) {
  if (!getSession(req)) return unauthorized();
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    const { rows } = clientId
      ? await pool.query(
          `SELECT ${COLS} FROM public.sorteio_registros WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [clientId, limit],
        )
      : await pool.query(
          `SELECT ${COLS} FROM public.sorteio_registros ORDER BY created_at DESC LIMIT $1`,
          [limit],
        );
    return Response.json({ registros: rows });
  } catch {
    // Sem banco (dev local) a tela degrada pra vazio.
    return Response.json({ registros: [] });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return unauthorized();

  const body = await req.json().catch(() => ({})) as {
    client_id?: string; rede?: string; post_id?: string; post_permalink?: string; post_legenda?: string;
    total_comentarios?: number; total_participantes?: number; total_chances?: number;
    regras?: unknown; ganhadores?: unknown; suplentes?: unknown; excluidos?: unknown;
  };
  if (!body.client_id || !Array.isArray(body.ganhadores) || body.ganhadores.length === 0) {
    return Response.json({ error: 'client_id e ganhadores são obrigatórios.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    // Autoria vem da SESSÃO, nunca do corpo.
    const { rows: users } = await pool
      .query<{ name: string }>('SELECT name FROM public.users WHERE id = $1', [session.uid])
      .catch(() => ({ rows: [] as { name: string }[] }));
    const { rows } = await pool.query(
      `INSERT INTO public.sorteio_registros
        (client_id, user_id, user_name, rede, post_id, post_permalink, post_legenda,
         total_comentarios, total_participantes, total_chances, regras, ganhadores, suplentes, excluidos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${COLS}`,
      [
        body.client_id,
        session.uid,
        users[0]?.name ?? null,
        body.rede === 'facebook' ? 'facebook' : 'instagram',
        body.post_id ?? null,
        body.post_permalink ?? null,
        (body.post_legenda ?? '').slice(0, 300) || null,
        Math.max(0, Number(body.total_comentarios) || 0),
        Math.max(0, Number(body.total_participantes) || 0),
        Math.max(0, Number(body.total_chances) || 0),
        // Comentário tem emoji — sanitiza pra JSONB nunca receber surrogate órfão
        // (lição do relatório de 1 ano, ver CLAUDE.md).
        JSON.stringify(sanitizeJsonValue(body.regras ?? {})),
        JSON.stringify(sanitizeJsonValue(body.ganhadores)),
        JSON.stringify(sanitizeJsonValue(body.suplentes ?? [])),
        JSON.stringify(sanitizeJsonValue(body.excluidos ?? {})),
      ],
    );
    return Response.json({ ok: true, registro: rows[0] }, { status: 201 });
  } catch {
    // Sem banco, o sorteio em si continua funcionando — só não fica no histórico.
    return Response.json({ ok: false, error: 'Não foi possível gravar o histórico.' });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const session = getSession(req);
  if (!session) return unauthorized();
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id) return Response.json({ error: 'id obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    const isAdmin = session.role === 'Administrador';
    const { rowCount } = await pool.query(
      isAdmin
        ? `DELETE FROM public.sorteio_registros WHERE id = $1`
        : `DELETE FROM public.sorteio_registros WHERE id = $1 AND user_id = $2`,
      isAdmin ? [id] : [id, session.uid],
    );
    if (!rowCount) return Response.json({ error: 'Registro não encontrado (ou não é seu).' }, { status: 404 });
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
