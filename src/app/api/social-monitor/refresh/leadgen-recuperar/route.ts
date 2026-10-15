// Recupera leads de FORMULÁRIO da Meta que o webhook não entregou.
//
// ⚠️ Mora DEBAIXO de /api/social-monitor/refresh pelo mesmo motivo da rota
// irmã `leadgen`: o proxy libera cron por PREFIXO e esse já está em
// CRON_PREFIXES — a rota nasce sem tocar no proxy.ts.
//
// GET ?secret=… (ou Bearer)
//   &clientId=…  um cliente só (padrão: toda a carteira com Página assinada)
//   &dias=30     janela para trás (1–400)
//   &dry=1       só conta o que entraria, sem criar nada
//
// É idempotente: a dedupe por `leadgen:{id}` faz rodada repetida não duplicar.
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { recuperarLeadsDaCarteira, recuperarLeadsDoCliente } from '@/lib/meta-leadgen-recuperar';

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const urlSecret = req.nextUrl.searchParams.get('secret');
  const authHeader = req.headers.get('authorization') ?? '';
  const secrets = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter((s): s is string => !!s);
  if (secrets.length === 0) return false;
  return secrets.some(s => urlSecret === s || authHeader === `Bearer ${s}`);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const clientId = sp.get('clientId');
  const dias = Number(sp.get('dias') ?? 30);
  const dry = sp.get('dry') === '1';
  const inicio = Date.now();
  const pool = makeServerPool();
  try {
    const opts = { dias: Number.isFinite(dias) ? dias : 30, dry, orcamentoMs: 240_000 };
    if (clientId) {
      const r = await recuperarLeadsDoCliente(pool, clientId, opts);
      return Response.json({ ok: true, dry, tookMs: Date.now() - inicio, ...r });
    }
    const r = await recuperarLeadsDaCarteira(pool, opts);
    return Response.json({ ok: true, dry, tookMs: Date.now() - inicio, ...r });
  } catch (e) {
    return Response.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
