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

    // O html2canvas corta o fundo dos glifos (números de KPI, valores das métricas) quando
    // o elemento de texto tem overflow:hidden — mexer no line-height NÃO resolve, só tirar
    // o clipe resolve. Liberamos o overflow apenas nos textos de UMA LINHA (white-space:
    // nowrap + overflow:hidden) — que são valores/labels curtos e não vazam do card. Isso é
    // feito no iframe oculto (descartado no fim), antes de medir a altura; o relatório real
    // não é tocado. Contêineres de slide usam overflow:hidden sem nowrap e ficam intactos.
    doc.querySelectorAll<HTMLElement>('[style*="overflow:hidden"]').forEach((el) => {
      if (el.style.whiteSpace === 'nowrap' && el.style.overflow === 'hidden') {
        el.style.overflow = 'visible';
        el.style.textOverflow = 'clip';
      }
    });

    const slides = Array.from(doc.querySelectorAll<HTMLElement>('[style*="width:1440px"]'));
    if (!slides.length) throw new Error('Nenhum slide encontrado no relatório');

    // TODAS as páginas do PDF têm o mesmo tamanho — o 16:9 de projeto (1440×810). Se um
    // slide crescer além de 810 (texto mais longo, mais cards), ele é capturado inteiro e
    // encaixado na página com "contain" (reduz proporcional, centralizado) em vez de virar
    // uma página maior. Assim não corta, não espreme e não fica com dimensões diferentes.
    const pdf = new jsPDF({ unit: 'px', format: [SLIDE_W, SLIDE_H], orientation: 'landscape', compress: true });

    for (let i = 0; i < slides.length; i++) {
      const realH = Math.max(SLIDE_H, Math.ceil(slides[i].getBoundingClientRect().height));
      const bg = win.getComputedStyle(slides[i]).backgroundColor;
      const rgb = (bg.match(/\d+/g) ?? ['255', '255', '255']).map(Number);

      const canvas = await html2canvas(slides[i], {
        scale: 2,
        useCORS: true,
        backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#FFFFFF',
        width: SLIDE_W,
        height: realH,
        windowWidth: SLIDE_W,
        windowHeight: realH,
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);

      if (i > 0) pdf.addPage([SLIDE_W, SLIDE_H], 'landscape');

      // Preenche a página inteira com o fundo do slide (evita barras brancas/emenda quando
      // o slide encaixado deixa uma sobra nas laterais).
      pdf.setFillColor(rgb[0] ?? 255, rgb[1] ?? 255, rgb[2] ?? 255);
      pdf.rect(0, 0, SLIDE_W, SLIDE_H, 'F');

      // contain: escala pra caber em 1440×810 mantendo a proporção; centraliza.
      const scale = Math.min(SLIDE_W / SLIDE_W, SLIDE_H / realH);
      const drawW = SLIDE_W * scale;
      const drawH = realH * scale;
      const x = (SLIDE_W - drawW) / 2;
      const y = (SLIDE_H - drawH) / 2;
      pdf.addImage(imgData, 'JPEG', x, y, drawW, drawH);
    }

    pdf.save(filename);
  } finally {
    document.body.removeChild(iframe);
  }
}
