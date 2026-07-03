import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { buildOmniReport, saveOmniReport } from '@/lib/report-builder';
import { buildDeliveryReport, saveDeliveryReport, type MetaBreakdownLevel } from '@/lib/delivery-report-builder';
import { buildSocialReport, saveSocialReport } from '@/lib/social-report-builder';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      clientId?: string; from?: string; to?: string;
      agencyContext?: string; template?: string;
      csvFiles?: { name: string; content: string }[];
      coverId?: string;
      metaLevel?: MetaBreakdownLevel;
    };

    const { clientId, from, to, agencyContext, template, coverId, metaLevel } = body;
    const csvFiles = body.csvFiles ?? [];
    if (!clientId || !from || !to) {
      return Response.json({ error: 'clientId, from e to são obrigatórios' }, { status: 400 });
    }

    // Resolve client name
    const pool = makeServerPool();
    let clientName = '';
    let metaConnectionId: string | null = null;
    let metaAccountIds: string[] = [];
    let googleConnectionId: string | null = null;
    let googleAccountIds: string[] = [];

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
      const metaLinks = links.filter((l: { platform: string }) => l.platform === 'meta_ads' || l.platform === 'meta');
      metaConnectionId = (metaLinks[0] as { connection_id: string } | undefined)?.connection_id ?? null;
      metaAccountIds = metaLinks.map((l: { account_id: string }) => l.account_id);
      const googleLinks = links.filter((l: { platform: string }) => l.platform === 'google_ads' || l.platform === 'google');
      googleConnectionId = (googleLinks[0] as { connection_id: string } | undefined)?.connection_id ?? null;
      googleAccountIds = googleLinks.map((l: { account_id: string }) => l.account_id);
    } finally {
      await pool.end();
    }

    // ── Delivery template ──────────────────────────────────────────────────────
    // csvFiles is optional — without it, sections derived from the cardápio digital
    // (base de clientes, produtos, pedidos por dia) are simply omitted; Meta Ads and
    // Instagram slides still render normally since they don't depend on CSV data.
    if (template === 'delivery') {
      const reportData = await buildDeliveryReport({
        clientId, clientName, from, to, csvFiles, agencyContext,
        connectionId: metaConnectionId,
        accountIds: metaAccountIds,
        coverId,
        metaLevel,
      });
      const { token, reportId } = await saveDeliveryReport({ clientId, clientName, from, to, data: { html: reportData.html } });
      return Response.json({ ok: true, id: reportId, public_token: token, avisos: reportData.avisos });
    }

    // ── Social template ─────────────────────────────────────────────────────────
    // Instagram-only slides — reuses the same fetch/slide builders as Delivery,
    // but skips Meta Ads/Google Ads/CRM entirely.
    if (template === 'social') {
      const reportData = await buildSocialReport({
        clientId, clientName, periodFrom: from, periodTo: to,
        connectionId: metaConnectionId,
        accountIds: metaAccountIds,
        coverId,
      });
      const { token, reportId } = await saveSocialReport({ clientId, clientName, from, to, data: reportData });
      return Response.json({ ok: true, id: reportId, public_token: token });
    }

    // ── Performance template (default) ────────────────────────────────────────
    const reportData = await buildOmniReport({
      clientId,
      clientName,
      connectionId: metaConnectionId,
      accountIds: metaAccountIds,
      googleConnectionId,
      googleAccountIds,
      periodFrom: from,
      periodTo: to,
      coverId,
      metaLevel,
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
