/**
 * POST /api/leadlovers/worker
 *
 * Processes due contacts for all active campaigns. Called by:
 * - Frontend polling (Painel tab monitors)
 * - Vercel cron (once per day at 09:00 UTC to catch "all at once" batches)
 *
 * Each call sends up to `limit` contacts whose next_send_at <= NOW().
 * Returns stats so the frontend can update its progress display.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

const DEFAULT_LIMIT = 10;

export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    // Allow both authenticated users (frontend polling) and cron secret
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization') ?? '';
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    const scope = await getCallerScope(req, pool);
    if (!scope.userId && !isCron) {
      return Response.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({})) as {
      campaign_id?: string;
      limit?: number;
    };

    const limit = Math.min(body.limit ?? DEFAULT_LIMIT, 50);

    // Build owner filter — cron processes all active campaigns; user only their own
    const ownerFilter = isCron
      ? 'TRUE'
      : `($1::boolean OR c.owner_id = $2)`;
    const ownerParams: unknown[] = isCron ? [] : [scope.unrestricted, scope.userId];
    let idx = ownerParams.length + 1;

    const campaignFilter = body.campaign_id
      ? ` AND ct.campaign_id = $${idx++}`
      : '';
    if (body.campaign_id) ownerParams.push(body.campaign_id);

    // Fetch due contacts — pick oldest next_send_at first
    const { rows: due } = await pool.query(
      `SELECT ct.*, c.webhook_url, c.machine_code, c.email_sequence_code, c.sequence_level_code, c.auth_key, c.owner_id AS campaign_owner_id
         FROM public.leadlovers_contacts ct
         JOIN public.leadlovers_campaigns c ON c.id = ct.campaign_id
        WHERE ct.status = 'pendente'
          AND ct.next_send_at <= NOW()
          AND c.status = 'ativa'
          AND ${ownerFilter}${campaignFilter}
        ORDER BY ct.next_send_at ASC
        LIMIT $${idx}`,
      [...ownerParams, limit],
    );

    if (due.length === 0) {
      return Response.json({ sent: 0, errors: 0, done: false });
    }

    // Send each contact to its campaign webhook
    type Result = { id: string; status: 'success' | 'error'; httpStatus?: number; error?: string };
    const results: Result[] = [];

    for (const contact of due) {
      // Build Leadlovers-compatible payload
      const payload: Record<string, unknown> = {
        Name:  contact.nome     ?? '',
        Email: contact.email    ?? '',
        Phone: contact.telefone ?? '',
      };
      if (contact.machine_code)        payload.MachineCode        = contact.machine_code;
      if (contact.email_sequence_code) payload.EmailSequenceCode  = contact.email_sequence_code;
      if (contact.sequence_level_code) payload.SequenceLevelCode  = contact.sequence_level_code;
      if (contact.empresa)             payload.Company            = contact.empresa;
      // Merge any extra fields from the spreadsheet
      if (contact.extra_data && typeof contact.extra_data === 'object') {
        Object.assign(payload, contact.extra_data);
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (contact.auth_key) headers['Authorization'] = `Bearer ${contact.auth_key}`;

      let ok = false;
      let httpStatus = 0;
      let errorMsg: string | null = null;

      try {
        const res = await fetch(contact.webhook_url as string, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });
        httpStatus = res.status;
        ok = res.ok;
        if (!ok) {
          errorMsg = `HTTP ${httpStatus}`;
        }
      } catch (err: unknown) {
        errorMsg = err instanceof Error ? err.message : 'Erro de rede';
      }

      const contactStatus = ok ? 'enviado' : 'erro';
      const logStatus: 'success' | 'error' = ok ? 'success' : 'error';

      // Update contact
      await pool.query(
        `UPDATE public.leadlovers_contacts
            SET status = $1, sent_at = $2, error_msg = $3,
                retry_count = retry_count + $4
          WHERE id = $5`,
        [contactStatus, ok ? new Date().toISOString() : null, errorMsg, ok ? 0 : 1, contact.id],
      );

      // Log dispatch
      await pool.query(
        `INSERT INTO public.leadlovers_dispatch_log
           (campaign_id, contact_id, status, http_status, error_msg)
         VALUES ($1, $2, $3, $4, $5)`,
        [contact.campaign_id, contact.id, logStatus, httpStatus || null, errorMsg],
      );

      // Increment campaign counter
      const counterCol = ok ? 'total_sent' : 'total_errors';
      await pool.query(
        `UPDATE public.leadlovers_campaigns
            SET ${counterCol} = ${counterCol} + 1, updated_at = NOW()
          WHERE id = $1`,
        [contact.campaign_id],
      );

      results.push({ id: contact.id as string, status: logStatus, httpStatus, error: errorMsg ?? undefined });
    }

    // Check if any campaign is now complete
    const campaignIds = [...new Set(due.map(d => d.campaign_id as string))];
    for (const cid of campaignIds) {
      const { rows: [{ pending }] } = await pool.query(
        `SELECT COUNT(*)::int AS pending FROM public.leadlovers_contacts
          WHERE campaign_id = $1 AND status = 'pendente'`,
        [cid],
      );
      if (pending === 0) {
        await pool.query(
          `UPDATE public.leadlovers_campaigns SET status = 'concluida', updated_at = NOW() WHERE id = $1`,
          [cid],
        );
      }
    }

    const sent   = results.filter(r => r.status === 'success').length;
    const errors = results.filter(r => r.status === 'error').length;

    return Response.json({ sent, errors, results, done: false });
  } finally {
    await pool.end();
  }
}

// Cron endpoint (GET with secret)
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const secret = new URL(req.url).searchParams.get('secret');
  if (!cronSecret || secret !== cronSecret) {
    return Response.json({ error: 'Não autorizado' }, { status: 401 });
  }
  return POST(new Request(req.url, { method: 'POST', headers: req.headers }) as NextRequest);
}
