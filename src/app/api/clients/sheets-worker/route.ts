/**
 * Analisa a planilha do próximo cliente com sheets_url pendente.
 * Executa 1 cliente por chamada para não exceder timeout.
 * Configurar no cron-job.org: toda terça-feira, método POST.
 * Cron expression: 0 8 * * 2  (08:00 toda terça, a cada 5 min para processar todos)
 * Cada cliente é reanalisado no máximo 1x a cada 6 dias.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { analyzeClientSheets } from '@/app/api/clients/[id]/sheets/route';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    const urlSecret = new URL(req.url).searchParams.get('secret');
    if (auth !== `Bearer ${secret}` && urlSecret !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const googleApiKey = process.env.GOOGLE_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!googleApiKey || !anthropicKey) {
    return Response.json({ error: 'Variáveis de ambiente ausentes.' }, { status: 500 });
  }

  const pool = makeServerPool();
  try {
    await pool.query(`
      ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sheets_url TEXT;
      ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sheets_result JSONB;
      ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sheets_analyzed_at TIMESTAMPTZ;
    `);

    const { rows: [client] } = await pool.query(`
      SELECT id, name, sheets_url
        FROM public.clients
       WHERE sheets_url IS NOT NULL
         AND status = 'Ativo'
         AND (sheets_analyzed_at IS NULL OR sheets_analyzed_at < NOW() - INTERVAL '6 days')
       ORDER BY sheets_analyzed_at ASC NULLS FIRST
       LIMIT 1
    `);

    if (!client) {
      return Response.json({ ok: true, skipped: true, reason: 'Todos os clientes foram analisados esta semana.' });
    }

    const result = await analyzeClientSheets(client.sheets_url, googleApiKey, anthropicKey);

    await pool.query(
      `UPDATE public.clients SET sheets_result = $1, sheets_analyzed_at = NOW() WHERE id = $2`,
      [JSON.stringify(result), client.id]
    );

    return Response.json({ ok: true, clientId: client.id, clientName: client.name, total: result.total });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido.';
    return Response.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    await pool.end();
  }
}
