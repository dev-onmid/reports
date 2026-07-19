import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getEvolutionState, setEvolutionWebhook, webhookOrigin } from '@/lib/evolution-api';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> },
) {
  const { id, instanceId } = await params;
  const pool = makeServerPool();
  try {
    const { rows: [inst] } = await pool.query(
      `SELECT instance_id, provider FROM public.client_zapi_instances
       WHERE id = $1 AND client_id = $2`,
      [instanceId, id],
    );
    if (!inst) {
      return Response.json({ error: 'Instância não encontrada' }, { status: 404 });
    }
    if (inst.provider !== 'evolution') {
      return Response.json({ state: 'n/a' });
    }
    const data = await getEvolutionState(inst.instance_id);
    const webhookUrl = `${webhookOrigin(req.url)}/api/webhook/whatsapp/${instanceId}`;
    const webhook = await setEvolutionWebhook(inst.instance_id, webhookUrl);
    return Response.json({ ...data, webhook_synced: webhook.ok, webhook_error: webhook.error ?? null });
  } catch (err) {
    return Response.json({ state: 'unknown', error: String(err) });
  } finally {
    await pool.end();
  }
}
