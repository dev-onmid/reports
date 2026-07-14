import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureOptimizerClientConfigTable } from '@/lib/optimizer';

export type OptimizerClientConfig = {
  client_id: string;
  modo_operacao: 'DIAGNOSTICO_APENAS' | 'RECOMENDACAO_COM_APROVACAO' | 'AUTOMATICO_PARCIAL' | 'AUTOMATICO_TOTAL';
  acoes_pre_aprovadas: string[];
  orcamento_diario_maximo: number | null;
  cpr_emergencia: number | null;
  min_conjuntos_ativos: number;
  max_conjuntos_ativos: number;
  min_dias_aprendizado: number;
  analise_dia_semana: number;
  ativo: boolean;
  observacoes_fixas: string | null;
  updated_at: string;
};

const MODOS_VALIDOS = ['DIAGNOSTICO_APENAS', 'RECOMENDACAO_COM_APROVACAO', 'AUTOMATICO_PARCIAL', 'AUTOMATICO_TOTAL'];
// Vocabulário canônico das ações pré-aprovadas — tem que bater com a checagem de auto-execução
// em sanitizeOptimizerOutputV2 (procura 'pausar' | 'ativar' | 'ajustar_orcamento_reduzir') e com
// ACOES_PRE_APROVADAS_OPCOES na UI. Antes esta lista usava 'pausar_conjunto' etc., que a UI nunca
// enviava → o filtro descartava tudo e nenhuma ação pré-aprovada era salva.
const ACOES_VALIDAS = ['pausar', 'ativar', 'ajustar_orcamento_reduzir'];

async function autoAssignDay(pool: ReturnType<typeof makeServerPool>): Promise<number> {
  const { rows } = await pool.query<{ analise_dia_semana: number; total: string }>(
    `SELECT analise_dia_semana, COUNT(*)::text AS total
       FROM public.optimizer_client_config
      WHERE ativo = true
      GROUP BY analise_dia_semana
      ORDER BY analise_dia_semana`,
  ).catch(() => ({ rows: [] as { analise_dia_semana: number; total: string }[] }));

  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) {
    const day = Number(row.analise_dia_semana);
    if (day >= 1 && day <= 5) counts[day] = Number(row.total);
  }
  return Number(Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0]);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params;
  const pool = makeServerPool();
  try {
    await ensureOptimizerClientConfigTable(pool);
    const { rows } = await pool.query<OptimizerClientConfig>(
      `SELECT client_id, modo_operacao, acoes_pre_aprovadas, orcamento_diario_maximo,
              cpr_emergencia, min_conjuntos_ativos, max_conjuntos_ativos,
              min_dias_aprendizado, analise_dia_semana, ativo, observacoes_fixas, updated_at
         FROM public.optimizer_client_config
        WHERE client_id = $1`,
      [clientId],
    );

    if (rows.length === 0) {
      const day = await autoAssignDay(pool);
      return Response.json({
        client_id: clientId,
        modo_operacao: 'RECOMENDACAO_COM_APROVACAO',
        acoes_pre_aprovadas: [],
        orcamento_diario_maximo: null,
        cpr_emergencia: null,
        min_conjuntos_ativos: 1,
        max_conjuntos_ativos: 20,
        min_dias_aprendizado: 7,
        analise_dia_semana: day,
        ativo: true,
        observacoes_fixas: null,
        updated_at: new Date().toISOString(),
      } satisfies OptimizerClientConfig);
    }

    return Response.json(rows[0]);
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params;
  const body = await req.json().catch(() => ({})) as Partial<OptimizerClientConfig> & { updated_by?: string };

  const pool = makeServerPool();
  try {
    await ensureOptimizerClientConfigTable(pool);
    const { rows: existing } = await pool.query<{ analise_dia_semana: number }>(
      `SELECT analise_dia_semana FROM public.optimizer_client_config WHERE client_id = $1`,
      [clientId],
    );

    const currentDay = existing[0]?.analise_dia_semana ?? await autoAssignDay(pool);
    const dia = Number(body.analise_dia_semana ?? currentDay);
    const modo = MODOS_VALIDOS.includes(body.modo_operacao ?? '') ? body.modo_operacao : 'RECOMENDACAO_COM_APROVACAO';
    const acoes = (body.acoes_pre_aprovadas ?? []).filter((a) => ACOES_VALIDAS.includes(a));

    const { rows } = await pool.query<OptimizerClientConfig>(
      `INSERT INTO public.optimizer_client_config
         (client_id, modo_operacao, acoes_pre_aprovadas, orcamento_diario_maximo,
          cpr_emergencia, min_conjuntos_ativos, max_conjuntos_ativos,
          min_dias_aprendizado, analise_dia_semana, ativo, observacoes_fixas, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12)
       ON CONFLICT (client_id) DO UPDATE SET
         modo_operacao         = EXCLUDED.modo_operacao,
         acoes_pre_aprovadas   = EXCLUDED.acoes_pre_aprovadas,
         orcamento_diario_maximo = EXCLUDED.orcamento_diario_maximo,
         cpr_emergencia        = EXCLUDED.cpr_emergencia,
         min_conjuntos_ativos  = EXCLUDED.min_conjuntos_ativos,
         max_conjuntos_ativos  = EXCLUDED.max_conjuntos_ativos,
         min_dias_aprendizado  = EXCLUDED.min_dias_aprendizado,
         analise_dia_semana    = EXCLUDED.analise_dia_semana,
         ativo                 = EXCLUDED.ativo,
         observacoes_fixas     = EXCLUDED.observacoes_fixas,
         updated_at            = NOW(),
         updated_by            = EXCLUDED.updated_by
       RETURNING *`,
      [
        clientId,
        modo,
        acoes,
        body.orcamento_diario_maximo ?? null,
        body.cpr_emergencia ?? null,
        body.min_conjuntos_ativos ?? 1,
        body.max_conjuntos_ativos ?? 20,
        body.min_dias_aprendizado ?? 7,
        dia >= 1 && dia <= 5 ? dia : currentDay,
        body.ativo ?? true,
        (body.observacoes_fixas ?? '').trim().slice(0, 2000) || null,
        body.updated_by ?? null,
      ],
    );

    return Response.json(rows[0]);
  } finally {
    await pool.end();
  }
}
