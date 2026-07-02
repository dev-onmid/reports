// Renders a public report as a real PDF file, entirely in the browser — no server
// round-trip, no window.print() dialog. We load the report route in a hidden iframe
// (same origin, so we can read its DOM), snapshot each fixed-size slide with
// html2canvas, and stitch the images into a jsPDF document sized to match.
//
// Cross-origin images (Meta/Instagram CDN thumbnails) would taint the canvas, so
// they're swapped to go through /api/reports/image-proxy before capture.

const SLIDE_W = 1440;
const SLIDE_H = 810;

function waitForImage(img: HTMLImageElement): Promise<void> {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });
}

async function proxyCrossOriginImages(doc: Document, origin: string): Promise<void> {
  const imgs = Array.from(doc.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:') || src.startsWith('/') || src.startsWith(origin)) {
      return waitForImage(img);
    }
    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = `/api/reports/image-proxy?url=${encodeURIComponent(src)}`;
    });
  }));
}

export async function exportReportToPdf(token: string, filename: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-99999px';
  iframe.style.top = '0';
  iframe.style.width = `${SLIDE_W}px`;
  iframe.style.height = `${SLIDE_H}px`;
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () => reject(new Error('Falha ao carregar o relatório'));
      iframe.src = `/relatorio/${token}`;
    });

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) throw new Error('Não foi possível acessar o conteúdo do relatório');

    await proxyCrossOriginImages(doc, win.location.origin);
    if (win.document.fonts?.ready) await win.document.fonts.ready;

    const slides = Array.from(doc.querySelectorAll<HTMLElement>('[style*="width:1440px"]'));
    if (!slides.length) throw new Error('Nenhum slide encontrado no relatório');

    const pdf = new jsPDF({ unit: 'px', format: [SLIDE_W, SLIDE_H], orientation: 'landscape', compress: true });

    for (let i = 0; i < slides.length; i++) {
      const canvas = await html2canvas(slides[i], {
        scale: 2,
        useCORS: true,
        backgroundColor: '#FFFFFF',
        windowWidth: SLIDE_W,
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage([SLIDE_W, SLIDE_H], 'landscape');
      pdf.addImage(imgData, 'JPEG', 0, 0, SLIDE_W, SLIDE_H);
    }

    pdf.save(filename);
  } finally {
    document.body.removeChild(iframe);
  }
}
