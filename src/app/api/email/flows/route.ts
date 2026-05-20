import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.account_email, f.name, f.status, f.flow_mode, f.created_at,
              COUNT(DISTINCT s.id)::int AS steps_count,
              COUNT(DISTINCT c.id) FILTER (WHERE c.status='active')::int AS active_contacts
       FROM public.email_flows f
       LEFT JOIN public.email_flow_steps s ON s.flow_id = f.id
       LEFT JOIN public.email_flow_contacts c ON c.flow_id = f.id
       GROUP BY f.id ORDER BY f.created_at DESC`,
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
    // linear mode
    steps?: Array<{ subject: string; bodyHtml: string; delayDays: number }>;
    contacts?: Array<{ email: string; name?: string }>;
    // graph mode
    flowMode?: 'linear' | 'graph';
    nodesJson?: unknown[];
    edgesJson?: unknown[];
  };

  const { accountEmail, name, steps, contacts, flowMode, nodesJson, edgesJson } = body;
  if (!accountEmail || !name) {
    return Response.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
  }
  const isGraph = flowMode === 'graph';
  if (!isGraph && !steps?.length) {
    return Response.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    let flowId: string;

    if (isGraph) {
      const { rows } = await pool.query(
        `INSERT INTO public.email_flows (account_email, name, flow_mode, nodes_json, edges_json)
         VALUES ($1,$2,'graph',$3::jsonb,$4::jsonb) RETURNING id`,
        [accountEmail, name, JSON.stringify(nodesJson ?? []), JSON.stringify(edgesJson ?? [])],
      );
      flowId = rows[0].id as string;
    } else {
      const { rows } = await pool.query(
        `INSERT INTO public.email_flows (account_email, name) VALUES ($1,$2) RETURNING id`,
        [accountEmail, name],
      );
      flowId = rows[0].id as string;

      for (let i = 0; i < (steps ?? []).length; i++) {
        await pool.query(
          `INSERT INTO public.email_flow_steps (flow_id, position, subject, body_html, delay_days)
           VALUES ($1,$2,$3,$4,$5)`,
          [flowId, i, steps![i].subject, steps![i].bodyHtml, steps![i].delayDays],
        );
      }
    }

    for (const contact of (contacts ?? [])) {
      await pool.query(
        `INSERT INTO public.email_flow_contacts (flow_id, email, name, current_node_id, next_send_at)
         VALUES ($1,$2,$3,'start',NOW())`,
        [flowId, contact.email, contact.name ?? null],
      );
    }

    return Response.json({ id: flowId }, { status: 201 });
  } finally {
    await pool.end();
  }
}
