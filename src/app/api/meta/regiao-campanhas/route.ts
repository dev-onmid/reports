// ── GET /api/meta/regiao-campanhas?clientIds=&campaignIds=&period=&dateFrom=&dateTo= ──
// Investimento e resultados das campanhas informadas POR ESTADO (UF), via
// `breakdowns=region` da Meta. Serve à tabela "Desempenho por região": a
// campanha NACIONAL (sem região no nome) roda no Brasil inteiro, mas a Meta
// sabe em que estado cada resultado foi gerado — é assim que o "Nacional /
// sem região" deixa de ser um bloco opaco (pedido do Matheus, 2026-09-23).
//
// ⚠️ Só Meta. O Google tem o equivalente (geographic_view), fica para depois.
// Uma chamada por conta (level=account + filtering por campaign.id), nunca
// por campanha — o teto de 10s da rota não aguentaria N campanhas × N contas.

import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { resolveMetaPeriod, applyMetaDateToUrl } from '@/lib/period-utils';
import { countMetaResults, type MetaAction } from '@/lib/meta-results';
import { ufDoEstado } from '@/lib/regiao-recorte';

export type RegiaoCampanhas = { uf: string; spend: number; leads: number; impressions: number; clicks: number };
export type RegiaoCampanhasResposta = { ok: boolean; porUf: RegiaoCampanhas[]; semUf: { spend: number; leads: number } };

const norm = (id: string) => id.replace(/^act_/, '');
const nodeId = (id: string) => (id.startsWith('act_') ? id : `act_${id}`);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const clientIds = (sp.get('clientIds') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const campaignIds = (sp.get('campaignIds') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const metaPeriod = resolveMetaPeriod(sp.get('period') ?? 'last_30d', sp.get('dateFrom') ?? '', sp.get('dateTo') ?? '');
  const vazio: RegiaoCampanhasResposta = { ok: false, porUf: [], semUf: { spend: 0, leads: 0 } };
  if (clientIds.length === 0 || campaignIds.length === 0) return Response.json(vazio);

  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conns: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let links: any[] = [];
  try {
    [conns, links] = await Promise.all([
      pool.query("SELECT * FROM public.meta_connections WHERE status = 'connected'").then(r => r.rows),
      pool.query(`SELECT client_id, connection_id, account_id FROM public.client_account_links WHERE platform = 'meta_ads' AND client_id = ANY($1::text[])`, [clientIds]).then(r => r.rows),
    ]);
  } catch {
    await pool.end().catch(() => {});
    return Response.json(vazio);
  }
  await pool.end().catch(() => {});

  const contasPorConn = new Map<string, Set<string>>();
  for (const l of links) {
    if (!l.connection_id || !l.account_id) continue;
    if (!contasPorConn.has(l.connection_id)) contasPorConn.set(l.connection_id, new Set());
    contasPorConn.get(l.connection_id)!.add(norm(String(l.account_id)));
  }

  const acc = new Map<string, RegiaoCampanhas>();
  const semUf = { spend: 0, leads: 0 };
  const filtering = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds.slice(0, 200) }]);

  await Promise.allSettled(conns.map(async (conn) => {
    const contas = contasPorConn.get(conn.id);
    if (!contas || contas.size === 0) return;
    const token = await getFreshMetaToken(conn);
    await Promise.allSettled([...contas].map(async (accountId) => {
      const url = new URL(`https://graph.facebook.com/v21.0/${nodeId(accountId)}/insights`);
      url.searchParams.set('fields', 'spend,impressions,clicks,actions');
      url.searchParams.set('level', 'account');
      url.searchParams.set('breakdowns', 'region');
      url.searchParams.set('filtering', filtering);
      url.searchParams.set('limit', '200');
      url.searchParams.set('access_token', token);
      applyMetaDateToUrl(url, metaPeriod);
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(9000) });
      if (!res.ok) return;
      const data = await res.json() as { data?: Array<Record<string, unknown>> };
      for (const row of data.data ?? []) {
        const spend = parseFloat(String(row.spend ?? '0')) || 0;
        const leads = countMetaResults((row.actions as MetaAction[] | undefined) ?? []);
        const uf = ufDoEstado(String(row.region ?? ''));
        if (!uf) { semUf.spend += spend; semUf.leads += leads; continue; }
        const cur = acc.get(uf) ?? { uf, spend: 0, leads: 0, impressions: 0, clicks: 0 };
        cur.spend += spend; cur.leads += leads;
        cur.impressions += parseInt(String(row.impressions ?? '0'), 10) || 0;
        cur.clicks += parseInt(String(row.clicks ?? '0'), 10) || 0;
        acc.set(uf, cur);
      }
    }));
  }));

  const porUf = [...acc.values()].sort((a, b) => b.spend - a.spend);
  return Response.json({ ok: true, porUf, semUf } satisfies RegiaoCampanhasResposta);
}
