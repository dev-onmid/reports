import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  NICHE_BENCHMARKS,
  ensureNicheBenchmarksTable,
  loadNicheBenchmarks,
} from '@/lib/optimizer-benchmarks';
import type { OptimizerNiche } from '@/lib/optimizer';

// Benchmarks de custo por nicho — régua de referência usada quando o cliente não tem meta
// cadastrada. GET devolve os valores efetivos (default do arquivo + override do banco por cima)
// junto dos defaults, pra tela mostrar o que é padrão e o que foi ajustado. POST faz upsert.

export const dynamic = 'force-dynamic';

const NICHOS = Object.keys(NICHE_BENCHMARKS) as OptimizerNiche[];

const LABELS: Record<OptimizerNiche, string> = {
  odontologia: 'Odontologia / Saúde',
  estetica: 'Estética',
  gastronomia: 'Gastronomia / Food',
  advocacia: 'Advocacia',
  contabilidade: 'Contabilidade',
  ecommerce: 'E-commerce',
  industria: 'Indústria / B2B',
  agencia: 'Agência',
  outro: 'Outro (padrão geral)',
};

export async function GET() {
  const pool = makeServerPool();
  try {
    const efetivos = await loadNicheBenchmarks(pool);
    const itens = NICHOS.map((nicho) => ({
      nicho,
      label: LABELS[nicho],
      cpl_ideal: efetivos[nicho].cpl_ideal,
      cpl_maximo: efetivos[nicho].cpl_maximo,
      default_ideal: NICHE_BENCHMARKS[nicho].cpl_ideal,
      default_maximo: NICHE_BENCHMARKS[nicho].cpl_maximo,
    }));
    return Response.json({ itens });
  } finally {
    await pool.end().catch(() => {});
  }
}

type PostBody = {
  itens?: Array<{ nicho: string; cpl_ideal: number; cpl_maximo: number }>;
  updated_by?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as PostBody;
  const itens = (body.itens ?? []).filter((i) =>
    NICHOS.includes(i.nicho as OptimizerNiche)
    && Number.isFinite(Number(i.cpl_ideal)) && Number(i.cpl_ideal) > 0
    && Number.isFinite(Number(i.cpl_maximo)) && Number(i.cpl_maximo) > 0,
  );
  if (itens.length === 0) {
    return Response.json({ error: 'Nenhum benchmark válido enviado.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureNicheBenchmarksTable(pool);
    for (const i of itens) {
      // teto nunca menor que o ideal — normaliza antes de gravar
      const ideal = Number(i.cpl_ideal);
      const maximo = Math.max(Number(i.cpl_maximo), ideal);
      await pool.query(
        `INSERT INTO public.optimizer_niche_benchmarks (nicho, cpl_ideal, cpl_maximo, updated_at, updated_by)
         VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT (nicho) DO UPDATE SET
           cpl_ideal = EXCLUDED.cpl_ideal,
           cpl_maximo = EXCLUDED.cpl_maximo,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by`,
        [i.nicho, ideal, maximo, body.updated_by ?? null],
      );
    }
    return Response.json({ ok: true, salvos: itens.length });
  } finally {
    await pool.end().catch(() => {});
  }
}
