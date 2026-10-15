import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { normalizeTolkiMessage } from '@/lib/whatsapp-provider';
import { registrarMensagemWhatsApp } from '@/lib/whatsapp-inbound';
import { ensureCrmMessagesSchema } from '@/lib/crm-conversation-sync';
import { resolverLeadExistente } from '@/lib/lead-identity';
import { salvarMidia, vincularMidiaAoLead } from '@/lib/crm-midia';
import {
  autorizacaoTolkiValida, baixarMidiaTolki, extrairReferralTolki, placeholderTolki, tipoDeMidiaTolki,
} from '@/lib/tolki';

// Webhook da Tolki, uma URL por instância (UUID na URL + token Bearer gerado
// pelo reports e colado em Tolki → Configurações → Integrações). Eventos:
// message.received / message.sent entram no pipeline do CRM; message.status
// atualiza os ✓✓; message.media.ready troca o placeholder pela mídia salva.

export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Instancia = { id: string; client_id: string; instance_id: string; token: string | null };

// Origens em que a Tolki fala PRIMEIRO com gente que o CRM não conhece
// (campanha em massa, template, lembrete): não viram lead por conta própria.
const ORIGENS_EM_MASSA = new Set(['campaign', 'channel_api_template', 'calendar_reminder', 'system']);

function statusTolki(raw: unknown): string | null {
  const s = String(raw ?? '').toLowerCase();
  if (['pending', 'sent', 'delivered', 'read', 'failed'].includes(s)) return s;
  if (s === 'played') return 'read';
  if (s.includes('error') || s.includes('fail')) return 'failed';
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(instanceId)) {
    return Response.json({ ok: false, error: 'Instância não encontrada' }, { status: 404 });
  }
  const pool = makeServerPool();
  try {
    const { rows: [inst] } = await pool.query<Instancia>(
      `SELECT id, client_id, instance_id, token FROM public.client_zapi_instances
        WHERE id::text = $1 AND provider = 'tolki' AND ativo = true`,
      [instanceId],
    );
    if (!inst) return Response.json({ ok: false, error: 'Instância não encontrada ou inativa' }, { status: 404 });
    if (!autorizacaoTolkiValida(req.headers.get('authorization'), inst.token)) {
      return Response.json({ ok: false, error: 'Token do webhook inválido' }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as Json | null;
    if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'json inválido' }, { status: 400 });

    // Filtro de conexão: a mesma empresa na Tolki pode ter vários números.
    const conexao = String(body.connection_id ?? body.data?.connection?.id ?? '');
    if (conexao && inst.instance_id && conexao !== inst.instance_id) {
      return Response.json({ ok: true, ignored: true, reason: 'outra_conexao' });
    }

    const evento = String(body.event ?? '');
    try {
      if (evento === 'message.received' || evento === 'message.sent') {
        return Response.json(await processarMensagem(pool, inst, body));
      }
      if (evento === 'message.status') {
        return Response.json(await processarStatus(pool, inst, body));
      }
      if (evento === 'message.media.ready') {
        return Response.json(await processarMidiaPronta(pool, inst, body));
      }
    } catch (err) {
      // 200 mesmo assim: a Tolki só tem 3 tentativas e o erro é nosso, não dela.
      console.error('[webhook tolki]', evento, err instanceof Error ? err.message : err);
      return Response.json({ ok: false, error: 'falha interna registrada' });
    }
    return Response.json({ ok: true, ignored: true, reason: evento || 'sem_evento' });
  } finally {
    await pool.end();
  }
}

async function processarMensagem(pool: ReturnType<typeof makeServerPool>, inst: Instancia, body: Json) {
  const m: Json = body.data?.message ?? {};
  if (m.isGroup === true || String(m.remoteJid ?? '').endsWith('@g.us')) {
    return { ok: true, ignored: true, reason: 'group_message' };
  }
  const referral = extrairReferralTolki(m.metadata);
  const corpo = String(m.body ?? '');
  const tipoMidia = tipoDeMidiaTolki(m.messageType, m.mediaType);
  const msg = normalizeTolkiMessage(body, referral, placeholderTolki(m.messageType, corpo));
  if (!msg) return { ok: false, error: 'telefone não identificado' };

  if (msg.fromMe && ORIGENS_EM_MASSA.has(String(body.message_origin ?? ''))) {
    const existe = await resolverLeadExistente(pool, inst.client_id, { telefone: msg.phone }).catch(() => null);
    if (!existe) return { ok: true, ignored: true, reason: 'disparo_para_nao_lead' };
  }

  let text = msg.text;
  let tipo = 'texto';
  let caption: string | null = null;
  let midiaToken: string | null = null;
  if (tipoMidia && typeof m.mediaUrl === 'string' && m.mediaUrl) {
    const baixada = await baixarMidiaTolki(m.mediaUrl);
    const salva = baixada
      ? await salvarMidia(pool, {
          clientId: inst.client_id, bytes: baixada.bytes, mime: m.mediaType ? String(m.mediaType) : baixada.mime, origem: msg.fromMe ? 'enviada' : 'recebida',
        }).catch(err => { console.error('[webhook tolki midia]', err instanceof Error ? err.message : err); return null; })
      : null;
    if (salva) {
      text = salva.url;
      tipo = tipoMidia;
      caption = corpo.trim() || null;
      midiaToken = salva.token;
    }
  }
  // Sem mediaUrl agora: fica o placeholder ("[Imagem]") e o message.media.ready troca depois.

  const resposta = await registrarMensagemWhatsApp(pool, {
    clientId: inst.client_id,
    instanceRowId: inst.id,
    instanceName: inst.instance_id,
    msg,
    media: { text, tipo, caption, midiaToken },
    rawPayload: body,
  });
  return await resposta.json().catch(() => ({ ok: true }));
}

async function processarStatus(pool: ReturnType<typeof makeServerPool>, inst: Instancia, body: Json) {
  const s: Json = body.data?.status ?? {};
  const status = statusTolki(s.status);
  const externalId = typeof s.messageId === 'string' ? s.messageId : '';
  if (!status || !externalId) return { ok: true, ignored: true, reason: 'status_sem_id' };
  const erro = s.errorMessage ? String(s.errorMessage) : s.errorCode ? String(s.errorCode) : null;
  await ensureCrmMessagesSchema(pool);
  const r = await pool.query(
    `UPDATE public.crm_messages
        SET whatsapp_status = $3,
            whatsapp_error = CASE WHEN $3 = 'failed' THEN COALESCE($4, whatsapp_error) ELSE whatsapp_error END
      WHERE client_id = $1 AND external_id = $2`,
    [inst.client_id, externalId, status, erro],
  );
  return { ok: true, status_updates: r.rowCount ?? 0 };
}

async function processarMidiaPronta(pool: ReturnType<typeof makeServerPool>, inst: Instancia, body: Json) {
  const d: Json = body.data ?? {};
  const externalId = typeof d.externalId === 'string' ? d.externalId : '';
  const url = typeof d.mediaUrl === 'string' ? d.mediaUrl : '';
  if (!externalId || !url) return { ok: true, ignored: true, reason: 'midia_sem_id' };
  await ensureCrmMessagesSchema(pool);
  const { rows: [linha] } = await pool.query<{ id: string; lead_id: string; tipo: string | null }>(
    `SELECT id, lead_id, tipo FROM public.crm_messages WHERE client_id = $1 AND external_id = $2 LIMIT 1`,
    [inst.client_id, externalId],
  );
  if (!linha) return { ok: true, ignored: true, reason: 'mensagem_desconhecida' };
  if (linha.tipo && linha.tipo !== 'texto') return { ok: true, ignored: true, reason: 'midia_ja_salva' };

  const baixada = await baixarMidiaTolki(url);
  if (!baixada) return { ok: false, error: 'download da mídia falhou' };
  const mime = d.mediaType ? String(d.mediaType) : baixada.mime;
  const tipo = tipoDeMidiaTolki(null, mime) ?? 'documento';
  const salva = await salvarMidia(pool, { clientId: inst.client_id, leadId: linha.lead_id, bytes: baixada.bytes, mime, origem: 'recebida' });
  await pool.query(
    `UPDATE public.crm_messages SET text = $2, tipo = $3 WHERE id = $1`,
    [linha.id, salva.url, tipo],
  );
  await vincularMidiaAoLead(pool, salva.token, linha.lead_id);
  return { ok: true, midia: tipo };
}

export async function GET() {
  return Response.json({ ok: true, message: 'Webhook Tolki ativo. Configure esta URL em Tolki → Configurações → Integrações, com o token Bearer da instância.' });
}
