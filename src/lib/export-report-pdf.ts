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
  const { blob } = await renderReportPdf(token);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Renderiza o relatório público (token) num PDF real — o MESMO pipeline do botão
// "Exportar PDF" da tela de Relatórios (html2canvas → jsPDF, qualidade Cinfel). Devolve
// o Blob pra quem quiser baixar OU enviar (ex: a Luna renderiza e sobe pro WhatsApp).
export async function renderReportPdf(token: string): Promise<{ blob: Blob }> {
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

    // Mede tudo com o documento íntegro, ANTES de isolar os slides.
    const medidas = slides.map((slide) => ({
      realH: Math.max(SLIDE_H, Math.ceil(slide.getBoundingClientRect().height)),
      bg: win.getComputedStyle(slide).backgroundColor,
    }));

    // ⚠️ O html2canvas clona o DOCUMENTO INTEIRO a cada chamada (o DocumentCloner parte do
    // documentElement, não do elemento pedido) e, antes de desenhar, espera TODAS as imagens
    // do clone carregarem (imagesReady). Com 19 slides e ~70 fotos, cada slide pagava por
    // clonar, carregar e decodificar o relatório inteiro — custo quadrático, e era daí que
    // vinha o minuto de espera. Deixando no documento SÓ o slide sendo capturado, cada
    // chamada custa um slide. Os slides são autocontidos (estilo inline, largura fixa), então
    // a posição não importa; e o iframe é descartado no fim, então nada precisa ser desfeito.
    const palco = slides[0].parentNode;
    if (!palco) throw new Error('Não foi possível isolar os slides do relatório');
    for (const slide of slides) slide.remove();

    // TODAS as páginas do PDF têm o mesmo tamanho — o 16:9 de projeto (1440×810). Se um
    // slide crescer além de 810 (texto mais longo, mais cards), ele é capturado inteiro e
    // encaixado na página com "contain" (reduz proporcional, centralizado) em vez de virar
    // uma página maior. Assim não corta, não espreme e não fica com dimensões diferentes.
    const pdf = new jsPDF({ unit: 'px', format: [SLIDE_W, SLIDE_H], orientation: 'landscape', compress: true });

    for (let i = 0; i < slides.length; i++) {
      const { realH, bg } = medidas[i];
      const rgb = (bg.match(/\d+/g) ?? ['255', '255', '255']).map(Number);

      palco.appendChild(slides[i]);
      const canvas = await html2canvas(slides[i], {
        // scale 1.6 (era 2) + JPEG 0.85 (era 0.92): ~2880px continua nítido em tela/impressão
        // e derruba o tamanho do arquivo ~40% (relatórios com muitas fotos de IG ficavam 7-8 MB,
        // "pesados de mexer"). Ajuste global de export.
        scale: 1.6,
        useCORS: true,
        backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#FFFFFF',
        width: SLIDE_W,
        height: realH,
        windowWidth: SLIDE_W,
        windowHeight: realH,
      });
      slides[i].remove();

      // Codificação SÍNCRONA por slide, de propósito. A tentativa de adiar o JPEG com
      // `toBlob` (pra codificar em paralelo com a captura seguinte) saiu 3× MAIS LENTA:
      // os callbacks ficavam presos atrás do trabalho do html2canvas no thread principal e
      // só resolviam no fim, todos de uma vez (medido: 9,1s contra 2,9s).
      const imgData = canvas.toDataURL('image/jpeg', 0.85);

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

    return { blob: pdf.output('blob') };
  } finally {
    document.body.removeChild(iframe);
  }
}
