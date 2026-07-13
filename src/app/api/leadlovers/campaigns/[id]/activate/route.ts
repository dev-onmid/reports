/**
 * POST /api/leadlovers/campaigns/[id]/activate
 *
 * Activates a campaign by:
 * 1. Reading all schedule rules
 * 2. Generating a list of business days in each rule range
 * 3. Distributing pending contacts across those days with timestamps
 * 4. Setting next_send_at on each contact
 * 5. Marking campaign status = 'ativa'
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

function businessDaysBetween(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  while (cur <= end) {
    const dow = cur.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const url = new URL(req.url);
    // ?reschedule=1 → recalcula next_send_at dos pendentes mesmo se já estiver ativa
    const reschedule = url.searchParams.get('reschedule') === '1';
    // ?mode=now → dispara tudo de uma vez: seta next_send_at = NOW() em todos os
    // pendentes, sem cronograma nem dias úteis. O drain fica por conta do
    // dispatch-day de hoje (loop no frontend) + worker automático.
    const modeNow = url.searchParams.get('mode') === 'now';

    // Fetch campaign + ownership check
    const { rows: [campaign] } = await pool.query(
      `SELECT * FROM public.leadlovers_campaigns WHERE id = $1 AND ($2::boolean OR owner_id = $3)`,
      [id, scope.unrestricted, scope.userId],
    );
    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });
    if (campaign.status === 'ativa' && !reschedule && !modeNow) {
      return Response.json({ error: 'Campanha já está ativa' }, { status: 400 });
    }

    if (modeNow) {
      const { rowCount } = await pool.query(
        `UPDATE public.leadlovers_contacts
            SET next_send_at = NOW()
          WHERE campaign_id = $1 AND status = 'pendente'`,
        [id],
      );
      const scheduled = rowCount ?? 0;
      if (scheduled === 0) return Response.json({ error: 'Nenhum contato pendente na campanha' }, { status: 400 });
      await pool.query(
        `UPDATE public.leadlovers_campaigns
            SET status = 'ativa', total_contacts = GREATEST(total_contacts, $2), updated_at = NOW()
          WHERE id = $1`,
        [id, scheduled],
      );
      return Response.json({ activated: true, scheduled, unscheduled: 0, mode: 'now' });
    }

    // Fetch rules
    const { rows: rules } = await pool.query(
      `SELECT * FROM public.leadlovers_schedule_rules WHERE campaign_id = $1 ORDER BY date_from`,
      [id],
    );
    if (rules.length === 0) return Response.json({ error: 'Adicione pelo menos uma regra de cronograma' }, { status: 400 });

    // Fetch pending contacts for this campaign (ordered by position)
    const { rows: contacts } = await pool.query(
      `SELECT id, position FROM public.leadlovers_contacts
        WHERE campaign_id = $1 AND status = 'pendente'
        ORDER BY position, created_at`,
      [id],
    );
    if (contacts.length === 0) return Response.json({ error: 'Nenhum contato pendente na campanha' }, { status: 400 });

    // Build a schedule: list of {contactId, sendAt} pairs
    type Slot = { contactId: string; sendAt: Date };
    const slots: Slot[] = [];

    let contactCursor = 0;
    const now = new Date();
    // Início do dia de hoje em UTC, para descartar dias úteis já passados
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // send_time é BRT (UTC-3); converte para UTC somando 3 horas
    const BRT_OFFSET_HOURS = 3;

    for (const rule of rules) {
      if (contactCursor >= contacts.length) break;

      // Não agenda em dias anteriores a hoje (reagendamento sempre olha pra frente)
      const bdays = businessDaysBetween(new Date(rule.date_from), new Date(rule.date_to))
        .filter(d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) >= todayUtc);
      const [sh, sm] = (rule.send_time as string).split(':').map(Number);

      for (const day of bdays) {
        if (contactCursor >= contacts.length) break;

        const toSendToday = Math.min(rule.qty_per_day as number, contacts.length - contactCursor);
        const step = rule.interval_minutes ? (rule.interval_minutes as number) : 0;

        for (let i = 0; i < toSendToday; i++) {
          if (contactCursor >= contacts.length) break;
          let sendAt = new Date(day);
          sendAt.setUTCHours(sh + BRT_OFFSET_HOURS, sm + i * step, 0, 0);
          // Se o horário calculado já passou (ex.: reagendar hoje após o horário),
          // dispara em instantes — escalonando se houver intervalo.
          if (sendAt < now) sendAt = new Date(now.getTime() + i * step * 60_000);
          slots.push({ contactId: contacts[contactCursor].id, sendAt });
          contactCursor++;
        }
      }
    }

    // Apply next_send_at to each contact
    for (const slot of slots) {
      await pool.query(
        `UPDATE public.leadlovers_contacts SET next_send_at = $1 WHERE id = $2`,
        [slot.sendAt.toISOString(), slot.contactId],
      );
    }

    // Activate campaign
    await pool.query(
      `UPDATE public.leadlovers_campaigns
          SET status = 'ativa', total_contacts = $2, updated_at = NOW()
        WHERE id = $1`,
      [id, slots.length],
    );

    return Response.json({
      activated: true,
      scheduled: slots.length,
      unscheduled: contacts.length - slots.length,
    });
  } finally {
    await pool.end();
  }
}
