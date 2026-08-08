import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureOtimizacaoHistoricoSchema } from '@/lib/otimizacao-historico';

// Programação de otimização por cliente+canal ("otimizar a cada N dias").
// frequencia_dias null/0 remove a linha = canal sem programação.

const CANAIS_AGENDAVEIS = new Set(['meta', 'google']);

export async function PATCH(req: NextRequest) {
  if (!getSession(req)) return unauthorized();

  const body = await req.json().catch(() => ({})) as {
    client_id?: string; canal?: string; frequencia_dias?: number | null;
  };
  const canal = (body.canal ?? '').trim().toLowerCase();
  if (!body.client_id || !CANAIS_AGENDAVEIS.has(canal)) {
    return Response.json({ error: 'client_id e canal (meta|google) são obrigatórios.' }, { status: 400 });
  }

  const freq = body.frequencia_dias;
  const pool = makeServerPool();
  try {
    await ensureOtimizacaoHistoricoSchema(pool);
    if (!freq || freq <= 0) {
      await pool.query(
        `DELETE FROM public.otimizacao_agenda WHERE client_id = $1 AND canal = $2`,
        [body.client_id, canal],
      );
      return Response.json({ ok: true, removida: true });
    }
    const dias = Math.min(90, Math.max(1, Math.floor(freq)));
    await pool.query(
      `INSERT INTO public.otimizacao_agenda (client_id, canal, frequencia_dias, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (client_id, canal) DO UPDATE
         SET frequencia_dias = EXCLUDED.frequencia_dias, updated_at = NOW()`,
      [body.client_id, canal, dias],
    );
    return Response.json({ ok: true, frequencia_dias: dias });
  } finally {
    await pool.end();
  }
}
