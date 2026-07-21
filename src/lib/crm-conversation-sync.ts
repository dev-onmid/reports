import type { Pool } from 'pg';

export const DEFAULT_CRM_STAGES = [
  { label: 'Em Atendimento', color: '#0ea5e9', position: 0 },
  { label: 'Agendado', color: '#3b82f6', position: 1 },
  { label: 'Reagendado', color: '#7dd3fc', position: 2 },
  { label: 'Fechado', color: '#10b981', position: 3 },
  { label: 'Comprou', color: '#34d399', position: 4 },
  { label: 'Paciente', color: '#a1a1aa', position: 5 },
  { label: 'Não Retorna', color: '#71717a', position: 6 },
  { label: 'Distante', color: '#f97316', position: 7 },
  { label: 'Sem Interesse', color: '#ef4444', position: 8 },
  { label: 'Desqualificado', color: '#dc2626', position: 9 },
];

export function normalizeCrmPhone(raw: unknown) {
  return String(raw ?? '').replace(/\D/g, '');
}

export async function ensureCrmConversationSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      mes TEXT,
      data DATE,
      nome TEXT,
      numero TEXT,
      canal TEXT,
      status TEXT DEFAULT 'Em Atendimento',
      observacao TEXT,
      fechou BOOLEAN DEFAULT FALSE,
      valor_rs NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.crm_funnels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Funil Principal',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.crm_stages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      funnel_id UUID NOT NULL REFERENCES public.crm_funnels(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#71717a',
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE public.crm_leads
      ADD COLUMN IF NOT EXISTS funnel_id UUID REFERENCES public.crm_funnels(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS origin TEXT,
      ADD COLUMN IF NOT EXISTS temperatura TEXT,
      ADD COLUMN IF NOT EXISTS time_interno BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_last_message_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS whatsapp_last_message_text TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_last_direction TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_lid TEXT,
      ADD COLUMN IF NOT EXISTS ctwa_clid TEXT,
      ADD COLUMN IF NOT EXISTS utm_source TEXT,
      ADD COLUMN IF NOT EXISTS utm_medium TEXT,
      ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
      ADD COLUMN IF NOT EXISTS utm_content TEXT,
      ADD COLUMN IF NOT EXISTS utm_term TEXT,
      ADD COLUMN IF NOT EXISTS source_id TEXT,
      ADD COLUMN IF NOT EXISTS source_url TEXT,
      ADD COLUMN IF NOT EXISTS campaign_name TEXT,
      ADD COLUMN IF NOT EXISTS adset_name TEXT,
      ADD COLUMN IF NOT EXISTS ad_name TEXT,
      ADD COLUMN IF NOT EXISTS creative_name TEXT,
      ADD COLUMN IF NOT EXISTS first_origin_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS instance_id TEXT,
      ADD COLUMN IF NOT EXISTS chat_read_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS crm_leads_client_id_idx ON public.crm_leads(client_id);
    CREATE INDEX IF NOT EXISTS crm_leads_funnel_id_idx ON public.crm_leads(funnel_id);
    CREATE INDEX IF NOT EXISTS crm_leads_normalized_phone_idx
      ON public.crm_leads (client_id, NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), ''));
    CREATE INDEX IF NOT EXISTS crm_leads_whatsapp_lid_idx
      ON public.crm_leads (client_id, whatsapp_lid) WHERE whatsapp_lid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS crm_funnels_client_id_idx ON public.crm_funnels(client_id);
    CREATE INDEX IF NOT EXISTS crm_stages_funnel_id_idx ON public.crm_stages(funnel_id);
  `);
}

export async function ensureCrmMessagesSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID,
      lead_id UUID,
      client_id TEXT,
      direction TEXT NOT NULL,
      text TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'texto',
      external_id TEXT,
      whatsapp_status TEXT,
      whatsapp_error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const stmts = [
    // Base columns the chat code reads/writes. The prod table was created by an early
    // minimal version MISSING `direction` (and possibly text/created_at/contact_id), so
    // every INSERT/SELECT referencing `direction` failed ("column direction does not
    // exist") — empty chat for everyone. Add every column the code depends on.
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS contact_id UUID`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS direction TEXT`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS text TEXT`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS content TEXT`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS lead_id UUID`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS client_id TEXT`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'texto'`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS external_id TEXT`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS whatsapp_status TEXT`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS whatsapp_error TEXT`,
    // Resposta citada (trecho da mensagem respondida) — exibido acima da bolha
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS reply_to_text TEXT`,
    // ── Legacy-schema repair ──────────────────────────────────────────────────
    // The original migration (migration_crm.sql) created crm_messages with
    // `contact_id UUID NOT NULL REFERENCES crm_contacts(id)` and a direction CHECK.
    // Some intermediate schemas also added `conversation_id NOT NULL` and `content
    // TEXT NOT NULL`. Lead-based chat messages set lead_id and write the message body
    // to `text`, so on installs that still carry the legacy constraints every INSERT
    // fails (NOT NULL / FK / CHECK). Make the legacy columns nullable, drop the FK to
    // crm_contacts, and drop the legacy direction CHECK so inbound/outbound rows always
    // persist.
    `ALTER TABLE public.crm_messages ALTER COLUMN contact_id DROP NOT NULL`,
    `ALTER TABLE public.crm_messages ALTER COLUMN conversation_id DROP NOT NULL`,
    `ALTER TABLE public.crm_messages DROP CONSTRAINT IF EXISTS crm_messages_contact_id_fkey`,
    `ALTER TABLE public.crm_messages DROP CONSTRAINT IF EXISTS crm_messages_direction_check`,
    `ALTER TABLE public.crm_messages ALTER COLUMN text DROP NOT NULL`,
    `ALTER TABLE public.crm_messages ALTER COLUMN content DROP NOT NULL`,
    `UPDATE public.crm_messages
        SET text = content
      WHERE (text IS NULL OR text = '')
        AND content IS NOT NULL
        AND content <> ''`,
    `UPDATE public.crm_messages
        SET content = text
      WHERE (content IS NULL OR content = '')
        AND text IS NOT NULL
        AND text <> ''`,
    `CREATE INDEX IF NOT EXISTS idx_crm_messages_lead
       ON public.crm_messages (lead_id, created_at DESC)
       WHERE lead_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_lead_external_idx
       ON public.crm_messages (lead_id, external_id)
       WHERE external_id IS NOT NULL AND lead_id IS NOT NULL`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch(() => null);
  }
}

export async function ensureDefaultFunnel(pool: Pool, clientId: string) {
  await ensureCrmConversationSchema(pool);

  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM public.crm_funnels WHERE client_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [clientId],
  );

  let funnelId = rows[0]?.id;
  if (!funnelId) {
    const created = await pool.query<{ id: string }>(
      `INSERT INTO public.crm_funnels (client_id, name)
       VALUES ($1, 'Funil Principal')
       RETURNING id`,
      [clientId],
    );
    funnelId = created.rows[0].id;
  }

  const { rows: stageCount } = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM public.crm_stages WHERE funnel_id = $1`,
    [funnelId],
  );
  if ((stageCount[0]?.total ?? 0) === 0) {
    for (const stage of DEFAULT_CRM_STAGES) {
      await pool.query(
        `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position)
         VALUES ($1, $2, $3, $4, $5)`,
        [funnelId, clientId, stage.label, stage.color, stage.position],
      );
    }
  }

  await pool.query(
    `UPDATE public.crm_leads
        SET funnel_id = $1, updated_at = COALESCE(updated_at, NOW())
      WHERE client_id = $2 AND funnel_id IS NULL`,
    [funnelId, clientId],
  );

  return funnelId;
}

export async function getFirstFunnelStageLabel(pool: Pool, funnelId: string) {
  const { rows: [stage] } = await pool.query<{ label: string }>(
    `SELECT label
       FROM public.crm_stages
      WHERE funnel_id = $1
      ORDER BY position ASC, created_at ASC
      LIMIT 1`,
    [funnelId],
  );
  return stage?.label ?? 'Em Atendimento';
}

export type ConversationLeadInput = {
  clientId: string;
  phone?: string | null;
  lid?: string | null;
  name?: string | null;
  profilePictureUrl?: string | null;
  lastMessageAt?: string | null;
  lastMessageText?: string | null;
  lastDirection?: 'in' | 'out' | string | null;
  canal?: string | null;
  origin?: string | null;
  status?: string | null;
  observacao?: string | null;
  ctwaClid?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  campaignName?: string | null;
  adsetName?: string | null;
  adName?: string | null;
  creativeName?: string | null;
  instanceId?: string | null;
};

export async function upsertLeadFromConversation(pool: Pool, input: ConversationLeadInput) {
  await ensureCrmConversationSchema(pool);
  const phone = normalizeCrmPhone(input.phone);
  const lid = normalizeCrmPhone(input.lid);
  const incomingName = input.name?.trim() ?? '';
  const displayName = incomingName || phone || lid || 'Contato WhatsApp';
  const canal = input.canal?.trim() || 'Whatsapp';
  const origin = input.origin?.trim() || 'organic';

  if (!phone && !lid) {
    throw new Error('Telefone ou LID é obrigatório para sincronizar conversa');
  }

  await pool.query('BEGIN');
  try {
    await pool.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`crm-lead:${input.clientId}:${phone || lid}`],
    );

    const funnelId = await ensureDefaultFunnel(pool, input.clientId);
    const status = input.status?.trim() || await getFirstFunnelStageLabel(pool, funnelId);
    const { rows: [existing] } = await pool.query<{ id: string }>(
      `SELECT id
         FROM public.crm_leads
        WHERE client_id = $1
          AND (
            ($2::text <> '' AND NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') = $2)
            OR ($3::text <> '' AND NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') = $3)
            OR ($3::text <> '' AND whatsapp_lid = $3)
          )
        ORDER BY
          CASE WHEN funnel_id IS NOT NULL THEN 0 ELSE 1 END,
          COALESCE(updated_at, created_at) DESC,
          created_at DESC
        LIMIT 1`,
      [input.clientId, phone, lid],
    );

    let leadId = existing?.id;
    if (leadId) {
      const updated = await pool.query<{ id: string }>(
        `UPDATE public.crm_leads
            SET nome = COALESCE(NULLIF($2, ''), nome),
                numero = COALESCE(NULLIF($3, ''), numero),
                whatsapp_lid = COALESCE(NULLIF($4, ''), whatsapp_lid),
                canal = COALESCE(NULLIF(canal, ''), $5),
                origin = COALESCE(NULLIF(origin, ''), $6),
                status = COALESCE(NULLIF(status, ''), $7),
                funnel_id = COALESCE(funnel_id, $8::uuid),
                profile_picture_url = COALESCE($9, profile_picture_url),
                whatsapp_last_message_at = COALESCE($10::timestamptz, whatsapp_last_message_at),
                whatsapp_last_message_text = COALESCE(NULLIF($11, ''), whatsapp_last_message_text),
                whatsapp_last_direction = COALESCE(NULLIF($12, ''), whatsapp_last_direction),
                observacao = COALESCE(NULLIF($13, ''), observacao),
                ctwa_clid = COALESCE(NULLIF(ctwa_clid, ''), NULLIF($14, '')),
                source_id = COALESCE(NULLIF(source_id, ''), NULLIF($15, '')),
                source_url = COALESCE(NULLIF(source_url, ''), NULLIF($16, '')),
                utm_source = COALESCE(NULLIF(utm_source, ''), NULLIF($17, '')),
                utm_medium = COALESCE(NULLIF(utm_medium, ''), NULLIF($18, '')),
                utm_campaign = COALESCE(NULLIF(utm_campaign, ''), NULLIF($19, '')),
                utm_content = COALESCE(NULLIF(utm_content, ''), NULLIF($20, '')),
                utm_term = COALESCE(NULLIF(utm_term, ''), NULLIF($21, '')),
                campaign_name = COALESCE(NULLIF(campaign_name, ''), NULLIF($22, '')),
                adset_name = COALESCE(NULLIF(adset_name, ''), NULLIF($23, '')),
                ad_name = COALESCE(NULLIF(ad_name, ''), NULLIF($24, '')),
                creative_name = COALESCE(NULLIF(creative_name, ''), NULLIF($25, '')),
                instance_id = COALESCE(NULLIF(instance_id, ''), NULLIF($26, '')),
                first_origin_at = COALESCE(first_origin_at, CASE WHEN NULLIF($14, '') IS NOT NULL OR NULLIF($15, '') IS NOT NULL OR NULLIF($17, '') IS NOT NULL THEN NOW() ELSE NULL END),
                updated_at = NOW()
          WHERE id = $1
          RETURNING id`,
        [
          leadId,
          incomingName,
          phone || null,
          lid || null,
          canal,
          origin,
          status,
          funnelId,
          input.profilePictureUrl ?? null,
          input.lastMessageAt ?? null,
          input.lastMessageText ?? null,
          input.lastDirection ?? null,
          input.observacao ?? null,
          input.ctwaClid ?? null,
          input.sourceId ?? null,
          input.sourceUrl ?? null,
          input.utmSource ?? null,
          input.utmMedium ?? null,
          input.utmCampaign ?? null,
          input.utmContent ?? null,
          input.utmTerm ?? null,
          input.campaignName ?? null,
          input.adsetName ?? null,
          input.adName ?? null,
          input.creativeName ?? null,
          input.instanceId ?? null,
        ],
      );
      leadId = updated.rows[0].id;
    } else {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO public.crm_leads
          (client_id, nome, numero, canal, origin, data, status, funnel_id, profile_picture_url,
           whatsapp_last_message_at, whatsapp_last_message_text, whatsapp_last_direction,
           whatsapp_lid, observacao, ctwa_clid, source_id, source_url, utm_source, utm_medium,
           utm_campaign, utm_content, utm_term, campaign_name, adset_name, ad_name, creative_name,
           instance_id, first_origin_at)
         VALUES ($1, $2, NULLIF($3, ''), $4, $5, CURRENT_DATE, $6, $7, $8,
                 $9::timestamptz, NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''),
                 NULLIF($14, ''), NULLIF($15, ''), NULLIF($16, ''), NULLIF($17, ''), NULLIF($18, ''),
                 NULLIF($19, ''), NULLIF($20, ''), NULLIF($21, ''), NULLIF($22, ''), NULLIF($23, ''),
                 NULLIF($24, ''), NULLIF($25, ''), NULLIF($26, ''),
                 CASE WHEN NULLIF($14, '') IS NOT NULL OR NULLIF($15, '') IS NOT NULL OR NULLIF($17, '') IS NOT NULL THEN NOW() ELSE NULL END)
         RETURNING id`,
        [
          input.clientId,
          displayName,
          phone,
          canal,
          origin,
          status,
          funnelId,
          input.profilePictureUrl ?? null,
          input.lastMessageAt ?? null,
          input.lastMessageText ?? null,
          input.lastDirection ?? null,
          lid,
          input.observacao ?? null,
          input.ctwaClid ?? null,
          input.sourceId ?? null,
          input.sourceUrl ?? null,
          input.utmSource ?? null,
          input.utmMedium ?? null,
          input.utmCampaign ?? null,
          input.utmContent ?? null,
          input.utmTerm ?? null,
          input.campaignName ?? null,
          input.adsetName ?? null,
          input.adName ?? null,
          input.creativeName ?? null,
          input.instanceId ?? null,
        ],
      );
      leadId = inserted.rows[0].id;
    }

    await pool.query('COMMIT');
    return { id: leadId, funnelId };
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => null);
    throw err;
  }
}
