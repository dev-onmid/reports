import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS public.client_monthly_summaries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   TEXT NOT NULL,
    month       INT  NOT NULL,
    year        INT  NOT NULL,
    summary     TEXT NOT NULL,
    meta_spend  NUMERIC,
    google_spend NUMERIC,
    total_leads INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(client_id, month, year)
  )
`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const pool = makeServerPool();
  try {
    await pool.query(ENSURE_TABLE);
    const { rows } = await pool.query(
      `SELECT id::text, month, year, summary, meta_spend, google_spend, total_leads, created_at
       FROM public.client_monthly_summaries
       WHERE client_id = $1
       ORDER BY year DESC, month DESC
       LIMIT 24`,
      [clientId]
    );
    return Response.json({ summaries: rows });
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const body = await req.json() as {
    month: number; year: number; summary: string;
    meta_spend?: number; google_spend?: number; total_leads?: number;
  };
  const pool = makeServerPool();
  try {
    await pool.query(ENSURE_TABLE);
    const { rows } = await pool.query(
      `INSERT INTO public.client_monthly_summaries
         (client_id, month, year, summary, meta_spend, google_spend, total_leads)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (client_id, month, year) DO UPDATE
         SET summary = $4, meta_spend = $5, google_spend = $6,
             total_leads = $7, created_at = NOW()
       RETURNING id::text, month, year, summary, meta_spend, google_spend, total_leads, created_at`,
      [clientId, body.month, body.year, body.summary,
       body.meta_spend ?? null, body.google_spend ?? null, body.total_leads ?? null]
    );
    return Response.json(rows[0], { status: 201 });
  } finally {
    await pool.end();
  }
}
