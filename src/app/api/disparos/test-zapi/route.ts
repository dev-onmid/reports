/**
 * Debug endpoint — tests Z-API connectivity for a campaign's instance.
 * GET /api/disparos/test-zapi?campaignId=xxx&phone=5511999999999
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get('campaignId');
  const testPhone = req.nextUrl.searchParams.get('phone');

  if (!campaignId) return Response.json({ error: 'campaignId obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [campaign] } = await pool.query(
      `SELECT c.id, c.name, c.message, cl.instance_id, cl.token, cl.security_token
         FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
        WHERE c.id = $1`,
      [campaignId],
    );

    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });

    const BASE = 'https://api.z-api.io/instances';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (campaign.security_token) headers['Client-Token'] = campaign.security_token;

    // 1. Check instance status
    const statusRes = await fetch(
      `${BASE}/${campaign.instance_id}/token/${campaign.token}/status`,
      { headers },
    );
    const statusBody = await statusRes.json().catch(() => ({}));

    const result: Record<string, unknown> = {
      campaign: { id: campaign.id, name: campaign.name },
      instance: { id: campaign.instance_id, token: campaign.token?.slice(0, 6) + '***', hasSecurityToken: !!campaign.security_token },
      statusCheck: { httpStatus: statusRes.status, body: statusBody },
    };

    // 2. Optionally send a real test message
    if (testPhone) {
      const sendRes = await fetch(
        `${BASE}/${campaign.instance_id}/token/${campaign.token}/send-text`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ phone: testPhone, message: '[TESTE] Verificação de envio Z-API' }),
        },
      );
      const sendBody = await sendRes.json().catch(() => ({}));
      result.sendTest = { phone: testPhone, httpStatus: sendRes.status, body: sendBody };
    }

    return Response.json(result);
  } finally {
    await pool.end();
  }
}
