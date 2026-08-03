import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  getAccountBalances,
  sendBalanceAlerts,
  sinalizarAlertaSemCanal,
  DEFAULT_DIAS_ANTECEDENCIA,
} from '@/lib/balance-alerts';
import {
  ensureBalanceAlertTables,
  buildTarget,
  BALANCE_CONFIG_SELECT,
  type BalanceAlertConfigRow,
} from '@/lib/balance-alert-configs';

export const maxDuration = 60;

/**
 * Vercel calls crons with `Authorization: Bearer $CRON_SECRET` and does NOT
 * interpolate `${CRON_SECRET}` inside the cron `path` — the old query-param-only
 * check meant this route answered 401 every single day. GitHub Actions passes the
 * secret in the query string instead, so both forms are accepted, against the
 * same family of secrets the other crons use (CRON_SECRET is marked Sensitive on
 * Vercel and can't be read back, so the workflows use REPORTS_CRON_SECRET).
 */
function isAuthorized(req: NextRequest): boolean {
  const secrets = [
    process.env.CRON_SECRET,
    process.env.REPORTS_CRON_SECRET,
    process.env.CRM_CRON_SECRET,
  ].filter((s): s is string => Boolean(s));
  if (secrets.length === 0) return false;

  const urlSecret = req.nextUrl.searchParams.get('secret');
  const authHeader = req.headers.get('authorization');
  return secrets.some(s => urlSecret === s || authHeader === `Bearer ${s}`);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = makeServerPool();
  let configs: BalanceAlertConfigRow[] = [];
  try {
    // The cron may well be the first thing to touch these tables on a fresh
    // database — it used to SELECT blindly and throw if the Pagamentos screen
    // had never been opened.
    await ensureBalanceAlertTables(pool);
    const { rows } = await pool.query<BalanceAlertConfigRow>(
      `${BALANCE_CONFIG_SELECT} WHERE bac.active = true`,
    );
    configs = rows;

    if (configs.length === 0) {
      await sinalizarAlertaSemCanal(
        pool,
        'Nenhum destino ativo em Pagamentos → Alertas. Enquanto isso, nenhuma conta com saldo curto é avisada.',
      );
    }
  } finally {
    await pool.end();
  }

  if (configs.length === 0) return Response.json({ ok: true, alerts: 0, configs: 0 });

  const accounts = await getAccountBalances();
  const results = [];
  for (const cfg of configs) {
    const target = buildTarget(cfg);
    if (!target) {
      // A instância do destino saiu do ar ou perdeu credencial. Sem este aviso o
      // alerta simplesmente deixa de existir, e a resposta do cron segue ok.
      const p = makeServerPool();
      try {
        await sinalizarAlertaSemCanal(
          p,
          `O destino "${cfg.whatsapp_group}" aponta para uma instância de WhatsApp inativa ou sem credenciais. Reconfigure em Pagamentos → Alertas.`,
          cfg.id,
        );
      } finally {
        await p.end();
      }
      results.push({ configId: cfg.id, whatsapp: 'instância inativa ou sem credenciais', email: 'skipped' });
      continue;
    }
    const r = await sendBalanceAlerts(target, accounts, {
      configId: cfg.id,
      diasAntecedencia: cfg.dias_antecedencia ?? DEFAULT_DIAS_ANTECEDENCIA,
      emailTo: cfg.email_to ?? undefined,
    });
    results.push({
      configId: cfg.id,
      whatsapp: r.whatsapp,
      email: r.email,
      alerted: r.alerted.length,
      skipped: r.skipped.length,
    });
  }

  return Response.json({ ok: true, totalChecked: accounts.length, configs: results.length, results });
}
