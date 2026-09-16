import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureLembretesSchema, proximoDepoisDeDisparar, type Lembrete } from '@/lib/lembretes';
import { registrarEvento } from '@/lib/notificacoes';

export const maxDuration = 60;

/**
 * Dispara os lembretes vencidos: cada um vira uma notificação para quem deve receber.
 *
 * ⚠️ Mora sob `/api/crm/followup/worker/...` de propósito — esse prefixo JÁ está em
 * `CRON_PREFIXES` no proxy, e o `proxy.ts` estava com trabalho de outra sessão quando
 * isto foi escrito. Cron novo sob prefixo não liberado recebe 401 do PROXY (não da
 * rota) e morre em silêncio; foi o que aconteceu com o worker de publicações em 08/2026.
 */

const SEGREDOS = ['CRON_SECRET', 'REPORTS_CRON_SECRET', 'CRM_CRON_SECRET'] as const;

function autorizado(req: NextRequest): boolean {
  const url = new URL(req.url);
  const dado = url.searchParams.get('secret') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!dado) return false;
  return SEGREDOS.some(k => { const v = process.env[k]; return !!v && v === dado; });
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'não autorizado' }, { status: 401 });

  const pool = makeServerPool();
  const disparados: string[] = [];
  try {
    await ensureLembretesSchema(pool);

    // ⚠️ Claim atômico: marca como disparado JÁ na seleção. Dois ticks sobrepostos (o
    // cron roda de minuto em minuto) mandariam a mesma notificação duas vezes, e um
    // alarme duplicado é exatamente o que faz alguém desligar o alarme.
    const { rows } = await pool.query<Lembrete>(
      `UPDATE public.lembretes
          SET ultimo_disparo = NOW(), updated_at = NOW()
        WHERE id IN (
          SELECT id FROM public.lembretes
           WHERE ativo AND proximo_disparo IS NOT NULL AND proximo_disparo <= NOW()
           ORDER BY proximo_disparo ASC LIMIT 50 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    );

    for (const l of rows) {
      await registrarEvento(pool, {
        userId: l.user_id,
        tipo: 'sistema',
        severidade: 'atencao',
        titulo: l.titulo,
        descricao: l.descricao,
        // ⚠️ chave com o disparo: um lembrete diário precisa entrar de novo amanhã. Chave
        // fixa faria o `upsert` da caixa tratar como o mesmo aviso e ele nunca reapareceria.
        signalKey: `lembrete:${l.id}:${new Date().toISOString().slice(0, 16)}`,
        importante: true,
      }).catch(() => null);

      const proximo = proximoDepoisDeDisparar(l);
      await pool.query(
        `UPDATE public.lembretes SET proximo_disparo = $2, ativo = $3, updated_at = NOW() WHERE id = $1`,
        [l.id, proximo, proximo !== null],
      ).catch(() => null);
      disparados.push(l.id);
    }
    return Response.json({ ok: true, disparados: disparados.length });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error)?.message }, { status: 500 });
  } finally {
    await pool.end();
  }
}
