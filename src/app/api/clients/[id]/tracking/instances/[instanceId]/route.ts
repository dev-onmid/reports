import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { deleteEvolutionInstance, setEvolutionWebhook } from '@/lib/evolution-api';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> },
) {
  const { id, instanceId } = await params;
  const body = await req.json().catch(() => ({})) as { ativo?: boolean };

  const pool = makeServerPool();
  try {
    const { rows: [inst] } = await pool.query(
      `SELECT instance_id, provider FROM public.client_zapi_instances
       WHERE id = $1 AND client_id = $2`,
      [instanceId, id],
    );
    await pool.query(
      `UPDATE public.client_zapi_instances
       SET ativo = $1
       WHERE id = $2 AND client_id = $3`,
      [body.ativo ?? true, instanceId, id],
    );
    let webhookSynced: boolean | null = null;
    let webhookError: string | null = null;
    if ((body.ativo ?? true) && inst?.provider === 'evolution') {
      const webhookUrl = `${new URL(req.url).origin}/api/webhook/whatsapp/${instanceId}`;
      const webhook = await setEvolutionWebhook(inst.instance_id, webhookUrl);
      webhookSynced = webhook.ok;
      webhookError = webhook.error ?? null;
    }
    return Response.json({ ok: true, webhook_synced: webhookSynced, webhook_error: webhookError });
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  _req: NextRequest,
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
    if (inst?.provider === 'evolution') {
      await deleteEvolutionInstance(inst.instance_id);
    }
    await pool.query(
      `DELETE FROM public.client_zapi_instances WHERE id = $1 AND client_id = $2`,
      [instanceId, id],
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
