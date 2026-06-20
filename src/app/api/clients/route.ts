import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureColumns(pool: ReturnType<typeof makeServerPool>) {
  // Ensure categories table and seed defaults
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_categories (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL UNIQUE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  for (const name of ['Clínica', 'Serviço', 'Delivery/Fast Food']) {
    await pool.query(
      `INSERT INTO public.client_categories (name, is_default) VALUES ($1, TRUE) ON CONFLICT (name) DO NOTHING`,
      [name],
    ).catch(() => {});
  }

  await pool.query('ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gestor_id TEXT').catch(() => {});
  await pool.query(`ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS ads_billing_mode TEXT NOT NULL DEFAULT 'prepaid'`).catch(() => {});
  await pool.query('ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.client_categories(id)').catch(() => {});
  await pool.query(`ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS dashboard_type TEXT NOT NULL DEFAULT 'leads'`).catch(() => {});
  // Default TRUE so every pre-existing client stays fully accessible — only clients
  // created through the mandatory onboarding wizard (/clientes/novo) get FALSE explicitly.
  await pool.query(`ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT true`).catch(() => {});
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJson(r: any) {
  return {
    id: r.id,
    name: r.name,
    segment: r.segment,
    status: r.status,
    gestor_id: r.gestor_id ?? null,
    gestor_name: r.gestor_name ?? null,
    ads_billing_mode: r.ads_billing_mode ?? 'prepaid',
    category_id: r.category_id ?? null,
    category_name: r.category_name ?? null,
    dashboard_type: r.dashboard_type ?? 'leads',
    onboarding_completed: r.onboarding_completed ?? true,
  };
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureColumns(pool);
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.segment, c.status, c.gestor_id, c.ads_billing_mode,
             c.category_id, c.dashboard_type, c.onboarding_completed, u.name as gestor_name, cat.name as category_name
      FROM public.clients c
      LEFT JOIN public.users u ON c.gestor_id = u.id
      LEFT JOIN public.client_categories cat ON cat.id = c.category_id
      ORDER BY c.name ASC
    `);
    return Response.json(rows.map(rowToJson));
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    id: string; name: string; segment: string; status: string;
    gestor_id?: string; category_id?: string; dashboard_type?: string; onboarding_completed?: boolean;
  };
  const pool = makeServerPool();
  try {
    await ensureColumns(pool);
    const { rows } = await pool.query(
      `INSERT INTO public.clients (id, name, segment, status, gestor_id, category_id, dashboard_type, onboarding_completed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET name = $2, segment = $3, status = $4, gestor_id = $5,
         category_id = COALESCE($6, clients.category_id),
         dashboard_type = COALESCE($7, clients.dashboard_type)
       RETURNING id, name, segment, status, gestor_id, category_id, dashboard_type, onboarding_completed`,
      [body.id, body.name, body.segment, body.status, body.gestor_id ?? null,
       body.category_id ?? null, body.dashboard_type ?? 'leads', body.onboarding_completed ?? true]
    );
    const row = rows[0];
    let gestor_name = null;
    if (row.gestor_id) {
      const { rows: u } = await pool.query('SELECT name FROM public.users WHERE id = $1', [row.gestor_id]);
      gestor_name = u[0]?.name ?? null;
    }
    let category_name = null;
    if (row.category_id) {
      const { rows: cat } = await pool.query('SELECT name FROM public.client_categories WHERE id = $1', [row.category_id]);
      category_name = cat[0]?.name ?? null;
    }
    return Response.json(rowToJson({ ...row, gestor_name, category_name }), { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  const body = await req.json() as Partial<{
    name: string; segment: string; status: string;
    gestor_id: string | null; category_id: string | null; dashboard_type: string;
    onboarding_completed: boolean;
  }>;
  const pool = makeServerPool();
  try {
    await ensureColumns(pool);
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (body.name           !== undefined) { sets.push(`name = $${idx++}`);           vals.push(body.name); }
    if (body.segment        !== undefined) { sets.push(`segment = $${idx++}`);        vals.push(body.segment); }
    if (body.status         !== undefined) { sets.push(`status = $${idx++}`);         vals.push(body.status); }
    if (body.gestor_id      !== undefined) { sets.push(`gestor_id = $${idx++}`);      vals.push(body.gestor_id); }
    if (body.category_id    !== undefined) { sets.push(`category_id = $${idx++}`);    vals.push(body.category_id); }
    if (body.dashboard_type !== undefined) { sets.push(`dashboard_type = $${idx++}`); vals.push(body.dashboard_type); }
    if (body.onboarding_completed !== undefined) { sets.push(`onboarding_completed = $${idx++}`); vals.push(body.onboarding_completed); }
    if (sets.length === 0) return Response.json({ error: 'Nothing to update' }, { status: 400 });
    vals.push(id);
    await pool.query(`UPDATE public.clients SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.clients WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
