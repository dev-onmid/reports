import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { classificarEtapa, SITUACOES_STAGE, type EtapaFunil, type SituacaoStage } from '@/lib/funil-etapas';

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
      `SELECT id, label, color, position, etapa_funil, situacao FROM public.crm_stages WHERE funnel_id = $1 ORDER BY position ASC`,
      [id],
    ).catch(() => pool.query(
      `SELECT id, label, color, position, NULL AS etapa_funil, NULL AS situacao FROM public.crm_stages WHERE funnel_id = $1 ORDER BY position ASC`,
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
  const { label, color = '#71717a', clientId, etapa_funil, situacao, position } = await req.json().catch(() => ({})) as {
    label?: string; color?: string; clientId?: string; etapa_funil?: string; situacao?: string; position?: number;
  };
  if (!label?.trim() || !clientId) return Response.json({ error: 'label and clientId required' }, { status: 400 });
  // Etapa nova nasce classificada: explícita se o editor mandou, senão pela
  // auto-classificação do rótulo (persistida, pra rename posterior não mudar
  // o funil por baixo de quem já conferiu).
  const etapa: EtapaFunil = ETAPAS_VALIDAS.has(etapa_funil ?? '')
    ? (etapa_funil as EtapaFunil)
    : classificarEtapa(label);
  // Situação só quando o editor mandou; outros chamadores deixam NULL (= auto).
  const sit: SituacaoStage | null = SITUACOES_STAGE.includes(situacao as SituacaoStage) ? (situacao as SituacaoStage) : null;

  const pool = makeServerPool();
  try {
    // ⚠️ Posição vem do editor quando ele manda: etapa criada JÁ ARRASTADA pro
    // meio do funil precisa nascer ali. Sem isto o INSERT jogava em MAX+1 e a
    // coluna voltava pro fim no primeiro refresh — o gestor arrastava, salvava,
    // recarregava e via a ordem antiga. Sem posição (outros chamadores), segue
    // o comportamento antigo de acrescentar no fim.
    const posExplicita = Number.isInteger(position) && (position as number) >= 0
      ? (position as number)
      : null;
    const { rows: [{ max_pos }] } = await pool.query(
      `SELECT COALESCE(MAX(position), -1)::int AS max_pos FROM public.crm_stages WHERE funnel_id = $1`,
      [funnelId],
    );
    const { rows: [stage] } = await pool.query(
      `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil, situacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, label, color, position, etapa_funil, situacao`,
      [funnelId, clientId, label.trim(), color, posExplicita ?? (max_pos as number) + 1, etapa, sit],
    );
    return Response.json(stage, { status: 201 });
  } finally {
    await pool.end();
  }
}
