import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
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
      ADD COLUMN IF NOT EXISTS raw JSONB;
  `);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const since    = url.searchParams.get('since');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = since
      ? await pool.query(
          `SELECT * FROM public.crm_leads WHERE client_id = $1 AND updated_at > $2 ORDER BY updated_at DESC`,
          [clientId, since],
        )
      : await pool.query(
          `SELECT *,
              COALESCE(lead_date, data) AS normalized_date,
              COALESCE(lead_name, nome) AS normalized_name,
              COALESCE(NULLIF(revenue, 0), valor_rs, 0)::float AS normalized_revenue
             FROM public.crm_leads
            WHERE client_id = $1
            ORDER BY COALESCE(lead_date, data) DESC NULLS LAST, created_at DESC`,
          [clientId],
        );
    return Response.json(rows);
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
    const { rows: [lead] } = await pool.query(
      `INSERT INTO public.crm_leads
        (client_id,mes,data,link_criativo,nome,numero,canal,emoji,
         dia1,dia2,dia3,dia4,status,data_agendada,video_dra,compareceu,
         observacao,orcamento,fechou,valor_rs,pagamento,analise_credito,
         data_nasc,bairro,motivacoes,dores)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING *`,
      [
        clientId, f.mes??null, f.data||null, f.link_criativo??null,
        f.nome??null, f.numero??null, f.canal??null, f.emoji??null,
        f.dia1??false, f.dia2??false, f.dia3??false, f.dia4??false,
        f.status??'Em Atendimento', f.data_agendada||null,
        f.video_dra??false, f.compareceu??false, f.observacao??null,
        f.orcamento||null, f.fechou??false, f.valor_rs||null,
        f.pagamento??null, f.analise_credito??false,
        f.data_nasc||null, f.bairro??null, f.motivacoes??null, f.dores??null,
      ]
    );
    return Response.json(lead, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CRM POST error]', msg);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
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
