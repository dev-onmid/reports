import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function POST(req: NextRequest) {
  const { leadId, clientId } = await req.json().catch(() => ({})) as {
    leadId?: string;
    clientId?: string;
  };
  if (!leadId || !clientId) return Response.json({ error: 'leadId and clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [lead] } = await pool.query(
      `SELECT numero FROM public.crm_leads WHERE id = $1 AND client_id = $2`,
      [leadId, clientId],
    );
    if (!lead?.numero) return Response.json({ error: 'Lead não encontrado' }, { status: 404 });

    const { rows: [inst] } = await pool.query(
      `SELECT instance_id, token, provider FROM public.client_zapi_instances
       WHERE client_id = $1 AND ativo = true
       ORDER BY CASE WHEN provider = 'evolution' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`,
      [clientId],
    );
    if (!inst) return Response.json({ error: 'Nenhuma instância ativa' }, { status: 404 });

    const phone = lead.numero.replace(/\D/g, '');
    const results: Array<{ url: string; method: string; body: unknown; status: number; preview: unknown }> = [];

    if (inst.provider === 'evolution') {
      const base = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
      const apikey = process.env.EVOLUTION_API_KEY ?? '';
      const headers = { 'Content-Type': 'application/json', apikey };

      const remoteJids = [
        `${phone}@s.whatsapp.net`,
        `${phone.replace(/^55/, '')}@s.whatsapp.net`,
        `${phone}@c.us`,
      ];

      const endpoints = [
        `${base}/chat/findMessages/${inst.instance_id}`,
        `${base}/message/findMessages/${inst.instance_id}`,
        `${base}/messages/findMessages/${inst.instance_id}`,
      ];

      // Try a small set of combinations — enough to identify what works
      for (const remoteJid of remoteJids.slice(0, 2)) {
        for (const url of endpoints.slice(0, 2)) {
          const bodies = [
            { where: { key: { remoteJid } }, page: 1, offset: 10 },
            { where: { key: { remoteJid } }, page: { limit: 10, page: 1 } },
            { where: { remoteJid }, page: 1, offset: 10 },
            { where: { remoteJid }, page: { limit: 10, page: 1 } },
          ];
          for (const bodyObj of bodies) {
            try {
              const res = await fetch(url, {
                method: 'POST', headers, body: JSON.stringify(bodyObj),
                signal: AbortSignal.timeout(8000),
              });
              const text = await res.text().catch(() => '');
              let preview: unknown;
              try { preview = JSON.parse(text); } catch { preview = text.slice(0, 300); }
              results.push({ url, method: 'POST', body: bodyObj, status: res.status, preview });
            } catch (err) {
              results.push({ url, method: 'POST', body: bodyObj, status: 0, preview: String(err) });
            }
          }
        }
      }
    } else {
      // Z-API
      const base = `https://api.z-api.io/instances/${inst.instance_id}/token/${inst.token}`;
      const urls = [
        `${base}/chat-messages/${phone}?page=1&pageSize=5`,
        `${base}/messages/${phone}?page=1&pageSize=5`,
        `${base}/last-messages?phone=${phone}&count=5`,
      ];
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(8000),
          });
          const text = await res.text().catch(() => '');
          let preview: unknown;
          try { preview = JSON.parse(text); } catch { preview = text.slice(0, 300); }
          results.push({ url, method: 'GET', body: null, status: res.status, preview });
        } catch (err) {
          results.push({ url, method: 'GET', body: null, status: 0, preview: String(err) });
        }
      }
    }

    return Response.json({
      provider: inst.provider,
      instanceId: inst.instance_id,
      phone,
      results,
    });
  } finally {
    await pool.end();
  }
}
