import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

// One-time cleanup endpoint — fixes bad data created before the filters were added.
// Removes group leads and clears wrong contact names set by the instance owner.
export async function POST(req: NextRequest) {
  const { clientId, wrongName } = await req.json().catch(() => ({})) as {
    clientId?: string;
    wrongName?: string; // optional: specific name to force-clear from all leads
  };
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    // 1. Delete group leads — numbers longer than 15 digits are always group JIDs
    const { rowCount: groupsDeleted } = await pool.query(
      `DELETE FROM public.crm_leads
       WHERE client_id = $1
         AND numero IS NOT NULL
         AND CHAR_LENGTH(numero) > 15`,
      [clientId],
    );

    // 2. Clear wrong names — leads where nome = instance owner's name but
    //    ALL messages are outbound (the name was set by the webhook on outbound calls).
    //    We identify them by checking if there are NO inbound messages for the lead.
    const { rowCount: namesCleared } = await pool.query(
      `UPDATE public.crm_leads l
       SET nome = NULL
       WHERE l.client_id = $1
         AND l.nome IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.crm_messages m
           WHERE m.lead_id IN (
             SELECT id FROM public.crm_leads l2
             WHERE l2.client_id = l.client_id
               AND l2.numero    = l.numero
               AND l2.numero IS NOT NULL
             UNION SELECT l.id
           )
           AND m.direction = 'in'
         )`,
      [clientId],
    );

    // 3. Also clear instance-owner name from ANY lead where the stored nome
    //    matches a known WA instance name for this client (more targeted fix).
    const { rows: instances } = await pool.query(
      `SELECT DISTINCT nome FROM public.client_zapi_instances
       WHERE client_id = $1 AND nome IS NOT NULL AND CHAR_LENGTH(nome) > 2`,
      [clientId],
    );
    let instanceNamesCleared = 0;
    for (const inst of instances) {
      const { rowCount } = await pool.query(
        `UPDATE public.crm_leads
         SET nome = NULL
         WHERE client_id = $1 AND nome = $2`,
        [clientId, inst.nome],
      );
      instanceNamesCleared += rowCount ?? 0;
    }

    // 4. If a specific wrong name was passed, force-clear it from ALL leads
    let specificNameCleared = 0;
    if (wrongName?.trim()) {
      const { rowCount } = await pool.query(
        `UPDATE public.crm_leads SET nome = NULL
         WHERE client_id = $1 AND nome ILIKE $2`,
        [clientId, wrongName.trim()],
      );
      specificNameCleared = rowCount ?? 0;
    }

    return Response.json({
      ok: true,
      groupsDeleted: groupsDeleted ?? 0,
      namesCleared: (namesCleared ?? 0) + instanceNamesCleared + specificNameCleared,
    });
  } finally {
    await pool.end();
  }
}
