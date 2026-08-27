import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { webhookOrigin } from '@/lib/evolution-api';
import { cancelarPublicacao, obterPublicacao, reenfileirarAlvo } from '@/lib/post-server';
import { processarFila } from '@/lib/post-motor';

/** Detalhe, cancelamento e ações de uma publicação. */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const dados = await obterPublicacao(pool, id);
    if (!dados) return Response.json({ ok: false, error: 'não encontrada' }, { status: 404 });
    return Response.json({ ok: true, ...dados });
  } catch (err) {
    console.error('[publicacao GET]', err);
    return Response.json({ ok: false, error: 'erro' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}

/**
 * Ações: `publicar_agora` e `reenviar` (um alvo que falhou).
 *
 * ⚠️ "Publicar agora" usa EXATAMENTE o mesmo motor do cron. É a razão de
 * `post-motor` ser uma lib: travas que divergem entre o manual e o automático
 * são o pior lugar para duplicar código — e aqui o efeito é irreversível.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const body = await req.json().catch(() => ({})) as { acao?: string; alvoId?: string };

    if (body.acao === 'reenviar') {
      if (!body.alvoId) return Response.json({ ok: false, error: 'alvo não informado' }, { status: 400 });
      const ok = await reenfileirarAlvo(pool, body.alvoId);
      return Response.json({ ok, error: ok ? undefined : 'esse envio não está em erro' });
    }

    if (body.acao === 'publicar_agora') {
      // Adianta a fila desta publicação: só o que já está pendente entra.
      await pool.query(
        `UPDATE public.post_alvo SET ocorrencia = NOW(), tentar_apos = NULL
          WHERE post_id = $1 AND status = 'pendente'`,
        [id],
      );
      const r = await processarFila(pool, webhookOrigin(req.url), { postId: id, budgetMs: 45_000 });
      return Response.json({ ok: true, ...r });
    }

    return Response.json({ ok: false, error: 'ação desconhecida' }, { status: 400 });
  } catch (err) {
    console.error('[publicacao POST]', err);
    return Response.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    // Cancela o que ainda não saiu; o que já foi publicado permanece no
    // histórico — a Meta não desfaz, e esconder o registro faria a tela mentir.
    await cancelarPublicacao(pool, id);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[publicacao DELETE]', err);
    return Response.json({ ok: false, error: 'erro' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
