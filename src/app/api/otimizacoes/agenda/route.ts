import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureOtimizacaoHistoricoSchema } from '@/lib/otimizacao-historico';

// Programação de otimização por cliente+canal ("otimizar a cada N dias").
// frequencia_dias null/0 remove a linha = canal sem programação.
// Aceita 1 cliente (`client_id`) ou lote (`client_ids[]` — modal "Programar
// vários"): mesma semântica, uma query só pro lote inteiro.

const CANAIS_AGENDAVEIS = new Set(['meta', 'google']);

export async function PATCH(req: NextRequest) {
  if (!getSession(req)) return unauthorized();

  const body = await req.json().catch(() => ({})) as {
    client_id?: string; client_ids?: unknown; canal?: string; frequencia_dias?: number | null;
  };
  const canal = (body.canal ?? '').trim().toLowerCase();
  const ids = Array.isArray(body.client_ids)
    ? body.client_ids.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 500)
    : body.client_id ? [body.client_id] : [];
  if (ids.length === 0 || !CANAIS_AGENDAVEIS.has(canal)) {
    return Response.json({ error: 'client_id(s) e canal (meta|google) são obrigatórios.' }, { status: 400 });
  }

  const freq = body.frequencia_dias;
  const pool = makeServerPool();
  try {
    await ensureOtimizacaoHistoricoSchema(pool);
    if (!freq || freq <= 0) {
      await pool.query(
        `DELETE FROM public.otimizacao_agenda WHERE client_id = ANY($1::text[]) AND canal = $2`,
        [ids, canal],
      );
      return Response.json({ ok: true, removida: true, clientes: ids.length });
    }
    const dias = Math.min(90, Math.max(1, Math.floor(freq)));
    await pool.query(
      `INSERT INTO public.otimizacao_agenda (client_id, canal, frequencia_dias, updated_at)
       SELECT unnest($1::text[]), $2, $3, NOW()
       ON CONFLICT (client_id, canal) DO UPDATE
         SET frequencia_dias = EXCLUDED.frequencia_dias, updated_at = NOW()`,
      [ids, canal, dias],
    );
    return Response.json({ ok: true, frequencia_dias: dias, clientes: ids.length });
  } finally {
    await pool.end();
  }
}
