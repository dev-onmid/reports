import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT * FROM public.meta_automations ORDER BY created_at DESC`
    );
    // Also return verify token for setup instructions
    const { rows: [cfg] } = await pool.query(
      `SELECT verify_token FROM public.meta_webhook_config WHERE id = 'global'`
    ).catch(() => ({ rows: [null] }));

    return Response.json({ automations: rows, verifyToken: cfg?.verify_token ?? null });
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    client_id?: string;
    account_id: string;
    account_name?: string;
    platform: string;
    trigger_type: string;
    keyword?: string;
    action: string;
    reply_message: string;
    dm_message?: string;
  };

  if (!body.account_id || !body.platform || !body.trigger_type || !body.action || !body.reply_message) {
    return Response.json({ error: 'Campos obrigatórios faltando' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.meta_automations
         (client_id, account_id, account_name, platform, trigger_type, keyword, action, reply_message, dm_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        body.client_id ?? null,
        body.account_id,
        body.account_name ?? null,
        body.platform,
        body.trigger_type,
        body.keyword ?? null,
        body.action,
        body.reply_message,
        body.dm_message ?? null,
      ]
    );
    return Response.json(row, { status: 201 });
  } finally {
    await pool.end();
  }
}
