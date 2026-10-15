import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getEvolutionState, setEvolutionWebhook, webhookOrigin } from '@/lib/evolution-api';
import { lerTokenMeta, verificarNumeroMeta } from '@/lib/meta-whatsapp';
import { lerApiKeyTolki, listarConexoesTolki } from '@/lib/tolki';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; instanceId: string }> },
) {
  const { id, instanceId } = await params;
  const pool = makeServerPool();
  try {
    const { rows: [inst] } = await pool.query(
      `SELECT instance_id, provider, token, tolki_api_key FROM public.client_zapi_instances
       WHERE id = $1 AND client_id = $2`,
      [instanceId, id],
    ).catch(() => pool.query(
      `SELECT instance_id, provider, token, NULL::text AS tolki_api_key FROM public.client_zapi_instances
       WHERE id = $1 AND client_id = $2`,
      [instanceId, id],
    ));
    if (!inst) {
      return Response.json({ error: 'Instância não encontrada' }, { status: 404 });
    }
    if (inst.provider === 'meta') {
      // "Conectado" aqui = a Meta aceita o token para este número. Não há
      // sessão de celular para cair; o que pode quebrar é o token.
      const numero = await verificarNumeroMeta(inst.instance_id, lerTokenMeta(inst.token));
      return Response.json({
        state: numero.ok ? 'open' : 'close',
        display_phone: numero.displayPhone,
        verified_name: numero.verifiedName,
        quality_rating: numero.qualityRating,
        error: numero.error,
      });
    }
    if (inst.provider === 'tolki') {
      // Estado real da conexão na Tolki (ela é quem fala com o WhatsApp).
      const apiKey = lerApiKeyTolki(inst.tolki_api_key);
      if (!apiKey) return Response.json({ state: 'unknown', error: 'sem chave da API da Tolki' });
      const conexoes = await listarConexoesTolki(apiKey);
      if (!conexoes.ok) return Response.json({ state: 'close', error: conexoes.error });
      const c = conexoes.data.find(x => x.id === inst.instance_id);
      if (!c) return Response.json({ state: 'close', error: 'conexão não existe mais na Tolki' });
      return Response.json({
        state: c.status === 'connected' ? 'open' : c.status === 'connecting' ? 'connecting' : 'close',
        display_phone: c.phone,
        verified_name: c.name,
        tolki_status: c.status,
      });
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
