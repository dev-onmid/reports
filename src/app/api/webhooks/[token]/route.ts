import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { analisarConversa } from '@/lib/crm-ai-analysis';
import {
  ensureCrmMessagesSchema,
  ensureDefaultFunnel,
  getFirstFunnelStageLabel,
  normalizeCrmPhone,
  upsertLeadFromConversation,
} from '@/lib/crm-conversation-sync';

// ── Helpers ─────────────────────────────────────────────────────────────────

function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  return pool.query(`
    CREATE TABLE IF NOT EXISTS public.webhook_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
      description TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_configs_token ON public.webhook_configs (token);
    CREATE TABLE IF NOT EXISTS public.webhook_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token TEXT,
      config_name TEXT,
      event_type TEXT,
      payload JSONB,
      status TEXT NOT NULL DEFAULT 'success',
      result JSONB,
      error_msg TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_logs_received_at ON public.webhook_logs (received_at DESC);
  `);
}

async function log(
  pool: ReturnType<typeof makeServerPool>,
  token: string,
  configName: string | null,
  eventType: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  status: 'success' | 'error' | 'ignored',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any,
  errorMsg?: string,
) {
  await pool.query(
    `INSERT INTO public.webhook_logs (token, config_name, event_type, payload, status, result, error_msg)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [token, configName, eventType, JSON.stringify(payload), status, JSON.stringify(result), errorMsg ?? null],
  );
}

// ── Event handlers ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleClientCreate(pool: ReturnType<typeof makeServerPool>, data: any) {
  const name = data.name ?? data.nome ?? data.client_name;
  if (!name) throw new Error('Campo "name" é obrigatório para client.create');

  const segment = data.segment ?? data.segmento ?? 'Não informado';
  const status  = data.status ?? 'Ativo';
  const id      = data.id ?? data.client_id ?? undefined;

  if (id) {
    await pool.query(
      `INSERT INTO public.clients (id, name, segment, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, segment = EXCLUDED.segment, status = EXCLUDED.status`,
      [id, name, segment, status],
    );
    return { action: 'client.create', id, name };
  }

  // auto-generate id
  const newId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await pool.query(
    `INSERT INTO public.clients (id, name, segment, status) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [newId, name, segment, status],
  );
  return { action: 'client.create', id: newId, name };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleLeadCreate(pool: ReturnType<typeof makeServerPool>, data: any) {
  let clientId = data.client_id ?? data.clientId;

  // Allow lookup by client name if id not provided
  if (!clientId && (data.client_name ?? data.cliente)) {
    const clientName = data.client_name ?? data.cliente;
    const { rows } = await pool.query(
      `SELECT id FROM public.clients WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [clientName],
    );
    if (rows[0]) clientId = rows[0].id;
  }

  if (!clientId) throw new Error('Campo "client_id" ou "client_name" é obrigatório para lead.create');

  // Normalize common field aliases
  const nome   = data.nome   ?? data.name   ?? data.lead_name ?? null;
  const numero = data.numero ?? data.phone  ?? data.telefone  ?? null;
  const canal  = data.canal  ?? data.source ?? data.origem    ?? null;
  const obs    = data.observacao ?? data.obs ?? data.notes ?? data.mensagem ?? null;

  const now    = new Date();
  const mes    = data.mes ?? `${now.toLocaleString('pt-BR', { month: 'short' })}/${now.getFullYear()}`;
  const dataLead = data.data ?? data.date ?? now.toISOString().slice(0, 10);

  const funnelId = await ensureDefaultFunnel(pool, clientId);
  const fallbackStatus = await getFirstFunnelStageLabel(pool, funnelId);
  if (normalizeCrmPhone(numero)) {
    const lead = await upsertLeadFromConversation(pool, {
      clientId,
      phone: numero,
      name: nome,
      canal,
      origin: canal,
      status: data.status ?? null,
      observacao: obs,
    });
    return { action: 'lead.create', id: lead.id, client_id: clientId, nome, numero };
  }

  const { rows } = await pool.query(
    `INSERT INTO public.crm_leads
       (client_id, mes, data, nome, numero, canal, observacao, status, funnel_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [clientId, mes, dataLead, nome, numero, canal, obs, data.status ?? fallbackStatus, funnelId],
  );

  return { action: 'lead.create', id: rows[0].id, client_id: clientId, nome, numero };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseWebhookTimestamp(data: any) {
  const raw = data.timestamp ?? data.messageTimestamp ?? data.created_at ?? data.createdAt ?? data.date;
  if (!raw) return new Date().toISOString();
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) {
    return new Date(num < 10_000_000_000 ? num * 1000 : num).toISOString();
  }
  const parsed = new Date(String(raw));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMessageReceived(pool: ReturnType<typeof makeServerPool>, data: any, direction: 'received' | 'sent') {
  const numero   = normalizeCrmPhone(data.numero ?? data.phone ?? data.from ?? data.to);
  const mensagem = String(data.mensagem ?? data.message ?? data.text ?? data.body ?? '').trim();
  const clientId = String(data.client_id ?? data.clientId ?? '');
  const lid      = normalizeCrmPhone(data.lid ?? data.remoteJid ?? data.remote_jid);
  const nome     = data.nome ?? data.name ?? data.pushName ?? data.pushname ?? data.contact_name ?? null;
  const externalId = data.external_id ?? data.messageId ?? data.message_id ?? data.id ?? null;
  const createdAt = parseWebhookTimestamp(data);

  if ((!numero && !lid) || !mensagem) throw new Error('Campos "numero" e "mensagem" são obrigatórios');
  if (!clientId) throw new Error('Campo "client_id" é obrigatório para identificar o funil correto');

  const syncedLead = await upsertLeadFromConversation(pool, {
    clientId,
    phone: numero,
    lid,
    name: nome,
    lastMessageAt: createdAt,
    lastMessageText: mensagem,
    lastDirection: direction === 'received' ? 'in' : 'out',
  });
  const { rows: [lead] } = await pool.query(
    `SELECT id, status FROM public.crm_leads WHERE id = $1`,
    [syncedLead.id],
  );

  // Persist message in crm_messages so analisarConversa has full context
  await ensureCrmMessagesSchema(pool);
  if (externalId) {
    await pool.query(
      `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, external_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (lead_id, external_id) DO NOTHING`,
      [lead.id, clientId, direction === 'received' ? 'in' : 'out', mensagem, String(externalId), createdAt],
    ).catch(() => null);
  } else {
    await pool.query(
      `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, created_at)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM public.crm_messages
          WHERE lead_id = $1 AND direction = $3 AND text = $4 AND created_at = $5
       )`,
      [lead.id, clientId, direction === 'received' ? 'in' : 'out', mensagem, createdAt],
    ).catch(() => null);
  }

  const statusBefore = lead.status;

  // Delegate to the full AI analysis: loads funnel stages, applies rules, updates status
  await analisarConversa(pool as Parameters<typeof analisarConversa>[0], lead.id);

  // Read updated status to report back
  const { rows: [updated] } = await pool.query(
    `SELECT status FROM public.crm_leads WHERE id = $1`, [lead.id],
  );
  return {
    action: `message.${direction}`,
    lead_id: lead.id,
    old_status: statusBefore,
    new_status: updated?.status ?? statusBefore,
    changed: updated?.status !== statusBefore,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleLeadUpdate(pool: ReturnType<typeof makeServerPool>, data: any) {
  const leadId = data.lead_id ?? data.id;
  if (!leadId) throw new Error('Campo "lead_id" é obrigatório para lead.update');

  const allowed = [
    'nome','numero','canal','status','mes','data','observacao',
    'orcamento','fechou','valor_rs','pagamento','compareceu',
    'video_dra','dia1','dia2','dia3','dia4','data_agendada',
    'link_criativo','emoji','analise_credito','data_nasc','bairro',
    'motivacoes','dores',
  ];

  const sets: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vals: any[] = [];
  let idx = 1;

  for (const field of allowed) {
    const alias: Record<string, string> = { nome: 'name', numero: 'phone', canal: 'source' };
    const value = data[field] ?? data[alias[field] ?? ''];
    if (value !== undefined) {
      sets.push(`${field} = $${idx++}`);
      vals.push(value);
    }
  }

  if (sets.length === 0) throw new Error('Nenhum campo válido para atualizar em lead.update');

  vals.push(leadId);
  await pool.query(
    `UPDATE public.crm_leads SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
    vals,
  );

  return { action: 'lead.update', id: leadId, updated: sets.length };
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const pool = makeServerPool();

  try {
    await ensureTables(pool);

    // Validate token
    const { rows: [config] } = await pool.query(
      `SELECT id, name, enabled FROM public.webhook_configs WHERE token = $1`,
      [token],
    );

    if (!config) {
      return Response.json({ error: 'Token inválido' }, { status: 401 });
    }
    if (!config.enabled) {
      return Response.json({ error: 'Webhook desativado' }, { status: 403 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await request.json().catch(() => ({}));
    const event = body.event ?? body.type ?? body.action ?? null;
    const data  = body.data ?? body.payload ?? body;

    let result;
    try {
      switch (event) {
        case 'client.create':
          result = await handleClientCreate(pool, data);
          break;
        case 'lead.create':
          result = await handleLeadCreate(pool, data);
          break;
        case 'lead.update':
          result = await handleLeadUpdate(pool, data);
          break;
        case 'message.received':
          result = await handleMessageReceived(pool, data, 'received');
          break;
        case 'message.sent':
          result = await handleMessageReceived(pool, data, 'sent');
          break;
        default:
          await log(pool, token, config.name, event, body, 'ignored', { reason: 'unknown_event' });
          return Response.json({ ok: true, message: `Evento "${event}" recebido mas não processado` });
      }

      await log(pool, token, config.name, event, body, 'success', result);
      return Response.json({ ok: true, ...result });

    } catch (handlerErr) {
      const msg = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
      await log(pool, token, config.name, event, body, 'error', null, msg);
      return Response.json({ ok: false, error: msg }, { status: 422 });
    }

  } finally {
    await pool.end();
  }
}

// Allow GET for simple connectivity test
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows: [config] } = await pool.query(
      `SELECT name, enabled FROM public.webhook_configs WHERE token = $1`,
      [token],
    );
    if (!config) return Response.json({ ok: false, error: 'Token inválido' }, { status: 401 });
    return Response.json({ ok: true, name: config.name, enabled: config.enabled });
  } finally {
    await pool.end();
  }
}
