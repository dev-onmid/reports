import type { Pool } from 'pg';
import { sendText } from '@/lib/zapi';

// Aviso diário do Monitor de Redes Sociais via Z-API: depois da coleta do cron,
// manda no grupo escolhido a lista de contas VISÍVEIS no radar (monitored=TRUE)
// com >= minDays dias sem post no Instagram + insights de cada uma.

export type SocialAlertConfig = {
  ativo: boolean;
  zapiClientId: string | null;
  groupId: string | null;
  groupName: string | null;
  minDays: number;
};

const K = {
  ativo: 'social_alert_ativo',
  zapiClientId: 'social_alert_zapi_client_id',
  groupId: 'social_alert_group_id',
  groupName: 'social_alert_group_name',
  minDays: 'social_alert_min_days',
} as const;

async function ensureSettingsTable(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS public.system_settings (
       key TEXT PRIMARY KEY, value TEXT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT
     )`,
  ).catch(() => {});
}

export async function loadSocialAlertConfig(pool: Pool): Promise<SocialAlertConfig> {
  await ensureSettingsTable(pool);
  const { rows } = await pool.query(
    `SELECT key, value FROM public.system_settings WHERE key = ANY($1)`,
    [Object.values(K)],
  );
  const map = Object.fromEntries((rows as { key: string; value: string }[]).map(r => [r.key, r.value]));
  const minDays = parseInt(map[K.minDays] ?? '2', 10);
  return {
    ativo: map[K.ativo] === 'true',
    zapiClientId: map[K.zapiClientId] || null,
    groupId: map[K.groupId] || null,
    groupName: map[K.groupName] || null,
    minDays: Number.isInteger(minDays) && minDays >= 1 ? minDays : 2,
  };
}

export async function saveSocialAlertConfig(pool: Pool, cfg: SocialAlertConfig, userId?: string) {
  await ensureSettingsTable(pool);
  const entries: Array<[string, string]> = [
    [K.ativo, String(cfg.ativo)],
    [K.zapiClientId, cfg.zapiClientId ?? ''],
    [K.groupId, cfg.groupId ?? ''],
    [K.groupName, cfg.groupName ?? ''],
    [K.minDays, String(cfg.minDays)],
  ];
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO public.system_settings (key, value, updated_at, updated_by)
       VALUES ($1,$2,NOW(),$3)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW(), updated_by=EXCLUDED.updated_by`,
      [key, value, userId ?? null],
    );
  }
}

type AlertRow = {
  name: string;
  username: string;
  days: number;
  followers: number | null;
  posts30d: number | null;
  reach28d: number | null;
  avgLikes: number | null;
  avgComments: number | null;
};

// Só contas VISÍVEIS no radar (monitored=TRUE), com conta IG resolvida e último
// post conhecido. Clientes ocultos (só tráfego) ficam de fora por definição.
async function buildAlertRows(pool: Pool, minDays: number): Promise<AlertRow[]> {
  const { rows } = await pool.query(
    `SELECT c.name, s.ig_username, s.last_post_at, s.followers, s.posts_30d,
            s.reach_28d, s.avg_likes, s.avg_comments
       FROM public.social_monitor_snapshots s
       JOIN public.clients c ON c.id = s.client_id
      WHERE c.status NOT IN ('Arquivado','Inativo')
        AND s.monitored = TRUE
        AND s.ig_username IS NOT NULL
        AND s.last_post_at IS NOT NULL`,
  );
  const out: AlertRow[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const ts = new Date(String(r.last_post_at)).getTime();
    if (!Number.isFinite(ts)) continue;
    const days = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
    if (days < minDays) continue;
    out.push({
      name: String(r.name),
      username: String(r.ig_username),
      days,
      followers: r.followers !== null ? Number(r.followers) : null,
      posts30d: r.posts_30d !== null ? Number(r.posts_30d) : null,
      reach28d: r.reach_28d !== null ? Number(r.reach_28d) : null,
      avgLikes: r.avg_likes !== null ? Number(r.avg_likes) : null,
      avgComments: r.avg_comments !== null ? Number(r.avg_comments) : null,
    });
  }
  out.sort((a, b) => b.days - a.days);
  return out;
}

const nf = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const num = (n: number | null) => (n === null ? '—' : nf.format(n));

export function buildAlertMessage(alertRows: AlertRow[], minDays: number): string {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  if (alertRows.length === 0) {
    return `✅ *Monitor de Redes Sociais* — ${hoje}\n\nTodas as contas visíveis no radar postaram nos últimos ${minDays} dias. Tudo em dia!`;
  }
  const linhas = alertRows.map(r => {
    const insights = `${num(r.followers)} seguidores · ${r.posts30d ?? 0} posts/30d · alcance ${num(r.reach28d)} (28d)` +
      (r.avgLikes !== null ? ` · ${num(r.avgLikes)} curtidas/post` : '');
    return `🔴 *${r.name}* (@${r.username}) — *${r.days} ${r.days === 1 ? 'dia' : 'dias'} sem post*\n   ${insights}`;
  });
  return [
    `🚨 *Monitor de Redes Sociais* — ${hoje}`,
    '',
    `${alertRows.length} ${alertRows.length === 1 ? 'conta está' : 'contas estão'} há ${minDays}+ dias sem postar no Instagram:`,
    '',
    linhas.join('\n\n'),
    '',
    '_Aviso automático do ONMID Reports (contas ocultas do radar não entram)._',
  ].join('\n');
}

export type AlertSendResult = {
  sent: boolean;
  reason?: string;
  clientes?: number;
};

/**
 * Monta e envia o aviso no grupo configurado. `force=true` (teste manual) envia
 * mesmo desativado e mesmo sem ofensores (manda o "tudo em dia" pra validar o canal).
 * No cron, sem ofensores = não envia (grupo não recebe ruído diário).
 */
export async function sendSocialMonitorAlert(pool: Pool, opts: { force?: boolean } = {}): Promise<AlertSendResult> {
  const cfg = await loadSocialAlertConfig(pool);
  if (!opts.force && !cfg.ativo) return { sent: false, reason: 'Aviso desativado' };
  if (!cfg.zapiClientId || !cfg.groupId) return { sent: false, reason: 'Instância/grupo não configurados' };

  const alertRows = await buildAlertRows(pool, cfg.minDays);
  if (alertRows.length === 0 && !opts.force) return { sent: false, reason: 'Nenhuma conta acima do limite', clientes: 0 };

  const { rows } = await pool.query(
    `SELECT instance_id, token, security_token FROM public.zapi_clients WHERE id = $1 AND active = TRUE`,
    [cfg.zapiClientId],
  );
  const inst = rows[0] as { instance_id: string; token: string; security_token: string | null } | undefined;
  if (!inst) return { sent: false, reason: 'Instância Z-API não encontrada ou inativa' };

  const message = buildAlertMessage(alertRows, cfg.minDays);
  const result = await sendText(
    { instanceId: inst.instance_id, token: inst.token, clientToken: inst.security_token ?? undefined },
    cfg.groupId,
    message,
  );
  if (!result.ok) return { sent: false, reason: result.error ?? 'Falha no envio Z-API', clientes: alertRows.length };
  return { sent: true, clientes: alertRows.length };
}
