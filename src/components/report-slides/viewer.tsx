"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Printer, X } from 'lucide-react';
import { renderSlide, SLIDE_W, SLIDE_H, isLightColor } from './slides';
import type { ReportData } from './types';

export function ReportViewer({ data, onClose }: { data: ReportData; onClose?: () => void }) {
  const manifest = data.manifest;
  const [current, setCurrent] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const slides = manifest
    ? manifest.slides.map((spec, i) =>
        renderSlide(spec, manifest.theme, manifest.primaryLogo, manifest.clientLogo, i, manifest.slides.length)
      )
    : null;

  useEffect(() => {
    if (!slides) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setScale(Math.min(width / SLIDE_W, height / SLIDE_H) * 0.96);
    });
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!slides]);

  const prev = useCallback(() => setCurrent((c) => Math.max(0, c - 1)), []);
  const next = useCallback(() => setCurrent((c) => Math.min((slides?.length ?? 1) - 1, c + 1)), [slides?.length]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next]);

  function handlePrint() {
    if (!slides || !manifest) return;
    const win = window.open('', '_blank', 'noopener,noreferrer,width=1400,height=900');
    if (!win) return;

    const isLight = isLightColor(manifest.theme);
    const bg = isLight ? '#f4f4f5' : '#0d0d0f';

    const slideDivs = manifest.slides
      .map((spec, i) => {
        const el = document.getElementById(`print-slide-src-${i}`);
        return `<div class="page"><div class="inner">${el?.innerHTML ?? ''}</div></div>`;
      })
      .join('\n');

    win.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${data.clientName} — ${data.periodLabel}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .page {
      width: 297mm; height: 210mm;
      display: flex; align-items: center; justify-content: center;
      page-break-after: always; break-after: page;
      overflow: hidden;
    }
    .inner {
      width: ${SLIDE_W}px; height: ${SLIDE_H}px;
      transform: scale(0.93); transform-origin: center center;
    }
    .print-btn { display: block; margin: 12px auto; padding: 10px 24px; cursor: pointer; font-size: 14px; border-radius: 6px; border: none; background: #7B21D0; color: white; }
    @media print { .print-btn { display: none; } @page { size: A4 landscape; margin: 0; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir / Salvar como PDF</button>
  ${slideDivs}
</body>
</html>`);
    win.document.close();
    setTimeout(() => win.print(), 600);
  }

  if (!slides || !manifest) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 bg-gray-950 text-center px-8">
        <p className="text-gray-400 text-sm">
          Este relatório foi gerado em uma versão anterior.<br />
          Gere um novo diagnóstico para ver o layout atualizado.
        </p>
        {onClose && (
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-white underline">
            Voltar
          </button>
        )}
      </div>
    );
  }

  const thumbScale = 104 / SLIDE_W;

  return (
    <div className="flex flex-col h-full" style={{ background: '#09090B' }}>
      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52, borderBottom: '1px solid #1F1F23', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{data.clientName}</span>
          <span style={{ fontSize: 12, color: '#555' }}>—</span>
          <span style={{ fontSize: 12, color: '#777' }}>{data.periodLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={prev} disabled={current === 0} style={navBtn}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: 12, color: '#666', width: 64, textAlign: 'center' }}>
            {current + 1} / {slides.length}
          </span>
          <button onClick={next} disabled={current === slides.length - 1} style={navBtn}>
            <ChevronRight size={16} />
          </button>
          <div style={{ width: 1, height: 20, background: '#333', margin: '0 6px' }} />
          <button onClick={handlePrint} style={actionBtn}>
            <Printer size={13} />
            <span>Exportar PDF</span>
          </button>
          {onClose && (
            <button onClick={onClose} style={{ ...navBtn, marginLeft: 2 }}>
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Slide viewport */}
      <div ref={containerRef} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 24 }}>
        <div style={{
          width: SLIDE_W * scale,
          height: SLIDE_H * scale,
          overflow: 'hidden',
          borderRadius: 6,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          flexShrink: 0,
        }}>
          <div style={{ width: SLIDE_W, height: SLIDE_H, transformOrigin: 'top left', transform: `scale(${scale})` }}>
            {slides[current]}
          </div>
        </div>
      </div>

      {/* Thumbnail strip */}
      <div style={{
        display: 'flex', gap: 8, padding: '8px 16px',
        borderTop: '1px solid #1F1F23', flexShrink: 0,
        overflowX: 'auto', background: '#09090B',
      }}>
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            style={{
              flexShrink: 0,
              width: 104,
              height: 58.5,
              overflow: 'hidden',
              borderRadius: 4,
              border: `2px solid ${i === current ? '#7B21D0' : 'transparent'}`,
              outline: i === current ? '1px solid #7B21D055' : 'none',
              cursor: 'pointer',
              background: 'none',
              padding: 0,
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{
              width: SLIDE_W,
              height: SLIDE_H,
              transformOrigin: 'top left',
              transform: `scale(${thumbScale})`,
              pointerEvents: 'none',
            }}>
              {slides[i]}
            </div>
          </button>
        ))}
      </div>

      {/* Hidden slide sources for print */}
      <div style={{ position: 'absolute', left: -99999, top: 0, pointerEvents: 'none' }}>
        {slides.map((slide, i) => (
          <div key={i} id={`print-slide-src-${i}`} style={{ width: SLIDE_W, height: SLIDE_H }}>
            {slide}
          </div>
        ))}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, borderRadius: 6, border: 'none', cursor: 'pointer',
  background: 'transparent', color: '#888',
};

const actionBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '0 12px', height: 30, borderRadius: 6, border: 'none', cursor: 'pointer',
  background: 'transparent', color: '#ccc', fontSize: 12, fontWeight: 600,
};
