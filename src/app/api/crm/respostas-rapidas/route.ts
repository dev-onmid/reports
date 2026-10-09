import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

/**
 * Respostas rápidas do chat, POR CLIENTE: a recepção de uma clínica e o
 * comercial de uma franquia não respondem as mesmas perguntas. No chat, "/"
 * abre a lista e o atalho filtra.
 */
type Pool = ReturnType<typeof makeServerPool>;
let pronto: Promise<void> | null = null;
function ensure(pool: Pool) {
  if (!pronto) {
    pronto = pool.query(`
      CREATE TABLE IF NOT EXISTS public.crm_respostas_rapidas (
        id BIGSERIAL PRIMARY KEY,
        client_id TEXT NOT NULL,
        atalho TEXT NOT NULL,
        texto TEXT NOT NULL,
        criado_por TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (client_id, atalho)
      )`).then(() => undefined).catch((e) => { pronto = null; throw e; });
  }
  return pronto;
}

function atalhoValido(v: unknown): string | null {
  const a = String(v ?? '').trim().toLowerCase().replace(/^\//, '').replace(/[^a-z0-9à-ú_-]+/gi, '-').slice(0, 30);
  return a || null;
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensure(pool);
    const { rows } = await pool.query(
      `SELECT id::text, atalho, texto FROM public.crm_respostas_rapidas WHERE client_id = $1 ORDER BY atalho`,
      [clientId],
    );
    return Response.json({ respostas: rows });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { clientId?: string; atalho?: string; texto?: string };
  const atalho = atalhoValido(body.atalho);
  const texto = String(body.texto ?? '').trim().slice(0, 2000);
  if (!body.clientId || !atalho || !texto) {
    return Response.json({ error: 'Informe o atalho e o texto.' }, { status: 400 });
  }
  const pool = makeServerPool();
  try {
    await ensure(pool);
    const { rows: [r] } = await pool.query(
      `INSERT INTO public.crm_respostas_rapidas (client_id, atalho, texto, criado_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, atalho) DO UPDATE SET texto = EXCLUDED.texto
       RETURNING id::text, atalho, texto`,
      [body.clientId, atalho, texto, req.headers.get('x-onmid-user-id')],
    );
    return Response.json(r, { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  const id = req.nextUrl.searchParams.get('id');
  if (!clientId || !id) return Response.json({ error: 'clientId e id obrigatórios' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensure(pool);
    // client_id no WHERE: o proxy confere o cliente da query, e o id sozinho
    // permitiria apagar a resposta de outro cliente.
    await pool.query(`DELETE FROM public.crm_respostas_rapidas WHERE id::text = $1 AND client_id = $2`, [id, clientId]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
