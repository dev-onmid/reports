import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

const CRON_LIMIT = 5;   // seguro dentro do limite de 10s do Vercel
const USER_LIMIT = 10;  // front-end polling pode pedir até 50

async function processContacts(opts: {
  isCron: boolean;
  userId: string | null;
  unrestricted: boolean;
  campaignId?: string;
  limit: number;
}): Promise<Response> {
  const pool = makeServerPool();
  try {
    const { isCron, userId, unrestricted, campaignId } = opts;
    const limit = Math.min(opts.limit, 50);

    const ownerFilter = isCron ? 'TRUE' : `($1::boolean OR c.owner_id = $2)`;
    const ownerParams: unknown[] = isCron ? [] : [unrestricted, userId];
    let idx = ownerParams.length + 1;

    const campaignFilter = campaignId ? ` AND ct.campaign_id = $${idx++}` : '';
    if (campaignId) ownerParams.push(campaignId);

    const { rows: due } = await pool.query(
      `SELECT ct.*, c.webhook_url, c.machine_code, c.email_sequence_code,
              c.sequence_level_code, c.auth_key
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

    type Result = { id: string; status: 'success' | 'error'; httpStatus?: number; error?: string };
    const results: Result[] = [];

    for (const contact of due) {
      const payload: Record<string, unknown> = {
        Name:  contact.nome     ?? '',
        Email: contact.email    ?? '',
        Phone: contact.telefone ?? '',
      };
      if (contact.machine_code)        payload.MachineCode        = contact.machine_code;
      if (contact.email_sequence_code) payload.EmailSequenceCode  = contact.email_sequence_code;
      if (contact.sequence_level_code) payload.SequenceLevelCode  = contact.sequence_level_code;
      if (contact.empresa)             payload.Company            = contact.empresa;
      if (contact.extra_data && typeof contact.extra_data === 'object') {
        Object.assign(payload, contact.extra_data);
      }

      const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (contact.auth_key) reqHeaders['Authorization'] = `Bearer ${contact.auth_key}`;

      let ok = false;
      let httpStatus = 0;
      let errorMsg: string | null = null;

      try {
        const res = await fetch(contact.webhook_url as string, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });
        httpStatus = res.status;
        ok = res.ok;
        if (!ok) errorMsg = `HTTP ${httpStatus}`;
      } catch (err: unknown) {
        errorMsg = err instanceof Error ? err.message : 'Erro de rede';
      }

      const contactStatus = ok ? 'enviado' : 'erro';
      const logStatus: 'success' | 'error' = ok ? 'success' : 'error';

      await pool.query(
        `UPDATE public.leadlovers_contacts
            SET status = $1, sent_at = $2, error_msg = $3,
                retry_count = retry_count + $4
          WHERE id = $5`,
        [contactStatus, ok ? new Date().toISOString() : null, errorMsg, ok ? 0 : 1, contact.id],
      );

      await pool.query(
        `INSERT INTO public.leadlovers_dispatch_log
           (campaign_id, contact_id, status, http_status, error_msg)
         VALUES ($1, $2, $3, $4, $5)`,
        [contact.campaign_id, contact.id, logStatus, httpStatus || null, errorMsg],
      );

      const counterCol = ok ? 'total_sent' : 'total_errors';
      await pool.query(
        `UPDATE public.leadlovers_campaigns
            SET ${counterCol} = ${counterCol} + 1, updated_at = NOW()
          WHERE id = $1`,
        [contact.campaign_id],
      );

      results.push({ id: contact.id as string, status: logStatus, httpStatus, error: errorMsg ?? undefined });
    }

    // Mark campaigns as complete when no pending contacts remain
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

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization') ?? '';
    const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`);

    const pool = makeServerPool();
    const scope = await getCallerScope(req, pool).finally(() => pool.end());
    if (!scope.userId && !isCron) {
      return Response.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({})) as { campaign_id?: string; limit?: number };
    const limit = isCron ? CRON_LIMIT : Math.min(body.limit ?? USER_LIMIT, 50);

    return processContacts({
      isCron,
      userId: scope.userId,
      unrestricted: scope.unrestricted,
      campaignId: body.campaign_id,
      limit,
    });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
}

// GET endpoint for cron (GitHub Actions + Vercel cron)
export async function GET(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const secret = new URL(req.url).searchParams.get('secret');
    if (!cronSecret || secret !== cronSecret) {
      return Response.json({ error: 'Não autorizado' }, { status: 401 });
    }
    return processContacts({
      isCron: true,
      userId: null,
      unrestricted: true,
      limit: CRON_LIMIT,
    });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 });
  }
}
