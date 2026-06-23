import type { Pool } from 'pg';
import { setEvolutionWebhook } from '@/lib/evolution-api';

// A WhatsApp/Evolution instance is universal: the same physical connection
// (identified by its Evolution `instance_id`) can send campaigns in Disparos AND
// feed a client's CRM/AI. The CRM link is a single row in client_zapi_instances
// tied to one client — so one number always has one inbound destination.

async function ensureCrmInstancesTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_zapi_instances (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id   TEXT NOT NULL,
      nome        TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      token       TEXT NOT NULL DEFAULT '',
      ativo       BOOLEAN NOT NULL DEFAULT true,
      provider    TEXT NOT NULL DEFAULT 'zapi',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export type InstanceClientLink = { clientId: string; clientName: string | null; rowId: string };

/** Which CRM client (if any) currently receives this Evolution instance's inbound. */
export async function getInstanceClientLink(pool: Pool, instanceId: string): Promise<InstanceClientLink | null> {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT czi.id, czi.client_id, c.name AS client_name
         FROM public.client_zapi_instances czi
         LEFT JOIN public.clients c ON c.id = czi.client_id
        WHERE czi.instance_id = $1 AND czi.ativo = true
        ORDER BY czi.created_at DESC
        LIMIT 1`,
      [instanceId],
    );
    return row ? { clientId: row.client_id, clientName: row.client_name ?? null, rowId: row.id } : null;
  } catch {
    return null;
  }
}

/**
 * Attach an instance to a CRM client. Enforces one CRM link per instance_id by
 * reusing the single client_zapi_instances row (and pruning duplicates), then
 * points the Evolution webhook at it so inbound resolves to this client.
 */
export async function linkInstanceToClient(pool: Pool, opts: {
  instanceId: string;
  token: string;
  provider: 'zapi' | 'evolution';
  nome: string;
  clientId: string;
  appOrigin: string;
}): Promise<{ rowId: string }> {
  await ensureCrmInstancesTable(pool);

  const { rows: existing } = await pool.query(
    `SELECT id FROM public.client_zapi_instances WHERE instance_id = $1 ORDER BY created_at ASC`,
    [opts.instanceId],
  );

  let rowId: string;
  if (existing.length > 0) {
    rowId = existing[0].id;
    await pool.query(
      `UPDATE public.client_zapi_instances
          SET client_id = $1, nome = $2, token = $3, provider = $4, ativo = true
        WHERE id = $5`,
      [opts.clientId, opts.nome, opts.token, opts.provider, rowId],
    );
    if (existing.length > 1) {
      await pool.query(
        `DELETE FROM public.client_zapi_instances WHERE instance_id = $1 AND id <> $2`,
        [opts.instanceId, rowId],
      );
    }
  } else {
    const { rows: [ins] } = await pool.query(
      `INSERT INTO public.client_zapi_instances (client_id, nome, instance_id, token, provider, ativo)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [opts.clientId, opts.nome, opts.instanceId, opts.token, opts.provider],
    );
    rowId = ins.id;
  }

  if (opts.provider === 'evolution') {
    await setEvolutionWebhook(opts.instanceId, `${opts.appOrigin}/api/webhook/whatsapp/${rowId}`);
  }

  return { rowId };
}

/** Detach an instance from the CRM — inbound stops feeding any client. */
export async function unlinkInstanceFromClient(pool: Pool, instanceId: string): Promise<void> {
  await pool.query(`DELETE FROM public.client_zapi_instances WHERE instance_id = $1`, [instanceId]);
}
