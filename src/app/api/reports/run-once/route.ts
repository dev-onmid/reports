import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { buildOmniReport, saveOmniReport } from '@/lib/report-builder';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    clientId?: string; from?: string; to?: string; manualNotes?: string;
  };

  const { clientId, from, to, manualNotes } = body;
  if (!clientId || !from || !to) {
    return Response.json({ error: 'clientId, from e to são obrigatórios' }, { status: 400 });
  }

  const pool = makeServerPool();
  let clientName = '';
  let metaConnectionId: string | null = null;
  let metaAccountIds: string[] = [];

  try {
    const { rows: clientRows } = await pool.query(
      `SELECT name FROM public.clients WHERE id = $1`, [clientId],
    );
    if (!clientRows[0]) return Response.json({ error: 'Cliente não encontrado' }, { status: 404 });
    clientName = clientRows[0].name as string;

    const { rows: links } = await pool.query(
      `SELECT platform, connection_id, account_id FROM public.client_account_links WHERE client_id = $1`,
      [clientId],
    );
    const metaLinks = links.filter((l: { platform: string }) => l.platform === 'meta');
    metaConnectionId = (metaLinks[0] as { connection_id: string } | undefined)?.connection_id ?? null;
    metaAccountIds = metaLinks.map((l: { account_id: string }) => l.account_id);
  } finally {
    await pool.end();
  }

  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

  const reportData = await buildOmniReport({
    clientId,
    clientName,
    connectionId: metaConnectionId,
    accountIds: metaAccountIds,
    periodFrom: from,
    periodTo: to,
    manualNotes,
    apiKey,
  });

  const { id, public_token } = await saveOmniReport({
    clientId, clientName, periodFrom: from, periodTo: to,
    reportData, generatedBy: 'manual',
  });

  return Response.json({ ok: true, id, public_token });
}
