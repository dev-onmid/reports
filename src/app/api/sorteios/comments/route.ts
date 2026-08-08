import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolveContaDoCliente, importarComentarios } from '@/lib/sorteio-fonte';

// Sorteador — importa TODOS os comentários de um post (paginado na Graph API,
// cap 5000 / orçamento ~100s). O filtro de regras e o sorteio em si rodam no
// CLIENTE (lib pura src/lib/sorteio.ts) — o servidor só entrega a matéria-prima.

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    clientId?: string; rede?: string; postId?: string;
  };
  const rede = body.rede === 'facebook' ? 'facebook' : 'instagram';
  if (!body.clientId || !body.postId) {
    return Response.json({ error: 'clientId e postId são obrigatórios.' }, { status: 400 });
  }

  const deadline = Date.now() + 100_000;
  const pool = makeServerPool();
  try {
    const conta = await resolveContaDoCliente(pool, body.clientId);
    if (!conta) {
      return Response.json({ ok: false, error: 'Conta do cliente não resolvida — vincule em Clientes → Vincular Contas.' });
    }
    const { comentarios, truncado } = await importarComentarios(conta, rede, body.postId, deadline);
    return Response.json({ ok: true, comentarios, truncado });
  } catch {
    return Response.json({ ok: false, error: 'Falha ao importar os comentários — tente de novo.' });
  } finally {
    await pool.end();
  }
}
