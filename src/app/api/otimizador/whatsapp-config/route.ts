import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const KEYS = [
  'otimizador_whatsapp_zapi_client_id',
  'otimizador_whatsapp_group_jid',
  'otimizador_whatsapp_ativo',
  'otimizador_notificar_crise_apenas',
] as const;

type SettingsRow = { key: string; value: string | null };

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

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureSettingsTable(pool);
    const { rows } = await pool.query<SettingsRow>(
      `SELECT key, value FROM public.system_settings WHERE key = ANY($1)`,
      [KEYS],
    );

    const map: Record<string, string | null> = Object.fromEntries(KEYS.map((k) => [k, null]));
    for (const row of rows) map[row.key] = row.value;

    // Busca instâncias Evolution disponíveis para popular o select na UI
    const { rows: instances } = await pool.query<{ id: string; name: string; instance_id: string }>(
      `SELECT id, name, instance_id FROM public.zapi_clients WHERE provider = 'evolution' ORDER BY name`,
    ).catch(() => ({ rows: [] as { id: string; name: string; instance_id: string }[] }));

    return Response.json({
      zapi_client_id: map['otimizador_whatsapp_zapi_client_id'],
      group_jid: map['otimizador_whatsapp_group_jid'],
      ativo: map['otimizador_whatsapp_ativo'] === 'true',
      notificar_crise_apenas: map['otimizador_notificar_crise_apenas'] === 'true',
      instances_disponiveis: instances,
    });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    zapi_client_id?: string | null;
    group_jid?: string | null;
    ativo?: boolean;
    notificar_crise_apenas?: boolean;
    updated_by?: string;
  };

  const pool = makeServerPool();
  try {
    await ensureSettingsTable(pool);

    const updates: Array<[string, string | null]> = [
      ['otimizador_whatsapp_zapi_client_id', body.zapi_client_id ?? null],
      ['otimizador_whatsapp_group_jid', body.group_jid ?? null],
      ['otimizador_whatsapp_ativo', body.ativo ? 'true' : 'false'],
      ['otimizador_notificar_crise_apenas', body.notificar_crise_apenas ? 'true' : 'false'],
    ];

    for (const [key, value] of updates) {
      await pool.query(
        `INSERT INTO public.system_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [key, value, body.updated_by ?? null],
      );
    }

    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
