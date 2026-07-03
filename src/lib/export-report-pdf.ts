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

    // O html2canvas posiciona o baseline de fontes um pouco diferente do navegador e, em
    // números grandes com line-height:1 + overflow:hidden (os cards de KPI/métrica), corta
    // o fundo do dígito. Relaxamos o line-height apertado direto no iframe (que é oculto e
    // descartado no fim) ANTES de medir a altura — assim a medição já considera o ajuste e
    // não sobra nem falta espaço. O relatório real não é tocado.
    doc.querySelectorAll<HTMLElement>('[style*="line-height:1"]').forEach((el) => {
      const lh = el.style.lineHeight.trim();
      if (lh === '1' || lh === '1.0') el.style.lineHeight = '1.2';
    });

    const slides = Array.from(doc.querySelectorAll<HTMLElement>('[style*="width:1440px"]'));
    if (!slides.length) throw new Error('Nenhum slide encontrado no relatório');

    let pdf: import('jspdf').jsPDF | null = null;

    for (let i = 0; i < slides.length; i++) {
      // Cada slide é desenhado com min-height:810px mas pode crescer um pouco além disso
      // (texto mais longo, mais cards). Capturamos e paginamos na ALTURA REAL do slide —
      // nunca forçando 810 — pra não espremer nem cortar o conteúdo que passa da linha.
      const realH = Math.ceil(slides[i].getBoundingClientRect().height);
      const pageH = Math.max(SLIDE_H, realH);
      const bg = win.getComputedStyle(slides[i]).backgroundColor;

      const canvas = await html2canvas(slides[i], {
        scale: 2,
        useCORS: true,
        backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#FFFFFF',
        width: SLIDE_W,
        height: pageH,
        windowWidth: SLIDE_W,
        windowHeight: pageH,
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);

      if (!pdf) {
        pdf = new jsPDF({ unit: 'px', format: [SLIDE_W, pageH], orientation: 'landscape', compress: true });
      } else {
        pdf.addPage([SLIDE_W, pageH], 'landscape');
      }
      pdf.addImage(imgData, 'JPEG', 0, 0, SLIDE_W, pageH);
    }

    pdf?.save(filename);
  } finally {
    document.body.removeChild(iframe);
  }
}
