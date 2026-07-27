import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { ensureBalanceAlertTables } from '@/lib/balance-alert-configs';

export async function GET(request: NextRequest) {
  const pool = makeServerPool();
  try {
    // These rows point at WhatsApp groups and can trigger real sends, so they
    // are admin-only — the endpoints used to be fully open.
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });

    await ensureBalanceAlertTables(pool);
    const { rows } = await pool.query(`
      SELECT bac.id, bac.whatsapp_group, bac.zapi_client_id, bac.active, bac.created_at,
             bac.dias_antecedencia, bac.email_to,
             z.name AS zapi_name, z.provider AS zapi_provider
      FROM public.balance_alert_configs bac
      LEFT JOIN public.zapi_clients z ON z.id = bac.zapi_client_id
      ORDER BY bac.created_at DESC
    `);
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    whatsappGroup: string; zapiClientId: string; diasAntecedencia?: number; emailTo?: string;
  };
  if (!body.whatsappGroup || !body.zapiClientId) {
    return Response.json({ error: 'whatsappGroup e zapiClientId são obrigatórios' }, { status: 400 });
  }
  const dias = Math.min(30, Math.max(1, Math.round(Number(body.diasAntecedencia) || 3)));

  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });

    await ensureBalanceAlertTables(pool);
    const { rows } = await pool.query(
      `INSERT INTO public.balance_alert_configs (whatsapp_group, zapi_client_id, dias_antecedencia, email_to)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.whatsappGroup, body.zapiClientId, dias, body.emailTo?.trim() || null],
    );
    return Response.json(rows[0]);
  } finally {
    await pool.end();
  }
}
