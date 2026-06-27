import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

async function resolveToken(connectionId: string, pool: ReturnType<typeof makeServerPool>) {
  if (connectionId) {
    const { rows } = await pool.query(
      `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
      [connectionId],
    );
    if (rows[0]) return getFreshMetaToken(rows[0] as Parameters<typeof getFreshMetaToken>[0]);
  }
  const { rows } = await pool.query(
    `SELECT 'legacy' AS id, '' AS app_id, access_token, token_expiry
       FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
  );
  if (!rows[0]) throw new Error('Conexão Meta não encontrada.');
  return getFreshMetaToken(rows[0] as Parameters<typeof getFreshMetaToken>[0]);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: adsetId } = await params;
  const { connectionId, novo_orcamento_diario } = await req.json() as {
    connectionId: string;
    novo_orcamento_diario: number; // em BRL
  };

  if (!novo_orcamento_diario || novo_orcamento_diario <= 0) {
    return Response.json({ error: 'novo_orcamento_diario inválido.' }, { status: 400 });
  }

  // Meta API recebe orçamento em centavos
  const budgetCents = Math.round(novo_orcamento_diario * 100);

  const pool = makeServerPool();
  let token: string;
  try {
    token = await resolveToken(connectionId, pool);
  } finally {
    await pool.end();
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${adsetId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_budget: budgetCents, access_token: token }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json({ error: err.error?.message ?? `Meta API ${res.status}` }, { status: res.status });
  }

  return Response.json({ ok: true, novo_orcamento_diario, budgetCents });
}
