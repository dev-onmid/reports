import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

type CampaignRow = Record<string, unknown>;

export type MonthlySummaryRow = {
  month: number;
  year: number;
  summary: string;
  meta_spend?: number | null;
  google_spend?: number | null;
  total_leads?: number | null;
};

export type ReportPdfData = {
  clientName: string;
  period: string;
  metaCampaigns: CampaignRow[];
  googleCampaigns: CampaignRow[];
  crmLeads: CampaignRow[];
  monthlySummaries?: MonthlySummaryRow[];
};

const GREEN  = rgb(0.333, 0.961, 0.184);
const DARK   = rgb(0.059, 0.067, 0.090);
const CARD   = rgb(0.102, 0.114, 0.153);
const LIGHT  = rgb(0.910, 0.918, 0.929);
const MUTED  = rgb(0.612, 0.639, 0.686);
const BLUE   = rgb(0.024, 0.408, 0.882);
const GGREEN = rgb(0.204, 0.659, 0.325);
const AMBER  = rgb(0.961, 0.620, 0.043);
const ROW_ALT = rgb(0.086, 0.098, 0.141);

const W = 595.28;
const H = 841.89;
const PAD = 40;
const COL = W - PAD * 2;

function currency(n: unknown): string {
  const v = typeof n === 'string' ? parseFloat(n) : Number(n ?? 0);
  return isNaN(v) ? 'R$ 0,00' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: unknown): string {
  const v = typeof n === 'string' ? parseFloat(n) : Number(n ?? 0);
  return isNaN(v) ? '0%' : `${v.toFixed(2)}%`;
}

function num(n: unknown): string {
  return String(Number(n ?? 0).toLocaleString('pt-BR'));
}

function sumField(rows: CampaignRow[], field: string): number {
  return rows.reduce((s, r) => s + (parseFloat(String(r[field] ?? 0)) || 0), 0);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// y helper: converts pdfkit top-origin y → pdf-lib bottom-origin y
function ty(y: number, fontSize = 0): number {
  return H - y - fontSize;
}

export async function generateReportPdf(data: ReportPdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);

  // ── helpers ──────────────────────────────────────────────────────────────────

  function addPage() {
    return doc.addPage([W, H]);
  }

  function fillBg(page: ReturnType<typeof addPage>, color = DARK) {
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color });
  }

  function accentBar(page: ReturnType<typeof addPage>, color = GREEN) {
    page.drawRectangle({ x: 0, y: 0, width: 6, height: H, color });
  }

  function text(
    page: ReturnType<typeof addPage>,
    str: string,
    x: number,
    y: number, // pdfkit-style (from top)
    size: number,
    color = LIGHT,
    font = regular,
  ) {
    page.drawText(str, { x, y: ty(y, size), size, color, font });
  }

  function sectionTitle(page: ReturnType<typeof addPage>, label: string, y: number): number {
    text(page, label.toUpperCase(), PAD + 6, y, 10, GREEN, bold);
    page.drawLine({
      start: { x: PAD + 6, y: ty(y + 14) },
      end:   { x: W - PAD, y: ty(y + 14) },
      color: GREEN,
      thickness: 0.5,
    });
    return y + 24;
  }

  function kpiCard(
    page: ReturnType<typeof addPage>,
    x: number, y: number, w: number, h: number,
    label: string, value: string,
  ) {
    page.drawRectangle({ x, y: ty(y + h), width: w, height: h, color: CARD });
    text(page, label, x + 12, y + 14, 8, MUTED, regular);
    text(page, value, x + 12, y + 28, 16, LIGHT, bold);
  }

  function tableHeader(
    page: ReturnType<typeof addPage>,
    headers: string[], x: number, y: number, colWidths: number[],
  ): number {
    let cx = x;
    headers.forEach((h, i) => {
      const align = i === 0 ? 'left' : 'right';
      const tx = align === 'right' ? cx + colWidths[i] - regular.widthOfTextAtSize(h, 8) - 8 : cx + 4;
      text(page, h, tx, y + 6, 8, MUTED, bold);
      cx += colWidths[i];
    });
    const totalW = colWidths.reduce((a, b) => a + b, 0);
    page.drawLine({
      start: { x, y: ty(y + 20) },
      end:   { x: x + totalW, y: ty(y + 20) },
      color: rgb(0.176, 0.192, 0.259),
      thickness: 0.5,
    });
    return y + 22;
  }

  function tableRow(
    page: ReturnType<typeof addPage>,
    cells: string[], x: number, y: number, colWidths: number[], even: boolean,
  ): number {
    const totalW = colWidths.reduce((a, b) => a + b, 0);
    if (even) page.drawRectangle({ x, y: ty(y + 20), width: totalW, height: 20, color: ROW_ALT });
    let cx = x;
    cells.forEach((c, i) => {
      const maxChars = Math.floor((colWidths[i] - 8) / 5);
      const str = truncate(c, maxChars);
      const align = i === 0 ? 'left' : 'right';
      const tx = align === 'right' ? cx + colWidths[i] - regular.widthOfTextAtSize(str, 8) - 8 : cx + 4;
      text(page, str, tx, y + 6, 8, LIGHT, regular);
      cx += colWidths[i];
    });
    return y + 20;
  }

  // ── PAGE 1: Cover ─────────────────────────────────────────────────────────────
  const metaSpend    = sumField(data.metaCampaigns,   'spend');
  const googleSpend  = sumField(data.googleCampaigns, 'spend');
  const totalSpend   = metaSpend + googleSpend;
  const metaLeads    = sumField(data.metaCampaigns,   'leads');
  const googleLeads  = sumField(data.googleCampaigns, 'leads');
  const totalLeads   = metaLeads + googleLeads;
  const cpl          = totalLeads > 0 ? totalSpend / totalLeads : 0;

  const p1 = addPage();
  fillBg(p1);
  accentBar(p1);
  text(p1, 'ONMID REPORTS', PAD + 6, 60,  10, GREEN, bold);
  text(p1, 'Relatório de',  PAD + 6, 120, 36, LIGHT, bold);
  text(p1, 'Performance',   PAD + 6, 162, 36, LIGHT, bold);

  // Client badge
  p1.drawRectangle({ x: PAD + 6, y: ty(240 + 56), width: COL - 6, height: 56, color: CARD });
  text(p1, 'CLIENTE',          PAD + 20, 252, 9,  MUTED, regular);
  text(p1, data.clientName,    PAD + 20, 266, 18, LIGHT, bold);

  // Period badge
  p1.drawRectangle({ x: PAD + 6, y: ty(312 + 40), width: COL - 6, height: 40, color: CARD });
  text(p1, 'PERÍODO',                   PAD + 20, 322, 9,  MUTED, regular);
  text(p1, data.period.toUpperCase(),   PAD + 20, 334, 13, GREEN, bold);

  // KPI cards
  const CARD_W = (COL - 6 - 12) / 3;
  kpiCard(p1, PAD + 6,                     375, CARD_W, 70, 'Investimento Total', currency(totalSpend));
  kpiCard(p1, PAD + 6 + CARD_W + 6,        375, CARD_W, 70, 'Leads Gerados',      num(totalLeads));
  kpiCard(p1, PAD + 6 + (CARD_W + 6) * 2, 375, CARD_W, 70, 'CPL Médio',          currency(cpl));

  text(p1, `Gerado em ${new Date().toLocaleDateString('pt-BR')} via Luna IA · Onmid Marketing`, PAD + 6, H - 30, 8, MUTED, regular);

  // ── PAGE 2: Meta Ads ──────────────────────────────────────────────────────────
  if (data.metaCampaigns.length > 0) {
    const p2 = addPage();
    fillBg(p2);
    accentBar(p2, BLUE);
    text(p2, 'META ADS',            PAD + 6, 40, 10, BLUE, bold);
    text(p2, 'Campanhas & Métricas', PAD + 6, 58, 20, LIGHT, bold);
    text(p2, data.period,            PAD + 6, 85,  9, MUTED, regular);

    const metaClicks      = sumField(data.metaCampaigns, 'clicks');
    const metaImpressions = sumField(data.metaCampaigns, 'impressions');
    const metaCtr = metaClicks / Math.max(metaImpressions, 1) * 100;
    const metaCpl = metaLeads > 0 ? metaSpend / metaLeads : 0;
    const HALF = (COL - 6) / 2 - 4;

    kpiCard(p2, PAD + 6,           104, HALF, 64, 'Investimento Meta', currency(metaSpend));
    kpiCard(p2, PAD + 6 + HALF + 8, 104, HALF, 64, 'Leads Meta',       num(metaLeads));
    kpiCard(p2, PAD + 6,           176, HALF, 64, 'CPL Meta',          currency(metaCpl));
    kpiCard(p2, PAD + 6 + HALF + 8, 176, HALF, 64, 'CTR Médio',        pct(metaCtr));

    let y = sectionTitle(p2, 'Campanhas', 260);
    const mCols = [190, 70, 70, 65, 65, 55];
    y = tableHeader(p2, ['Campanha', 'Status', 'Gasto', 'Leads', 'CPL', 'CTR'], PAD + 6, y, mCols);
    data.metaCampaigns.slice(0, 20).forEach((c, i) => {
      if (y > H - 60) return;
      y = tableRow(p2, [
        String(c.name ?? '').slice(0, 28),
        String(c.status ?? 'ACTIVE') === 'ACTIVE' ? 'Ativa' : 'Pausada',
        currency(c.spend),
        num(c.leads),
        currency(Number(c.spend ?? 0) / Math.max(Number(c.leads ?? 0), 1)),
        pct(c.ctr),
      ], PAD + 6, y, mCols, i % 2 === 0);
    });
    text(p2, `${data.metaCampaigns.length} campanha(s) no período`, PAD + 6, H - 24, 8, MUTED, regular);
  }

  // ── PAGE 3: Google Ads ────────────────────────────────────────────────────────
  if (data.googleCampaigns.length > 0) {
    const p3 = addPage();
    fillBg(p3);
    accentBar(p3, GGREEN);
    text(p3, 'GOOGLE ADS',           PAD + 6, 40, 10, GGREEN, bold);
    text(p3, 'Campanhas & Métricas', PAD + 6, 58, 20, LIGHT, bold);
    text(p3, data.period,             PAD + 6, 85,  9, MUTED, regular);

    const googleClicks      = sumField(data.googleCampaigns, 'clicks');
    const googleImpressions = sumField(data.googleCampaigns, 'impressions');
    const googleCtr = googleClicks / Math.max(googleImpressions, 1) * 100;
    const googleCpl = googleLeads > 0 ? googleSpend / googleLeads : 0;
    const HALF = (COL - 6) / 2 - 4;

    kpiCard(p3, PAD + 6,           104, HALF, 64, 'Investimento Google', currency(googleSpend));
    kpiCard(p3, PAD + 6 + HALF + 8, 104, HALF, 64, 'Conversões',         num(googleLeads));
    kpiCard(p3, PAD + 6,           176, HALF, 64, 'CPA Médio',           currency(googleCpl));
    kpiCard(p3, PAD + 6 + HALF + 8, 176, HALF, 64, 'CTR Médio',          pct(googleCtr));

    let y = sectionTitle(p3, 'Campanhas', 260);
    const gCols = [200, 70, 70, 60, 60, 55];
    y = tableHeader(p3, ['Campanha', 'Status', 'Gasto', 'Conversões', 'CPA', 'CTR'], PAD + 6, y, gCols);
    data.googleCampaigns.slice(0, 20).forEach((c, i) => {
      if (y > H - 60) return;
      y = tableRow(p3, [
        String(c.name ?? '').slice(0, 30),
        String(c.status ?? 'ENABLED') === 'ENABLED' ? 'Ativa' : 'Pausada',
        currency(c.spend),
        num(c.leads),
        currency(Number(c.spend ?? 0) / Math.max(Number(c.leads ?? 0), 1)),
        pct(c.ctr),
      ], PAD + 6, y, gCols, i % 2 === 0);
    });
    text(p3, `${data.googleCampaigns.length} campanha(s) no período`, PAD + 6, H - 24, 8, MUTED, regular);
  }

  // ── PAGE 4: CRM ───────────────────────────────────────────────────────────────
  if (data.crmLeads.length > 0) {
    const p4 = addPage();
    fillBg(p4);
    accentBar(p4, AMBER);
    text(p4, 'CRM',                    PAD + 6, 40, 10, AMBER, bold);
    text(p4, 'Leads & Funil de Vendas', PAD + 6, 58, 20, LIGHT, bold);

    const statusCount = (s: string) => data.crmLeads.filter(l => String(l.status ?? '').toLowerCase().includes(s)).length;
    const wins     = statusCount('won') + statusCount('win');
    const meetings = statusCount('meeting');
    const THIRD = (COL - 6 - 12) / 3;

    kpiCard(p4, PAD + 6,                    100, THIRD, 64, 'Total de Leads', num(data.crmLeads.length));
    kpiCard(p4, PAD + 6 + THIRD + 6,        100, THIRD, 64, 'Reuniões',       num(meetings));
    kpiCard(p4, PAD + 6 + (THIRD + 6) * 2, 100, THIRD, 64, 'Fechamentos',    num(wins));

    let y = sectionTitle(p4, 'Últimos Leads', 186);
    const lCols = [160, 100, 100, 155];
    y = tableHeader(p4, ['Nome', 'Status', 'Data', 'Contato'], PAD + 6, y, lCols);
    data.crmLeads.slice(0, 25).forEach((l, i) => {
      if (y > H - 60) return;
      const date = l.created_at ? new Date(String(l.created_at)).toLocaleDateString('pt-BR') : '-';
      y = tableRow(p4, [
        String(l.name ?? '').slice(0, 22),
        String(l.status ?? '-').slice(0, 14),
        date,
        String(l.phone ?? l.email ?? '-').slice(0, 22),
      ], PAD + 6, y, lCols, i % 2 === 0);
    });
  }

  // ── PAGE 5: Monthly Summaries ─────────────────────────────────────────────────
  const HIST_COLOR = rgb(0.333, 0.961, 0.184); // same green
  if (data.monthlySummaries && data.monthlySummaries.length > 0) {
    const MONTH_NAMES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const ph = addPage();
    fillBg(ph);
    accentBar(ph, HIST_COLOR);
    text(ph, 'HISTÓRICO', PAD + 6, 40, 10, HIST_COLOR, bold);
    text(ph, 'Resumos Mensais', PAD + 6, 58, 20, LIGHT, bold);

    let y = 100;
    for (const s of data.monthlySummaries.slice(0, 6)) {
      if (y > H - 100) break;
      const monthLabel = `${MONTH_NAMES[s.month] ?? s.month} ${s.year}`;
      const spend = (s.meta_spend ?? 0) + (s.google_spend ?? 0);

      // Card background
      ph.drawRectangle({ x: PAD + 6, y: ty(y + 72), width: COL - 6, height: 72, color: CARD });

      // Month header
      text(ph, monthLabel.toUpperCase(), PAD + 20, y + 14, 9, HIST_COLOR, bold);

      // KPIs on same line
      if (spend > 0) {
        const kStr = `Gasto: ${currency(spend)}`;
        text(ph, kStr, PAD + 6 + 140, y + 14, 8, MUTED, regular);
      }
      if ((s.total_leads ?? 0) > 0) {
        const lStr = `Leads: ${num(s.total_leads)}`;
        text(ph, lStr, PAD + 6 + 260, y + 14, 8, MUTED, regular);
      }

      // Summary text — wrap to ~95 chars per line, max 2 lines
      const words = s.summary.split(/\s+/);
      const lines: string[] = [];
      let line = '';
      for (const w of words) {
        if ((line + ' ' + w).trim().length > 90) { lines.push(line.trim()); line = w; }
        else line = line ? line + ' ' + w : w;
        if (lines.length >= 2) break;
      }
      if (line && lines.length < 2) lines.push(line.trim());

      lines.forEach((l, i) => text(ph, l, PAD + 20, y + 32 + i * 14, 8, LIGHT, regular));

      y += 80;
    }
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
