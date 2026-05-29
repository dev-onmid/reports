import { createHash } from 'crypto';
import { makeServerPool } from '@/lib/server-db';
import { normalizeWebhookPayload, type WhatsAppProvider } from '@/lib/whatsapp-provider';
import type { NextRequest } from 'next/server';

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractUtm(text: string): { utm_source?: string; utm_medium?: string; utm_campaign?: string } {
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  for (const url of urls) {
    try {
      const u = new URL(url);
      const utm_source = u.searchParams.get('utm_source') ?? undefined;
      if (utm_source) {
        return {
          utm_source,
          utm_medium: u.searchParams.get('utm_medium') ?? undefined,
          utm_campaign: u.searchParams.get('utm_campaign') ?? undefined,
        };
      }
    } catch { /* invalid URL, skip */ }
  }
  const srcMatch = text.match(/utm_source=([^\s&]+)/i);
  if (srcMatch) {
    return {
      utm_source: srcMatch[1],
      utm_medium: text.match(/utm_medium=([^\s&]+)/i)?.[1],
      utm_campaign: text.match(/utm_campaign=([^\s&]+)/i)?.[1],
    };
  }
  return {};
}

function detectOrigin(ctwaClid: string | undefined, utmSource: string | undefined): string {
  if (ctwaClid) return 'meta';
  if (!utmSource) return 'organic';
  const src = utmSource.toLowerCase();
  if (src.includes('google')) return 'google';
  if (src.includes('instagram')) return 'instagram';
  if (src.includes('facebook') || src.includes('fb')) return 'meta';
  if (src.includes('tiktok')) return 'tiktok';
  return utmSource;
}

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}

async function sendMetaEvent({
  pixelId, accessToken, eventName, phone, ctwaClid, value,
}: {
  pixelId: string; accessToken: string;
  eventName: 'Lead' | 'Purchase';
  phone: string; ctwaClid?: string | null; value?: number;
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
    const res = await fetch(`https://graph.facebook.com/v18.0/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [eventData], access_token: accessToken }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: JSON.stringify(err) };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params;
  const pool = makeServerPool();

  try {
    // 1. Resolve instance → client + provider
    const { rows: [inst] } = await pool.query(
      `SELECT client_id, provider FROM public.client_zapi_instances WHERE id = $1 AND ativo = true`,
      [instanceId],
    );
    if (!inst) {
      return Response.json({ ok: false, error: 'Instância não encontrada ou inativa' }, { status: 404 });
    }
    const clientId: string = inst.client_id;
    const provider: WhatsAppProvider = inst.provider === 'evolution' ? 'evolution' : 'zapi';

    // 2. Parse and normalize payload based on provider
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const msg = normalizeWebhookPayload(provider, body);

    if (!msg) {
      return Response.json({ ok: false, error: 'telefone não identificado' }, { status: 400 });
    }

    const { phone, fromMe, text: messageText, ctwaClid, sourceId, pushName } = msg;

    // ── CRM: upsert contact + save message (always, regardless of pixel config) ──
    const utmData = extractUtm(messageText);
    const origin = detectOrigin(ctwaClid, utmData.utm_source);

    const { rows: [crmContact] } = await pool.query(
      `INSERT INTO public.crm_contacts
         (client_id, phone, name, origin, ctwa_clid, utm_source, utm_medium, utm_campaign, instance_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (client_id, phone) DO UPDATE SET
         name         = COALESCE(EXCLUDED.name, crm_contacts.name),
         updated_at   = NOW()
       RETURNING id`,
      [clientId, phone, pushName ?? null, origin, ctwaClid ?? null,
       utmData.utm_source ?? null, utmData.utm_medium ?? null, utmData.utm_campaign ?? null,
       instanceId],
    );

    if (crmContact && messageText) {
      await pool.query(
        `INSERT INTO public.crm_messages (contact_id, client_id, instance_id, direction, text)
         VALUES ($1, $2, $3, $4, $5)`,
        [crmContact.id, clientId, instanceId, fromMe ? 'out' : 'in', messageText],
      );
    }

    // 3. Load client tracking config (optional — only needed for pixel events)
    const { rows: [cfg] } = await pool.query(
      `SELECT pixel_id, meta_token, gatilho_compra, eventos_ativos
       FROM public.client_tracking_config WHERE client_id = $1`,
      [clientId],
    );
    if (!cfg?.pixel_id || !cfg?.meta_token) {
      return Response.json({ ok: true, message: 'CRM salvo. Pixel não configurado para este cliente.' });
    }
    const eventos: { lead: boolean; purchase: boolean } = cfg.eventos_ativos ?? { lead: true, purchase: true };
    const gatilho: string = (cfg.gatilho_compra ?? 'compra aprovada').toLowerCase().trim();

    // ── FLOW 1: Lead (received from ad) ──────────────────────────────────────
    if (!fromMe) {
      if (!eventos.lead) {
        return Response.json({ ok: true, message: 'evento Lead desativado para este cliente' });
      }

      if (!ctwaClid && !sourceId) {
        return Response.json({ ok: true, message: 'mensagem orgânica, salva no CRM' });
      }

      // Deduplicate per client
      const { rows: existing } = await pool.query(
        `SELECT id FROM public.whatsapp_leads WHERE telefone = $1 AND client_id = $2`,
        [phone, clientId],
      );
      if (existing.length > 0) {
        return Response.json({ ok: true, message: 'lead já registrado para este cliente' });
      }

      const metaResult = await sendMetaEvent({
        pixelId: cfg.pixel_id, accessToken: cfg.meta_token,
        eventName: 'Lead', phone, ctwaClid,
      });

      await pool.query(`
        INSERT INTO public.whatsapp_leads
          (telefone, ctwa_clid, source_id, pixel_id,
           evento_lead_enviado, client_id, zapi_instance_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [phone, ctwaClid ?? null, sourceId ?? null, cfg.pixel_id,
          metaResult.success, clientId, instanceId]);

      return Response.json({
        ok: true, action: 'lead_created',
        meta_sent: metaResult.success, meta_error: metaResult.error ?? null,
      });
    }

    // ── FLOW 2: Purchase (sent by attendant) ─────────────────────────────────
    if (fromMe) {
      if (!eventos.purchase) {
        return Response.json({ ok: true, message: 'evento Purchase desativado para este cliente' });
      }

      const lcMsg = messageText.toLowerCase();
      if (!lcMsg.includes(gatilho)) {
        return Response.json({ ok: true, message: 'mensagem sem gatilho de compra, ignorada' });
      }

      // Extract value after the trigger keyword
      const afterGatilho = lcMsg.slice(lcMsg.indexOf(gatilho) + gatilho.length).trim();
      const match = afterGatilho.match(/^[\s:]*([\d.,]+)/);
      if (!match) {
        return Response.json({ ok: false, error: 'valor de compra não encontrado após o gatilho' }, { status: 400 });
      }
      const valor = parseFloat(match[1].replace(',', '.'));
      if (isNaN(valor)) {
        return Response.json({ ok: false, error: 'valor de compra inválido' }, { status: 400 });
      }

      const { rows: [lead] } = await pool.query(
        `SELECT id, ctwa_clid, evento_compra_enviado
         FROM public.whatsapp_leads WHERE telefone = $1 AND client_id = $2`,
        [phone, clientId],
      );
      if (!lead) {
        return Response.json({ ok: false, error: 'lead não encontrado para este telefone/cliente' }, { status: 404 });
      }
      if (lead.evento_compra_enviado) {
        return Response.json({ ok: true, message: 'evento de compra já enviado anteriormente' });
      }

      const metaResult = await sendMetaEvent({
        pixelId: cfg.pixel_id, accessToken: cfg.meta_token,
        eventName: 'Purchase', phone, ctwaClid: lead.ctwa_clid, value: valor,
      });

      await pool.query(
        `UPDATE public.whatsapp_leads
         SET evento_compra_enviado = $1, valor_compra = $2
         WHERE id = $3`,
        [metaResult.success, valor, lead.id],
      );

      return Response.json({
        ok: true, action: 'purchase_sent', valor,
        meta_sent: metaResult.success, meta_error: metaResult.error ?? null,
      });
    }

    return Response.json({ ok: true, message: 'mensagem ignorada' });

  } finally {
    await pool.end();
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    message: 'Webhook WhatsApp (instância) ativo.',
  });
}
