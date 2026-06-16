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
    // ── Lead under inspection ────────────────────────────────────────────────
    const { rows: [lead] } = await pool.query(
      `SELECT id, client_id, nome, numero, whatsapp_lid
         FROM public.crm_leads WHERE id = $1 AND client_id = $2`,
      [leadId, clientId],
    ).catch(async () => pool.query(
      `SELECT id, client_id, nome, numero, NULL::text AS whatsapp_lid
         FROM public.crm_leads WHERE id = $1 AND client_id = $2`,
      [leadId, clientId],
    ));
    if (!lead?.numero) return Response.json({ error: 'Lead não encontrado ou sem número' }, { status: 404 });

    const phone = String(lead.numero).replace(/\D/g, '');

    // ── ALL active instances for this client (so we see what exists) ──────────
    const { rows: allInstances } = await pool.query(
      `SELECT nome, instance_id, provider, ativo, created_at
         FROM public.client_zapi_instances
        WHERE client_id = $1
        ORDER BY ativo DESC, CASE WHEN provider = 'evolution' THEN 0 ELSE 1 END, created_at ASC`,
      [clientId],
    );

    // The instance the app will actually use (same ordering as inbox/sync/send)
    const { rows: [inst] } = await pool.query(
      `SELECT instance_id, token, provider FROM public.client_zapi_instances
       WHERE client_id = $1 AND ativo = true
       ORDER BY CASE WHEN provider = 'evolution' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`,
      [clientId],
    );

    // ── How many messages are ALREADY stored (by lead id and by phone) ───────
    const { rows: [storedByLead] } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM public.crm_messages WHERE lead_id = $1`,
      [leadId],
    ).catch(() => ({ rows: [{ n: -1 }] }));
    const { rows: [storedByPhone] } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM public.crm_messages m
         JOIN public.crm_leads l ON l.id = m.lead_id
        WHERE l.client_id = $1
          AND NULLIF(regexp_replace(COALESCE(l.numero,''),'\\D','','g'),'') = $2`,
      [clientId, phone],
    ).catch(() => ({ rows: [{ n: -1 }] }));

    // ── Duplicate leads sharing this phone (the "two Matheus" problem) ───────
    const { rows: dupLeads } = await pool.query(
      `SELECT id, nome, numero, funnel_id, created_at
         FROM public.crm_leads
        WHERE client_id = $1
          AND NULLIF(regexp_replace(COALESCE(numero,''),'\\D','','g'),'') = $2
        ORDER BY created_at ASC`,
      [clientId, phone],
    ).catch(() => ({ rows: [] }));

    // ── Probe the live API of the SELECTED instance ──────────────────────────
    const results: Array<{ url: string; method: string; body: unknown; status: number; records: number | string; preview: unknown }> = [];

    if (inst?.provider === 'evolution') {
      const base = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
      const apikey = process.env.EVOLUTION_API_KEY ?? '';
      const headers = { 'Content-Type': 'application/json', apikey };

      const remoteJids = [
        `${phone}@s.whatsapp.net`,
        ...(lead.whatsapp_lid ? [`${String(lead.whatsapp_lid).replace(/\D/g, '')}@lid`] : []),
        `${phone}@lid`,
      ];
      const url = `${base}/chat/findMessages/${inst.instance_id}`;

      for (const remoteJid of remoteJids) {
        const bodyObj = { where: { key: { remoteJid } }, page: 1, offset: 10 };
        try {
          const res = await fetch(url, {
            method: 'POST', headers, body: JSON.stringify(bodyObj),
            signal: AbortSignal.timeout(8000),
          });
          const text = await res.text().catch(() => '');
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 300); }
          // count records across known shapes
          let records: number | string = 'n/a';
          if (parsed && typeof parsed === 'object') {
            const o = parsed as Record<string, unknown>;
            const recs = (o.messages as Record<string, unknown> | undefined)?.records ?? o.records ?? o.messages ?? o.data;
            if (Array.isArray(recs)) records = recs.length;
            else if (Array.isArray(parsed)) records = (parsed as unknown[]).length;
          }
          results.push({ url, method: 'POST', body: bodyObj, status: res.status, records, preview: parsed });
        } catch (err) {
          results.push({ url, method: 'POST', body: bodyObj, status: 0, records: 'error', preview: String(err) });
        }
      }
    } else if (inst) {
      const base = `https://api.z-api.io/instances/${inst.instance_id}/token/${inst.token}`;
      const urls = [
        `${base}/chat-messages/${phone}?page=1&pageSize=5`,
        `${base}/last-messages?phone=${phone}&count=5`,
      ];
      for (const u of urls) {
        try {
          const res = await fetch(u, { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000) });
          const text = await res.text().catch(() => '');
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 300); }
          const records = Array.isArray(parsed) ? parsed.length : 'n/a';
          results.push({ url: u, method: 'GET', body: null, status: res.status, records, preview: parsed });
        } catch (err) {
          results.push({ url: u, method: 'GET', body: null, status: 0, records: 'error', preview: String(err) });
        }
      }
    }

    // ── DRY-RUN IMPORT: replay exactly what sync-history does, inside a tx we ROLL BACK.
    // This surfaces the real INSERT error in production without writing anything.
    const dryRun: {
      recordsFound: number; wouldImport: number; normalizedNull: number;
      insertErrors: string[]; sample: Array<{ direction: string; text: string; externalId: string | null }>;
    } = { recordsFound: 0, wouldImport: 0, normalizedNull: 0, insertErrors: [], sample: [] };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractText = (msg: any): string => {
      const m = msg.message ?? msg;
      if (typeof m === 'string') return m;
      if (m?.conversation) return m.conversation;
      if (m?.extendedTextMessage?.text) return m.extendedTextMessage.text;
      if (m?.imageMessage) return '[Imagem]';
      if (m?.audioMessage) return '[Áudio]';
      if (m?.videoMessage) return '[Vídeo]';
      if (typeof msg.body === 'string' && msg.body) return msg.body;
      return '';
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const norm = (msg: any) => {
      const key = msg.key;
      const externalId = (key?.id ?? msg.id ?? null) as string | null;
      const text = extractText(msg);
      if (!text) return null;
      const direction = (key?.fromMe ?? false) ? 'out' : 'in';
      const n = Number(msg.messageTimestamp);
      const ts = (Number.isFinite(n) && n > 0) ? new Date(n < 1e10 ? n * 1000 : n).toISOString() : new Date().toISOString();
      return { externalId, text, direction, ts };
    };

    // gather records from the first apiResult that returned some
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let records: any[] = [];
    for (const r of results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recs = (r.preview as any)?.messages?.records;
      if (Array.isArray(recs) && recs.length) { records = recs; break; }
    }
    dryRun.recordsFound = records.length;

    if (records.length) {
      await pool.query('BEGIN').catch(() => null);
      try {
        for (const raw of records.slice(0, 10)) {
          const n = norm(raw);
          if (!n) { dryRun.normalizedNull++; continue; }
          if (dryRun.sample.length < 3) dryRun.sample.push({ direction: n.direction, text: n.text.slice(0, 40), externalId: n.externalId });
          try {
            const r = await pool.query(
              `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, external_id, created_at)
               VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
              [leadId, clientId, n.direction, n.text, n.externalId, n.ts],
            );
            if ((r.rowCount ?? 0) > 0) dryRun.wouldImport++;
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            if (!dryRun.insertErrors.includes(m)) dryRun.insertErrors.push(m);
          }
        }
      } finally {
        await pool.query('ROLLBACK').catch(() => null);
      }
    }

    return Response.json({
      lead: { id: lead.id, nome: lead.nome, numero: lead.numero, whatsapp_lid: lead.whatsapp_lid, phone },
      allInstances,
      selectedInstance: inst ? { instance_id: inst.instance_id, provider: inst.provider } : null,
      storedMessages: { byLeadId: storedByLead?.n, byPhone: storedByPhone?.n },
      duplicateLeadsWithSamePhone: dupLeads,
      dryRunImport: dryRun,
      apiResults: results,
    });
  } finally {
    await pool.end();
  }
}
