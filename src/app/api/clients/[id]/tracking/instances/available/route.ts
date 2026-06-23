import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

// Existing Disparos instances that can be attached to a CRM client. Shows which
// client (if any) each one currently feeds, so the UI can flag a re-link.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await params; // client id not needed to list — instances are global
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT z.id, z.name, z.instance_id, z.provider,
              link.client_id AS linked_client_id, c.name AS linked_client_name
         FROM public.zapi_clients z
         LEFT JOIN LATERAL (
           SELECT client_id FROM public.client_zapi_instances
            WHERE instance_id = z.instance_id AND ativo = true
            ORDER BY created_at DESC LIMIT 1
         ) link ON true
         LEFT JOIN public.clients c ON c.id = link.client_id
        ORDER BY z.created_at DESC`,
    );
    return Response.json(rows);
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
