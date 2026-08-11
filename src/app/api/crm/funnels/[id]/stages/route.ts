import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { classificarEtapa, type EtapaFunil } from '@/lib/funil-etapas';

const ETAPAS_VALIDAS = new Set<string>(['contato', 'qualificado', 'agendamento', 'comparecimento', 'fechamento', 'perdido']);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    // Instalação anterior a etapa_funil: fallback sem a coluna (o editor então
    // auto-classifica pelo rótulo no client).
    const { rows } = await pool.query(
      `SELECT id, label, color, position, etapa_funil FROM public.crm_stages WHERE funnel_id = $1 ORDER BY position ASC`,
      [id],
    ).catch(() => pool.query(
      `SELECT id, label, color, position, NULL AS etapa_funil FROM public.crm_stages WHERE funnel_id = $1 ORDER BY position ASC`,
      [id],
    ));
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: funnelId } = await params;
  const { label, color = '#71717a', clientId, etapa_funil } = await req.json().catch(() => ({})) as {
    label?: string; color?: string; clientId?: string; etapa_funil?: string;
  };
  if (!label?.trim() || !clientId) return Response.json({ error: 'label and clientId required' }, { status: 400 });
  // Etapa nova nasce classificada: explícita se o editor mandou, senão pela
  // auto-classificação do rótulo (persistida, pra rename posterior não mudar
  // o funil por baixo de quem já conferiu).
  const etapa: EtapaFunil = ETAPAS_VALIDAS.has(etapa_funil ?? '')
    ? (etapa_funil as EtapaFunil)
    : classificarEtapa(label);

  const pool = makeServerPool();
  try {
    const { rows: [{ max_pos }] } = await pool.query(
      `SELECT COALESCE(MAX(position), -1)::int AS max_pos FROM public.crm_stages WHERE funnel_id = $1`,
      [funnelId],
    );
    const { rows: [stage] } = await pool.query(
      `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, label, color, position, etapa_funil`,
      [funnelId, clientId, label.trim(), color, (max_pos as number) + 1, etapa],
    );
    return Response.json(stage, { status: 201 });
  } finally {
    await pool.end();
  }
}
