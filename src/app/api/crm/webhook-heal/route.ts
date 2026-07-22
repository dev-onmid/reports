import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getEvolutionWebhook, setEvolutionWebhook, webhookOrigin } from '@/lib/evolution-api';

// Cura automática do webhook das instâncias Evolution de um cliente.
// Instâncias antigas podem ter ficado com o webhook apontado pra uma URL de
// preview/localhost (bug corrigido em 2026-07 só pra instâncias novas) — aí o
// inbound nunca chega e o chat "congela" até alguém puxar manualmente.
// Chamado pelo chat-view ao abrir o chat do cliente: confere a URL configurada
// na Evolution e reaponta pra canônica quando estiver errada.

export async function POST(req: NextRequest) {
  const { clientId } = await req.json().catch(() => ({})) as { clientId?: string };
  if (!clientId) return Response.json({ error: 'clientId obrigatório' }, { status: 400 });

  const origin = webhookOrigin(req.url);
  if (!origin || origin.includes('localhost')) {
    // Sem APP_URL canônica (dev local) não dá pra curar — melhor não tocar.
    return Response.json({ ok: true, skipped: 'origin não canônica', healed: 0 });
  }

  const pool = makeServerPool();
  try {
    const { rows: instances } = await pool.query<{ id: string; instance_id: string }>(
      `SELECT id, instance_id FROM public.client_zapi_instances
        WHERE client_id = $1 AND ativo = TRUE AND provider = 'evolution'`,
      [clientId],
    );
    if (instances.length === 0) return Response.json({ ok: true, healed: 0, instances: 0 });

    let healed = 0;
    const details: Array<{ instance: string; from: string | null; to?: string; ok?: boolean }> = [];
    for (const inst of instances) {
      const expected = `${origin}/api/webhook/whatsapp/${inst.id}`;
      const current = await getEvolutionWebhook(inst.instance_id);
      if (current.enabled && current.url === expected) continue;
      const result = await setEvolutionWebhook(inst.instance_id, expected);
      details.push({ instance: inst.instance_id, from: current.url, to: expected, ok: result.ok });
      if (result.ok) healed++;
    }
    return Response.json({ ok: true, instances: instances.length, healed, details });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
