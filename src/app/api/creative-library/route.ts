import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { aggregateCreatives } from '@/lib/creative-library';

// GET /api/creative-library?days=30&clientId=optional
// Ranking de criativos a partir da atribuição do CRM (leads/vendas/receita/etapas).

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get('days') ?? 30), 1), 180);
  const clientId = searchParams.get('clientId');

  const pool = makeServerPool();
  try {
    const creatives = await aggregateCreatives(pool, { days, clientId });
    return Response.json({ ok: true, days, creatives });
  } catch (err) {
    console.error('[creative-library]', err);
    return Response.json({ ok: false, days, creatives: [], error: String(err) }, { status: 200 });
  } finally {
    await pool.end();
  }
}
