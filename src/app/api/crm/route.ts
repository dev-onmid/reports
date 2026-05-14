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
  `);
}

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      `SELECT * FROM public.crm_leads WHERE client_id = $1 ORDER BY data DESC NULLS LAST, created_at DESC`,
      [clientId]
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
  } finally {
    await pool.end();
  }
}
