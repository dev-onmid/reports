import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

type EvolutionGroup = {
  id: string;
  subject: string;
  size?: number;
};

export async function GET(req: NextRequest) {
  const zapiClientId = req.nextUrl.searchParams.get('zapiClientId') ?? '';
  if (!zapiClientId) return Response.json({ error: 'zapiClientId obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  let instanceName = '';
  try {
    const { rows } = await pool.query<{ instance_id: string }>(
      `SELECT instance_id FROM public.zapi_clients WHERE id = $1 AND provider = 'evolution'`,
      [zapiClientId],
    );
    instanceName = rows[0]?.instance_id ?? '';
  } finally {
    await pool.end();
  }

  if (!instanceName) return Response.json({ error: 'Instância Evolution não encontrada.' }, { status: 404 });

  const base = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY ?? '';

  const res = await fetch(
    `${base}/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`,
    { headers: { 'Content-Type': 'application/json', apikey: apiKey } },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return Response.json({ error: `Evolution API ${res.status}: ${text}` }, { status: 502 });
  }

  const raw = await res.json() as EvolutionGroup[] | { groups?: EvolutionGroup[] };
  const groups: EvolutionGroup[] = Array.isArray(raw) ? raw : (raw.groups ?? []);

  return Response.json(
    groups
      .filter((g) => g.id && g.subject)
      .map((g) => ({ jid: g.id, nome: g.subject, membros: g.size ?? null }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  );
}
