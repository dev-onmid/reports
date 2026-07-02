// Saúde da conta Webshare — banda consumida + status de cobrança.
// O proxy Webshare é ponto único de falha de TODAS as instâncias Evolution:
// se a banda estoura (throttled/402 bandwidthlimit) ou a assinatura pausa por
// pagamento, todo o WhatsApp cai. Este módulo lê o estado para alertar antes.
// Docs: https://apidocs.webshare.io/proxystats/aggregate e /subscription

const API_BASE = 'https://proxy.webshare.io/api/v2';

function headers() {
  const key = process.env.WEBSHARE_API_KEY;
  if (!key) throw new Error('WEBSHARE_API_KEY não configurada no servidor');
  return { Authorization: `Token ${key}`, 'Content-Type': 'application/json' };
}

export interface WebshareHealth {
  usedGb: number;
  limitGb: number;
  usedPct: number;          // 0-100
  throttled: boolean;       // banda estourada — o proxy já bloqueia (402 bandwidthlimit)
  paused: boolean;          // assinatura pausada — provável pagamento pendente
  renewalsEnabled: boolean; // renovação automática ligada
  endDate: string | null;   // fim do ciclo atual (ISO)
  daysToEnd: number | null;
}

interface Subscription {
  paused?: boolean;
  throttled?: boolean;
  renewals_enabled?: boolean;
  end_date?: string | null;
}

interface AggregateStats {
  bandwidth_total?: number; // bytes consumidos no período
}

// O limite de banda não vem cru na API de subscription, então é configurável
// (o plano atual é 250 GB). Ajuste via WEBSHARE_BANDWIDTH_LIMIT_GB se mudar o plano.
function limitGb(): number {
  const n = Number(process.env.WEBSHARE_BANDWIDTH_LIMIT_GB ?? '250');
  return Number.isFinite(n) && n > 0 ? n : 250;
}

export async function getWebshareHealth(): Promise<WebshareHealth> {
  const subRes = await fetch(`${API_BASE}/subscription/`, { headers: headers() });
  if (!subRes.ok) throw new Error(`Webshare subscription HTTP ${subRes.status}`);
  const sub = await subRes.json() as Subscription;

  // Banda: agregado dos últimos 31 dias (a API aceita até 90). Cobre o ciclo atual.
  const now = new Date();
  const gte = new Date(now.getTime() - 31 * 24 * 3600 * 1000);
  const params = new URLSearchParams({
    timestamp__gte: gte.toISOString(),
    timestamp__lte: now.toISOString(),
  });
  const statsRes = await fetch(`${API_BASE}/stats/aggregate/?${params.toString()}`, { headers: headers() });
  const stats = statsRes.ok ? (await statsRes.json() as AggregateStats) : {};
  const usedGb = (stats.bandwidth_total ?? 0) / (1024 ** 3);

  const limit = limitGb();
  const endDate = sub.end_date ?? null;
  const daysToEnd = endDate
    ? Math.ceil((new Date(endDate).getTime() - now.getTime()) / 86_400_000)
    : null;

  return {
    usedGb: Math.round(usedGb * 100) / 100,
    limitGb: limit,
    usedPct: limit > 0 ? Math.round((usedGb / limit) * 1000) / 10 : 0,
    throttled: sub.throttled === true,
    paused: sub.paused === true,
    renewalsEnabled: sub.renewals_enabled !== false,
    endDate,
    daysToEnd,
  };
}

export type WebshareAlertLevel = 'ok' | 'warn' | 'critical';

export function evaluateWebshareAlert(
  h: WebshareHealth,
  warnPct: number,
): { level: WebshareAlertLevel; reasons: string[] } {
  const reasons: string[] = [];
  let level: WebshareAlertLevel = 'ok';
  const bump = (to: WebshareAlertLevel) => {
    if (to === 'critical' || (to === 'warn' && level === 'ok')) level = to;
  };

  if (h.throttled) {
    reasons.push('Banda ESTOURADA (throttled) — o proxy já está bloqueando; o WhatsApp pode cair a qualquer momento.');
    bump('critical');
  }
  if (h.paused) {
    reasons.push('Assinatura PAUSADA — provável pagamento pendente.');
    bump('critical');
  }
  if (h.usedPct >= 100) {
    reasons.push(`Banda em ${h.usedPct}% (${h.usedGb} de ${h.limitGb} GB).`);
    bump('critical');
  } else if (h.usedPct >= warnPct) {
    reasons.push(`Banda em ${h.usedPct}% (${h.usedGb} de ${h.limitGb} GB).`);
    bump('warn');
  }
  if (!h.renewalsEnabled) {
    reasons.push('Renovação automática DESLIGADA — a conta expira no fim do ciclo.');
    bump('warn');
  }
  if (h.daysToEnd !== null && h.daysToEnd <= 3 && !h.renewalsEnabled) {
    reasons.push(`Ciclo termina em ${h.daysToEnd} dia(s).`);
  }

  return { level, reasons };
}
