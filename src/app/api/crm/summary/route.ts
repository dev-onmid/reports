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
    const params: (string | null)[] = [];
    let dateFilter = '';
    if (from && to) {
      params.push(from, to);
      dateFilter = `AND (data IS NULL OR (data >= $1 AND data <= $2))`;
    }

    const { rows } = await pool.query(
      `SELECT client_id, data, status, compareceu, fechou, valor_rs
         FROM public.crm_leads
        WHERE TRUE ${dateFilter}
        ORDER BY client_id, data`,
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
