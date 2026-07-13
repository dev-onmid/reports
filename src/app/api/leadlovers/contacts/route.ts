import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { normalizeContact } from '@/lib/leadlovers-fields';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.leadlovers_campaigns (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id       TEXT NOT NULL,
      name           TEXT NOT NULL,
      webhook_url    TEXT NOT NULL,
      status         TEXT DEFAULT 'rascunho',
      total_contacts INTEGER DEFAULT 0,
      total_sent     INTEGER DEFAULT 0,
      total_errors   INTEGER DEFAULT 0,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.leadlovers_contacts (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id     TEXT NOT NULL,
      campaign_id  UUID REFERENCES public.leadlovers_campaigns(id) ON DELETE SET NULL,
      nome         TEXT,
      email        TEXT,
      telefone     TEXT,
      empresa      TEXT,
      extra_data   JSONB DEFAULT '{}',
      status       TEXT DEFAULT 'pendente',
      sent_at      TIMESTAMPTZ,
      error_msg    TEXT,
      retry_count  INTEGER DEFAULT 0,
      next_send_at TIMESTAMPTZ,
      position     INTEGER DEFAULT 0,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const url = new URL(req.url);
    const campaignId = url.searchParams.get('campaign_id');
    const status = url.searchParams.get('status');
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '500'), 1000);
    const offset = parseInt(url.searchParams.get('offset') ?? '0');

    const conditions: string[] = ['($1::boolean OR owner_id = $2)'];
    const params: unknown[] = [scope.unrestricted, scope.userId];
    let idx = 3;

    if (campaignId) { conditions.push(`campaign_id = $${idx++}`); params.push(campaignId); }
    if (status)     { conditions.push(`status = $${idx++}`); params.push(status); }

    const where = conditions.join(' AND ');

    const [{ rows }, { rows: [{ count }] }] = await Promise.all([
      pool.query(
        `SELECT * FROM public.leadlovers_contacts WHERE ${where}
         ORDER BY position, created_at LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS count FROM public.leadlovers_contacts WHERE ${where}`, params),
    ]);

    return Response.json({ contacts: rows, total: count });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json() as {
      contacts: Array<{
        nome?: string; email?: string; telefone?: string; empresa?: string;
        [key: string]: unknown;
      }>;
      campaign_id?: string;
    };

    if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
      return Response.json({ error: 'Nenhum contato enviado' }, { status: 400 });
    }

    const inserted: unknown[] = [];
    for (let i = 0; i < body.contacts.length; i++) {
      // Normaliza cabeçalhos em qualquer caixa/variação (Nome/EMAIL/Celular…) pras
      // colunas certas; o que sobra vai pra extra_data.
      const { nome, email, telefone, empresa, extra } = normalizeContact(body.contacts[i] as Record<string, unknown>);
      const extraJson = Object.keys(extra).length > 0 ? JSON.stringify(extra) : '{}';
      const { rows: [row] } = await pool.query(
        `INSERT INTO public.leadlovers_contacts
           (owner_id, campaign_id, nome, email, telefone, empresa, extra_data, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING *`,
        [scope.userId, body.campaign_id ?? null, nome, email, telefone, empresa, extraJson, i],
      );
      inserted.push(row);
    }

    return Response.json({ inserted: inserted.length });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const url = new URL(req.url);
    const campaignId = url.searchParams.get('campaign_id');
    if (!campaignId) return Response.json({ error: 'campaign_id obrigatório' }, { status: 400 });

    const { rowCount } = await pool.query(
      `DELETE FROM public.leadlovers_contacts
        WHERE campaign_id = $1 AND ($2::boolean OR owner_id = $3) AND status = 'pendente'`,
      [campaignId, scope.unrestricted, scope.userId],
    );
    return Response.json({ deleted: rowCount });
  } finally {
    await pool.end();
  }
}
