import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { garantirEstruturaEngajado } from '@/lib/lead-qualificacao-server';
import { COLUNA_ENGAJADO } from '@/lib/lead-qualificacao';

export const maxDuration = 300;

/**
 * Cria a coluna "Engajado" nos funis que já existiam antes de 16/09/2026.
 *
 * Cliente NOVO já nasce com ela (`ETAPAS_PADRAO`); esta rota é só para a base atual.
 * Roda uma vez — e `?dry=1` mostra o que faria sem tocar em nada, porque mexer no
 * Kanban de 28 clientes de uma vez merece ser visto antes.
 *
 * ⚠️ Sob `/api/crm/sanear-kanban/...`: prefixo já liberado em CRON_PREFIXES, e é
 * semanticamente onde mora o saneamento de funil.
 */

const SEGREDOS = ['CRON_SECRET', 'REPORTS_CRON_SECRET', 'CRM_CRON_SECRET'] as const;

function autorizado(req: NextRequest): boolean {
  const dado = new URL(req.url).searchParams.get('secret')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  return !!dado && SEGREDOS.some(k => { const v = process.env[k]; return !!v && v === dado; });
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'não autorizado' }, { status: 401 });
  const dry = new URL(req.url).searchParams.get('dry') === '1';

  const pool = makeServerPool();
  try {
    const { rows: clientes } = await pool.query<{ client_id: string; nome: string; funis: number; ja_tem: number }>(
      `SELECT f.client_id,
              COALESCE(c.name, f.client_id) AS nome,
              COUNT(DISTINCT f.id)::int AS funis,
              COUNT(DISTINCT f.id) FILTER (
                WHERE EXISTS (SELECT 1 FROM public.crm_stages s
                               WHERE s.funnel_id = f.id AND lower(trim(s.label)) = lower($1)))::int AS ja_tem
         FROM public.crm_funnels f
         LEFT JOIN public.clients c ON c.id = f.client_id
        GROUP BY f.client_id, c.name
        ORDER BY nome`,
      [COLUNA_ENGAJADO],
    );

    const pendentes = clientes.filter(c => c.ja_tem < c.funis);
    if (dry) {
      return Response.json({
        dry: true,
        clientes: clientes.length,
        funis_total: clientes.reduce((s, c) => s + c.funis, 0),
        ja_tem: clientes.reduce((s, c) => s + c.ja_tem, 0),
        vao_ganhar_a_coluna: pendentes.reduce((s, c) => s + (c.funis - c.ja_tem), 0),
        lista: pendentes.map(c => ({ cliente: c.nome, funis_sem_a_coluna: c.funis - c.ja_tem })),
      });
    }

    const feitos: string[] = [];
    for (const c of pendentes) {
      await garantirEstruturaEngajado(pool, c.client_id).catch(() => null);
      feitos.push(c.nome);
    }
    return Response.json({ ok: true, clientes_ajustados: feitos.length, clientes: feitos });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error)?.message }, { status: 500 });
  } finally {
    await pool.end();
  }
}
