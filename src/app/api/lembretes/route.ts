import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureLembretesSchema, normalizarLembrete, proximoDisparo, type Lembrete } from '@/lib/lembretes';

/**
 * Lembretes do usuário logado.
 *
 * ⚠️ O destinatário (`user_id`) pode ser OUTRA pessoa — é o pedido do Matheus ("poder
 * criar para outros usuários, mas por padrão para si mesmo"). O `criado_por` é sempre
 * a sessão, nunca o corpo: quem recebe um lembrete precisa saber quem o pôs lá, e um
 * remetente que o cliente escolhe é um remetente que o cliente pode forjar.
 */

function sessao(req: NextRequest): string | null {
  // O proxy de auth sobrescreve este header a partir do cookie assinado.
  return req.headers.get('x-onmid-user-id') || null;
}

export async function GET(req: NextRequest) {
  const uid = sessao(req);
  if (!uid) return Response.json({ error: 'Não autenticado.' }, { status: 401 });
  const pool = makeServerPool();
  try {
    await ensureLembretesSchema(pool);
    const { rows } = await pool.query<Lembrete>(
      `SELECT * FROM public.lembretes
        WHERE user_id = $1 AND ativo
        ORDER BY proximo_disparo ASC NULLS LAST
        LIMIT 100`,
      [uid],
    );
    return Response.json(rows);
  } catch {
    // degrada para vazio: o sino não pode quebrar porque a tabela ainda não existe
    return Response.json([]);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const uid = sessao(req);
  if (!uid) return Response.json({ error: 'Não autenticado.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const norm = normalizarLembrete(body);
  if (!norm.ok) return Response.json({ error: norm.erro }, { status: 400 });

  const destino = String(body.user_id ?? '').trim() || uid; // padrão: para si mesmo
  const quando = proximoDisparo(norm.valor);
  if (!quando) return Response.json({ error: 'Não consegui calcular quando isso deve tocar.' }, { status: 400 });
  // ⚠️ 'once' no passado nunca tocaria e ficaria eternamente pendente na lista.
  if (norm.valor.recorrencia === 'once' && quando.getTime() < Date.now() - 60_000) {
    return Response.json({ error: 'Essa data e hora já passaram.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureLembretesSchema(pool);
    const { rows: [novo] } = await pool.query<Lembrete>(
      `INSERT INTO public.lembretes
         (user_id, criado_por, titulo, descricao, recorrencia, run_at, hora, dia_semana, dia_mes, proximo_disparo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [destino, uid, norm.valor.titulo, norm.valor.descricao, norm.valor.recorrencia,
       norm.valor.run_at, norm.valor.hora, norm.valor.dia_semana, norm.valor.dia_mes, quando],
    );
    return Response.json(novo);
  } catch (e) {
    return Response.json({ error: (e as Error)?.message ?? 'Falha ao salvar.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const uid = sessao(req);
  if (!uid) return Response.json({ error: 'Não autenticado.' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureLembretesSchema(pool);
    // ⚠️ Pode apagar o que recebe OU o que criou para outra pessoa — mas nada além disso.
    const { rowCount } = await pool.query(
      `UPDATE public.lembretes SET ativo = false, updated_at = NOW()
        WHERE id = $1::uuid AND (user_id = $2 OR criado_por = $2)`,
      [id, uid],
    );
    if (!rowCount) return Response.json({ error: 'Não encontrado.' }, { status: 404 });
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
