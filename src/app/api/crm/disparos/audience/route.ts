import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmDisparoSchema } from '@/lib/crm-disparo';
import { parsePhoneList } from '@/lib/phone-formatter';

export type AudienceFilter = {
  clientId: string;
  funnelId?: string;
  stageLabels?: string[];
  tagIds?: string[];
  origin?: string[];
  temperatura?: string[];
  manualNumbers?: string;
};

export async function resolveAudience(pool: ReturnType<typeof makeServerPool>, filter: AudienceFilter) {
  if (filter.manualNumbers?.trim()) {
    const parsed = parsePhoneList(filter.manualNumbers);
    return parsed.map((p, i) => ({ leadId: null as string | null, phone: p.phone, nome: p.name || null, position: i }));
  }

  const conditions: string[] = ['client_id = $1', `numero IS NOT NULL`, `numero <> ''`];
  const params: unknown[] = [filter.clientId];

  if (filter.funnelId) {
    params.push(filter.funnelId);
    conditions.push(`funnel_id = $${params.length}::uuid`);
  }
  if (filter.stageLabels?.length) {
    params.push(filter.stageLabels);
    conditions.push(`status = ANY($${params.length}::text[])`);
  }
  if (filter.origin?.length) {
    params.push(filter.origin);
    conditions.push(`origin = ANY($${params.length}::text[])`);
  }
  if (filter.temperatura?.length) {
    params.push(filter.temperatura);
    conditions.push(`temperatura = ANY($${params.length}::text[])`);
  }
  if (filter.tagIds?.length) {
    params.push(filter.tagIds);
    conditions.push(`id IN (
      SELECT lead_id FROM public.crm_lead_tag_assignments WHERE tag_id = ANY($${params.length}::uuid[])
    )`);
  }

  const { rows } = await pool.query<{ id: string; numero: string; nome: string | null }>(
    `SELECT id, numero, nome FROM public.crm_leads WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`,
    params,
  );

  return rows.map((r, i) => ({ leadId: r.id, phone: r.numero, nome: r.nome, position: i }));
}

export async function POST(req: NextRequest) {
  const filter = await req.json() as AudienceFilter;
  if (!filter.clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureCrmDisparoSchema(pool);
    const audience = await resolveAudience(pool, filter);
    return Response.json({ count: audience.length, leads: audience.slice(0, 200) });
  } finally {
    await pool.end();
  }
}
