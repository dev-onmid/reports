import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureOtimizacaoHistoricoSchema, type OtimizacaoRegistroRow } from '@/lib/otimizacao-historico';

// Histórico manual de otimizações por conta. Ver src/lib/otimizacao-historico.ts
// para o racional do modelo (registro imutável; delete só autor/admin).

const COLS = `id, client_id, user_id, user_name, canal, canal_detalhe, acoes, descricao, origem, created_at`;
const CANAIS_VALIDOS = new Set(['meta', 'google', 'outro']);

export async function GET(req: NextRequest) {
  if (!getSession(req)) return unauthorized();
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 200));

  const pool = makeServerPool();
  try {
    await ensureOtimizacaoHistoricoSchema(pool);
    const { rows } = await pool.query<OtimizacaoRegistroRow>(
      `SELECT ${COLS} FROM public.otimizacao_registros
        WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [clientId, limit],
    );
    return Response.json({ registros: rows });
  } catch {
    // Sem banco (dev local) a tela degrada pra vazio em vez de quebrar.
    return Response.json({ registros: [] });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return unauthorized();

  const body = await req.json().catch(() => ({})) as {
    client_id?: string; canal?: string; canal_detalhe?: string | null;
    acoes?: unknown; descricao?: string; origem?: string;
  };
  const canal = (body.canal ?? '').trim().toLowerCase();
  const descricao = (body.descricao ?? '').trim();
  if (!body.client_id || !descricao) {
    return Response.json({ error: 'client_id e descricao são obrigatórios.' }, { status: 400 });
  }
  if (!CANAIS_VALIDOS.has(canal)) {
    return Response.json({ error: 'canal inválido. Use meta, google ou outro.' }, { status: 400 });
  }

  const acoes = Array.isArray(body.acoes)
    ? body.acoes.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        .map((a) => a.trim().slice(0, 40)).slice(0, 15)
    : [];

  const pool = makeServerPool();
  try {
    await ensureOtimizacaoHistoricoSchema(pool);
    // Autoria vem da SESSÃO, nunca do corpo — o histórico é trilha de auditoria.
    const { rows: users } = await pool
      .query<{ name: string }>('SELECT name FROM public.users WHERE id = $1', [session.uid])
      .catch(() => ({ rows: [] as { name: string }[] }));
    const { rows } = await pool.query<OtimizacaoRegistroRow>(
      `INSERT INTO public.otimizacao_registros
        (client_id, user_id, user_name, canal, canal_detalhe, acoes, descricao, origem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${COLS}`,
      [
        body.client_id,
        session.uid,
        users[0]?.name ?? null,
        canal,
        canal === 'outro' ? (body.canal_detalhe?.trim().slice(0, 80) || null) : null,
        acoes,
        descricao.slice(0, 8000),
        body.origem === 'audio' ? 'audio' : 'texto',
      ],
    );
    return Response.json({ ok: true, registro: rows[0] }, { status: 201 });
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
    await ensureOtimizacaoHistoricoSchema(pool);
    // Só o autor ou um admin apagam — o histórico existe pra dar continuidade
    // entre gestores, então ninguém reescreve o registro dos outros.
    const isAdmin = session.role === 'Administrador';
    const { rowCount } = await pool.query(
      isAdmin
        ? `DELETE FROM public.otimizacao_registros WHERE id = $1`
        : `DELETE FROM public.otimizacao_registros WHERE id = $1 AND user_id = $2`,
      isAdmin ? [id] : [id, session.uid],
    );
    if (!rowCount) return Response.json({ error: 'Registro não encontrado (ou não é seu).' }, { status: 404 });
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
