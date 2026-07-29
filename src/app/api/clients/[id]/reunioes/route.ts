import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { listarResumos } from '@/lib/reuniao-resumos';

/**
 * Resumos de reunião do cliente — alimenta a seção "Reuniões" da aba Demandas.
 * Escrita acontece só pelo webhook `/api/integrations/reuniao/resumo` (Make);
 * aqui é leitura (+ exclusão pontual pra limpar teste/duplicata).
 * Auth: deny-by-default do proxy (cookie de sessão), padrão das subrotas de cliente.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50) || 50;
  const pool = makeServerPool();
  try {
    const resumos = await listarResumos(pool, id, limit);
    return Response.json({ resumos });
  } catch (err) {
    console.error('[client reunioes GET]', err);
    // Tela degrada graciosa (mostra vazio) em vez de quebrar com 500.
    return Response.json({ resumos: [], error: 'Falha ao listar resumos' });
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const resumoId = new URL(req.url).searchParams.get('resumoId');
  if (!resumoId) return Response.json({ error: 'resumoId obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await pool.query(
      'DELETE FROM public.reuniao_resumos WHERE client_id = $1 AND id = $2',
      [id, resumoId],
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[client reunioes DELETE]', err);
    return Response.json({ error: 'Falha ao excluir' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
