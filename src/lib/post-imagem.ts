/**
 * Preparo da imagem no NAVEGADOR (client-safe — só APIs de browser aqui).
 *
 * ⚠️ Mora separado do acesso ao banco de propósito: um único import de `pg`
 * neste caminho quebraria a tela inteira (mesma lição do `normalizeClientName`,
 * que precisou virar cópia client-safe por causa disso).
 *
 * Por que converter aqui e não no servidor: a Meta aceita **só JPEG** para
 * imagem, e o projeto não tem nenhuma lib de imagem instalada. O canvas do
 * navegador resolve conversão e redimensionamento sem dependência nova — mesmo
 * espírito do gzip do import de planilha e do `lerArquivoContatos`.
 */

/** Lado maior da imagem enviada. 1080 é a largura nativa do feed/story. */
const LADO_MAX = 1080;
/** Mesmo cap de `client_assets` — o destino é BYTEA no Postgres. */
const BYTES_MAX = 4 * 1024 * 1024;
const QUALIDADES = [0.85, 0.75, 0.65, 0.55];

export type ImagemPreparada = {
  /** `data:image/jpeg;base64,...` — é o que a rota grava. */
  dataUrl: string;
  largura: number;
  altura: number;
  kb: number;
};

/**
 * Aviso de proporção — NÃO bloqueia.
 *
 * ⚠️ O feed do Instagram só aceita entre 4:5 (0.8) e 1.91:1; fora disso a Meta
 * corta por conta própria. Story é 9:16 e imagem quadrada aparece com tarja.
 * Avisar antes é melhor que descobrir depois de publicado — e publicado não
 * volta atrás.
 */
export function avisoProporcao(largura: number, altura: number, tipo: 'feed' | 'story' | 'reels'): string | null {
  if (!largura || !altura) return null;
  const r = largura / altura;
  if (tipo === 'feed') {
    if (r < 0.8) return 'A imagem é mais alta que 4:5 — o Instagram vai cortar as bordas de cima e de baixo.';
    if (r > 1.91) return 'A imagem é mais larga que 1.91:1 — o Instagram vai cortar as laterais.';
    return null;
  }
  // Story/Reels: 9:16 ≈ 0.5625. Tolerância generosa antes de incomodar.
  if (r > 0.7) {
    return tipo === 'reels'
      ? 'Reels é vertical (9:16) — este vídeo vai aparecer com tarjas em cima e embaixo.'
      : 'O story é vertical (9:16) — esta imagem vai aparecer com tarjas em cima e embaixo.';
  }
  return null;
}

function carregar(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui ler esse arquivo como imagem.')); };
    img.src = url;
  });
}

function paraBlob(canvas: HTMLCanvasElement, q: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', q));
}

function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Falha ao ler a imagem convertida.'));
    fr.readAsDataURL(blob);
  });
}

/** Converte qualquer imagem suportada pelo navegador em JPEG pronto para a Meta. */
export async function prepararImagem(file: File): Promise<ImagemPreparada> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Envie uma imagem (JPG, PNG ou WebP) — vídeo entra pelo mesmo botão, em MP4.');
  }
  const img = await carregar(file);
  const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const largura = Math.round(img.naturalWidth * escala);
  const altura = Math.round(img.naturalHeight * escala);

  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('O navegador não permitiu converter a imagem.');

  // ⚠️ Fundo BRANCO antes de desenhar: JPEG não tem canal alpha, e PNG com
  // transparência sairia com o fundo PRETO — um logo transparente viraria uma
  // caixa preta publicada na conta do cliente.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(img, 0, 0, largura, altura);

  for (const q of QUALIDADES) {
    const blob = await paraBlob(canvas, q);
    if (!blob) continue;
    if (blob.size <= BYTES_MAX) {
      return { dataUrl: await blobParaDataUrl(blob), largura, altura, kb: Math.round(blob.size / 1024) };
    }
  }
  throw new Error('A imagem é grande demais mesmo depois de comprimida. Reduza as dimensões e tente de novo.');
}

// ------------------------------------------------------------------- Vídeo

export type VideoLido = {
  duracaoSeg: number;
  largura: number;
  altura: number;
  mb: number;
  /** ObjectURL para preview local — revogar quando o modal fechar. */
  previewUrl: string;
};

/** Formatos que a Meta publica (Reels/story). WebM fica de fora de propósito. */
const VIDEO_MIME_OK = /^video\/(mp4|quicktime)$/;
/** Cap do upload — Reels típico de CapCut/Premiere fica bem abaixo disso. */
export const VIDEO_MB_MAX = 150;

/**
 * Lê duração e dimensões do vídeo SEM subir nada — metadados via <video>.
 *
 * ⚠️ Diferente da imagem, vídeo NÃO tem conversão no navegador: se o arquivo
 * não é MP4/MOV, não há o que fazer aqui — a recusa precisa acontecer antes do
 * upload de 80 MB, não no worker.
 */
export function lerMetadadosVideo(file: File): Promise<VideoLido> {
  return new Promise((resolve, reject) => {
    if (!VIDEO_MIME_OK.test(file.type)) {
      reject(new Error('Vídeo precisa ser MP4 (ou MOV). Exporte de novo nesse formato.'));
      return;
    }
    if (file.size > VIDEO_MB_MAX * 1024 * 1024) {
      reject(new Error(`O vídeo tem ${Math.round(file.size / 1024 / 1024)} MB — o limite é ${VIDEO_MB_MAX} MB.`));
      return;
    }
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve({
        duracaoSeg: v.duration,
        largura: v.videoWidth,
        altura: v.videoHeight,
        mb: Math.round(file.size / 1024 / 1024 * 10) / 10,
        previewUrl: url,
      });
    };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui ler esse arquivo como vídeo.')); };
    v.src = url;
  });
}
