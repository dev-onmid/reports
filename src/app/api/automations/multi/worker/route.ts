import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sendGmail } from '@/lib/gmail';
import { sendText as sendWhatsapp } from '@/lib/zapi';
import { sendInstagramDM } from '@/lib/instagram-dm';
import { injectTracking } from '@/lib/email-tracking';
import { getFreshMetaToken } from '@/lib/meta-token';

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
    const { rows: contacts } = await pool.query(`
      SELECT
        c.id, c.automation_id, c.name, c.email, c.whatsapp, c.instagram_id,
        c.current_node_id, c.email_opens, c.email_clicks,
        c.whatsapp_replied, c.instagram_replied,
        a.nodes_json, a.edges_json
      FROM public.mc_automation_contacts c
      JOIN public.mc_automations a ON a.id = c.automation_id
      WHERE c.status = 'active' AND c.next_send_at <= NOW() AND a.status = 'active'
      LIMIT 10
    `);

    type MCNode = { id: string; type: string; data: Record<string, unknown> };
    type MCEdge = { source: string; target: string; sourceHandle?: string };

    for (const contact of contacts) {
      if (Date.now() > deadline) break;

      const nodes = (contact.nodes_json ?? []) as MCNode[];
      const edges = (contact.edges_json ?? []) as MCEdge[];
      const currentNodeId: string = contact.current_node_id ?? 'trigger';
      const currentNode = nodes.find((n) => n.id === currentNodeId);

      if (!currentNode) {
        await pool.query(`UPDATE public.mc_automation_contacts SET status='completed' WHERE id=$1`, [contact.id]);
        continue;
      }

      const getNextNode = (handle?: string): MCNode | null => {
        const edge = edges.find((e) => e.source === currentNode.id && (handle ? e.sourceHandle === handle : true));
        if (!edge) return null;
        return nodes.find((n) => n.id === edge.target) ?? null;
      };

      const advance = async (target: MCNode | null) => {
        if (!target || target.type === 'end') {
          await pool.query(`UPDATE public.mc_automation_contacts SET status='completed' WHERE id=$1`, [contact.id]);
        } else if (target.type === 'delay') {
          const value = Number(target.data.value ?? 1);
          const unit = (target.data.unit as string) ?? 'days';
          const ms = unit === 'hours' ? value * 3_600_000 : value * 86_400_000;
          await pool.query(
            `UPDATE public.mc_automation_contacts SET current_node_id=$1, next_send_at=$2 WHERE id=$3`,
            [target.id, new Date(Date.now() + ms).toISOString(), contact.id],
          );
        } else {
          await pool.query(
            `UPDATE public.mc_automation_contacts SET current_node_id=$1, next_send_at=NOW() WHERE id=$2`,
            [target.id, contact.id],
          );
        }
      };

      // ── Handle each node type ────────────────────────────────────────
      if (currentNode.type === 'trigger' || currentNode.type === 'delay') {
        await advance(getNextNode());

      } else if (currentNode.type === 'email') {
        const accountEmail = currentNode.data.accountEmail as string;
        if (!accountEmail || !contact.email) {
          await advance(getNextNode());
          continue;
        }
        const { rows: tokenRows } = await pool.query(
          `SELECT refresh_token FROM public.google_connections WHERE email=$1 AND account_type='gmail'`,
          [accountEmail],
        );
        if (tokenRows.length === 0) continue;

        const html = injectTracking(
          ((currentNode.data.bodyHtml as string) ?? '')
            .replace(/\{email\}/g, contact.email as string)
            .replace(/\{nome\}/g, (contact.name as string) ?? ''),
          contact.id as string,
          'flow',
        );
        const result = await sendGmail(
          { email: accountEmail, refreshToken: tokenRows[0].refresh_token as string },
          { to: contact.email as string, toName: (contact.name as string) ?? undefined, subject: (currentNode.data.subject as string) ?? '', html },
        );
        if (result.ok) {
          await advance(getNextNode());
          processed++;
        }

      } else if (currentNode.type === 'whatsapp') {
        const clientId = currentNode.data.clientId as string;
        const message = (currentNode.data.message as string) ?? '';
        if (!clientId || !contact.whatsapp) {
          await advance(getNextNode());
          continue;
        }
        const { rows: zapiRows } = await pool.query(
          `SELECT instance_id, token, security_token FROM public.zapi_clients WHERE id=$1 AND active=true`,
          [clientId],
        );
        if (zapiRows.length === 0) continue;
        const { instance_id, token, security_token } = zapiRows[0] as { instance_id: string; token: string; security_token: string };
        const result = await sendWhatsapp(
          { instanceId: instance_id, token, clientToken: security_token },
          contact.whatsapp as string,
          message
            .replace(/\{nome\}/g, (contact.name as string) ?? '')
            .replace(/\{email\}/g, (contact.email as string) ?? ''),
        );
        if (result.ok) {
          await advance(getNextNode());
          processed++;
        }

      } else if (currentNode.type === 'instagram') {
        const metaConnId = currentNode.data.metaConnectionId as string;
        const message = (currentNode.data.message as string) ?? '';
        if (!metaConnId || !contact.instagram_id) {
          await advance(getNextNode());
          continue;
        }
        const { rows: metaRows } = await pool.query(
          `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id=$1`,
          [metaConnId],
        );
        if (metaRows.length === 0) continue;
        const conn = metaRows[0] as { id: string; app_id: string; access_token: string; token_expiry: string | null };
        const freshToken = await getFreshMetaToken(conn);

        // Get the IG business account ID from the page
        const igRes = await fetch(
          `https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account{id}&access_token=${freshToken}`,
        );
        const igData = await igRes.json() as { data?: { instagram_business_account?: { id: string } }[] };
        const igUserId = igData.data?.find((d) => d.instagram_business_account)?.instagram_business_account?.id;
        if (!igUserId) continue;

        const result = await sendInstagramDM(
          igUserId,
          contact.instagram_id as string,
          message
            .replace(/\{nome\}/g, (contact.name as string) ?? '')
            .replace(/\{email\}/g, (contact.email as string) ?? ''),
          freshToken,
        );
        if (result.ok) {
          await advance(getNextNode());
          processed++;
        }

      } else if (currentNode.type === 'condition') {
        const check = currentNode.data.check as string;
        let met = false;
        if (check === 'email_opened') met = Number(contact.email_opens) > 0;
        else if (check === 'email_clicked') met = Number(contact.email_clicks) > 0;
        else if (check === 'whatsapp_replied') met = Boolean(contact.whatsapp_replied);
        else if (check === 'instagram_replied') met = Boolean(contact.instagram_replied);

        const handle = met ? 'yes' : 'no';
        const edge = edges.find((e) => e.source === currentNode.id && e.sourceHandle === handle);
        const target = edge ? nodes.find((n) => n.id === edge.target) ?? null : null;
        await advance(target);

      } else if (currentNode.type === 'end') {
        await pool.query(`UPDATE public.mc_automation_contacts SET status='completed' WHERE id=$1`, [contact.id]);
      }
    }

    return Response.json({ ok: true, processed });
  } finally {
    await pool.end();
  }
}
