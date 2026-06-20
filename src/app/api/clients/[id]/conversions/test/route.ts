import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { enviarEventoMeta, enviarEventoGoogle, getConversionConfig } from '@/lib/conversions';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { platform } = await req.json() as { platform: 'meta' | 'google' };
  const pool = makeServerPool();

  try {
    const cfg = await getConversionConfig(pool, id);
    if (!cfg) return Response.json({ error: 'Configuração não encontrada.' }, { status: 404 });

    const testLead = { id: undefined, phone: '5511999999999' };

    if (platform === 'meta') {
      if (!cfg.meta_pixel_id || !cfg.meta_access_token) {
        return Response.json({ error: 'Pixel ID e Token são obrigatórios.' }, { status: 400 });
      }
      // The WhatsApp message dataset uses "LeadSubmitted", not the website pixel's "Lead".
      await enviarEventoMeta(pool, id, 'LeadSubmitted', testLead);
    } else {
      if (!cfg.google_measurement_id || !cfg.google_api_secret) {
        return Response.json({ error: 'Measurement ID e API Secret são obrigatórios.' }, { status: 400 });
      }
      await enviarEventoGoogle(pool, id, cfg.google_conversion_label_lead ?? 'test', testLead);
    }

    // Return last log entry for this client/platform
    const { rows: [last] } = await pool.query(
      `SELECT sucesso, status_resposta, resposta_body, enviado_em
         FROM public.conversion_log
        WHERE client_id = $1 AND plataforma = $2
        ORDER BY enviado_em DESC LIMIT 1`,
      [id, platform],
    );
    return Response.json({ ok: true, resultado: last ?? null });
  } finally {
    await pool.end();
  }
}
