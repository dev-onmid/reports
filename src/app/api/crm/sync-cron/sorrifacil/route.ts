import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { lerConfig, sincronizarSorrifacil } from '@/lib/sorrifacil-sync';

// Importação diária do CRM Sorrifácil (planilhas de Faturamento e Leads).
// Mora sob /api/crm/sync-cron porque esse prefixo já está em CRON_PREFIXES do
// proxy — o cron da VPS chama com ?secret=, a tela chama com sessão.

export const maxDuration = 300;

/** Cron (VPS). Respeita o interruptor "ativo" da configuração. */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') ?? '';
  const valid = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET].filter(Boolean);
  if (valid.length === 0 || !valid.includes(secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const pool = makeServerPool();
  try {
    const cfg = await lerConfig(pool);
    if (!cfg.ativo) return Response.json({ ok: true, skipped: 'desativado' });
    return Response.json(await sincronizarSorrifacil(pool));
  } finally {
    await pool.end();
  }
}

/** "Sincronizar agora" da tela — roda mesmo com a rotina diária desligada. */
export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });
    return Response.json(await sincronizarSorrifacil(pool));
  } finally {
    await pool.end();
  }
}
