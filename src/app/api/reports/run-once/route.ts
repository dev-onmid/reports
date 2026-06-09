import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { buildOmniReport, saveOmniReport } from '@/lib/report-builder';
import { buildDeliveryReport, saveDeliveryReport } from '@/lib/delivery-report-builder';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      clientId?: string; from?: string; to?: string; manualNotes?: string;
      agencyContext?: string; template?: string; csvContent?: string;
    };

    const { clientId, from, to, manualNotes, agencyContext, template, csvContent } = body;
    if (!clientId || !from || !to) {
      return Response.json({ error: 'clientId, from e to são obrigatórios' }, { status: 400 });
    }

    // Resolve client name
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

    // ── Delivery template ──────────────────────────────────────────────────────
    if (template === 'delivery') {
      if (!csvContent) {
        return Response.json({ error: 'csvContent é obrigatório para o template Delivery' }, { status: 400 });
      }

      const reportData = await buildDeliveryReport({ clientId, clientName, from, to, csvContent, agencyContext });
      const { token, reportId } = await saveDeliveryReport({ clientId, clientName, from, to, data: reportData });
      return Response.json({ ok: true, id: reportId, public_token: token });
    }

    // ── Performance template (default) ────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

    const reportData = await buildOmniReport({
      clientId,
      clientName,
      connectionId: metaConnectionId,
      accountIds: metaAccountIds,
      periodFrom: from,
      periodTo: to,
      agencyContext: agencyContext ?? manualNotes,
      apiKey,
    });

    const { id, public_token } = await saveOmniReport({
      clientId, clientName, periodFrom: from, periodTo: to,
      reportData, generatedBy: 'manual',
    });

    return Response.json({ ok: true, id, public_token });

  } catch (err) {
    console.error('[run-once] erro:', err);
    const message = err instanceof Error ? err.message : 'Erro interno ao gerar relatório.';
    return Response.json({ error: message }, { status: 500 });
  }
}
