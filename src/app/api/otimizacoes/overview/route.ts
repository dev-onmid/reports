import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import {
  ensureOtimizacaoHistoricoSchema,
  type OtimizacaoAgendaRow,
} from '@/lib/otimizacao-historico';

// Visão geral do histórico de otimizações: último registro por cliente+canal,
// programação (agenda) e contagem total. O join com nome/gestor do cliente é
// client-side via useClients (mesmo padrão do Monitor de Redes Sociais).

type UltimaRow = {
  client_id: string;
  canal: string;
  canal_detalhe: string | null;
  user_name: string | null;
  acoes: string[];
  resumo: string;
  created_at: string;
};

export async function GET(req: NextRequest) {
  if (!getSession(req)) return unauthorized();

  const pool = makeServerPool();
  try {
    await ensureOtimizacaoHistoricoSchema(pool);
    const { rows: ultimas } = await pool.query<UltimaRow>(
      `SELECT DISTINCT ON (client_id, canal)
              client_id, canal, canal_detalhe, user_name, acoes,
              LEFT(descricao, 220) AS resumo, created_at
         FROM public.otimizacao_registros
        ORDER BY client_id, canal, created_at DESC`,
    );
    const { rows: agenda } = await pool.query<OtimizacaoAgendaRow>(
      `SELECT client_id, canal, frequencia_dias FROM public.otimizacao_agenda`,
    );
    const { rows: contagens } = await pool.query<{ client_id: string; total: string }>(
      `SELECT client_id, COUNT(*)::text AS total
         FROM public.otimizacao_registros GROUP BY client_id`,
    );
    return Response.json({
      ultimas,
      agenda,
      contagens: contagens.map((c) => ({ client_id: c.client_id, total: Number(c.total) })),
    });
  } catch {
    // Sem banco (dev local) a tela degrada pra vazio em vez de quebrar.
    return Response.json({ ultimas: [], agenda: [], contagens: [] });
  } finally {
    await pool.end();
  }
}
