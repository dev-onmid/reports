import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

type FunnelEntry = { date: string; stage: string; amount?: number };

const FUNNEL_STAGES = ['Atendimento', 'Agendamento', 'Comparecimento', 'Fechamento'];

function getStage(row: { status: string | null; compareceu: boolean; fechou: boolean }): string | null {
  if (row.fechou) return 'Fechamento';
  if (row.compareceu) return 'Comparecimento';
  if (row.status === 'Agendado' || row.status === 'Reagendado') return 'Agendamento';
  if (row.status === 'Em Atendimento' || row.status === 'Não Retorna' || row.status === 'Distante') return 'Atendimento';
  return null; // Sem Interesse, Desqualificado → excluded
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const pool = makeServerPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.crm_leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE public.crm_leads
        ADD COLUMN IF NOT EXISTS data DATE,
        ADD COLUMN IF NOT EXISTS lead_date DATE,
        ADD COLUMN IF NOT EXISTS status TEXT,
        ADD COLUMN IF NOT EXISTS compareceu BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS fechou BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS valor_rs NUMERIC,
        ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0
    `);

    const params: (string | null)[] = [];
    let dateFilter = '';
    if (from && to) {
      params.push(from, to);
      dateFilter = `AND (COALESCE(lead_date, data) IS NULL OR (COALESCE(lead_date, data) >= $1 AND COALESCE(lead_date, data) <= $2))`;
    }

    const { rows } = await pool.query(
      `SELECT client_id,
              COALESCE(lead_date, data) AS data,
              status,
              compareceu,
              (fechou OR COALESCE(revenue, valor_rs, 0) > 0) AS fechou,
              COALESCE(revenue, valor_rs, 0) AS valor_rs
         FROM public.crm_leads
        WHERE TRUE ${dateFilter}
        ORDER BY client_id, COALESCE(lead_date, data)`,
      params
    );

    const byClient: Record<string, FunnelEntry[]> = {};
    for (const row of rows) {
      const stage = getStage(row);
      if (!stage) continue;
      const clientId = row.client_id as string;
      if (!byClient[clientId]) byClient[clientId] = [];
      byClient[clientId].push({
        date: row.data ? String(row.data).split('T')[0] : new Date().toISOString().split('T')[0],
        stage,
        ...(row.fechou && row.valor_rs ? { amount: Number(row.valor_rs) } : {}),
      });
    }

    return Response.json(
      Object.entries(byClient).map(([clientId, entries]) => ({
        clientId,
        entries,
        stages: FUNNEL_STAGES.filter(s => entries.some(e => e.stage === s)),
        total: entries.reduce((sum, e) => sum + (e.amount ?? 0), 0),
      }))
    );
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
