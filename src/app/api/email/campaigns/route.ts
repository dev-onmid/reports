import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, account_email, name, subject, status, scheduled_at, finished_at,
              total, sent, failed, interval_min, interval_max, created_at
       FROM public.email_campaigns ORDER BY created_at DESC LIMIT 100`,
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    accountEmail: string;
    name: string;
    subject: string;
    bodyHtml: string;
    recipients: Array<{ email: string; name?: string }>;
    scheduledAt?: string;
    intervalMin?: number;
    intervalMax?: number;
  };

  const { accountEmail, name, subject, bodyHtml, recipients, scheduledAt, intervalMin = 10, intervalMax = 30 } = body;
  if (!accountEmail || !name || !subject || !bodyHtml || !recipients?.length) {
    return Response.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.email_campaigns
         (account_email, name, subject, body_html, status, scheduled_at, total, interval_min, interval_max)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8)
       RETURNING id`,
      [accountEmail, name, subject, bodyHtml, scheduledAt ?? null, recipients.length, intervalMin, intervalMax],
    );
    const campaignId = rows[0].id as string;

    for (let i = 0; i < recipients.length; i++) {
      await pool.query(
        `INSERT INTO public.email_recipients (campaign_id, email, name, position) VALUES ($1,$2,$3,$4)`,
        [campaignId, recipients[i].email, recipients[i].name ?? null, i],
      );
    }

    return Response.json({ id: campaignId }, { status: 201 });
  } finally {
    await pool.end();
  }
}
