import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(`
      SELECT id, telefone, ctwa_clid, source_id, campanha, pixel_id,
             evento_lead_enviado, evento_compra_enviado, valor_compra, created_at
      FROM public.whatsapp_leads
      ORDER BY created_at DESC
      LIMIT 200
    `);
    return Response.json(rows);
  } catch {
    // table may not exist yet — return empty list
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
