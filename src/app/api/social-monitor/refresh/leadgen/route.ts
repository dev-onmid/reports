// Rotina da carteira: garante que a Página de TODO cliente ativo esteja
// mapeada e assinada em `leadgen` — é o "automático" que o Matheus pediu
// ("qualquer formulário vinculado à página entra no CRM, sem selecionar").
//
// ⚠️ Mora DEBAIXO de /api/social-monitor/refresh de propósito: o proxy libera
// cron por PREFIXO e esse prefixo já está em CRON_PREFIXES — assim a rota nasce
// sem tocar no proxy.ts (que estava com trabalho de outra sessão no dia).
// Semanticamente é o mesmo "refresh" do monitor: relê a Página de cada cliente.
//
// GET ?secret=… (ou Bearer) — mesma família de segredos dos outros crons.
// ?dry=1 não existe: a operação é idempotente e sem efeito colateral fora da
// Meta (assinar Página já assinada é no-op).
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { garantirLeadgenParaTodos } from '@/lib/meta-leadgen-forms';

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
  const inicio = Date.now();
  const pool = makeServerPool();
  try {
    const r = await garantirLeadgenParaTodos(pool, 240_000);
    return Response.json({ ok: true, tookMs: Date.now() - inicio, ...r });
  } catch (e) {
    return Response.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
