import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { extractDealValue } from '@/lib/crm-deal-extraction';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const suggestion = await extractDealValue(pool, id);
    return Response.json(suggestion);
  } catch (err) {
    console.error('[extract-value POST]', err);
    return Response.json({ valor: null, trecho: null, confianca: 0, error: String(err) });
  } finally {
    await pool.end();
  }
}
