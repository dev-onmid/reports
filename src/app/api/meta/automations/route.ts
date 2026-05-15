import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    // Ensure config table + global row exist so verify_token is always available
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.meta_webhook_config (
        id TEXT PRIMARY KEY DEFAULT 'global',
        verify_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex')
      );
      INSERT INTO public.meta_webhook_config (id) VALUES ('global') ON CONFLICT DO NOTHING;

      CREATE TABLE IF NOT EXISTS public.meta_automations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id TEXT,
        account_id TEXT NOT NULL,
        account_name TEXT,
        platform TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        keyword TEXT,
        action TEXT NOT NULL,
        reply_message TEXT NOT NULL,
        dm_message TEXT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.meta_automation_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        automation_id UUID,
        platform TEXT,
        event_type TEXT,
        account_id TEXT,
        sender_id TEXT,
        trigger_text TEXT,
        action_taken TEXT,
        status TEXT NOT NULL DEFAULT 'success',
        error_msg TEXT,
        triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows } = await pool.query(
      `SELECT * FROM public.meta_automations ORDER BY created_at DESC`
    );
    const { rows: [cfg] } = await pool.query(
      `SELECT verify_token FROM public.meta_webhook_config WHERE id = 'global'`
    );

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
