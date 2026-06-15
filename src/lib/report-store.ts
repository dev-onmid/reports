"use client";

const STORAGE_KEY = 'onmid-report-library';
const UPDATED_EVENT = 'onmid-reports-updated';

export type StoredReport = {
  id: string;
  title: string;
  clientId: string;
  client: string;
  date: string;
  status: 'Gerado' | 'Enviado' | 'Rascunho';
  summary: string;
  html: string;
};

const INITIAL_REPORTS: StoredReport[] = [
  {
    id: 'report-abril-2026',
    title: 'Relatório Mensal - Abril 2026',
    clientId: '1',
    client: 'Tech Solutions',
    date: '01/05/2026',
    status: 'Gerado',
    summary: 'Resumo mensal de performance e indicadores principais.',
    html: '<p>Resumo mensal de performance e indicadores principais.</p>',
  },
  {
    id: 'report-q1-performance',
    title: 'Performance Campanhas Q1',
    clientId: '2',
    client: 'OdontoPrime',
    date: '15/04/2026',
    status: 'Enviado',
    summary: 'Análise consolidada das campanhas do primeiro trimestre.',
    html: '<p>Análise consolidada das campanhas do primeiro trimestre.</p>',
  },
  {
    id: 'report-social-media',
    title: 'Análise de Social Media',
    clientId: '3',
    client: 'Bella Imóveis',
    date: '10/04/2026',
    status: 'Rascunho',
    summary: 'Rascunho com oportunidades de conteúdo e canais.',
    html: '<p>Rascunho com oportunidades de conteúdo e canais.</p>',
  },
];

function canUseStorage() {
  return typeof window !== 'undefined';
}

export function readReports(): StoredReport[] {
  if (!canUseStorage()) return INITIAL_REPORTS;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_REPORTS));
      return INITIAL_REPORTS;
    }
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : INITIAL_REPORTS;
  } catch {
    return INITIAL_REPORTS;
  }
}

function writeReports(reports: StoredReport[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  window.dispatchEvent(new Event(UPDATED_EVENT));
}

export function saveReport(report: StoredReport) {
  const reports = readReports();
  writeReports([report, ...reports.filter((item) => item.id !== report.id)]);
}

export function deleteReport(id: string) {
  writeReports(readReports().filter((report) => report.id !== id));
}

export function subscribeReports(callback: () => void) {
  if (!canUseStorage()) return () => {};

  window.addEventListener(UPDATED_EVENT, callback);
  window.addEventListener('storage', callback);

  return () => {
    window.removeEventListener(UPDATED_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function downloadReportPdf(report: StoredReport) {
  if (!canUseStorage()) return;

  const win = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
  if (!win) return;

  win.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${report.title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #0F172A; background: #EEF1F5; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .meta { color: #475569; font-size: 13px; margin-bottom: 24px; }
    .summary { border: 1px solid #D6DEE8; border-radius: 10px; padding: 16px; margin-bottom: 24px; background: #FFFFFF; }
    .widget-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0 28px; }
    .widget { position: relative; overflow: hidden; border: 1px solid #D6DEE8; border-radius: 12px; padding: 16px; background: #FFFFFF; box-shadow: 0 10px 26px rgba(15,23,42,.07); }
    .widget-bar { position: absolute; top: 0; left: 0; right: 0; height: 4px; }
    .widget-source { margin: 0 0 6px; color: #475569; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
    .widget h3 { margin: 0; font-size: 14px; }
    .widget strong { display: block; margin-top: 10px; font-size: 24px; }
    .widget p:last-child { margin: 6px 0 0; color: #475569; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { border: 1px solid #D6DEE8; padding: 10px; text-align: left; }
    th { background: #F1F5F9; }
    @media print { button { display: none; } body { margin: 24px; } }
  </style>
</head>
<body>
  <button onclick="window.print()" style="margin-bottom: 24px; padding: 10px 14px;">Baixar / salvar PDF</button>
  <h1>${report.title}</h1>
  <div class="meta">${report.client} · ${report.date} · ${report.status}</div>
  <div class="summary">${report.summary}</div>
  ${report.html}
  <script>setTimeout(() => window.print(), 300);</script>
</body>
</html>`);
  win.document.close();
}
