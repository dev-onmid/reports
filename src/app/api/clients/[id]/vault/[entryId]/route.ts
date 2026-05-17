import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id: clientId, entryId } = await params;
  const body = await req.json() as {
    title: string; url?: string; login?: string;
    password_enc?: string; category?: string; notes?: string;
  };
  if (!body.title?.trim()) return Response.json({ error: 'Título obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `UPDATE public.client_vault
       SET title=$1, url=$2, login=$3, password_enc=$4, category=$5, notes=$6, updated_at=NOW()
       WHERE id=$7 AND client_id=$8
       RETURNING id::text, title, url, login, password_enc, category, notes, created_at, updated_at`,
      [body.title.trim(), body.url ?? null, body.login ?? null, body.password_enc ?? null,
       body.category ?? 'Outros', body.notes ?? null, entryId, clientId]
    );
    if (!rows[0]) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(rows[0]);
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id: clientId, entryId } = await params;
  const pool = makeServerPool();
  try {
    await pool.query(
      'DELETE FROM public.client_vault WHERE id=$1 AND client_id=$2',
      [entryId, clientId]
    );
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
