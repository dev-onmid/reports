import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import type { ReportData } from '@/components/report-slides/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows: [row] } = await pool.query(
      `SELECT id, client_id, client_name, title, period_from, period_to, report_data, generated_by, created_at
         FROM public.diagnostic_reports WHERE id = $1`,
      [id],
    );
    if (!row) return Response.json({ error: 'Relatório não encontrado' }, { status: 404 });

    const data: ReportData = {
      ...(row.report_data as ReportData),
      id: row.id,
      createdAt: row.created_at,
    };
    return Response.json(data);
  } finally {
    await pool.end();
  }
}
