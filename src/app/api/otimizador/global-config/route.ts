import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

// Interruptor GERAL do Otimizador (system_settings.optimizer_auto_enabled).
// Desligado: o cron semanal (rodízio automático) não roda nenhuma análise.
// Análises manuais pela tela ("Analisar esta conta"/"Analisar todos") continuam funcionando.

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
      `SELECT value FROM public.system_settings WHERE key = 'optimizer_auto_enabled'`,
    );
    return Response.json({ ativo: rows[0]?.value !== 'false' });
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { ativo?: boolean };
  if (typeof body.ativo !== 'boolean') {
    return Response.json({ error: 'ativo (boolean) é obrigatório' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });

    await ensureSettingsTable(pool);
    await pool.query(
      `INSERT INTO public.system_settings (key, value, updated_at)
       VALUES ('optimizer_auto_enabled', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [body.ativo ? 'true' : 'false'],
    );
    return Response.json({ ok: true, ativo: body.ativo });
  } finally {
    await pool.end();
  }
}
