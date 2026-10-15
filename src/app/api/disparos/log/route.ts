import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { listarLogCampanha } from '@/lib/disparos-log';

/** Histórico de ajustes das campanhas: `?campaignId=` (uma) ou geral, `?dias=` (padrão 10). */
export async function GET(request: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.userId) return Response.json({ error: 'Não autenticado' }, { status: 401 });
    const sp = request.nextUrl.searchParams;
    const campaignId = sp.get('campaignId');
    if (campaignId && !/^[0-9a-f-]{36}$/i.test(campaignId)) return Response.json({ error: 'campaignId inválido' }, { status: 400 });
    const dias = Number(sp.get('dias') ?? 10) || 10;
    const registros = await listarLogCampanha(pool, { campaignId, dias, unrestricted: scope.unrestricted, userId: scope.userId });
    return Response.json({ ok: true, dias, registros });
  } finally {
    await pool.end();
  }
}
