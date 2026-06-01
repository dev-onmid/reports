import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmAiSchema } from '@/lib/crm-ai-analysis';

type Temperature = 'quente' | 'morno' | 'frio';

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureCrmAiSchema(pool);
    const { rows } = await pool.query(
      `SELECT client_id, temperatura, criterios
         FROM public.crm_temperatura_criterios
        WHERE client_id = $1 OR client_id IS NULL
        ORDER BY client_id NULLS LAST`,
      [clientId],
    );
    const defaults: Partial<Record<Temperature, string>> = {};
    const custom: Partial<Record<Temperature, string>> = {};
    for (const row of rows) {
      if (row.temperatura !== 'quente' && row.temperatura !== 'morno' && row.temperatura !== 'frio') continue;
      if (row.client_id === null) defaults[row.temperatura as Temperature] = row.criterios;
      else custom[row.temperatura as Temperature] = row.criterios;
    }
    return Response.json({
      useDefault: Object.keys(custom).length === 0,
      defaults,
      custom,
      effective: { ...defaults, ...custom },
    });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    clientId?: string;
    useDefault?: boolean;
    criterios?: Partial<Record<Temperature, string>>;
  };
  if (!body.clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureCrmAiSchema(pool);
    if (body.useDefault) {
      await pool.query(
        `DELETE FROM public.crm_temperatura_criterios WHERE client_id = $1`,
        [body.clientId],
      );
      return Response.json({ ok: true });
    }

    for (const temperatura of ['quente', 'morno', 'frio'] as const) {
      const criterios = body.criterios?.[temperatura]?.trim();
      if (!criterios) continue;
      await pool.query(
        `DELETE FROM public.crm_temperatura_criterios WHERE client_id = $1 AND temperatura = $2`,
        [body.clientId, temperatura],
      );
      await pool.query(
        `INSERT INTO public.crm_temperatura_criterios (client_id, temperatura, criterios)
         VALUES ($1, $2, $3)`,
        [body.clientId, temperatura, criterios],
      );
    }

    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
