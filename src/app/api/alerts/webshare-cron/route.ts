import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getWebshareHealth, evaluateWebshareAlert, type WebshareHealth, type WebshareAlertLevel } from '@/lib/webshare';
import { sendEvolutionText } from '@/lib/evolution-api';
import { sendGmail } from '@/lib/gmail';

export const maxDuration = 60;

const WARN_PCT = Number(process.env.WEBSHARE_WARN_PCT ?? '80');
const STATE_KEY = 'webshare_alert_last'; // guarda '{"date":"YYYY-MM-DD","level":"warn"}' em system_settings

// Reaproveita o mesmo grupo de WhatsApp do Otimizador (onde o alerta já é visto).
async function loadWhatsApp(pool: ReturnType<typeof makeServerPool>): Promise<{ instanceName: string; groupJid: string } | null> {
  const { rows } = await pool.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM public.system_settings
      WHERE key IN ('otimizador_whatsapp_zapi_client_id', 'otimizador_whatsapp_group_jid', 'otimizador_whatsapp_ativo')`,
  );
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (map['otimizador_whatsapp_ativo'] !== 'true') return null;
  if (!map['otimizador_whatsapp_group_jid'] || !map['otimizador_whatsapp_zapi_client_id']) return null;
  const { rows: inst } = await pool.query<{ instance_id: string }>(
    `SELECT instance_id FROM public.zapi_clients WHERE id = $1 AND provider = 'evolution'`,
    [map['otimizador_whatsapp_zapi_client_id']],
  );
  if (!inst[0]?.instance_id) return null;
  return { instanceName: inst[0].instance_id, groupJid: map['otimizador_whatsapp_group_jid'] };
}

// Usa qualquer conta Gmail já conectada no sistema para enviar o e-mail de alerta.
async function loadGmail(pool: ReturnType<typeof makeServerPool>): Promise<{ email: string; refreshToken: string } | null> {
  const { rows } = await pool.query<{ email: string; refresh_token: string | null }>(
    `SELECT email, refresh_token FROM public.google_connections
      WHERE account_type = 'gmail' AND status = 'connected' AND refresh_token IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
  );
  if (!rows[0]?.refresh_token) return null;
  return { email: rows[0].email, refreshToken: rows[0].refresh_token };
}

function buildMessage(h: WebshareHealth, level: WebshareAlertLevel, reasons: string[], isDayOneReminder: boolean): { subject: string; text: string; html: string } {
  const emoji = level === 'critical' ? '🔴' : level === 'warn' ? '🟡' : '🟢';
  const title = isDayOneReminder && level === 'ok'
    ? '🗓️ Lembrete: hoje é dia de pagar o Webshare'
    : `${emoji} Alerta Webshare (proxy do WhatsApp)`;

  const linhas = [
    title,
    '',
    `• Banda: ${h.usedGb} / ${h.limitGb} GB (${h.usedPct}%)`,
    `• Assinatura: ${h.paused ? 'PAUSADA ⚠️' : 'ativa'}${h.throttled ? ' · BANDA ESTOURADA ⚠️' : ''}`,
    `• Renovação automática: ${h.renewalsEnabled ? 'ligada' : 'DESLIGADA ⚠️'}`,
    h.endDate ? `• Fim do ciclo: ${new Date(h.endDate).toLocaleDateString('pt-BR')}${h.daysToEnd !== null ? ` (${h.daysToEnd} dia(s))` : ''}` : null,
    '',
    ...(reasons.length ? ['O que precisa de atenção:', ...reasons.map(r => `→ ${r}`), ''] : []),
    'Conta: dev.onmid@gmail.com · plano Static Residential',
    'Se o proxy cair, todas as instâncias WhatsApp param de conectar.',
  ].filter((l): l is string => l !== null);

  const text = linhas.join('\n');
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#111;line-height:1.6">${
    linhas.map(l => l === '' ? '<br>' : `<div>${l.replace(/</g, '&lt;')}</div>`).join('')
  }</div>`;
  return { subject: title, text, html };
}

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let health: WebshareHealth;
  try {
    health = await getWebshareHealth();
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 502 });
  }

  const { level, reasons } = evaluateWebshareAlert(health, WARN_PCT);
  const today = new Date();
  const isDayOne = today.getUTCDate() === 1;
  const todayStr = today.toISOString().slice(0, 10);

  const pool = makeServerPool();
  try {
    // Dedupe: evita repetir o mesmo alerta todo dia. Envia se:
    //  - é dia 1 (lembrete mensal de pagar, mesmo que esteja tudo ok), ou
    //  - há problema (warn/critical) E (mudou de nível OU já faz >= 3 dias do último envio).
    const { rows: stateRows } = await pool.query<{ value: string | null }>(
      `SELECT value FROM public.system_settings WHERE key = $1`, [STATE_KEY],
    );
    let last: { date?: string; level?: string } = {};
    try { last = stateRows[0]?.value ? JSON.parse(stateRows[0].value) as typeof last : {}; } catch { /* estado corrompido → trata como vazio */ }

    const daysSinceLast = last.date ? Math.floor((Date.parse(todayStr) - Date.parse(last.date)) / 86_400_000) : 999;
    const shouldSend = isDayOne
      || (level !== 'ok' && (last.level !== level || daysSinceLast >= 3));

    if (!shouldSend) {
      return Response.json({ ok: true, sent: false, level, health, note: 'sem mudança — não reenviado' });
    }

    const msg = buildMessage(health, level, reasons, isDayOne);
    const results: Record<string, unknown> = {};

    // WhatsApp (mesmo grupo do Otimizador)
    const wa = await loadWhatsApp(pool);
    if (wa) {
      const r = await sendEvolutionText(wa.instanceName, wa.groupJid, msg.text);
      results.whatsapp = r.ok ? 'enviado' : `falhou: ${r.error}`;
    } else {
      results.whatsapp = 'não configurado (Otimizador WhatsApp)';
    }

    // E-mail (backup — funciona mesmo se o proxy já caiu)
    const to = process.env.WEBSHARE_ALERT_EMAIL;
    const gmail = await loadGmail(pool);
    if (to && gmail) {
      const r = await sendGmail(gmail, { to, subject: msg.subject, html: msg.html, text: msg.text });
      results.email = r.ok ? `enviado para ${to}` : `falhou: ${r.error}`;
    } else {
      results.email = !to ? 'WEBSHARE_ALERT_EMAIL não configurado' : 'nenhuma conta Gmail conectada';
    }

    // Grava o estado do envio (dedupe)
    await pool.query(
      `INSERT INTO public.system_settings (key, value, updated_at, updated_by)
       VALUES ($1, $2, NOW(), 'webshare-cron')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
      [STATE_KEY, JSON.stringify({ date: todayStr, level })],
    );

    return Response.json({ ok: true, sent: true, level, reasons, health, results });
  } finally {
    await pool.end();
  }
}
