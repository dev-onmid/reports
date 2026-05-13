"use client";

import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Printer, X } from 'lucide-react';
import { buildSlides } from './slides';
import type { ReportData } from './types';

export function ReportViewer({ data, onClose }: { data: ReportData; onClose?: () => void }) {
  const slides = buildSlides(data);
  const [current, setCurrent] = useState(0);

  const prev = useCallback(() => setCurrent((c) => Math.max(0, c - 1)), []);
  const next = useCallback(() => setCurrent((c) => Math.min(slides.length - 1, c + 1)), [slides.length]);

  function handlePrint() {
    const win = window.open('', '_blank', 'noopener,noreferrer,width=1400,height=900');
    if (!win) return;
    const html = document.getElementById('report-slides-container')?.innerHTML ?? '';
    win.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatório ${data.clientName} — ${data.periodLabel}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: white; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .slide-print-wrapper {
      width: 297mm;
      height: 167mm;
      page-break-after: always;
      break-after: page;
      overflow: hidden;
      position: relative;
    }
    .slide-print-wrapper > * { width: 100% !important; height: 100% !important; }
    @media print {
      html, body { width: 297mm; }
      .slide-print-wrapper { page-break-after: always; break-after: page; margin: 0; }
      @page { size: A4 landscape; margin: 0; }
    }
    button.print-btn { display: block; margin: 16px auto; padding: 10px 20px; cursor: pointer; font-size: 14px; }
    @media print { button.print-btn { display: none; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir / Salvar como PDF</button>
  ${slides.map((_, i) => `<div class="slide-print-wrapper" id="print-slide-${i}"></div>`).join('\n')}
  <script>
    setTimeout(() => window.print(), 500);
  </script>
</body>
</html>`);
    win.document.close();

    // Hydrate each slide div with its rendered HTML
    setTimeout(() => {
      const containers = document.querySelectorAll<HTMLElement>('#report-slides-container > div');
      containers.forEach((el, i) => {
        const target = win.document.getElementById(`print-slide-${i}`);
        if (target) target.innerHTML = el.innerHTML;
      });
    }, 200);
  }

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Controls bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white">{data.clientName}</span>
          <span className="text-xs text-gray-400">—</span>
          <span className="text-xs text-gray-400">{data.periodLabel}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={prev}
            disabled={current === 0}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-400 w-16 text-center">
            {current + 1} / {slides.length}
          </span>
          <button
            onClick={next}
            disabled={current === slides.length - 1}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-gray-700 mx-1" />
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white hover:bg-gray-700 transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            Exportar PDF
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Slide display */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
        <div className="w-full max-w-5xl shadow-2xl rounded-lg overflow-hidden">
          {slides[current]}
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="shrink-0 bg-gray-900 border-t border-gray-800 px-4 py-3 flex gap-2 overflow-x-auto">
        {slides.map((slide, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`shrink-0 rounded overflow-hidden border-2 transition-colors ${
              i === current ? 'border-violet-500' : 'border-transparent hover:border-gray-600'
            }`}
            style={{ width: 96, aspectRatio: '16/9' }}
          >
            <div style={{ transform: 'scale(0.25)', transformOrigin: 'top left', width: '400%', height: '400%', pointerEvents: 'none' }}>
              {slide}
            </div>
          </button>
        ))}
      </div>

      {/* Hidden container for print hydration */}
      <div id="report-slides-container" style={{ position: 'absolute', left: -9999, top: -9999, width: 1200, pointerEvents: 'none' }}>
        {slides}
      </div>
    </div>
  );
}
