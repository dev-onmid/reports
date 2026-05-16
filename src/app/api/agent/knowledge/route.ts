import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.agent_knowledge (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      title      TEXT        NOT NULL,
      type       TEXT        NOT NULL CHECK (type IN ('text', 'url', 'pdf')),
      content    TEXT        NOT NULL,
      mime_type  TEXT,
      url        TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      'SELECT id, title, type, url, created_at, LEFT(content, 200) as preview FROM public.agent_knowledge ORDER BY created_at DESC'
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    role?: string;
    title: string;
    type: 'text' | 'url' | 'pdf';
    content: string;
    mime_type?: string;
    url?: string;
  };

  if (body.role !== 'Administrador') {
    return Response.json({ error: 'Acesso negado' }, { status: 403 });
  }
  if (!body.title?.trim() || !body.content?.trim()) {
    return Response.json({ error: 'Título e conteúdo obrigatórios' }, { status: 400 });
  }

  // For URL type: fetch the page content if content is empty
  let content = body.content;
  if (body.type === 'url' && body.url) {
    try {
      const res = await fetch(body.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();
      // Strip HTML tags and collapse whitespace
      content = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50000);
    } catch {
      content = `[Não foi possível carregar o conteúdo de ${body.url}]`;
    }
  }

  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      `INSERT INTO public.agent_knowledge (title, type, content, mime_type, url)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, title, type, url, created_at`,
      [body.title.trim(), body.type, content, body.mime_type ?? null, body.url ?? null]
    );
    return Response.json(rows[0], { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  const role = req.nextUrl.searchParams.get('role');
  if (role !== 'Administrador') return Response.json({ error: 'Acesso negado' }, { status: 403 });
  if (!id) return Response.json({ error: 'ID obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.agent_knowledge WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
