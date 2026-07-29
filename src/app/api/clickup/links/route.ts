import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { ensureClickupSchema, getClickupConnection } from '@/lib/clickup';

/**
 * Vínculo cliente do ONMID ↔ lista do ClickUp. É o mapa que qualquer envio
 * futuro consulta (`resolveClientList`) pra saber onde a tarefa deve nascer.
 */

type LinkBody = {
  client_id?: string;
  list_id?: string;
  list_name?: string;
  folder_name?: string;
  space_name?: string;
};

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureClickupSchema(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const { rows } = await pool.query(
      `SELECT l.client_id, l.list_id, l.list_name, l.folder_name, l.space_name, l.updated_at,
              c.name AS client_name
         FROM public.clickup_client_links l
         LEFT JOIN public.clients c ON c.id = l.client_id
        ORDER BY c.name NULLS LAST`,
    );
    return Response.json(rows);
  } catch (err) {
    console.error('[clickup links GET]', err);
    return Response.json([]);
  } finally {
    await pool.end();
  }
}

/** Upsert de um vínculo (client_id é a PK — um cliente aponta pra uma lista só). */
export async function POST(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureClickupSchema(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json() as LinkBody & { links?: LinkBody[] };
    // Aceita um vínculo ou um lote (a tela salva o "vincular automaticamente" de uma vez).
    const items = Array.isArray(body.links) ? body.links : [body];
    const valid = items.filter((i) => i.client_id?.trim() && i.list_id?.trim());
    if (!valid.length) return Response.json({ error: 'Cliente e lista obrigatórios' }, { status: 400 });

    const conn = await getClickupConnection(pool);
    if (!conn) return Response.json({ error: 'ClickUp não conectado' }, { status: 400 });

    for (const item of valid) {
      await pool.query(
        `INSERT INTO public.clickup_client_links
           (client_id, connection_id, list_id, list_name, folder_name, space_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (client_id) DO UPDATE
            SET connection_id = EXCLUDED.connection_id,
                list_id       = EXCLUDED.list_id,
                list_name     = EXCLUDED.list_name,
                folder_name   = EXCLUDED.folder_name,
                space_name    = EXCLUDED.space_name,
                updated_at    = NOW()`,
        [
          item.client_id!.trim(),
          conn.id,
          item.list_id!.trim(),
          item.list_name?.trim() ?? null,
          item.folder_name?.trim() ?? null,
          item.space_name?.trim() ?? null,
        ],
      );
    }
    return Response.json({ ok: true, saved: valid.length });
  } catch (err) {
    console.error('[clickup links POST]', err);
    return Response.json({ error: 'Falha ao salvar o vínculo' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const pool = makeServerPool();
  try {
    await ensureClickupSchema(pool);
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const clientId = new URL(req.url).searchParams.get('client_id');
    if (!clientId) return Response.json({ error: 'client_id obrigatório' }, { status: 400 });

    await pool.query('DELETE FROM public.clickup_client_links WHERE client_id = $1', [clientId]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
