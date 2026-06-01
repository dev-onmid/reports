import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureSchema(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_followup_regras (
      id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id      TEXT    NOT NULL,
      nome           TEXT    NOT NULL,
      status_gatilho TEXT    NOT NULL,
      ativo          BOOLEAN NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.crm_followup_mensagens (
      id                       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      regra_id                 UUID    NOT NULL REFERENCES public.crm_followup_regras(id) ON DELETE CASCADE,
      ordem                    INT     NOT NULL DEFAULT 1,
      tipo                     TEXT    NOT NULL DEFAULT 'texto',
      conteudo                 TEXT    NOT NULL DEFAULT '',
      delay_minutos            INT     NOT NULL DEFAULT 0,
      timer_sem_resposta_horas NUMERIC NOT NULL DEFAULT 24,
      acao_sem_resposta        TEXT    NOT NULL DEFAULT 'mover_status',
      status_destino           TEXT,
      created_at               TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.crm_followup_execucoes (
      id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id       UUID    NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
      client_id     TEXT    NOT NULL,
      regra_id      UUID    NOT NULL REFERENCES public.crm_followup_regras(id) ON DELETE CASCADE,
      mensagem_id   UUID    NOT NULL REFERENCES public.crm_followup_mensagens(id) ON DELETE CASCADE,
      status        TEXT    NOT NULL DEFAULT 'aguardando_envio',
      scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      enviado_em    TIMESTAMPTZ,
      expira_em     TIMESTAMPTZ,
      respondido_em TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE public.crm_followup_mensagens ADD COLUMN IF NOT EXISTS partes JSONB;

    CREATE INDEX IF NOT EXISTS idx_followup_regras_client ON public.crm_followup_regras(client_id);
    CREATE INDEX IF NOT EXISTS idx_followup_exec_lead ON public.crm_followup_execucoes(lead_id);
    CREATE INDEX IF NOT EXISTS idx_followup_exec_status ON public.crm_followup_execucoes(status);
    CREATE INDEX IF NOT EXISTS idx_followup_exec_scheduled ON public.crm_followup_execucoes(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_followup_exec_expira ON public.crm_followup_execucoes(expira_em);
  `);
}

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    const { rows } = await pool.query(
      `SELECT r.id, r.nome, r.status_gatilho, r.ativo, r.created_at,
              COUNT(m.id)::int AS total_mensagens
         FROM public.crm_followup_regras r
         LEFT JOIN public.crm_followup_mensagens m ON m.regra_id = r.id
        WHERE r.client_id = $1
        GROUP BY r.id
        ORDER BY r.created_at ASC`,
      [clientId],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const { clientId, nome, status_gatilho } = await req.json().catch(() => ({})) as {
    clientId?: string; nome?: string; status_gatilho?: string;
  };
  if (!clientId || !nome?.trim() || !status_gatilho?.trim()) {
    return Response.json({ error: 'clientId, nome e status_gatilho são obrigatórios' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    const { rows: [regra] } = await pool.query(
      `INSERT INTO public.crm_followup_regras (client_id, nome, status_gatilho)
       VALUES ($1, $2, $3) RETURNING id, nome, status_gatilho, ativo, created_at`,
      [clientId, nome.trim(), status_gatilho.trim()],
    );
    return Response.json({ ...regra, total_mensagens: 0 }, { status: 201 });
  } finally {
    await pool.end();
  }
}
