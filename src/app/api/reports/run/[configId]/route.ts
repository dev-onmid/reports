import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  fetchMetaReport, fetchCrmReport, generateAnalysis,
  buildDiagnosticoData, saveReport, brl, numFmt,
} from '@/lib/report-runner';

export const maxDuration = 60;

function prevMonth(): { from: string; to: string; label: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const label = `01/${String(first.getMonth() + 1).padStart(2, '0')}/${first.getFullYear()} a ${String(last.getDate()).padStart(2, '0')}/${String(last.getMonth() + 1).padStart(2, '0')}/${last.getFullYear()}`;
  return { from: fmt(first), to: fmt(last), label };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ configId: string }> }) {
  const { configId } = await params;
  const body = await request.json().catch(() => ({})) as { dateFrom?: string; dateTo?: string; periodLabel?: string };

  const pool = makeServerPool();
  let config: {
    client_id: string; client_name: string;
    meta_connection_id: string | null; meta_account_ids: string[];
    google_connection_id: string | null; google_account_id: string | null;
  } | null = null;

  try {
    const { rows } = await pool.query(`
      SELECT
        rc.client_id, c.name AS client_name,
        (SELECT cal.connection_id FROM public.client_account_links cal
         WHERE cal.client_id = rc.client_id AND cal.platform = 'meta' LIMIT 1) AS meta_connection_id,
        ARRAY(SELECT cal.account_id FROM public.client_account_links cal
              WHERE cal.client_id = rc.client_id AND cal.platform = 'meta') AS meta_account_ids,
        (SELECT cal.connection_id FROM public.client_account_links cal
         WHERE cal.client_id = rc.client_id AND cal.platform = 'google' LIMIT 1) AS google_connection_id,
        (SELECT cal.account_id FROM public.client_account_links cal
         WHERE cal.client_id = rc.client_id AND cal.platform = 'google' LIMIT 1) AS google_account_id
      FROM public.report_configs rc
      JOIN public.clients c ON c.id = rc.client_id
      WHERE rc.id = $1
    `, [configId]);
    config = rows[0] ?? null;
  } finally {
    await pool.end();
  }

  if (!config) return Response.json({ error: 'Config not found' }, { status: 404 });

  const period = body.dateFrom
    ? { from: body.dateFrom, to: body.dateTo ?? body.dateFrom, label: body.periodLabel ?? `${body.dateFrom} a ${body.dateTo}` }
    : prevMonth();

  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

  const [metaData, crmData] = await Promise.all([
    config.meta_connection_id && config.meta_account_ids.length > 0
      ? fetchMetaReport(config.meta_connection_id, config.meta_account_ids, period.from, period.to)
      : Promise.resolve(null),
    fetchCrmReport(config.client_id, period.from, period.to),
  ]);

  const meta = metaData ?? {
    spend: 0, impressions: 0, reach: 0, results: 0,
    newContacts: 0, totalContacts: 0, purchases: 0,
    facebook: { spend: 0, results: 0, newContacts: 0 },
    instagram: { spend: 0, results: 0, newContacts: 0 },
    criativos: [],
  };

  const analysisSummary = {
    cliente: config.client_name, periodo: period.label,
    meta_ads: {
      investimento: brl(meta.spend), resultados: meta.results,
      custo_resultado: meta.results > 0 ? brl(meta.spend / meta.results) : '—',
      impressoes: numFmt(meta.impressions), alcance: numFmt(meta.reach),
      facebook: { investimento: brl(meta.facebook.spend), resultados: meta.facebook.results },
      instagram: { investimento: brl(meta.instagram.spend), resultados: meta.instagram.results },
      top_criativos: meta.criativos.slice(0, 5).map(c => c.nome),
    },
    crm: {
      registros: crmData.registros, pacientes_unicos: crmData.pacientes,
      faturamento_total: brl(crmData.totalFat),
      relacao_fat_investimento: meta.spend > 0 ? `${(crmData.totalFat / meta.spend).toFixed(2)}x` : '—',
      por_origem: crmData.porOrigem.map(o => ({ canal: o.canal, registros: o.registros, faturamento: o.faturamento })),
    },
  };

  const analysis = await generateAnalysis(analysisSummary, apiKey);
  const reportData = buildDiagnosticoData(config.client_name, period.label, meta, crmData, analysis);
  const { id, public_token } = await saveReport({
    clientId: config.client_id, clientName: config.client_name,
    periodFrom: period.from, periodTo: period.to,
    reportData, generatedBy: 'auto', configId,
  });

  return Response.json({ ok: true, id, public_token });
}
