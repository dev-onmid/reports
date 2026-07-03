import { randomUUID } from 'crypto';
import { makeServerPool } from '@/lib/server-db';
import {
  fetchInstagramData,
  sCapa, sInstagram, sInstagramCalendar, sInstagramPosts, sInstagramSpotlight,
  monthsBetweenInclusive, FONT_LINK, CANVAS, INTER,
  resolveReportCover, fetchReportRotationSeed,
  type DiagJson, type ParsedData,
} from './delivery-report-builder';

// ── Persist ───────────────────────────────────────────────────────────────────

export async function saveSocialReport(opts: {
  clientId: string;
  clientName: string;
  from: string;
  to: string;
  data: { html: string };
  generatedBy?: string;
  configId?: string;
}): Promise<{ token: string; reportId: string }> {
  const { clientId, clientName, from, to, data, generatedBy = 'manual', configId } = opts;
  const token = randomUUID();
  const pool  = makeServerPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.diagnostic_reports (client_id,client_name,period_from,period_to,template_slug,report_data,public_token,generated_by,config_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [clientId, clientName, from, to, 'onmid-narrative-social', JSON.stringify(data), token, generatedBy, configId ?? null],
    );
    return { token, reportId: rows[0].id as string };
  } finally {
    await pool.end();
  }
}

// ── Build ─────────────────────────────────────────────────────────────────────

const EMPTY_DATA: ParsedData = {
  ativos: 0, inativos: 0, potenciais: 0,
  faturamento: 0, pedidos_ativos: 0, ticket: 0,
  uma_compra: 0, recorrentes: 0,
  produtos: [], inativos_faixas: [], por_dia: [],
};

export async function buildSocialReport(input: {
  clientId: string;
  clientName: string;
  connectionId?: string | null;
  accountIds?: string[];
  periodFrom: string;
  periodTo: string;
  coverId?: string | null;
}): Promise<{ html: string }> {
  const { clientId, clientName, connectionId, accountIds, periodFrom, periodTo, coverId } = input;

  const fromDate = new Date(periodFrom + 'T12:00:00');
  const toDate   = new Date(periodTo   + 'T12:00:00');
  const MONTHS   = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodo     = `${MONTHS[fromDate.getMonth()]}/${fromDate.getFullYear()}`;
  const prevFromDate = new Date(fromDate.getFullYear(), fromDate.getMonth() - 1, 1);
  const prevPeriodo  = `${MONTHS[prevFromDate.getMonth()]}/${prevFromDate.getFullYear()}`;

  const [instagramFull, rotationSeed] = await Promise.all([
    // Called unconditionally — fetchInstagramData resolves a directly-linked Instagram
    // account (client_account_links platform='instagram') on its own even without a
    // Meta Ads connection/account for this client.
    fetchInstagramData(clientId, connectionId ?? null, accountIds ?? [], periodFrom, periodTo),
    fetchReportRotationSeed(),
  ]);
  const cover = resolveReportCover(coverId, rotationSeed);

  const instagram = instagramFull?.insights ?? null;
  const igPosts    = instagramFull?.posts ?? [];
  const instagramCalendarMonths = monthsBetweenInclusive(fromDate, toDate);

  // sCapa accepts a DiagJson but never renders its text — no need for an AI call here.
  const diag: DiagJson = { insight_campanha_conversa: '', insight_campanha_conversao: '' };

  const hasInstagram          = instagram !== null;
  const hasInstagramPosts     = igPosts.length > 0;
  const hasInstagramSpotlight = hasInstagramPosts;

  const total = 1
    + (hasInstagram      ? 1 : 0)
    + (hasInstagramPosts ? instagramCalendarMonths.length : 0)
    + (hasInstagramPosts ? 1 : 0)
    + (hasInstagramSpotlight ? 1 : 0);

  const slides: string[] = [];
  let i = 1;

  slides.push(sCapa(
    EMPTY_DATA, null, clientName, periodo, prevPeriodo, diag, total, cover,
    'Relatório de Redes Sociais',
    'Análise de calendário de postagens, principais conteúdos e métricas de Instagram do período.',
  ));

  if (hasInstagram) slides.push(sInstagram(instagram!, ++i, total, periodo));
  if (hasInstagramPosts) {
    for (const monthDate of instagramCalendarMonths) {
      slides.push(sInstagramCalendar(igPosts, ++i, total, monthDate));
    }
  }
  if (hasInstagramPosts)     slides.push(sInstagramPosts(igPosts, ++i, total));
  if (hasInstagramSpotlight) slides.push(sInstagramSpotlight(igPosts, ++i, total));

  return { html: `${FONT_LINK}<div class="onmid-report" style="background:${CANVAS};padding:28px;font-family:${INTER}">${slides.join('')}</div>` };
}
