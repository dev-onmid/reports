type PDFDocumentType = typeof import('pdfkit');

type CampaignRow = Record<string, unknown>;

export type ReportPdfData = {
  clientName: string;
  period: string;
  metaCampaigns: CampaignRow[];
  googleCampaigns: CampaignRow[];
  crmLeads: CampaignRow[];
};

const BRAND_GREEN = '#55f52f';
const DARK_BG = '#0f1117';
const CARD_BG = '#1a1d27';
const TEXT_LIGHT = '#e8eaed';
const TEXT_MUTED = '#9ca3af';

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

export async function generateReportPdf(data: ReportPdfData): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit') as PDFDocumentType;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Relatório ${data.clientName}`, Author: 'Onmid Reports' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28;
    const H = 841.89;
    const PAD = 40;
    const COL = W - PAD * 2;

    // ── Helpers ──────────────────────────────────────────────────────────────
    function fillPage(color: string) {
      doc.rect(0, 0, W, H).fill(color);
    }

    function sectionTitle(text: string, y: number) {
      doc.fontSize(10).fillColor(BRAND_GREEN).font('Helvetica-Bold').text(text.toUpperCase(), PAD, y, { characterSpacing: 1.5 });
      doc.moveTo(PAD, y + 14).lineTo(W - PAD, y + 14).strokeColor(BRAND_GREEN).lineWidth(0.5).stroke();
      return y + 22;
    }

    function kpiCard(x: number, y: number, w: number, h: number, label: string, value: string, sub?: string) {
      doc.roundedRect(x, y, w, h, 6).fill(CARD_BG);
      doc.fontSize(8).fillColor(TEXT_MUTED).font('Helvetica').text(label, x + 12, y + 12, { width: w - 24 });
      doc.fontSize(18).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text(value, x + 12, y + 26, { width: w - 24 });
      if (sub) doc.fontSize(8).fillColor(TEXT_MUTED).font('Helvetica').text(sub, x + 12, y + 48, { width: w - 24 });
    }

    function tableHeader(headers: string[], x: number, y: number, colWidths: number[]) {
      let cx = x;
      headers.forEach((h, i) => {
        doc.fontSize(8).fillColor(TEXT_MUTED).font('Helvetica-Bold').text(h, cx + 4, y + 4, { width: colWidths[i] - 8, align: i === 0 ? 'left' : 'right' });
        cx += colWidths[i];
      });
      doc.moveTo(x, y + 18).lineTo(x + colWidths.reduce((a, b) => a + b, 0), y + 18).strokeColor('#2d3142').lineWidth(0.5).stroke();
      return y + 20;
    }

    function tableRow(cells: string[], x: number, y: number, colWidths: number[], even: boolean) {
      if (even) doc.rect(x, y, colWidths.reduce((a, b) => a + b, 0), 20).fill('#161924');
      let cx = x;
      cells.forEach((c, i) => {
        doc.fontSize(8).fillColor(TEXT_LIGHT).font('Helvetica').text(c, cx + 4, y + 5, { width: colWidths[i] - 8, align: i === 0 ? 'left' : 'right', ellipsis: true });
        cx += colWidths[i];
      });
      return y + 20;
    }

    // ── PAGE 1: Cover ─────────────────────────────────────────────────────────
    fillPage(DARK_BG);
    // Green accent bar
    doc.rect(0, 0, 6, H).fill(BRAND_GREEN);
    // Brand
    doc.fontSize(10).fillColor(BRAND_GREEN).font('Helvetica-Bold').text('ONMID REPORTS', PAD + 6, 60, { characterSpacing: 2 });
    // Big title
    doc.fontSize(38).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text('Relatório de\nPerformance', PAD + 6, 120, { lineGap: 6 });
    // Client badge
    doc.roundedRect(PAD + 6, 240, COL - 6, 56, 8).fill(CARD_BG);
    doc.fontSize(10).fillColor(TEXT_MUTED).font('Helvetica').text('CLIENTE', PAD + 20, 252);
    doc.fontSize(20).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text(data.clientName, PAD + 20, 266);
    // Period
    doc.roundedRect(PAD + 6, 312, COL - 6, 40, 8).fill(CARD_BG);
    doc.fontSize(9).fillColor(TEXT_MUTED).font('Helvetica').text('PERÍODO', PAD + 20, 322);
    doc.fontSize(14).fillColor(BRAND_GREEN).font('Helvetica-Bold').text(data.period.toUpperCase(), PAD + 20, 335);
    // Summary numbers
    const metaSpend = sumField(data.metaCampaigns, 'spend');
    const googleSpend = sumField(data.googleCampaigns, 'spend');
    const totalSpend = metaSpend + googleSpend;
    const metaLeads = sumField(data.metaCampaigns, 'leads');
    const googleLeads = sumField(data.googleCampaigns, 'leads');
    const totalLeads = metaLeads + googleLeads;
    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const CARD_W = (COL - 6 - 12) / 3;
    kpiCard(PAD + 6, 375, CARD_W, 70, 'Investimento Total', currency(totalSpend));
    kpiCard(PAD + 6 + CARD_W + 6, 375, CARD_W, 70, 'Leads Gerados', num(totalLeads));
    kpiCard(PAD + 6 + (CARD_W + 6) * 2, 375, CARD_W, 70, 'CPL Médio', currency(cpl));
    // Footer
    doc.fontSize(8).fillColor(TEXT_MUTED).font('Helvetica').text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} via Luna IA · Onmid Marketing`, PAD + 6, H - 40);

    // ── PAGE 2: Meta Ads ─────────────────────────────────────────────────────
    if (data.metaCampaigns.length > 0) {
      doc.addPage();
      fillPage(DARK_BG);
      doc.rect(0, 0, 6, H).fill('#0668E1');
      doc.fontSize(10).fillColor('#0668E1').font('Helvetica-Bold').text('META ADS', PAD + 6, 40, { characterSpacing: 2 });
      doc.fontSize(22).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text('Campanhas & Métricas', PAD + 6, 58);
      doc.fontSize(9).fillColor(TEXT_MUTED).font('Helvetica').text(data.period, PAD + 6, 86);

      // KPIs
      const metaCtr = data.metaCampaigns.length > 0 ? sumField(data.metaCampaigns, 'clicks') / Math.max(sumField(data.metaCampaigns, 'impressions'), 1) * 100 : 0;
      const metaCpl = metaLeads > 0 ? metaSpend / metaLeads : 0;
      const HALF = (COL - 6) / 2 - 4;
      kpiCard(PAD + 6, 104, HALF, 64, 'Investimento Meta', currency(metaSpend));
      kpiCard(PAD + 6 + HALF + 8, 104, HALF, 64, 'Leads Meta', num(metaLeads));
      kpiCard(PAD + 6, 176, HALF, 64, 'CPL Meta', currency(metaCpl));
      kpiCard(PAD + 6 + HALF + 8, 176, HALF, 64, 'CTR Médio', pct(metaCtr));

      let y = sectionTitle('Campanhas', 260);
      const mCols = [190, 70, 70, 65, 65, 55];
      y = tableHeader(['Campanha', 'Status', 'Gasto', 'Leads', 'CPL', 'CTR'], PAD + 6, y, mCols);
      data.metaCampaigns.slice(0, 20).forEach((c, i) => {
        if (y > H - 60) return;
        const status = String(c.status ?? 'ACTIVE');
        y = tableRow([
          String(c.name ?? '').slice(0, 28),
          status === 'ACTIVE' ? 'Ativa' : 'Pausada',
          currency(c.spend),
          num(c.leads),
          currency(Number(c.spend ?? 0) / Math.max(Number(c.leads ?? 0), 1)),
          pct(c.ctr),
        ], PAD + 6, y, mCols, i % 2 === 0);
      });
      doc.fontSize(8).fillColor(TEXT_MUTED).font('Helvetica').text(`${data.metaCampaigns.length} campanha(s) no período`, PAD + 6, H - 30);
    }

    // ── PAGE 3: Google Ads ────────────────────────────────────────────────────
    if (data.googleCampaigns.length > 0) {
      doc.addPage();
      fillPage(DARK_BG);
      doc.rect(0, 0, 6, H).fill('#34A853');
      doc.fontSize(10).fillColor('#34A853').font('Helvetica-Bold').text('GOOGLE ADS', PAD + 6, 40, { characterSpacing: 2 });
      doc.fontSize(22).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text('Campanhas & Métricas', PAD + 6, 58);
      doc.fontSize(9).fillColor(TEXT_MUTED).font('Helvetica').text(data.period, PAD + 6, 86);

      const googleClicks = sumField(data.googleCampaigns, 'clicks');
      const googleImpressions = sumField(data.googleCampaigns, 'impressions');
      const googleCtr = googleClicks / Math.max(googleImpressions, 1) * 100;
      const googleCpl = googleLeads > 0 ? googleSpend / googleLeads : 0;
      const HALF = (COL - 6) / 2 - 4;
      kpiCard(PAD + 6, 104, HALF, 64, 'Investimento Google', currency(googleSpend));
      kpiCard(PAD + 6 + HALF + 8, 104, HALF, 64, 'Conversões', num(googleLeads));
      kpiCard(PAD + 6, 176, HALF, 64, 'CPA Médio', currency(googleCpl));
      kpiCard(PAD + 6 + HALF + 8, 176, HALF, 64, 'CTR Médio', pct(googleCtr));

      let y = sectionTitle('Campanhas', 260);
      const gCols = [200, 70, 70, 60, 60, 55];
      y = tableHeader(['Campanha', 'Status', 'Gasto', 'Conversões', 'CPA', 'CTR'], PAD + 6, y, gCols);
      data.googleCampaigns.slice(0, 20).forEach((c, i) => {
        if (y > H - 60) return;
        y = tableRow([
          String(c.name ?? '').slice(0, 30),
          String(c.status ?? 'ENABLED') === 'ENABLED' ? 'Ativa' : 'Pausada',
          currency(c.spend),
          num(c.leads),
          currency(Number(c.spend ?? 0) / Math.max(Number(c.leads ?? 0), 1)),
          pct(c.ctr),
        ], PAD + 6, y, gCols, i % 2 === 0);
      });
      doc.fontSize(8).fillColor(TEXT_MUTED).font('Helvetica').text(`${data.googleCampaigns.length} campanha(s) no período`, PAD + 6, H - 30);
    }

    // ── PAGE 4: CRM ───────────────────────────────────────────────────────────
    if (data.crmLeads.length > 0) {
      doc.addPage();
      fillPage(DARK_BG);
      doc.rect(0, 0, 6, H).fill('#f59e0b');
      doc.fontSize(10).fillColor('#f59e0b').font('Helvetica-Bold').text('CRM', PAD + 6, 40, { characterSpacing: 2 });
      doc.fontSize(22).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text('Leads & Funil de Vendas', PAD + 6, 58);

      const statusCount = (s: string) => data.crmLeads.filter(l => String(l.status ?? '').toLowerCase().includes(s)).length;
      const wins = statusCount('won') + statusCount('win');
      const meetings = statusCount('meeting');
      const THIRD = (COL - 6 - 12) / 3;
      kpiCard(PAD + 6, 100, THIRD, 64, 'Total de Leads', num(data.crmLeads.length));
      kpiCard(PAD + 6 + THIRD + 6, 100, THIRD, 64, 'Reuniões', num(meetings));
      kpiCard(PAD + 6 + (THIRD + 6) * 2, 100, THIRD, 64, 'Fechamentos', num(wins));

      let y = sectionTitle('Últimos Leads', 186);
      const lCols = [160, 100, 100, 155];
      y = tableHeader(['Nome', 'Status', 'Data', 'Contato'], PAD + 6, y, lCols);
      data.crmLeads.slice(0, 25).forEach((l, i) => {
        if (y > H - 60) return;
        const date = l.created_at ? new Date(String(l.created_at)).toLocaleDateString('pt-BR') : '-';
        y = tableRow([
          String(l.name ?? '').slice(0, 22),
          String(l.status ?? '-').slice(0, 14),
          date,
          String(l.phone ?? l.email ?? '-').slice(0, 22),
        ], PAD + 6, y, lCols, i % 2 === 0);
      });
    }

    doc.end();
  });
}
