import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmTagsSchema, normalizarCorTag, normalizarNomeTag } from '@/lib/crm-tags';

export const dynamic = 'force-dynamic';

/** Renomear / trocar a cor. O proxy só deixa usuário de cliente chegar aqui em tag do próprio cliente. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { name?: unknown; color?: unknown };
  const name = body.name === undefined ? undefined : normalizarNomeTag(body.name);
  const color = body.color === undefined ? undefined : normalizarCorTag(body.color);
  if (name === null) return Response.json({ error: 'Nome inválido.' }, { status: 400 });
  if (name === undefined && color === undefined) return Response.json({ error: 'Nada para alterar.' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureCrmTagsSchema(pool);
    const { rows: [tag] } = await pool.query(
      `UPDATE public.crm_lead_tags SET name = COALESCE($2, name), color = COALESCE($3, color)
        WHERE id = $1 RETURNING id, name, color`,
      [id, name ?? null, color ?? null],
    );
    if (!tag) return Response.json({ error: 'Tag não encontrada.' }, { status: 404 });
    return Response.json(tag);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === '23505') return Response.json({ error: 'Já existe uma tag com esse nome.' }, { status: 409 });
    console.error('[crm/tags PATCH]', err);
    return Response.json({ error: 'Não foi possível alterar a tag.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

/** Apagar a tag solta todos os leads dela (CASCADE nas associações). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await pool.query(`DELETE FROM public.crm_lead_tags WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
