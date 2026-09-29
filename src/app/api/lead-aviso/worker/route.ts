import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { processarAvisos } from '@/lib/lead-aviso';
import { sendTextOnmid } from '@/lib/whatsapp-send';

// Avisa no grupo do cliente os leads que entraram por formulário (Meta Lead Ads
// e landing page). Chamado pelo cron da VPS a cada minuto.
//
// ⚠️ É worker, não hook na ingestão: WhatsApp fora do ar não pode segurar a
// recepção de lead de ninguém (lição da integração SULTS).

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function autorizado(req: NextRequest): boolean {
  const alvo = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter((s): s is string => !!s && s.length > 0);
  if (!alvo.length) return false;
  const q = req.nextUrl.searchParams.get('secret');
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return alvo.some(s => s === q || s === bearer);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'não autorizado' }, { status: 401 });

  const pool = makeServerPool();
  try {
    const r = await processarAvisos(pool, (destino, texto) => sendTextOnmid(pool, destino, texto));
    return Response.json({ ok: true, ...r });
  } catch (err) {
    console.error('[lead-aviso worker]', err);
    return Response.json({ error: 'falha ao processar' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
