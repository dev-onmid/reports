import { createHash } from 'crypto';
import { makeServerPool } from '@/lib/server-db';
import type { NextRequest } from 'next/server';

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  return raw.replace('@c.us', '').replace(/\D/g, '');
}

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}

function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  return pool.query(`
    CREATE TABLE IF NOT EXISTS public.whatsapp_pixel_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pixel_id TEXT NOT NULL DEFAULT '',
      meta_token TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.whatsapp_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      telefone TEXT NOT NULL,
      ctwa_clid TEXT,
      source_id TEXT,
      campanha TEXT,
      conjunto TEXT,
      anuncio TEXT,
      pixel_id TEXT,
      evento_lead_enviado BOOLEAN NOT NULL DEFAULT false,
      evento_compra_enviado BOOLEAN NOT NULL DEFAULT false,
      valor_compra NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_leads_telefone
      ON public.whatsapp_leads (telefone);
  `);
}

async function sendMetaEvent({
  pixelId,
  accessToken,
  eventName,
  phone,
  ctwaClid,
  value,
}: {
  pixelId: string;
  accessToken: string;
  eventName: 'Lead' | 'Purchase';
  phone: string;
  ctwaClid?: string | null;
  value?: number;
}): Promise<{ success: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userData: Record<string, any> = { ph: [hashPhone(phone)] };
  if (ctwaClid) userData.ctwa_clid = ctwaClid;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventData: Record<string, any> = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'other',
    user_data: userData,
  };

  if (eventName === 'Purchase' && value !== undefined) {
    eventData.custom_data = { currency: 'BRL', value };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${pixelId}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [eventData], access_token: accessToken }),
      },
    );
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { success: false, error: JSON.stringify(errBody) };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ── Route handlers ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json().catch(() => ({}));

    const fromMe: boolean = body.fromMe === true;
    const phone = normalizePhone(body.phone ?? body.phoneNumber ?? '');
    const messageText: string = (body.text?.message ?? body.body ?? '').trim();

    if (!phone) {
      return Response.json({ ok: false, error: 'telefone não identificado' }, { status: 400 });
    }

    // Z-API: ReceivedCallback = inbound, SendedCallback = outbound
    const isReceived = !fromMe;
    const isSent = fromMe;

    // Load pixel config
    const { rows: [config] } = await pool.query(
      `SELECT pixel_id, meta_token FROM public.whatsapp_pixel_config LIMIT 1`,
    );

    if (!config?.pixel_id || !config?.meta_token) {
      return Response.json({ ok: false, error: 'Pixel ID ou Token não configurado' }, { status: 400 });
    }

    // ── FLOW 1: Lead ─────────────────────────────────────────────────────────
    if (isReceived) {
      const ctwaClid: string | undefined =
        body.ctwaClid ?? body.ctwa_clid ?? body.ctwaclid ?? undefined;
      const sourceId: string | undefined =
        body.sourceId ?? body.source_id ?? body.adId ?? undefined;

      // Only process messages that came from an ad
      if (!ctwaClid && !sourceId) {
        return Response.json({ ok: true, message: 'mensagem orgânica, ignorada' });
      }

      // Deduplicate by phone
      const { rows: existing } = await pool.query(
        `SELECT id FROM public.whatsapp_leads WHERE telefone = $1`,
        [phone],
      );

      if (existing.length > 0) {
        return Response.json({ ok: true, message: 'lead já registrado' });
      }

      const metaResult = await sendMetaEvent({
        pixelId: config.pixel_id,
        accessToken: config.meta_token,
        eventName: 'Lead',
        phone,
        ctwaClid,
      });

      await pool.query(
        `INSERT INTO public.whatsapp_leads
           (telefone, ctwa_clid, source_id, pixel_id, evento_lead_enviado)
         VALUES ($1, $2, $3, $4, $5)`,
        [phone, ctwaClid ?? null, sourceId ?? null, config.pixel_id, metaResult.success],
      );

      return Response.json({
        ok: true,
        action: 'lead_created',
        meta_sent: metaResult.success,
        meta_error: metaResult.error ?? null,
      });
    }

    // ── FLOW 2: Purchase ─────────────────────────────────────────────────────
    if (isSent) {
      const match = messageText.match(/compra\s+aprovada\s+([\d.,]+)/i);
      if (!match) {
        return Response.json({ ok: true, message: 'mensagem sem gatilho de compra, ignorada' });
      }

      const valor = parseFloat(match[1].replace(',', '.'));
      if (isNaN(valor)) {
        return Response.json({ ok: false, error: 'valor inválido' }, { status: 400 });
      }

      const { rows: [lead] } = await pool.query(
        `SELECT id, ctwa_clid, evento_compra_enviado FROM public.whatsapp_leads WHERE telefone = $1`,
        [phone],
      );

      if (!lead) {
        return Response.json({ ok: false, error: 'lead não encontrado para este telefone' }, { status: 404 });
      }

      if (lead.evento_compra_enviado) {
        return Response.json({ ok: true, message: 'evento de compra já enviado anteriormente' });
      }

      const metaResult = await sendMetaEvent({
        pixelId: config.pixel_id,
        accessToken: config.meta_token,
        eventName: 'Purchase',
        phone,
        ctwaClid: lead.ctwa_clid,
        value: valor,
      });

      await pool.query(
        `UPDATE public.whatsapp_leads
         SET evento_compra_enviado = $1, valor_compra = $2
         WHERE id = $3`,
        [metaResult.success, valor, lead.id],
      );

      return Response.json({
        ok: true,
        action: 'purchase_sent',
        valor,
        meta_sent: metaResult.success,
        meta_error: metaResult.error ?? null,
      });
    }

    return Response.json({ ok: true, message: 'mensagem ignorada' });

  } finally {
    await pool.end();
  }
}

// GET: connectivity test
export async function GET() {
  return Response.json({
    ok: true,
    message: 'Webhook WhatsApp ativo. Configure este endpoint no Z-API como URL de Notificação.',
  });
}
