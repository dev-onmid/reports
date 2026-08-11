import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ETAPAS_PADRAO } from '@/lib/funil-etapas';

// Fonte única dos seeds (com a etapa semântica do Funil de Performance) —
// compartilhada com o seed gêmeo de crm-conversation-sync.ts.
const DEFAULT_STAGES = ETAPAS_PADRAO;

async function ensureSchema(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_funnels (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id  TEXT NOT NULL,
      name       TEXT NOT NULL DEFAULT 'Funil Principal',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.crm_stages (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      funnel_id  UUID NOT NULL REFERENCES public.crm_funnels(id) ON DELETE CASCADE,
      client_id  TEXT NOT NULL,
      label      TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#71717a',
      position   INT  NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS funnel_id UUID REFERENCES public.crm_funnels(id) ON DELETE SET NULL;
    ALTER TABLE public.crm_stages ADD COLUMN IF NOT EXISTS etapa_funil TEXT;
    CREATE INDEX IF NOT EXISTS crm_funnels_client_id_idx ON public.crm_funnels(client_id);
    CREATE INDEX IF NOT EXISTS crm_stages_funnel_id_idx ON public.crm_stages(funnel_id);
    CREATE INDEX IF NOT EXISTS crm_leads_funnel_id_idx ON public.crm_leads(funnel_id);
  `);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);

    const { rows: funnels } = await pool.query(
      `SELECT id, name, created_at FROM public.crm_funnels WHERE client_id = $1 ORDER BY created_at ASC`,
      [clientId],
    );

    // Auto-create default funnel and assign all legacy leads to it
    if (funnels.length === 0) {
      const { rows: [funnel] } = await pool.query(
        `INSERT INTO public.crm_funnels (client_id, name) VALUES ($1, 'Funil Principal') RETURNING id, name, created_at`,
        [clientId],
      );
      for (const s of DEFAULT_STAGES) {
        await pool.query(
          `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil) VALUES ($1, $2, $3, $4, $5, $6)`,
          [funnel.id, clientId, s.label, s.color, s.position, s.etapa],
        );
      }
      await pool.query(
        `UPDATE public.crm_leads SET funnel_id = $1 WHERE client_id = $2 AND funnel_id IS NULL`,
        [funnel.id, clientId],
      );
      funnels.push(funnel);
    }

    return Response.json(funnels);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const { clientId, name } = await req.json().catch(() => ({})) as { clientId?: string; name?: string };
  if (!clientId || !name?.trim()) return Response.json({ error: 'clientId and name required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);

    const { rows: [funnel] } = await pool.query(
      `INSERT INTO public.crm_funnels (client_id, name) VALUES ($1, $2) RETURNING id, name, created_at`,
      [clientId, name.trim()],
    );
    for (const s of DEFAULT_STAGES) {
      await pool.query(
        `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil) VALUES ($1, $2, $3, $4, $5, $6)`,
        [funnel.id, clientId, s.label, s.color, s.position, s.etapa],
      );
    }
    return Response.json(funnel, { status: 201 });
  } finally {
    await pool.end();
  }
}
