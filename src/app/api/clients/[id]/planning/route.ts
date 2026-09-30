import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { normalizarCanais } from '@/lib/planejamento-canais';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_planning (
      client_id   TEXT PRIMARY KEY,
      tkm         NUMERIC NOT NULL DEFAULT 9000,
      cpl_meta    NUMERIC NOT NULL DEFAULT 30,
      stages      JSONB NOT NULL DEFAULT '[]',
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE public.client_planning ADD COLUMN IF NOT EXISTS simple_mode BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE public.client_planning ADD COLUMN IF NOT EXISTS inv_pla_simple NUMERIC NOT NULL DEFAULT 0`);
  // Divisão por canal: [{ id, share, cpl }]. Vazio = planejamento com um CPL só,
  // exatamente como era antes — a coluna não muda nada de quem não usa.
  await pool.query(`ALTER TABLE public.client_planning ADD COLUMN IF NOT EXISTS canais JSONB NOT NULL DEFAULT '[]'`);
  // Verba total do planejamento por canal. Coluna PRÓPRIA, longe de cpl_meta:
  // é a ÂNCORA que o gestor digita, e as fatias só a repartem. cpl_meta segue
  // guardando o CPL que o resto do sistema lê como meta.
  await pool.query(`ALTER TABLE public.client_planning ADD COLUMN IF NOT EXISTS investimento_total NUMERIC NOT NULL DEFAULT 0`);
}

const SELECT_COLS = `tkm::float, cpl_meta::float AS "cplMeta", stages, canais,
                     investimento_total::float AS "investimentoTotal",
                     simple_mode AS "simpleMode", inv_pla_simple::float AS "invPlaSimple"`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows: [row] } = await pool.query(
      `SELECT ${SELECT_COLS} FROM public.client_planning WHERE client_id = $1`,
      [id],
    );
    return Response.json(row ?? null);
  } finally {
    await pool.end();
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as {
    tkm: number; cplMeta: number; stages: unknown[];
    canais?: unknown; investimentoTotal?: number;
    simpleMode?: boolean; invPlaSimple?: number;
  };
  const verba = Number(body.investimentoTotal);
  const investimentoTotal = Number.isFinite(verba) ? Math.max(0, verba) : 0;
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows: [row] } = await pool.query(
      // cpl_meta continua sendo gravado, e com o valor DERIVADO quando há canais:
      // dez lugares do sistema leem essa coluna como "a meta de CPL do cliente"
      // (dashboard, Radar, relatório diário, funil por cidade, Luna). Deixá-la
      // com o número digitado antigo faria o resto do sistema cobrar uma meta
      // que a tela do planejamento não mostra mais.
      `INSERT INTO public.client_planning
         (client_id, tkm, cpl_meta, stages, canais, investimento_total, simple_mode, inv_pla_simple, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (client_id) DO UPDATE
         SET tkm = $2, cpl_meta = $3, stages = $4, canais = $5,
             investimento_total = $6, simple_mode = $7, inv_pla_simple = $8, updated_at = NOW()
       RETURNING ${SELECT_COLS}`,
      [id, body.tkm, body.cplMeta, JSON.stringify(body.stages),
       JSON.stringify(normalizarCanais(body.canais ?? [])),
       investimentoTotal, body.simpleMode ?? false, body.invPlaSimple ?? 0],
    );
    return Response.json(row);
  } finally {
    await pool.end();
  }
}
