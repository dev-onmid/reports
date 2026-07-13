import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { dispatchBatch, ensureDispatchLogTable } from '@/lib/leadlovers-worker';

// Disparo manual de um dia inteiro do cronograma ("antecipar"): ignora o horário
// agendado (send_time) e o "next_send_at <= NOW()" do worker normal — dispara tudo
// que é pendente daquele dia (fuso America/Sao_Paulo), seja um dia futuro (antecipação)
// ou pendências que sobraram de hoje/dias passados.
//
// Processa em lotes dentro do próprio request (mesmo padrão síncrono já usado em
// /api/otimizador/weekly — maxDuration alto em vez de fila assíncrona) e retorna
// quanto sobrou pra UI continuar chamando até zerar, sem nunca estourar o tempo
// de uma única invocação.
export const maxDuration = 60;
const BUDGET_MS = 50_000;
const BATCH_SIZE = 8;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureDispatchLogTable(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json().catch(() => ({})) as { date?: string };
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return Response.json({ error: 'date obrigatório (YYYY-MM-DD)' }, { status: 400 });
    }

    const { rows: [campaign] } = await pool.query(
      `SELECT id, status FROM public.leadlovers_campaigns
        WHERE id = $1 AND ($2::boolean OR owner_id = $3)`,
      [id, scope.unrestricted, scope.userId],
    );
    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });
    if (!['ativa', 'pausada'].includes(campaign.status)) {
      return Response.json({ error: 'Campanha precisa estar ativa (ou pausada) pra disparar manualmente' }, { status: 400 });
    }

    const startedAt = Date.now();
    let sent = 0;
    let errors = 0;

    while (Date.now() - startedAt < BUDGET_MS) {
      const r = await dispatchBatch(pool, {
        campaignId: id,
        limit: BATCH_SIZE,
        selection: { mode: 'day', day: body.date },
        scope: { unrestricted: scope.unrestricted, userId: scope.userId },
        isCron: false,
      });
      sent += r.sent;
      errors += r.errors;
      if (r.results.length === 0) break; // nada mais pendente pra esse dia
    }

    const { rows: [{ remaining }] } = await pool.query(
      `SELECT COUNT(*)::int AS remaining FROM public.leadlovers_contacts
        WHERE campaign_id = $1 AND status = 'pendente'
          AND TO_CHAR(next_send_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') = $2`,
      [id, body.date],
    );

    return Response.json({ sent, errors, remaining });
  } finally {
    await pool.end();
  }
}
