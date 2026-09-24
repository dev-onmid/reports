import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import {
  ensureFunilModelosSchema,
  listarModelos,
  salvarModelo,
  etapasDoFunil,
  normalizarEtapas,
} from '@/lib/crm-funil-modelos';

// Modelos de funil — biblioteca da AGÊNCIA, não do cliente: o objetivo é
// reaproveitar num cliente o funil que deu certo em outro, então a lista é a
// mesma para todo mundo (mesma filosofia da biblioteca de benchmarks).

export async function GET(req: NextRequest) {
  if (!getSession(req)) return unauthorized();
  const pool = makeServerPool();
  try {
    await ensureFunilModelosSchema(pool);
    return Response.json(await listarModelos(pool));
  } catch (err) {
    // Degrada para lista vazia: sem modelo o gestor ainda cria funil no padrão.
    console.error('[funil-modelos] GET', err);
    return Response.json([]);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return unauthorized();

  const body = await req.json().catch(() => ({})) as {
    nome?: string; descricao?: string; funnelId?: string; clientId?: string; etapas?: unknown;
  };
  const nome = body.nome?.trim();
  if (!nome) return Response.json({ error: 'nome é obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureFunilModelosSchema(pool);

    // Duas portas: fotografar um funil existente (`funnelId`) ou receber as
    // etapas prontas — o editor manda as etapas que estão na TELA, que podem
    // ainda não ter sido salvas no funil.
    const etapas = body.funnelId
      ? await etapasDoFunil(pool, body.funnelId)
      : normalizarEtapas(body.etapas);

    if (etapas.length === 0) {
      return Response.json({ error: 'O modelo precisa de pelo menos uma etapa.' }, { status: 400 });
    }

    const modelo = await salvarModelo(pool, {
      nome,
      descricao: body.descricao ?? null,
      etapas,
      clienteOrigem: body.clientId ?? null,
      criadoPor: session.uid,
    });
    return Response.json(modelo, { status: 201 });
  } catch (err) {
    console.error('[funil-modelos] POST', err);
    return Response.json({ error: 'Não foi possível salvar o modelo.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  if (!getSession(req)) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id é obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureFunilModelosSchema(pool);
    // ⚠️ Apagar o modelo NÃO toca em funil nenhum: o modelo é uma fotografia,
    // os funis criados a partir dele seguem vivos e independentes.
    await pool.query(`DELETE FROM public.crm_funil_modelos WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
