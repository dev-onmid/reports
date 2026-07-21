import { randomUUID } from 'crypto';
import { makeServerPool } from '@/lib/server-db';
import {
  fetchInstagramData,
  sCapa, sInstagram, sInstagramCalendar, sInstagramPosts, sInstagramSpotlight,
  sInstagramTodosConteudos, ordenarPostsPorData, TODOS_CONTEUDOS_POR_PAGINA,
  monthsBetweenInclusive, FONT_LINK, CANVAS, INTER,
  resolveReportCover, fetchReportRotationSeed,
  type DiagJson, type ParsedData, type CompareOverride,
} from './delivery-report-builder';
import { sectionEnabled } from './report-sections';

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
  // Páginas habilitadas (keys de src/lib/report-sections.ts). null/undefined = todas.
  sections?: string[] | null;
  // Período de comparação do Instagram escolhido na geração (undefined = automático).
  compare?: CompareOverride;
}): Promise<{ html: string }> {
  const { clientId, clientName, connectionId, accountIds, periodFrom, periodTo, coverId, sections = null, compare } = input;

  const fromDate = new Date(periodFrom + 'T12:00:00');
  const toDate   = new Date(periodTo   + 'T12:00:00');
  const MONTHS   = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodo     = `${MONTHS[fromDate.getMonth()]}/${fromDate.getFullYear()}`;
  // Label do período anterior: usa o override explícito quando houver, senão o mês-calendário anterior.
  const prevFromDate = compare ? new Date(compare.from + 'T12:00:00') : new Date(fromDate.getFullYear(), fromDate.getMonth() - 1, 1);
  const prevPeriodo  = compare === null ? '' : `${MONTHS[prevFromDate.getMonth()]}/${prevFromDate.getFullYear()}`;

  const [instagramFull, rotationSeed] = await Promise.all([
    // Called unconditionally — fetchInstagramData resolves a directly-linked Instagram
    // account (client_account_links platform='instagram') on its own even without a
    // Meta Ads connection/account for this client.
    fetchInstagramData(clientId, connectionId ?? null, accountIds ?? [], periodFrom, periodTo, compare),
    fetchReportRotationSeed(),
  ]);
  const cover = resolveReportCover(coverId, rotationSeed);

  const instagram = instagramFull?.insights ?? null;
  const igPosts    = instagramFull?.posts ?? [];
  const instagramCalendarMonths = monthsBetweenInclusive(fromDate, toDate);

  // sCapa accepts a DiagJson but never renders its text — no need for an AI call here.
  const diag: DiagJson = { insight_campanha_conversa: '', insight_campanha_conversao: '' };

  // Cada página só entra se tem dados E se a seção está habilitada na geração
  // (checkboxes "Personalizar páginas"; sections=null mantém o padrão: todas).
  const en = (key: string) => sectionEnabled(sections, key);

  const hasInstagram          = instagram !== null && en('instagram_resumo');
  const hasInstagramPosts     = igPosts.length > 0;
  const hasTodosConteudos     = hasInstagramPosts && en('todos_conteudos');
  const hasCalendario         = hasInstagramPosts && en('calendario');
  const hasTopConteudos       = hasInstagramPosts && en('top_conteudos');
  const hasInstagramSpotlight = hasInstagramPosts && en('melhor_conteudo');
  const todosConteudosPages   = hasTodosConteudos ? Math.ceil(igPosts.length / TODOS_CONTEUDOS_POR_PAGINA) : 0;

  const total = 1
    + (hasInstagram      ? 1 : 0)
    + todosConteudosPages
    + (hasCalendario ? instagramCalendarMonths.length : 0)
    + (hasTopConteudos ? 1 : 0)
    + (hasInstagramSpotlight ? 1 : 0);

  const slides: string[] = [];
  let i = 1;

  slides.push(sCapa(
    EMPTY_DATA, null, clientName, periodo, prevPeriodo, diag, total, cover,
    'Relatório de Redes Sociais',
    'Análise de calendário de postagens, principais conteúdos e métricas de Instagram do período.',
  ));

  if (hasInstagram) slides.push(sInstagram(instagram!, ++i, total, periodo));
  if (hasCalendario) {
    for (const monthDate of instagramCalendarMonths) {
      slides.push(sInstagramCalendar(igPosts, ++i, total, monthDate));
    }
  }
  if (hasTodosConteudos) {
    const ordered = ordenarPostsPorData(igPosts);
    for (let start = 0, page = 1; start < ordered.length; start += TODOS_CONTEUDOS_POR_PAGINA, page++) {
      slides.push(sInstagramTodosConteudos(ordered.slice(start, start + TODOS_CONTEUDOS_POR_PAGINA), ++i, total, page, todosConteudosPages));
    }
  }
  if (hasTopConteudos)       slides.push(sInstagramPosts(igPosts, ++i, total));
  if (hasInstagramSpotlight) slides.push(sInstagramSpotlight(igPosts, ++i, total));

  return { html: `${FONT_LINK}<div class="onmid-report" style="background:${CANVAS};padding:28px;font-family:${INTER}">${slides.join('')}</div>` };
}
