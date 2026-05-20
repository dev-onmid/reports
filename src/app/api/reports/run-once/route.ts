import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  fetchMetaReport, fetchCrmReport, generateAnalysis,
  buildDiagnosticoData, saveReport, brl, numFmt,
} from '@/lib/report-runner';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    clientId?: string; from?: string; to?: string; periodLabel?: string;
  };

  const { clientId, from, to } = body;
  if (!clientId || !from || !to) {
    return Response.json({ error: 'clientId, from e to são obrigatórios' }, { status: 400 });
  }

  // Lookup client name + account links
  const pool = makeServerPool();
  let clientName = '';
  let metaConnectionId: string | null = null;
  let metaAccountIds: string[] = [];

  try {
    const { rows: clientRows } = await pool.query(
      `SELECT name FROM public.clients WHERE id = $1`, [clientId],
    );
    if (!clientRows[0]) return Response.json({ error: 'Cliente não encontrado' }, { status: 404 });
    clientName = clientRows[0].name as string;

    const { rows: links } = await pool.query(
      `SELECT platform, connection_id, account_id FROM public.client_account_links WHERE client_id = $1`,
      [clientId],
    );
    const metaLinks = links.filter((l: { platform: string }) => l.platform === 'meta');
    metaConnectionId = (metaLinks[0] as { connection_id: string } | undefined)?.connection_id ?? null;
    metaAccountIds = metaLinks.map((l: { account_id: string }) => l.account_id);
  } finally {
    await pool.end();
  }

  const periodLabel = body.periodLabel ?? `${from} a ${to}`;
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

  const [metaData, crmData] = await Promise.all([
    metaConnectionId && metaAccountIds.length > 0
      ? fetchMetaReport(metaConnectionId, metaAccountIds, from, to)
      : Promise.resolve(null),
    fetchCrmReport(clientId, from, to),
  ]);

  const meta = metaData ?? {
    spend: 0, impressions: 0, reach: 0, results: 0,
    newContacts: 0, totalContacts: 0, purchases: 0,
    facebook: { spend: 0, results: 0, newContacts: 0 },
    instagram: { spend: 0, results: 0, newContacts: 0 },
    criativos: [],
  };

  const analysisSummary = {
    cliente: clientName, periodo: periodLabel,
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
  const reportData = buildDiagnosticoData(clientName, periodLabel, meta, crmData, analysis);
  const { id, public_token } = await saveReport({
    clientId, clientName, periodFrom: from, periodTo: to,
    reportData, generatedBy: 'manual',
  });

  return Response.json({ ok: true, id, public_token });
}
