import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { atualizarChecklist, listarResumos, type ChecklistItem } from '@/lib/reuniao-resumos';

/**
 * Reuniões do cliente — alimenta a aba Reuniões da tela do cliente.
 * Escrita do pacote acontece só pelo webhook `/api/integrations/reuniao/resumo`
 * (Make); aqui é leitura, PATCH do checklist (marcar item feito na tela) e
 * exclusão pontual pra limpar teste/duplicata.
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { resumoId?: unknown; checklist?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const resumoId = typeof body.resumoId === 'string' || typeof body.resumoId === 'number' ? String(body.resumoId) : '';
  if (!resumoId) return Response.json({ error: 'resumoId obrigatório' }, { status: 400 });

  // A UI manda o array completo que está exibindo (texto + feito).
  if (!Array.isArray(body.checklist)) return Response.json({ error: 'checklist deve ser um array' }, { status: 400 });
  const checklist: ChecklistItem[] = [];
  for (const item of body.checklist) {
    const texto = typeof (item as ChecklistItem)?.texto === 'string' ? (item as ChecklistItem).texto.trim() : '';
    if (!texto) return Response.json({ error: 'item de checklist sem texto' }, { status: 400 });
    checklist.push({ texto, feito: (item as ChecklistItem).feito === true });
  }

  const pool = makeServerPool();
  try {
    const ok = await atualizarChecklist(pool, id, resumoId, checklist);
    if (!ok) return Response.json({ error: 'Reunião não encontrada' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[client reunioes PATCH]', err);
    return Response.json({ error: 'Falha ao salvar checklist' }, { status: 500 });
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
