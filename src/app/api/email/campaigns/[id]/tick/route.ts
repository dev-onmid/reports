import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sendGmail } from '@/lib/gmail';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    // Load campaign
    const { rows: campRows } = await pool.query(
      `SELECT c.*, g.refresh_token
       FROM public.email_campaigns c
       JOIN public.google_connections g ON g.email = c.account_email AND g.account_type = 'gmail'
       WHERE c.id = $1 AND c.status = 'running'
         AND (c.next_tick_at IS NULL OR c.next_tick_at <= NOW())`,
      [id],
    );
    if (campRows.length === 0) return Response.json({ skipped: true });

    const camp = campRows[0] as {
      id: string; account_email: string; subject: string; body_html: string;
      interval_min: number; interval_max: number; refresh_token: string;
    };

    // Claim one pending recipient atomically
    const { rows: recipRows } = await pool.query(
      `UPDATE public.email_recipients
       SET status = 'sending'
       WHERE id = (
         SELECT id FROM public.email_recipients
         WHERE campaign_id = $1 AND status = 'pending'
         ORDER BY position ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, email, name`,
      [id],
    );
    if (recipRows.length === 0) {
      // No more pending — mark done
      await pool.query(
        `UPDATE public.email_campaigns SET status='done', finished_at=NOW() WHERE id=$1`,
        [id],
      );
      return Response.json({ done: true });
    }

    const recip = recipRows[0] as { id: string; email: string; name: string | null };

    // Replace template vars
    const html = camp.body_html
      .replace(/\{email\}/g, recip.email)
      .replace(/\{nome\}/g, recip.name ?? '');

    const result = await sendGmail(
      { email: camp.account_email, refreshToken: camp.refresh_token },
      { to: recip.email, toName: recip.name ?? undefined, subject: camp.subject, html },
    );

    const intervalMs = (camp.interval_min + Math.random() * (camp.interval_max - camp.interval_min)) * 1000;
    const nextTick = new Date(Date.now() + intervalMs).toISOString();

    if (result.ok) {
      await pool.query(
        `UPDATE public.email_recipients SET status='sent', sent_at=NOW() WHERE id=$1`,
        [recip.id],
      );
      await pool.query(
        `UPDATE public.email_campaigns SET sent=sent+1, next_tick_at=$1 WHERE id=$2`,
        [nextTick, id],
      );
    } else {
      await pool.query(
        `UPDATE public.email_recipients SET status='failed', error_msg=$1 WHERE id=$2`,
        [result.error ?? 'Erro desconhecido', recip.id],
      );
      await pool.query(
        `UPDATE public.email_campaigns SET failed=failed+1, next_tick_at=$1 WHERE id=$2`,
        [nextTick, id],
      );
    }

    return Response.json({ ok: result.ok, email: recip.email, error: result.error });
  } finally {
    await pool.end();
  }
}

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await _req.json() as { action: 'start' | 'pause' | 'cancel' };
  const pool = makeServerPool();
  try {
    if (body.action === 'start') {
      await pool.query(
        `UPDATE public.email_campaigns SET status='running', next_tick_at=NOW() WHERE id=$1`,
        [id],
      );
    } else if (body.action === 'pause') {
      await pool.query(`UPDATE public.email_campaigns SET status='paused' WHERE id=$1`, [id]);
    } else if (body.action === 'cancel') {
      await pool.query(`UPDATE public.email_campaigns SET status='cancelled' WHERE id=$1`, [id]);
    }
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
