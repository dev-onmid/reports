import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

export type OpportunityScoreResult = {
  score: number | null;
  recomendacoes: Array<{
    tipo: string;
    ganho_score: number;
    descricao: string;
    object_ids: string[];
  }>;
};

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

function normalizeAccountId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const connectionId = req.nextUrl.searchParams.get('connectionId') ?? '';
  const accountId = normalizeAccountId(id);

  const pool = makeServerPool();
  let token: string;
  try {
    token = await resolveToken(connectionId, pool);
  } finally {
    await pool.end();
  }

  const url = new URL(`https://graph.facebook.com/v21.0/${accountId}/recommendations`);
  url.searchParams.set('fields', 'score,recommendations{recommendation_type,score_lift,message,object_ids}');
  url.searchParams.set('access_token', token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    // Opportunity Score pode não estar disponível para todas as contas — retorna vazio
    return Response.json({ score: null, recomendacoes: [] } satisfies OpportunityScoreResult);
  }

  const data = await res.json() as {
    score?: number;
    recommendations?: {
      data?: Array<{
        recommendation_type?: string;
        score_lift?: number;
        message?: string;
        object_ids?: string[];
      }>;
    };
  };

  const recomendacoes = (data.recommendations?.data ?? []).map((r) => ({
    tipo: r.recommendation_type ?? 'unknown',
    ganho_score: Number(r.score_lift ?? 0),
    descricao: r.message ?? '',
    object_ids: r.object_ids ?? [],
  }));

  return Response.json({
    score: data.score != null ? Number(data.score) : null,
    recomendacoes,
  } satisfies OpportunityScoreResult);
}
