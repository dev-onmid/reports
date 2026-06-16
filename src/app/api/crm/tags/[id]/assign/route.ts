import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { leadIds } = await req.json() as { leadIds: string[] };
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return Response.json({ error: 'leadIds é obrigatório.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await pool.query(
      `INSERT INTO public.crm_lead_tag_assignments (lead_id, tag_id)
       SELECT unnest($1::uuid[]), $2::uuid
       ON CONFLICT DO NOTHING`,
      [leadIds, id],
    );
    return Response.json({ ok: true, assigned: leadIds.length });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { leadIds } = await req.json() as { leadIds: string[] };
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return Response.json({ error: 'leadIds é obrigatório.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await pool.query(
      `DELETE FROM public.crm_lead_tag_assignments WHERE tag_id = $1 AND lead_id = ANY($2::uuid[])`,
      [id, leadIds],
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
