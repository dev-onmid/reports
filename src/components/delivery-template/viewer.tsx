'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { DeliveryReportData } from './types';
import { renderDeliverySlide, getDeliverySlideCount, SLIDE_W, SLIDE_H } from './slides';

interface Props {
  data: DeliveryReportData;
}

export default function DeliveryViewer({ data }: Props) {
  const totalSlides = getDeliverySlideCount(data);
  const [current, setCurrent] = useState(0);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Scale observer — fits slide inside the viewport with padding
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const scaleX = width / SLIDE_W;
      const scaleY = (height - 80) / SLIDE_H; // 80px reserved for thumbnail strip
      setScale(Math.min(scaleX, scaleY, 1));
    });
    const el = containerRef.current;
    if (el) observer.observe(el);
    return () => { if (el) observer.unobserve(el); };
  }, []);

  // Keyboard navigation
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      setCurrent(c => Math.min(c + 1, totalSlides - 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      setCurrent(c => Math.max(c - 1, 0));
    }
  }, [totalSlides]);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  function handlePrint() {
    const slides = Array.from({ length: totalSlides }, (_, i) => {
      const el = document.getElementById(`print-delivery-slide-${i}`);
      return el?.innerHTML ?? '';
    });

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: white; font-family: "Inter", -apple-system, sans-serif; }
        .page { width: ${SLIDE_W}px; height: ${SLIDE_H}px; page-break-after: always; overflow: hidden; }
        @page { size: ${SLIDE_W}px ${SLIDE_H}px; margin: 0; }
        @media print { body { -webkit-print-color-adjust: exact; color-adjust: exact; } }
      </style>
    </head><body>
      ${slides.map(html => `<div class="page">${html}</div>`).join('')}
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 500);
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw', height: '100vh',
        background: '#1a1a1a',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-start',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      {/* Slide area */}
      <div style={{
        flex: 1, width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {/* Render all slides, hide off-screen ones (for print) */}
        {Array.from({ length: totalSlides }, (_, i) => (
          <div
            key={i}
            id={`print-delivery-slide-${i}`}
            style={{
              position: 'absolute',
              width: SLIDE_W,
              height: SLIDE_H,
              transform: `scale(${scale})`,
              transformOrigin: 'top center',
              opacity: i === current ? 1 : 0,
              pointerEvents: i === current ? 'auto' : 'none',
              top: 0,
              boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {renderDeliverySlide(data, i, totalSlides)}
          </div>
        ))}
      </div>

      {/* Controls bar */}
      <div style={{
        width: '100%',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        {/* Thumbnail strip */}
        <div style={{ display: 'flex', gap: 8, overflow: 'auto', flex: 1 }}>
          {Array.from({ length: totalSlides }, (_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              style={{
                width: 80, height: 45,
                borderRadius: 6,
                border: i === current ? '2px solid #22C55E' : '2px solid transparent',
                cursor: 'pointer',
                overflow: 'hidden',
                position: 'relative',
                flexShrink: 0,
                background: '#333',
                padding: 0,
              }}
            >
              <div style={{
                width: SLIDE_W, height: SLIDE_H,
                transform: `scale(${80 / SLIDE_W})`,
                transformOrigin: 'top left',
                pointerEvents: 'none',
              }}>
                {renderDeliverySlide(data, i, totalSlides)}
              </div>
            </button>
          ))}
        </div>

        {/* Nav buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => setCurrent(c => Math.max(c - 1, 0))}
            disabled={current === 0}
            style={{
              width: 34, height: 34, borderRadius: 6,
              background: current === 0 ? '#333' : '#555',
              border: 'none', cursor: current === 0 ? 'default' : 'pointer',
              color: current === 0 ? '#666' : 'white',
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >‹</button>
          <span style={{ color: 'white', fontSize: 13, fontWeight: 600, minWidth: 60, textAlign: 'center' }}>
            {String(current + 1).padStart(2, '0')} / {String(totalSlides).padStart(2, '0')}
          </span>
          <button
            onClick={() => setCurrent(c => Math.min(c + 1, totalSlides - 1))}
            disabled={current === totalSlides - 1}
            style={{
              width: 34, height: 34, borderRadius: 6,
              background: current === totalSlides - 1 ? '#333' : '#555',
              border: 'none', cursor: current === totalSlides - 1 ? 'default' : 'pointer',
              color: current === totalSlides - 1 ? '#666' : 'white',
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >›</button>

          {/* Print/PDF */}
          <button
            onClick={handlePrint}
            style={{
              height: 34, padding: '0 14px', borderRadius: 6,
              background: '#22C55E', border: 'none',
              color: 'white', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            PDF
          </button>
        </div>
      </div>
    </div>
  );
}
