import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { aggregateCreatives } from '@/lib/creative-library';
import { parseIsoDateRange } from '@/lib/optimizer-period-range';

// GET /api/creative-library?days=30&clientId=optional
// GET /api/creative-library?from=2026-06-01&to=2026-06-30&clientId=optional
// Ranking de criativos a partir da atribuição do CRM (leads/vendas/receita/etapas).
// `days` é a janela corrida legada (segue sendo o padrão e a chave de cache do enrich);
// `from`/`to` expressam uma janela explícita — o único jeito de pedir mês-calendário.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get('days') ?? 30), 1), 180);
  const clientId = searchParams.get('clientId');
  const range = parseIsoDateRange(searchParams.get('from'), searchParams.get('to'));

  const pool = makeServerPool();
  try {
    const creatives = await aggregateCreatives(pool, {
      days,
      from: range?.from,
      to: range?.to,
      clientId,
    });
    // Ecoa a janela REALMENTE usada — a tela rotula o período com isso em vez de
    // assumir que o from/to enviado foi aceito.
    return Response.json({ ok: true, days, from: range?.from ?? null, to: range?.to ?? null, creatives });
  } catch (err) {
    console.error('[creative-library]', err);
    return Response.json(
      { ok: false, days, from: range?.from ?? null, to: range?.to ?? null, creatives: [], error: String(err) },
      { status: 200 },
    );
  } finally {
    await pool.end();
  }
}
