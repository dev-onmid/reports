import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.account_email, c.name, c.subject, c.status, c.scheduled_at, c.finished_at,
              c.total, c.sent, c.failed, c.interval_min, c.interval_max, c.created_at,
              COALESCE(SUM(r.open_count), 0)::int  AS total_opens,
              COUNT(r.id) FILTER (WHERE r.open_count > 0)::int  AS unique_opens,
              COALESCE(SUM(r.click_count), 0)::int AS total_clicks,
              COUNT(r.id) FILTER (WHERE r.click_count > 0)::int AS unique_clicks
       FROM public.email_campaigns c
       LEFT JOIN public.email_recipients r ON r.campaign_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC LIMIT 100`,
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
