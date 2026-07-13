import { makeServerPool } from '@/lib/server-db';
import { effectiveField } from '@/lib/leadlovers-fields';

type Pool = ReturnType<typeof makeServerPool>;

export type DispatchSelection =
  | { mode: 'due' }                     // next_send_at <= NOW() — worker normal (cron/monitor)
  | { mode: 'day'; day: string };        // DATE(next_send_at) local = $day — disparo manual ("antecipar")

export type DispatchResult = {
  sent: number;
  errors: number;
  results: Array<{ id: string; status: 'success' | 'error'; httpStatus?: number; error?: string }>;
};

export async function ensureDispatchLogTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.leadlovers_dispatch_log (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id   UUID NOT NULL REFERENCES public.leadlovers_campaigns(id) ON DELETE CASCADE,
      contact_id    UUID NOT NULL REFERENCES public.leadlovers_contacts(id) ON DELETE CASCADE,
      dispatched_at TIMESTAMPTZ DEFAULT NOW(),
      status        TEXT NOT NULL,
      http_status   INTEGER,
      error_msg     TEXT
    );
  `);
}

/**
 * Busca um lote de contatos pendentes elegíveis pra uma campanha, conforme a seleção:
 * - 'due': igual ao worker de sempre — next_send_at <= NOW() (cron + monitor da UI).
 * - 'day': ignora o horário agendado, pega tudo daquele dia (fuso America/Sao_Paulo) —
 *   usado pelo botão "Disparar agora" (antecipar um dia futuro ou zerar pendências do dia).
 */
async function selectDue(
  pool: Pool,
  opts: {
    campaignId?: string;
    limit: number;
    selection: DispatchSelection;
    scope: { unrestricted: boolean; userId: string | null };
    isCron: boolean;
  },
) {
  const { campaignId, limit, selection, scope, isCron } = opts;
  const params: unknown[] = [];
  let idx = 1;

  const ownerFilter = isCron ? 'TRUE' : `($${idx++}::boolean OR c.owner_id = $${idx++})`;
  if (!isCron) params.push(scope.unrestricted, scope.userId);

  let campaignFilter = '';
  if (campaignId) {
    campaignFilter = ` AND ct.campaign_id = $${idx++}`;
    params.push(campaignId);
  }

  let timeFilter = `ct.next_send_at <= NOW()`;
  if (selection.mode === 'day') {
    timeFilter = `TO_CHAR(ct.next_send_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') = $${idx++}`;
    params.push(selection.day);
  }

  const limitIdx = idx++;
  params.push(limit);

  // 'due' (cron/monitor automático) só dispara campanha ativa — pausar precisa
  // realmente parar o envio automático. 'day' (clique manual "Disparar agora")
  // é uma decisão explícita do usuário, então também libera campanha pausada.
  const statusFilter = selection.mode === 'due' ? `c.status = 'ativa'` : `c.status IN ('ativa', 'pausada')`;

  const { rows } = await pool.query(
    `SELECT ct.*, c.webhook_url, c.machine_code, c.email_sequence_code,
            c.sequence_level_code, c.auth_key
       FROM public.leadlovers_contacts ct
       JOIN public.leadlovers_campaigns c ON c.id = ct.campaign_id
      WHERE ct.status = 'pendente'
        AND ct.next_send_at IS NOT NULL
        AND ${timeFilter}
        AND ${statusFilter}
        AND ${ownerFilter}${campaignFilter}
      ORDER BY ct.next_send_at ASC
      LIMIT $${limitIdx}`,
    params,
  );
  return rows;
}

export async function dispatchBatch(
  pool: Pool,
  opts: {
    campaignId?: string;
    limit: number;
    selection: DispatchSelection;
    scope: { unrestricted: boolean; userId: string | null };
    isCron: boolean;
  },
): Promise<DispatchResult> {
  const due = await selectDue(pool, opts);
  if (due.length === 0) return { sent: 0, errors: 0, results: [] };

  const results: DispatchResult['results'] = [];

  for (const contact of due) {
    // usa a coluna; se estiver vazia (contatos importados antes da normalização),
    // cai pro extra_data pelas variações de cabeçalho
    const empresa = effectiveField(contact, 'empresa');
    const payload: Record<string, unknown> = {
      Name:  effectiveField(contact, 'nome'),
      Email: effectiveField(contact, 'email'),
      Phone: effectiveField(contact, 'telefone'),
    };
    if (contact.machine_code)        payload.MachineCode        = contact.machine_code;
    if (contact.email_sequence_code) payload.EmailSequenceCode  = contact.email_sequence_code;
    if (contact.sequence_level_code) payload.SequenceLevelCode  = contact.sequence_level_code;
    if (empresa)                     payload.Company            = empresa;
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

  // Marca a campanha como concluída quando não sobra mais pendente
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
  return { sent, errors, results };
}
