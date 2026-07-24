import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

// Sincronização de RESERVA do CRM rodando no SERVIDOR (cron GitHub Actions a cada
// 10 min) — antes ela só existia dentro do chat-view (browser), então o inbox só
// "andava" com alguém logado. O webhook continua sendo o caminho primário em tempo
// real; este cron garante que, mesmo se o webhook falhar, as conversas de TODOS os
// clientes com instância Evolution ativa entram sozinhas no banco.
//
// Por cliente: (1) webhook-heal (reaponta webhook errado pra URL canônica) e
// (2) import do inbox (mesma rota POST /api/crm/inbox que o botão "Carregar mais
// conversas" usa) — reuso via HTTP interno, zero lógica duplicada.

export const maxDuration = 300;

function appOrigin(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://reports.onmid.app')
    .trim().replace(/\/$/, '');
}

type ClientResult = {
  client_id: string;
  name: string | null;
  healed?: number;
  imported?: number;
  error?: string;
  skipped?: boolean;
};

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') ?? '';
  const valid = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter(Boolean);
  if (valid.length === 0 || !valid.includes(secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const deadlineMs = 240_000; // orçamento; maxDuration=300 dá folga pro flush
  const origin = appOrigin();

  const pool = makeServerPool();
  let clients: Array<{ client_id: string; name: string | null }> = [];
  try {
    // CRM de cliente é sempre Evolution (Z-API é uso interno da agência) — o cron
    // só sincroniza quem tem instância Evolution ativa vinculada ao CRM.
    const { rows } = await pool.query<{ client_id: string; name: string | null }>(
      `SELECT DISTINCT i.client_id, c.name
         FROM public.client_zapi_instances i
         LEFT JOIN public.clients c ON c.id = i.client_id
        WHERE i.ativo = TRUE AND i.provider = 'evolution'
        ORDER BY c.name ASC NULLS LAST`,
    );
    clients = rows;
  } catch (err) {
    await pool.end();
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
  await pool.end();

  const results: ClientResult[] = [];
  for (const client of clients) {
    if (Date.now() - started > deadlineMs) {
      results.push({ ...client, skipped: true });
      continue;
    }
    const entry: ClientResult = { ...client };
    try {
      // 1) Cura do webhook (best-effort — falha aqui não impede o import)
      try {
        const heal = await fetch(`${origin}/api/crm/webhook-heal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: client.client_id }),
          signal: AbortSignal.timeout(30_000),
        });
        const healJson = await heal.json().catch(() => null) as { healed?: number } | null;
        entry.healed = healJson?.healed ?? 0;
      } catch { /* best-effort */ }

      // 2) Import das conversas direto da Evolution (mesma rota do botão manual)
      const imp = await fetch(`${origin}/api/crm/inbox?clientId=${encodeURIComponent(client.client_id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
        signal: AbortSignal.timeout(90_000),
      });
      const impJson = await imp.json().catch(() => null) as { imported?: number; error?: string } | null;
      if (!imp.ok) {
        entry.error = impJson?.error ?? `HTTP ${imp.status}`;
      } else {
        entry.imported = impJson?.imported ?? 0;
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
    }
    results.push(entry);
  }

  const summary = {
    ok: true,
    clients: clients.length,
    synced: results.filter(r => r.imported !== undefined).length,
    skipped: results.filter(r => r.skipped).length,
    errors: results.filter(r => r.error).length,
    tookMs: Date.now() - started,
    results,
  };
  console.log('[crm sync-cron]', JSON.stringify(summary));
  return Response.json(summary);
}
