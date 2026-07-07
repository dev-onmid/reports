import { makeServerPool } from '@/lib/server-db';
import { sendEvolutionText } from '@/lib/evolution-api';
import { sendGmail } from '@/lib/gmail';

export type InstanceStatus = 'open' | 'close' | 'connecting' | string;

export interface EvolutionInstance {
  name: string;
  connectionStatus: InstanceStatus;
  ownerJid: string | null;
  profileName: string | null;
  disconnectionReasonCode: number | null;
  disconnectionObject: string | null;
  disconnectionAt: string | null;
}

export interface DisconnectedAlert {
  name: string;
  status: InstanceStatus;
  profileName: string | null;
  phone: string | null;
  reasonCode: number | null;
  reason: string;
  disconnectedAt: string | null;
}

function parseReason(instance: EvolutionInstance): string {
  const code = instance.disconnectionReasonCode;
  if (code === 401) return '401 – Sessão revogada (reconectar via QR Code)';
  if (code === 403) return '403 – Conexão bloqueada pelo WhatsApp';
  if (instance.disconnectionObject) {
    try {
      const obj = JSON.parse(instance.disconnectionObject) as Record<string, unknown>;
      const msg = (obj?.error as Record<string, unknown>)?.output as Record<string, unknown>;
      const payload = msg?.payload as Record<string, unknown>;
      if (payload?.message) return String(payload.message);
    } catch { /* ignore */ }
  }
  if (instance.connectionStatus === 'connecting') return 'Reconectando — pode precisar de QR Code';
  return 'Desconectado sem motivo registrado';
}

export async function fetchDisconnectedInstances(): Promise<DisconnectedAlert[]> {
  const base = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY ?? '';

  const res = await fetch(`${base}/instance/fetchInstances`, {
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`Evolution API ${res.status}: ${await res.text().catch(() => '')}`);

  const instances = await res.json() as EvolutionInstance[];

  return instances
    .filter((i) => i.connectionStatus !== 'open')
    .map((i) => ({
      name: i.name,
      status: i.connectionStatus,
      profileName: i.profileName,
      phone: i.ownerJid ? i.ownerJid.replace('@s.whatsapp.net', '').replace('@c.us', '') : null,
      reasonCode: i.disconnectionReasonCode,
      reason: parseReason(i),
      disconnectedAt: i.disconnectionAt ?? null,
    }));
}

export async function ensureAlertLogTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.evolution_alert_log (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      instance    TEXT        NOT NULL,
      status      TEXT        NOT NULL,
      alert_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
      alerted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (instance, status, alert_date)
    )
  `);
}

function buildWhatsAppMessage(alerts: DisconnectedAlert[]): string {
  const lines = ['⚠️ *Alerta — Instâncias Evolution desconectadas*\n'];
  for (const a of alerts) {
    const who = a.profileName ? `*${a.profileName}*` : `*${a.name}*`;
    const phone = a.phone ? ` (${a.phone})` : '';
    const when = a.disconnectedAt
      ? new Date(a.disconnectedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';
    lines.push(
      `📵 ${who}${phone}\n` +
      `Status: ${a.status}\n` +
      `Motivo: ${a.reason}\n` +
      `Desde: ${when}\n`,
    );
  }
  lines.push('Acesse Configurações → Disparos para reconectar.');
  return lines.join('\n');
}

function buildEmailHtml(alerts: DisconnectedAlert[]): { subject: string; html: string; text: string } {
  const subject = `⚠️ ${alerts.length} instância(s) Evolution desconectada(s)`;
  const rows = alerts.map((a) => {
    const when = a.disconnectedAt
      ? new Date(a.disconnectedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : '—';
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #333;">${a.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #333;">${a.profileName ?? '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #333;color:#f87171;">${a.status}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #333;">${a.reason}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #333;font-size:12px;">${when}</td>
      </tr>`;
  }).join('');

  const html = `
    <div style="background:#0e0f14;color:#e5e7eb;font-family:Inter,sans-serif;padding:24px;border-radius:8px;max-width:700px">
      <h2 style="color:#f87171;margin:0 0 16px">⚠️ Instâncias Evolution desconectadas</h2>
      <table style="width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#2a2a2a">
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#9ca3af">Instância</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#9ca3af">Perfil</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#9ca3af">Status</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#9ca3af">Motivo</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#9ca3af">Desde</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px;font-size:13px;color:#9ca3af">
        Acesse <strong>Configurações → Disparos</strong> para reconectar as instâncias via QR Code.
      </p>
    </div>`;

  const text = alerts.map((a) =>
    `${a.name} | ${a.profileName ?? '—'} | ${a.status} | ${a.reason}`,
  ).join('\n');

  return { subject, html, text };
}

interface SendOptions {
  force?: boolean;
  whatsappInstance?: string;
  whatsappGroup?: string;
  emailTo?: string;
}

interface SendResult {
  whatsapp: string;
  email: string;
  newAlerts: number;
  totalDisconnected: number;
}

export async function sendInstanceAlerts(
  alerts: DisconnectedAlert[],
  opts: SendOptions = {},
): Promise<SendResult> {
  const result: SendResult = { whatsapp: 'skipped', email: 'skipped', newAlerts: 0, totalDisconnected: alerts.length };
  if (alerts.length === 0) return result;

  const pool = makeServerPool();
  try {
    await ensureAlertLogTable(pool);

    // dedup: only send for new (instance, status) pairs today
    const newAlerts: DisconnectedAlert[] = [];
    for (const a of alerts) {
      if (opts.force) {
        await pool.query(
          `DELETE FROM public.evolution_alert_log WHERE instance = $1 AND alert_date = CURRENT_DATE`,
          [a.name],
        );
        newAlerts.push(a);
        continue;
      }
      const { rowCount } = await pool.query(
        `INSERT INTO public.evolution_alert_log (instance, status)
         VALUES ($1, $2) ON CONFLICT (instance, status, alert_date) DO NOTHING`,
        [a.name, a.status],
      );
      if ((rowCount ?? 0) > 0) newAlerts.push(a);
    }

    result.newAlerts = newAlerts.length;
    if (newAlerts.length === 0) return result;

    // WhatsApp
    const waInstance = opts.whatsappInstance ?? process.env.EVOLUTION_DEFAULT_INSTANCE ?? 'numero_matheus_4398835555';
    const waTarget = opts.whatsappGroup;
    if (waTarget) {
      const msg = buildWhatsAppMessage(newAlerts);
      const r = await sendEvolutionText(waInstance, waTarget, msg);
      result.whatsapp = r.ok ? 'enviado' : `falhou: ${r.error ?? 'erro desconhecido'}`;
    }

    // Email
    const to = opts.emailTo ?? process.env.WEBSHARE_ALERT_EMAIL ?? '';
    if (to) {
      const { rows: gmailRows } = await pool.query<{ email: string; refresh_token: string }>(
        `SELECT email, refresh_token FROM public.google_connections
         WHERE account_type = 'gmail' AND status = 'connected' AND refresh_token IS NOT NULL
         LIMIT 1`,
      );
      if (gmailRows[0]) {
        const { subject, html, text } = buildEmailHtml(newAlerts);
        const r = await sendGmail({ email: gmailRows[0].email, refreshToken: gmailRows[0].refresh_token }, { to, subject, html, text });
        result.email = r.ok ? `enviado para ${to}` : `falhou: ${r.error ?? 'erro desconhecido'}`;
      } else {
        result.email = 'nenhuma conta Gmail conectada';
      }
    }

    return result;
  } finally {
    await pool.end();
  }
}
