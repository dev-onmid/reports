import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sendGmail } from '@/lib/gmail';
import { injectTracking } from '@/lib/email-tracking';

// Vercel Cron: runs every minute
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = makeServerPool();
  const deadline = Date.now() + 25_000;
  let processed = 0;

  try {
    // ── 1. Process running campaigns ────────────────────────────────
    const { rows: campaigns } = await pool.query(
      `SELECT c.id, c.account_email, c.subject, c.body_html, c.interval_min, c.interval_max, g.refresh_token
       FROM public.email_campaigns c
       JOIN public.google_connections g ON g.email = c.account_email AND g.account_type = 'gmail'
       WHERE c.status = 'running' AND (c.next_tick_at IS NULL OR c.next_tick_at <= NOW())
       LIMIT 5`,
    );

    for (const camp of campaigns) {
      if (Date.now() > deadline) break;

      const { rows: recipRows } = await pool.query(
        `UPDATE public.email_recipients SET status='sending'
         WHERE id = (
           SELECT id FROM public.email_recipients
           WHERE campaign_id=$1 AND status='pending'
           ORDER BY position ASC LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING id, email, name`,
        [camp.id],
      );

      if (recipRows.length === 0) {
        await pool.query(
          `UPDATE public.email_campaigns SET status='done', finished_at=NOW() WHERE id=$1`,
          [camp.id],
        );
        continue;
      }

      const recip = recipRows[0] as { id: string; email: string; name: string | null };
      const html = injectTracking(
        (camp.body_html as string)
          .replace(/\{email\}/g, recip.email)
          .replace(/\{nome\}/g, recip.name ?? ''),
        recip.id,
      );

      const result = await sendGmail(
        { email: camp.account_email, refreshToken: camp.refresh_token },
        { to: recip.email, toName: recip.name ?? undefined, subject: camp.subject, html },
      );

      const intervalMs = (Number(camp.interval_min) + Math.random() * (Number(camp.interval_max) - Number(camp.interval_min))) * 1000;
      const nextTick = new Date(Date.now() + intervalMs).toISOString();

      if (result.ok) {
        await pool.query(`UPDATE public.email_recipients SET status='sent', sent_at=NOW() WHERE id=$1`, [recip.id]);
        await pool.query(`UPDATE public.email_campaigns SET sent=sent+1, next_tick_at=$1 WHERE id=$2`, [nextTick, camp.id]);
      } else {
        await pool.query(`UPDATE public.email_recipients SET status='failed', error_msg=$1 WHERE id=$2`, [result.error, recip.id]);
        await pool.query(`UPDATE public.email_campaigns SET failed=failed+1, next_tick_at=$1 WHERE id=$2`, [nextTick, camp.id]);
      }
      processed++;
    }

    // ── 2. Process flow contacts ────────────────────────────────────
    const { rows: flowContacts } = await pool.query(
      `SELECT fc.id, fc.flow_id, fc.email, fc.name, fc.current_step,
              f.account_email, g.refresh_token
       FROM public.email_flow_contacts fc
       JOIN public.email_flows f ON f.id = fc.flow_id
       JOIN public.google_connections g ON g.email = f.account_email AND g.account_type = 'gmail'
       WHERE fc.status = 'active' AND fc.next_send_at <= NOW() AND f.status = 'active'
       LIMIT 10`,
    );

    for (const fc of flowContacts) {
      if (Date.now() > deadline) break;

      const { rows: stepRows } = await pool.query(
        `SELECT subject, body_html, delay_days FROM public.email_flow_steps
         WHERE flow_id=$1 AND position=$2`,
        [fc.flow_id, fc.current_step],
      );

      if (stepRows.length === 0) {
        // No more steps — complete this contact
        await pool.query(`UPDATE public.email_flow_contacts SET status='completed' WHERE id=$1`, [fc.id]);
        continue;
      }

      const step = stepRows[0] as { subject: string; body_html: string; delay_days: number };
      const html = injectTracking(
        step.body_html
          .replace(/\{email\}/g, fc.email)
          .replace(/\{nome\}/g, fc.name ?? ''),
        fc.id,
      );

      const result = await sendGmail(
        { email: fc.account_email, refreshToken: fc.refresh_token },
        { to: fc.email, toName: fc.name ?? undefined, subject: step.subject, html },
      );

      if (result.ok) {
        // Advance to next step
        const { rows: nextStep } = await pool.query(
          `SELECT delay_days FROM public.email_flow_steps WHERE flow_id=$1 AND position=$2`,
          [fc.flow_id, Number(fc.current_step) + 1],
        );

        if (nextStep.length > 0) {
          const nextSend = new Date(Date.now() + nextStep[0].delay_days * 86_400_000).toISOString();
          await pool.query(
            `UPDATE public.email_flow_contacts SET current_step=$1, next_send_at=$2 WHERE id=$3`,
            [Number(fc.current_step) + 1, nextSend, fc.id],
          );
        } else {
          await pool.query(`UPDATE public.email_flow_contacts SET status='completed' WHERE id=$1`, [fc.id]);
        }
        processed++;
      }
    }

    // ── 3. Process graph flow contacts ─────────────────────────────
    const { rows: graphContacts } = await pool.query(
      `SELECT fc.id, fc.flow_id, fc.email, fc.name, fc.current_node_id,
              fc.graph_opens, fc.graph_clicks,
              f.nodes_json, f.edges_json, f.account_email AS flow_account_email
       FROM public.email_flow_contacts fc
       JOIN public.email_flows f ON f.id = fc.flow_id
       WHERE fc.status = 'active' AND fc.next_send_at <= NOW()
         AND f.status = 'active' AND f.flow_mode = 'graph'
       LIMIT 10`,
    );

    for (const fc of graphContacts) {
      if (Date.now() > deadline) break;

      type GNode = { id: string; type: string; data: Record<string, unknown> };
      type GEdge = { source: string; target: string; sourceHandle?: string };
      const gNodes = (fc.nodes_json ?? []) as GNode[];
      const gEdges = (fc.edges_json ?? []) as GEdge[];

      const currentNodeId: string = fc.current_node_id ?? 'start';
      const currentNode = gNodes.find((n) => n.id === currentNodeId);

      if (!currentNode) {
        await pool.query(`UPDATE public.email_flow_contacts SET status='completed' WHERE id=$1`, [fc.id]);
        continue;
      }

      const nextNode = (handle?: string): GNode | null => {
        const edge = gEdges.find((e) => e.source === currentNode.id && (handle ? e.sourceHandle === handle : !e.sourceHandle || true));
        if (!edge) return null;
        return gNodes.find((n) => n.id === edge.target) ?? null;
      };

      const advance = async (target: GNode | null) => {
        if (!target || target.type === 'end') {
          await pool.query(`UPDATE public.email_flow_contacts SET status='completed' WHERE id=$1`, [fc.id]);
        } else if (target.type === 'delay') {
          const delayMs = Number(target.data.days ?? 1) * 86_400_000;
          await pool.query(
            `UPDATE public.email_flow_contacts SET current_node_id=$1, next_send_at=$2 WHERE id=$3`,
            [target.id, new Date(Date.now() + delayMs).toISOString(), fc.id],
          );
        } else {
          await pool.query(
            `UPDATE public.email_flow_contacts SET current_node_id=$1, next_send_at=NOW() WHERE id=$2`,
            [target.id, fc.id],
          );
        }
      };

      if (currentNode.type === 'start' || currentNode.type === 'delay') {
        await advance(nextNode());
      } else if (currentNode.type === 'email') {
        const sendEmail = (currentNode.data.accountEmail as string) || (fc.flow_account_email as string);
        const { rows: tokenRows } = await pool.query(
          `SELECT refresh_token FROM public.google_connections WHERE email=$1 AND account_type='gmail'`,
          [sendEmail],
        );
        if (tokenRows.length === 0) continue;

        const html = injectTracking(
          ((currentNode.data.bodyHtml as string) ?? '')
            .replace(/\{email\}/g, fc.email as string)
            .replace(/\{nome\}/g, (fc.name as string) ?? ''),
          fc.id as string,
          'flow',
        );
        const result = await sendGmail(
          { email: sendEmail, refreshToken: tokenRows[0].refresh_token as string },
          { to: fc.email as string, toName: (fc.name as string) ?? undefined, subject: (currentNode.data.subject as string) ?? '', html },
        );
        if (result.ok) {
          await advance(nextNode());
          processed++;
        }
      } else if (currentNode.type === 'condition') {
        const met = currentNode.data.check === 'clicked'
          ? Number(fc.graph_clicks) > 0
          : Number(fc.graph_opens) > 0;
        const handle = met ? 'yes' : 'no';
        const edge = gEdges.find((e) => e.source === currentNode.id && e.sourceHandle === handle);
        const target = edge ? gNodes.find((n) => n.id === edge.target) ?? null : null;
        await advance(target);
      } else if (currentNode.type === 'end') {
        await pool.query(`UPDATE public.email_flow_contacts SET status='completed' WHERE id=$1`, [fc.id]);
      }
    }

    return Response.json({ ok: true, processed });
  } finally {
    await pool.end();
  }
}
