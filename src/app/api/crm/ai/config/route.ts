import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { ensureCrmAiSchema } from '@/lib/crm-ai-analysis';

// Liga/desliga a análise de IA do CRM (a que muda etapa/temperatura dos leads).
// GET  → { global_ativa }
// PATCH { global_ativa: boolean }            → interruptor geral (system_settings.crm_ai_enabled)
// PATCH { clientId: string, ia_ativa: bool } → interruptor por cliente (client_tracking_config.ia_ativa)

async function ensureSettingsTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.system_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
}

export async function GET(request: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });

    await ensureSettingsTable(pool);
    const { rows } = await pool.query<{ value: string | null }>(
      `SELECT value FROM public.system_settings WHERE key = 'crm_ai_enabled'`,
    );
    return Response.json({ global_ativa: rows[0]?.value !== 'false' });
  } finally {
    await pool.end();
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    global_ativa?: boolean;
    clientId?: string;
    ia_ativa?: boolean;
  };

  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });

    if (typeof body.global_ativa === 'boolean') {
      await ensureSettingsTable(pool);
      await pool.query(
        `INSERT INTO public.system_settings (key, value, updated_at)
         VALUES ('crm_ai_enabled', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [body.global_ativa ? 'true' : 'false'],
      );
      return Response.json({ ok: true, global_ativa: body.global_ativa });
    }

    if (body.clientId && typeof body.ia_ativa === 'boolean') {
      await ensureCrmAiSchema(pool);
      await pool.query(
        `INSERT INTO public.client_tracking_config (client_id, ia_ativa)
         VALUES ($1, $2)
         ON CONFLICT (client_id) DO UPDATE SET ia_ativa = EXCLUDED.ia_ativa, updated_at = NOW()`,
        [body.clientId, body.ia_ativa],
      );
      return Response.json({ ok: true, clientId: body.clientId, ia_ativa: body.ia_ativa });
    }

    return Response.json({ error: 'Informe global_ativa OU clientId + ia_ativa' }, { status: 400 });
  } finally {
    await pool.end();
  }
}
