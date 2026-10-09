import type { NextRequest } from 'next/server';
import { memoizarSchema } from '@/lib/schema-memo';
import { makeServerPool } from '@/lib/server-db';
import { requireAdmin } from '@/lib/api-auth';
import { autorDaRequisicao, ensureColunasOperacao, registrarEventos } from '@/lib/crm-eventos';
import { ensureCrmMessagesSchema, ensureDefaultFunnel, getFirstFunnelStageLabel } from '@/lib/crm-conversation-sync';
import { leadVisivelCrmSql } from '@/lib/lead-contagem';

async function ensureTableInterno(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_leads (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id   TEXT NOT NULL,
      mes         TEXT,
      data        DATE,
      link_criativo TEXT,
      nome        TEXT,
      numero      TEXT,
      canal       TEXT,
      emoji       TEXT,
      dia1        BOOLEAN DEFAULT FALSE,
      dia2        BOOLEAN DEFAULT FALSE,
      dia3        BOOLEAN DEFAULT FALSE,
      dia4        BOOLEAN DEFAULT FALSE,
      status      TEXT DEFAULT 'Em Atendimento',
      data_agendada DATE,
      video_dra   BOOLEAN DEFAULT FALSE,
      compareceu  BOOLEAN DEFAULT FALSE,
      observacao  TEXT,
      orcamento   NUMERIC,
      fechou      BOOLEAN DEFAULT FALSE,
      valor_rs    NUMERIC,
      pagamento   TEXT,
      analise_credito BOOLEAN DEFAULT FALSE,
      data_nasc   DATE,
      bairro      TEXT,
      motivacoes  TEXT,
      dores       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS crm_leads_client_id_idx ON public.crm_leads(client_id);
    CREATE INDEX IF NOT EXISTS crm_leads_data_idx ON public.crm_leads(data);
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'crm_leads'
          AND column_name = 'client_id' AND data_type = 'uuid'
      ) THEN
        ALTER TABLE public.crm_leads ALTER COLUMN client_id TYPE TEXT;
      END IF;
    END $$;
    ALTER TABLE public.crm_leads
      ADD COLUMN IF NOT EXISTS upload_id UUID,
      ADD COLUMN IF NOT EXISTS lead_date DATE,
      ADD COLUMN IF NOT EXISTS lead_name TEXT,
      ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS raw JSONB,
      ADD COLUMN IF NOT EXISTS origin TEXT,
      ADD COLUMN IF NOT EXISTS ctwa_clid TEXT,
      ADD COLUMN IF NOT EXISTS source_id TEXT,
      ADD COLUMN IF NOT EXISTS source_url TEXT,
      ADD COLUMN IF NOT EXISTS utm_source TEXT,
      ADD COLUMN IF NOT EXISTS utm_medium TEXT,
      ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
      ADD COLUMN IF NOT EXISTS utm_content TEXT,
      ADD COLUMN IF NOT EXISTS utm_term TEXT,
      ADD COLUMN IF NOT EXISTS campaign_name TEXT,
      ADD COLUMN IF NOT EXISTS adset_name TEXT,
      ADD COLUMN IF NOT EXISTS ad_name TEXT,
      ADD COLUMN IF NOT EXISTS creative_name TEXT,
      ADD COLUMN IF NOT EXISTS first_origin_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS instance_id TEXT,
      ADD COLUMN IF NOT EXISTS qualificado BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS qualificado_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS qualificado_por TEXT,
      ADD COLUMN IF NOT EXISTS engajado BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS engajado_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS temperatura TEXT,
      ADD COLUMN IF NOT EXISTS temperatura_atualizada_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ia_ultimo_analise TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ia_confianca_ultimo INTEGER,
      ADD COLUMN IF NOT EXISTS nota_atendimento SMALLINT,
      ADD COLUMN IF NOT EXISTS nota_atendimento_motivo TEXT,
      ADD COLUMN IF NOT EXISTS nota_atendimento_ajuste TEXT,
      ADD COLUMN IF NOT EXISTS nota_atendimento_trecho JSONB,
      ADD COLUMN IF NOT EXISTS nota_atendimento_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS time_interno BOOLEAN NOT NULL DEFAULT false;
  `);
}

// ⚠️ Memoizada: ALTER TABLE pede lock ACCESS EXCLUSIVE mesmo quando é no-op, e
// esta rota é caminho quente (o CRM faz poll a cada 3s). Sem isto, as chamadas
// concorrentes se enfileiram no lock da tabela e a rota estoura — foi o apagão do
// CRM em 16/09/2026. Ver src/lib/schema-memo.ts.
const ensureTable = memoizarSchema(ensureTableInterno);

/**
 * `raw` é a linha ORIGINAL da planilha importada — a tela nunca lê, e era o que
 * mais pesava: o CRM da Romanza baixava 24 MB por abertura (medido 09/10), num
 * CRM que agora roda no celular da recepção do cliente.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function semCru(row: any) {
  const { raw: _raw, ...resto } = row;
  void _raw;
  return resto;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const funnelId = searchParams.get('funnelId');
  const since    = searchParams.get('since');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    await ensureDefaultFunnel(pool, clientId);
    await ensureCrmMessagesSchema(pool);
    // Modo incremental: o CRM busca a lista completa ao abrir e, entre uma carga e
    // outra, só o que mudou. A Atmos tem 3.500+ leads (8,5 MB): baixar tudo a cada
    // 8 s travava a tela e, chegando no meio de um arraste, jogava o lead de volta.
    // ⚠️ Mesmos filtros da lista completa (funil + número válido + lead visível),
    // senão o incremental traz linha que a carga completa não mostra.
    if (since) {
      const { rows } = await pool.query(
        `SELECT l.*,
                COALESCE(l.lead_date, l.data) AS normalized_date,
                COALESCE(l.lead_name, l.nome) AS normalized_name,
                COALESCE(NULLIF(l.revenue, 0), l.valor_rs, 0)::float AS normalized_revenue,
                COALESCE(l.whatsapp_last_message_at, lm.last_contact_at, l.updated_at, l.created_at) AS last_contact_at
           FROM public.crm_leads l
           LEFT JOIN LATERAL (
             SELECT MAX(m.created_at) AS last_contact_at
               FROM public.crm_messages m
              WHERE m.lead_id = l.id
           ) lm ON true
          WHERE l.client_id = $1 AND l.updated_at > $2
            AND ($3::uuid IS NULL OR l.funnel_id = $3::uuid)
            AND (
              NULLIF(regexp_replace(COALESCE(l.numero, ''), '\\D', '', 'g'), '') IS NULL
              OR regexp_replace(l.numero, '\\D', '', 'g') ~ '^[0-9]{8,15}$'
            )
            AND ${leadVisivelCrmSql('l')}
          ORDER BY l.updated_at DESC`,
        [clientId, since, funnelId ?? null],
      );
      return Response.json(rows.map(semCru));
    }
    const { rows } = await pool.query(
      `WITH ranked AS (
        SELECT *,
          COALESCE(lead_date, data) AS normalized_date,
          COALESCE(lead_name, nome) AS normalized_name,
          COALESCE(NULLIF(revenue, 0), valor_rs, 0)::float AS normalized_revenue,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), ''), id::text)
            ORDER BY
              CASE WHEN $2::uuid IS NOT NULL AND funnel_id = $2::uuid THEN 0 ELSE 1 END,
              CASE WHEN funnel_id IS NOT NULL THEN 0 ELSE 1 END,
              COALESCE(updated_at, created_at) DESC,
              created_at DESC
          ) AS rn
        FROM public.crm_leads
        WHERE client_id = $1
          AND ($2::uuid IS NULL OR funnel_id = $2::uuid)
          -- Mostra: sem número (lead manual) OU número que, normalizado, tem 8-15
          -- dígitos. O filtro antigo (numero cru ~ 10-15 dígitos) escondia leads
          -- criados à mão com número formatado "(43) 99999-8888" ou vazio — eles
          -- entravam no banco e "sumiam" da lista no poll seguinte.
          AND (
            NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') IS NULL
            OR regexp_replace(numero, '\\D', '', 'g') ~ '^[0-9]{8,15}$'
          )
          -- Só quem é lead de verdade (lead-contagem.ts): conversa do Evolution sem
          -- rastro pago e "Paciente"/"Não lead" sem rastro ficam fora do Kanban e da
          -- lista. O inbox (chat) continua mostrando todas as conversas.
          AND ${leadVisivelCrmSql()}
      )
      SELECT ranked.*,
             COALESCE(ranked.whatsapp_last_message_at, lm.last_contact_at, ranked.updated_at, ranked.created_at) AS last_contact_at
      FROM ranked
      LEFT JOIN LATERAL (
        SELECT MAX(m.created_at) AS last_contact_at
          FROM public.crm_messages m
         WHERE m.lead_id = ranked.id
      ) lm ON true
      WHERE rn = 1
      ORDER BY COALESCE(normalized_date, data) DESC NULLS LAST, created_at DESC`,
      [clientId, funnelId ?? null]
    );
    return Response.json(rows.map(semCru));
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;
  const { clientId, ...f } = body as { clientId: string } & Record<string, unknown>;
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const fallbackFunnelId = await ensureDefaultFunnel(pool, clientId);
    // Funil informado tem de ser DESTE cliente (auditoria 2026-10-10).
    if (f.funnel_id) {
      const { rowCount } = await pool.query(`SELECT 1 FROM public.crm_funnels WHERE id::text = $1 AND client_id = $2`, [String(f.funnel_id), clientId]);
      if (!rowCount) return Response.json({ error: 'Funil não pertence a este cliente.' }, { status: 400 });
    }
    const fallbackStatus = await getFirstFunnelStageLabel(pool, String(f.funnel_id ?? fallbackFunnelId));
    // Normaliza o número na ENTRADA (só dígitos; vazio → NULL) — o webhook e o GET
    // já trabalham com número normalizado; sem isso, número digitado formatado
    // criava lead invisível pra listagem/dedup.
    const numeroNormalizado = String(f.numero ?? '').replace(/\D/g, '') || null;
    const { rows: [lead] } = await pool.query(
      `INSERT INTO public.crm_leads
        (client_id,mes,data,link_criativo,nome,numero,canal,emoji,
         dia1,dia2,dia3,dia4,status,data_agendada,video_dra,compareceu,
         observacao,orcamento,fechou,valor_rs,pagamento,analise_credito,
         data_nasc,bairro,motivacoes,dores,funnel_id,temperatura,time_interno)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       RETURNING *`,
      [
        clientId, f.mes??null, f.data||null, f.link_criativo??null,
        f.nome??null, numeroNormalizado, f.canal??null, f.emoji??null,
        f.dia1??false, f.dia2??false, f.dia3??false, f.dia4??false,
        f.status??fallbackStatus, f.data_agendada||null,
        f.video_dra??false, f.compareceu??false, f.observacao??null,
        f.orcamento||null, f.fechou??false, f.valor_rs||null,
        f.pagamento??null, f.analise_credito??false,
        f.data_nasc||null, f.bairro??null, f.motivacoes??null, f.dores??null,
        f.funnel_id??fallbackFunnelId, f.temperatura??null, f.time_interno === true,
      ]
    );
    // Responsável escolhido na criação conta como definido à mão (a integração
    // não reescreve). Fora do INSERT posicional de propósito: aquela lista de
    // 29 parâmetros já foi fonte de bug de posição.
    if (typeof f.responsavel === 'string' && f.responsavel.trim()) {
      await ensureColunasOperacao(pool);
      await pool.query(
        `UPDATE public.crm_leads SET responsavel = $2, responsavel_manual = TRUE WHERE id = $1`,
        [lead.id, f.responsavel.trim().slice(0, 120)],
      );
      lead.responsavel = f.responsavel.trim().slice(0, 120);
    }
    await registrarEventos(pool, {
      leadId: lead.id, clientId, autor: autorDaRequisicao(req),
      eventos: [{ tipo: 'criado', campo: null, de: null, para: [lead.nome, lead.status].filter(Boolean).join(' · ') }],
    });
    return Response.json(lead, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CRM POST error]', msg);
    return Response.json({ error: 'Não foi possível criar o lead.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  // Apaga TODOS os leads de um cliente — só administrador, conferido no banco.
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    await pool.query(`DELETE FROM public.crm_leads WHERE client_id = $1`, [clientId]);
    await pool.query(`DELETE FROM public.crm_uploads WHERE client_id = $1`, [clientId]).catch(() => null);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
