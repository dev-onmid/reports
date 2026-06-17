'use client';

export default function FullPreviewViewerClient({ html }: { html: string }) {
  return (
    <div style={{ minHeight: '100vh' }}>
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: 'rgba(15,23,42,0.92)', color: 'white',
          padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12,
          fontFamily: 'Inter, sans-serif', fontSize: 13,
        }}
      >
        <span>Preview completo do relatório — role pra ver todas as páginas</span>
        <button
          onClick={() => window.scrollBy({ top: -866, behavior: 'smooth' })}
          style={{ marginLeft: 'auto', background: '#333', color: 'white', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}
        >‹ Página anterior</button>
        <button
          onClick={() => window.scrollBy({ top: 866, behavior: 'smooth' })}
          style={{ background: '#22C55E', color: 'white', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}
        >Próxima página ›</button>
      </div>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
