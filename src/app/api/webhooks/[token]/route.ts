import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

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

  const { rows } = await pool.query(
    `INSERT INTO public.crm_leads
       (client_id, mes, data, nome, numero, canal, observacao, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [clientId, mes, dataLead, nome, numero, canal, obs, data.status ?? 'Em Atendimento'],
  );

  return { action: 'lead.create', id: rows[0].id, client_id: clientId, nome, numero };
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
