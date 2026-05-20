import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.mc_automations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      nodes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      edges_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.mc_automation_contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      automation_id UUID NOT NULL REFERENCES public.mc_automations(id) ON DELETE CASCADE,
      name TEXT,
      email TEXT,
      whatsapp TEXT,
      instagram_id TEXT,
      current_node_id TEXT NOT NULL DEFAULT 'trigger',
      next_send_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'active',
      email_opens INTEGER NOT NULL DEFAULT 0,
      email_clicks INTEGER NOT NULL DEFAULT 0,
      whatsapp_replied BOOLEAN NOT NULL DEFAULT false,
      instagram_replied BOOLEAN NOT NULL DEFAULT false,
      context_json JSONB DEFAULT '{}'::jsonb,
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.mc_automation_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      automation_id UUID NOT NULL REFERENCES public.mc_automations(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query(`
      SELECT a.id, a.name, a.status, a.created_at,
             t.token,
             COUNT(c.id) FILTER (WHERE c.status = 'active') AS active_contacts,
             COUNT(c.id) AS total_contacts
      FROM public.mc_automations a
      LEFT JOIN public.mc_automation_tokens t ON t.automation_id = a.id
      LEFT JOIN public.mc_automation_contacts c ON c.automation_id = a.id
      GROUP BY a.id, a.name, a.status, a.created_at, t.token
      ORDER BY a.created_at DESC
    `);
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { name: string; nodesJson?: unknown[]; edgesJson?: unknown[] };
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query(
      `INSERT INTO public.mc_automations (name, nodes_json, edges_json)
       VALUES ($1, $2, $3)
       RETURNING id, name, status, created_at`,
      [
        body.name,
        JSON.stringify(body.nodesJson ?? []),
        JSON.stringify(body.edgesJson ?? []),
      ],
    );
    const automation = rows[0] as { id: string; name: string; status: string; created_at: string };
    const { rows: tokenRows } = await pool.query(
      `INSERT INTO public.mc_automation_tokens (automation_id) VALUES ($1) RETURNING token`,
      [automation.id],
    );
    return Response.json({ ...automation, token: tokenRows[0].token });
  } finally {
    await pool.end();
  }
}
