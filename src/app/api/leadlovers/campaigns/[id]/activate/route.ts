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

    // Fetch campaign + ownership check
    const { rows: [campaign] } = await pool.query(
      `SELECT * FROM public.leadlovers_campaigns WHERE id = $1 AND ($2::boolean OR owner_id = $3)`,
      [id, scope.unrestricted, scope.userId],
    );
    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });
    if (campaign.status === 'ativa') return Response.json({ error: 'Campanha já está ativa' }, { status: 400 });

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

    for (const rule of rules) {
      if (contactCursor >= contacts.length) break;

      const bdays = businessDaysBetween(new Date(rule.date_from), new Date(rule.date_to));
      const [sh, sm] = (rule.send_time as string).split(':').map(Number);

      for (const day of bdays) {
        if (contactCursor >= contacts.length) break;

        const toSendToday = Math.min(rule.qty_per_day as number, contacts.length - contactCursor);

        if (rule.interval_minutes) {
          // Stagger sends: first at send_time, then +interval each
          for (let i = 0; i < toSendToday; i++) {
            if (contactCursor >= contacts.length) break;
            const sendAt = new Date(day);
            sendAt.setHours(sh, sm + i * (rule.interval_minutes as number), 0, 0);
            slots.push({ contactId: contacts[contactCursor].id, sendAt });
            contactCursor++;
          }
        } else {
          // All at once at send_time
          for (let i = 0; i < toSendToday; i++) {
            if (contactCursor >= contacts.length) break;
            const sendAt = new Date(day);
            sendAt.setHours(sh, sm, 0, 0);
            slots.push({ contactId: contacts[contactCursor].id, sendAt });
            contactCursor++;
          }
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
