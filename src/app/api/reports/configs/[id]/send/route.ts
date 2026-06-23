import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sendText as sendWhatsapp } from '@/lib/zapi';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const pool = makeServerPool();
  let cfg: {
    client_name: string; template: 'performance' | 'delivery';
    whatsapp_group: string | null;
    zapi_instance_id: string | null; zapi_token: string | null; zapi_security_token: string | null;
    last_token: string | null; last_created_at: string | null;
  } | null = null;

  try {
    const { rows } = await pool.query(`
      SELECT
        c.name AS client_name, rc.template, rc.whatsapp_group,
        z.instance_id AS zapi_instance_id,
        z.token AS zapi_token,
        z.security_token AS zapi_security_token,
        (SELECT public_token FROM public.diagnostic_reports dr
         WHERE dr.config_id = rc.id ORDER BY created_at DESC LIMIT 1) AS last_token,
        (SELECT created_at FROM public.diagnostic_reports dr
         WHERE dr.config_id = rc.id ORDER BY created_at DESC LIMIT 1) AS last_created_at
      FROM public.report_configs rc
      JOIN public.clients c ON c.id = rc.client_id
      LEFT JOIN public.zapi_clients z ON z.id = rc.zapi_client_id AND z.active = true
      WHERE rc.id = $1
    `, [id]);
    cfg = rows[0] ?? null;
  } finally {
    await pool.end();
  }

  if (!cfg) return Response.json({ error: 'Automação não encontrada' }, { status: 404 });
  if (!cfg.whatsapp_group) return Response.json({ error: 'Essa automação não tem grupo de WhatsApp configurado' }, { status: 400 });
  if (!cfg.zapi_instance_id || !cfg.zapi_token) return Response.json({ error: 'Essa automação não tem instância Z-API configurada' }, { status: 400 });
  if (!cfg.last_token) return Response.json({ error: 'Gere o relatório primeiro (botão "Gerar agora")' }, { status: 400 });

  const origin = new URL(request.url).origin;
  const reportUrl = `${origin}/relatorio/${cfg.last_token}`;
  const month = (cfg.last_created_at ? new Date(cfg.last_created_at) : new Date())
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const label = cfg.template === 'delivery' ? 'Relatório de Delivery' : 'Relatório de Performance';
  const message = `📊 *${label} — ${cfg.client_name}*\n\nO relatório de *${month}* está pronto!\n\nAcesse aqui: ${reportUrl}`;

  const result = await sendWhatsapp(
    { instanceId: cfg.zapi_instance_id, token: cfg.zapi_token, clientToken: cfg.zapi_security_token ?? '' },
    cfg.whatsapp_group,
    message,
  );

  if (!result.ok) return Response.json({ error: result.error ?? 'Falha ao enviar via Z-API' }, { status: 502 });

  const pool2 = makeServerPool();
  try {
    await pool2.query(`UPDATE public.diagnostic_reports SET sent_at = NOW() WHERE public_token = $1`, [cfg.last_token]);
  } finally {
    await pool2.end();
  }

  return Response.json({ ok: true });
}
