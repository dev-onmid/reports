import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { normalizeMetaMessage, metaMediaOf } from '@/lib/whatsapp-provider';
import { registrarMensagemWhatsApp, parseProviderTimestamp } from '@/lib/whatsapp-inbound';
import { uploadBase64ToStorage } from '@/lib/evolution-media';
import { ensureCrmMessagesSchema, upsertLeadFromConversation } from '@/lib/crm-conversation-sync';
import { resolverLeadExistente } from '@/lib/lead-identity';
import {
  assinaturaMetaValida, ensureMetaWebhookConfig, fetchMetaMediaBase64, lerTokenMeta,
} from '@/lib/meta-whatsapp';

// Webhook ÚNICO da WhatsApp Cloud API (Meta). A Meta tem uma URL por app, e o
// payload diz qual número recebeu (`metadata.phone_number_id`) — é por ele que
// a mensagem acha o cliente em client_zapi_instances (provider = 'meta').
// Só recebe: o que o cliente envia por outro sistema chega apenas como status.

export const maxDuration = 60;

const TEXTO_SAIDA_OFICIAL = '[Resposta do atendente — conteúdo não disponível na API oficial]';

type InstanciaMeta = { id: string; client_id: string; instance_id: string; token: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const verifyToken = await ensureMetaWebhookConfig(pool);
    const mode = req.nextUrl.searchParams.get('hub.mode');
    const token = req.nextUrl.searchParams.get('hub.verify_token');
    const challenge = req.nextUrl.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!assinaturaMetaValida(raw, req.headers.get('x-hub-signature-256'))) {
    return new Response('Invalid signature', { status: 401 });
  }
  let body: Json;
  try { body = JSON.parse(raw) as Json; } catch { return Response.json({ ok: false, error: 'json inválido' }, { status: 400 }); }
  if (body.object !== 'whatsapp_business_account') return Response.json({ ok: true, ignored: true });

  const pool = makeServerPool();
  let recebidas = 0;
  let statuses = 0;
  let semInstancia = 0;
  try {
    for (const entry of (body.entry ?? []) as Json[]) {
      for (const change of (entry.changes ?? []) as Json[]) {
        if (change.field !== 'messages') continue;
        const value: Json = change.value ?? {};
        const phoneNumberId = String(value.metadata?.phone_number_id ?? '');
        if (!phoneNumberId) continue;

        const { rows: [inst] } = await pool.query<InstanciaMeta>(
          `SELECT id, client_id, instance_id, token FROM public.client_zapi_instances
            WHERE provider = 'meta' AND instance_id = $1 AND ativo = true
            ORDER BY created_at DESC LIMIT 1`,
          [phoneNumberId],
        );
        if (!inst) {
          // 200 mesmo assim: a Meta reenviaria para sempre, e número sem cadastro
          // é configuração, não falha transitória.
          semInstancia++;
          console.warn('[whatsapp-oficial] número sem instância cadastrada', phoneNumberId);
          continue;
        }

        for (const m of (value.messages ?? []) as Json[]) {
          try {
            await processarRecebida(pool, inst, value, m, body);
            recebidas++;
          } catch (err) {
            console.error('[whatsapp-oficial] mensagem', m?.id, err);
          }
        }
        for (const s of (value.statuses ?? []) as Json[]) {
          try {
            await processarStatus(pool, inst, s);
            statuses++;
          } catch (err) {
            console.error('[whatsapp-oficial] status', s?.id, err);
          }
        }
      }
    }
    return Response.json({ ok: true, recebidas, statuses, sem_instancia: semInstancia });
  } finally {
    await pool.end();
  }
}

async function processarRecebida(
  pool: ReturnType<typeof makeServerPool>,
  inst: InstanciaMeta,
  value: Json,
  m: Json,
  rawPayload: unknown,
) {
  const msg = normalizeMetaMessage(value, m);
  if (!msg) return;

  let tipo = 'texto';
  let text = msg.text;
  let caption: string | null = null;
  const media = metaMediaOf(m);
  if (media) {
    const token = lerTokenMeta(inst.token);
    const bytes = token ? await fetchMetaMediaBase64(media.id, token) : null;
    const url = bytes ? await uploadBase64ToStorage(bytes.base64, bytes.mimetype) : null;
    if (url) {
      text = url;
      tipo = media.kind;
      caption = media.caption;
    }
  }

  await registrarMensagemWhatsApp(pool, {
    clientId: inst.client_id,
    instanceRowId: inst.id,
    instanceName: inst.instance_id,
    msg,
    media: { text, tipo, caption },
    rawPayload,
  });
}

function statusMeta(raw: unknown): string | null {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'sent') return 'sent';
  if (s === 'delivered') return 'delivered';
  if (s === 'read') return 'read';
  if (s === 'failed') return 'failed';
  return null;
}

// O que o cliente envia pelo sistema dele chega só como status (sem texto). A
// conversa no CRM ganha um marcador por mensagem enviada — assim o lead não
// parece abandonado quando o atendente já respondeu — e os ✓✓ acompanham.
async function processarStatus(pool: ReturnType<typeof makeServerPool>, inst: InstanciaMeta, s: Json) {
  const status = statusMeta(s.status);
  const externalId = typeof s.id === 'string' ? s.id : '';
  const phone = String(s.recipient_id ?? '').replace(/\D/g, '');
  if (!status || !externalId || !phone) return;
  const erro = Array.isArray(s.errors) && s.errors[0]
    ? String(s.errors[0].title ?? s.errors[0].message ?? s.errors[0].code ?? '')
    : null;

  await ensureCrmMessagesSchema(pool);
  const atualizado = await pool.query(
    `UPDATE public.crm_messages
        SET whatsapp_status = $3,
            whatsapp_error = CASE WHEN $3 = 'failed' THEN COALESCE($4, whatsapp_error) ELSE whatsapp_error END
      WHERE client_id = $1 AND external_id = $2`,
    [inst.client_id, externalId, status, erro],
  );
  if ((atualizado.rowCount ?? 0) > 0) return;

  const quando = parseProviderTimestamp(s.timestamp);
  const existente = await resolverLeadExistente(pool, inst.client_id, { telefone: phone }).catch(() => null);
  if (!existente) return; // só marca resposta em conversa que o CRM já conhece

  const { id: leadId } = await upsertLeadFromConversation(pool, {
    clientId: inst.client_id,
    phone,
    lastMessageAt: quando,
    lastMessageText: TEXTO_SAIDA_OFICIAL,
    lastDirection: 'out',
    instanceId: inst.instance_id,
  });
  await pool.query(
    `INSERT INTO public.crm_messages
       (lead_id, client_id, direction, text, tipo, external_id, created_at, whatsapp_status, whatsapp_error)
     VALUES ($1, $2, 'out', $3, 'texto', $4, $5::timestamptz, $6, $7)
     ON CONFLICT DO NOTHING`,
    [leadId, inst.client_id, TEXTO_SAIDA_OFICIAL, externalId, quando, status, status === 'failed' ? erro : null],
  );
}
