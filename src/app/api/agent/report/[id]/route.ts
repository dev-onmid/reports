import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.agent_report_files (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      pdf_data   BYTEA       NOT NULL,
      filename   TEXT        NOT NULL,
      client_name TEXT       NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
    )
  `);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      `SELECT pdf_data, filename FROM public.agent_report_files
       WHERE id = $1 AND expires_at > NOW()`,
      [id]
    );
    if (!rows[0]) {
      return new Response('Relatório não encontrado ou expirado.', { status: 404 });
    }
    return new Response(new Uint8Array(rows[0].pdf_data as Buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${rows[0].filename as string}"`,
        'Cache-Control': 'private, max-age=604800',
      },
    });
  } finally {
    await pool.end();
  }
}
