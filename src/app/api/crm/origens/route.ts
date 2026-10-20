import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { canalSql, rotularCanal } from '@/lib/canal-lead';
import { lerJanela, trafegoOuManualSql } from '@/lib/crm-origem-filtro';

/**
 * Opções do filtro de origem do CRM: quantas conversas cada origem tem no
 * período, separando o que é tráfego (conta no dashboard ou foi criado à mão)
 * do que não veio de anúncio. Mesma régua de data da tela do CRM (coluna data).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const clientId = sp.get('clientId');
  const funnelId = sp.get('funnelId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });
  const janela = lerJanela(sp.get('from'), sp.get('to'));
  const params: unknown[] = [clientId, funnelId || null];
  const cond: string[] = [];
  if (janela.from) { params.push(janela.from); cond.push(`data >= $${params.length}::date`); }
  if (janela.to) { params.push(janela.to); cond.push(`data <= $${params.length}::date`); }
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT ${canalSql()} AS canal,
              count(*)::int AS total,
              count(*) FILTER (WHERE ${trafegoOuManualSql()})::int AS trafego
         FROM public.crm_leads
        WHERE client_id = $1
          AND ($2::uuid IS NULL OR funnel_id = $2::uuid)
          ${cond.length ? `AND ${cond.join(' AND ')}` : ''}
        GROUP BY 1
        ORDER BY 2 DESC`,
      params,
    );
    // Grafias diferentes do mesmo canal ("google" e "Google Ads", "Whatsapp" e
    // "WhatsApp") viram uma linha; o valor leva todas, separadas por "|".
    const porRotulo = new Map<string, { grafias: Set<string>; rotulo: string; total: number; trafego: number }>();
    for (const r of rows as { canal: string | null; total: number; trafego: number }[]) {
      const rotulo = rotularCanal(r.canal) ?? 'Sem canal informado';
      const chave = rotulo.toLowerCase();
      const atual = porRotulo.get(chave) ?? { grafias: new Set<string>(), rotulo, total: 0, trafego: 0 };
      atual.grafias.add((r.canal ?? '').trim());
      atual.total += r.total; atual.trafego += r.trafego;
      porRotulo.set(chave, atual);
    }
    const canais = [...porRotulo.values()]
      .map(c => ({ canal: [...c.grafias].join('|'), rotulo: c.rotulo, total: c.total, trafego: c.trafego }))
      .sort((a, b) => b.total - a.total);
    const total = canais.reduce((s, c) => s + c.total, 0);
    const trafego = canais.reduce((s, c) => s + c.trafego, 0);
    return Response.json({ total, trafego, semAnuncio: total - trafego, canais });
  } catch (e) {
    console.error('[crm origens]', e);
    return Response.json({ total: 0, trafego: 0, semAnuncio: 0, canais: [] });
  } finally {
    await pool.end();
  }
}
