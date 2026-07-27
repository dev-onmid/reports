import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { getAccountBalances, sendBalanceAlerts, selectLowBalance, DEFAULT_DIAS_ANTECEDENCIA } from '@/lib/balance-alerts';
import {
  ensureBalanceAlertTables,
  buildTarget,
  BALANCE_CONFIG_SELECT,
  type BalanceAlertConfigRow,
} from '@/lib/balance-alert-configs';

export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const pool = makeServerPool();
  let cfg: BalanceAlertConfigRow | null = null;
  try {
    const scope = await getCallerScope(request, pool);
    if (!scope.unrestricted) return Response.json({ error: 'Sem permissão' }, { status: 403 });

    await ensureBalanceAlertTables(pool);
    const { rows } = await pool.query<BalanceAlertConfigRow>(
      `${BALANCE_CONFIG_SELECT} WHERE bac.id = $1`, [id],
    );
    cfg = rows[0] ?? null;
  } finally {
    await pool.end();
  }

  if (!cfg) return Response.json({ error: 'Configuração não encontrada' }, { status: 404 });

  const target = buildTarget(cfg);
  if (!target) return Response.json({ error: 'Instância de WhatsApp inativa ou sem credenciais' }, { status: 400 });

  const dias = cfg.dias_antecedencia ?? DEFAULT_DIAS_ANTECEDENCIA;
  const accounts = await getAccountBalances();
  const result = await sendBalanceAlerts(target, accounts, {
    configId: cfg.id,
    diasAntecedencia: dias,
    emailTo: cfg.email_to ?? undefined,
    force: true,
  });

  return Response.json({
    ok: true,
    diasAntecedencia: dias,
    totalChecked: accounts.length,
    atRisk: selectLowBalance(accounts, dias).length,
    alerted: result.alerted.length,
    whatsapp: result.whatsapp,
    email: result.email,
  });
}
