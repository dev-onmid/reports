import { makeServerPool } from '@/lib/server-db';
import { getAiBillingSettings } from '@/lib/ai-billing-settings';
import { sendText } from '@/lib/zapi';

function providerFromModel(model: string): 'openai' | 'claude' {
  return model.toLowerCase().includes('claude') ? 'claude' : 'openai';
}

export async function GET() {
  const pool = makeServerPool();
  try {
    const settings = await getAiBillingSettings(pool);
    if (!settings.alert_enabled) return Response.json({ ok: true, skipped: 'alert_disabled' });
    if (!settings.alert_phone || !settings.zapi_client_id) {
      return Response.json({ ok: true, skipped: 'missing_whatsapp_config' });
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.ai_usage_log (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source        TEXT NOT NULL,
        model         TEXT NOT NULL,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd      NUMERIC(12,8) NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const { rows: providerRows } = await pool.query<{ model: string; cost_usd: string }>(`
      SELECT model, COALESCE(SUM(cost_usd), 0) AS cost_usd
        FROM public.ai_usage_log
       WHERE created_at >= date_trunc('month', NOW())
       GROUP BY model
    `);
    const used = { openai: 0, claude: 0 };
    providerRows.forEach(row => {
      used[providerFromModel(row.model)] += parseFloat(row.cost_usd);
    });
    const balances = [
      { label: 'Claude', provider: 'claude' as const, balance: settings.claude_credit_usd - used.claude },
      { label: 'OpenAI', provider: 'openai' as const, balance: settings.openai_credit_usd - used.openai },
    ].filter(item => item.balance <= settings.alert_threshold_usd && (
      item.provider === 'claude' ? settings.claude_credit_usd > 0 : settings.openai_credit_usd > 0
    ));

    if (balances.length === 0) return Response.json({ ok: true, alert: false });

    const lastAlert = settings.last_alert_at ? new Date(settings.last_alert_at).getTime() : 0;
    if (lastAlert && Date.now() - lastAlert < 6 * 60 * 60 * 1000) {
      return Response.json({ ok: true, skipped: 'cooldown', balances });
    }

    const { rows: [zapi] } = await pool.query<{
      instance_id: string; token: string; security_token: string | null;
    }>(
      `SELECT instance_id, token, security_token
         FROM public.zapi_clients
        WHERE id = $1::uuid AND active = true`,
      [settings.zapi_client_id],
    );
    if (!zapi) return Response.json({ ok: false, error: 'Instância WhatsApp não encontrada' }, { status: 404 });

    const lines = balances.map(item => `${item.label}: US$ ${Math.max(item.balance, 0).toFixed(2)}`);
    const result = await sendText(
      { instanceId: zapi.instance_id, token: zapi.token, clientToken: zapi.security_token ?? undefined },
      settings.alert_phone,
      `Alerta de creditos IA\nSaldo estimado abaixo de US$ ${settings.alert_threshold_usd.toFixed(2)}:\n${lines.join('\n')}`,
    );
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 500 });

    await pool.query(
      `UPDATE public.ai_billing_settings SET last_alert_at = NOW(), updated_at = NOW() WHERE id = 'global'`,
    );
    return Response.json({ ok: true, alert: true, balances });
  } finally {
    await pool.end();
  }
}
