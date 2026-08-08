// Sorteador — arte do resultado em canvas (client-only): contagem regressiva
// 5→0 + revelação do vencedor no layout "story" 1080×1920 (referência: card do
// AppSorteos — gradiente azul, estrelas, faixa, círculo com a foto, nome).
// O MESMO desenho alimenta: (1) o show ao vivo na tela, (2) a gravação em vídeo
// via canvas.captureStream + MediaRecorder (MP4 quando o navegador suporta,
// senão WebM) e (3) o PNG estático pra postar.
//
// Foto do vencedor: unavatar.io/instagram/{user} atrás do /api/reports/image-proxy
// (mesma origem — sem ele o canvas ficaria "tainted" e toBlob/captureStream
// quebrariam). Sem foto → círculo com a inicial.

export type GanhadorArte = { username: string; avatar: HTMLImageElement | null };

export type ArteOpts = {
  /** @ da conta que fez o sorteio (sem @). */
  conta: string;
  ganhadores: GanhadorArte[];
  /** Nº do registro no histórico — vira "Nº 123" no rodapé quando existe. */
  codigo?: string | null;
};

export const ARTE_W = 1080;
export const ARTE_H = 1920;

function loadImage(src: string, timeoutMs = 5000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
}

export function carregarAvatar(username: string): Promise<HTMLImageElement | null> {
  const alvo = `https://unavatar.io/instagram/${encodeURIComponent(username)}?fallback=false`;
  return loadImage(`/api/reports/image-proxy?url=${encodeURIComponent(alvo)}`);
}

export function carregarLogo(): Promise<HTMLImageElement | null> {
  return loadImage('/brand/onmid-logo-white.png');
}

// ── primitivas de desenho ────────────────────────────────────────────────────

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const raio = i % 2 === 0 ? r : r * 0.45;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + raio * Math.cos(ang);
    const y = cy + raio * Math.sin(ang);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

type StarSeed = { x: number; y: number; r: number; a: number };

export function gerarEstrelas(qtd = 26): StarSeed[] {
  const out: StarSeed[] = [];
  for (let i = 0; i < qtd; i++) {
    out.push({
      x: Math.random() * ARTE_W,
      y: 260 + Math.random() * (ARTE_H - 500),
      r: 14 + Math.random() * 30,
      a: 0.08 + Math.random() * 0.14,
    });
  }
  return out;
}

function drawBg(ctx: CanvasRenderingContext2D, estrelas: StarSeed[]) {
  const g = ctx.createLinearGradient(0, 0, 0, ARTE_H);
  g.addColorStop(0, '#2f7de0');
  g.addColorStop(0.55, '#1653b4');
  g.addColorStop(1, '#0a2a6b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ARTE_W, ARTE_H);
  // Estrelas decorativas em contorno, como no card de referência.
  for (const s of estrelas) {
    ctx.strokeStyle = `rgba(255,255,255,${s.a})`;
    ctx.lineWidth = 3;
    starPath(ctx, s.x, s.y, s.r);
    ctx.stroke();
  }
}

function drawRaios(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 24; i++) {
    const ang = (i * Math.PI) / 12;
    ctx.beginPath();
    ctx.moveTo(cx + 380 * Math.cos(ang), cy + 380 * Math.sin(ang));
    ctx.lineTo(cx + 560 * Math.cos(ang), cy + 560 * Math.sin(ang));
    ctx.stroke();
  }
  ctx.restore();
}

function fonte(px: number, peso = 700): string {
  return `${peso} ${px}px 'Inter', system-ui, -apple-system, sans-serif`;
}

function drawHeader(ctx: CanvasRenderingContext2D, conta: string) {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = fonte(52, 700);
  ctx.fillText(`Sorteio de @${conta}`, ARTE_W / 2, 300);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = fonte(40, 500);
  ctx.fillText(conta, ARTE_W / 2, 366);
}

function drawTituloVencedor(ctx: CanvasRenderingContext2D, plural: boolean) {
  const y = 520;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = fonte(108, 800);
  const titulo = plural ? 'Vencedores' : 'Vencedor';
  ctx.fillText(titulo, ARTE_W / 2, y);
  const meia = ctx.measureText(titulo).width / 2;
  ctx.fillStyle = '#ffd335';
  starPath(ctx, ARTE_W / 2 - meia - 90, y - 60, 44); ctx.fill();
  starPath(ctx, ARTE_W / 2 - meia - 160, y - 10, 26); ctx.fill();
  starPath(ctx, ARTE_W / 2 + meia + 90, y - 60, 44); ctx.fill();
  starPath(ctx, ARTE_W / 2 + meia + 160, y - 10, 26); ctx.fill();
}

function drawFaixa(ctx: CanvasRenderingContext2D, cy: number) {
  // Faixa branca atrás do círculo, com pontas em "rabo de andorinha".
  const h = 150;
  const y = cy - h / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(70, y);
  ctx.lineTo(ARTE_W - 70, y);
  ctx.lineTo(ARTE_W - 70, y + h);
  ctx.lineTo(70, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(70, y); ctx.lineTo(20, y + h / 2); ctx.lineTo(70, y + h); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(ARTE_W - 70, y); ctx.lineTo(ARTE_W - 20, y + h / 2); ctx.lineTo(ARTE_W - 70, y + h); ctx.closePath();
  ctx.fill();
}

function drawAvatarCirculo(ctx: CanvasRenderingContext2D, cx: number, cy: number, g: GanhadorArte, escala = 1) {
  const rExt = 330 * escala;
  const rFoto = 292 * escala;
  ctx.save();
  // Anel branco + risco tracejado decorativo.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cx, cy, rExt, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(10,42,107,0.25)';
  ctx.lineWidth = 4;
  ctx.setLineDash([14, 12]);
  ctx.beginPath(); ctx.arc(cx, cy, (rExt + rFoto) / 2, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(cx, cy, rFoto, 0, Math.PI * 2); ctx.clip();
  if (g.avatar) {
    const img = g.avatar;
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(
      img,
      (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado,
      cx - rFoto, cy - rFoto, rFoto * 2, rFoto * 2,
    );
  } else {
    ctx.fillStyle = '#0e0f14';
    ctx.fillRect(cx - rFoto, cy - rFoto, rFoto * 2, rFoto * 2);
    ctx.fillStyle = '#55f52f';
    ctx.font = fonte(rFoto, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((g.username[0] ?? '?').toUpperCase(), cx, cy + rFoto * 0.06);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

function drawRodape(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, codigo?: string | null) {
  const y = ARTE_H - 240;
  const w = 640; const h = 120;
  const x = (ARTE_W - w) / 2;
  ctx.save();
  ctx.fillStyle = '#0e0f14';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 26);
  ctx.fill();
  if (logo) {
    const lh = 44;
    const lw = (logo.naturalWidth / logo.naturalHeight) * lh;
    ctx.drawImage(logo, x + 48, y + (h - lh) / 2, lw, lh);
    if (codigo) {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 48 + lw + 40, y + 28); ctx.lineTo(x + 48 + lw + 40, y + h - 28);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = fonte(30, 600);
      ctx.textAlign = 'left';
      ctx.fillText('SORTEIO', x + 48 + lw + 70, y + h / 2 - 6);
      ctx.fillStyle = '#55f52f';
      ctx.font = fonte(38, 800);
      ctx.fillText(`Nº ${codigo}`, x + 48 + lw + 70, y + h / 2 + 40);
    }
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = fonte(40, 800);
    ctx.textAlign = 'center';
    ctx.fillText('ONMID', ARTE_W / 2, y + h / 2 + 14);
  }
  ctx.restore();
  ctx.textAlign = 'center';
}

/** Frame completo do vencedor (usado no vídeo, no PNG e no fim do show). */
export function drawVencedorFrame(
  ctx: CanvasRenderingContext2D,
  opts: ArteOpts,
  estrelas: StarSeed[],
  logo: HTMLImageElement | null,
  escala = 1,
) {
  drawBg(ctx, estrelas);
  const unico = opts.ganhadores.length === 1;
  const cy = unico ? 980 : 940;
  drawRaios(ctx, ARTE_W / 2, cy);
  drawHeader(ctx, opts.conta);
  drawTituloVencedor(ctx, !unico);

  if (unico) {
    const g = opts.ganhadores[0];
    drawFaixa(ctx, cy);
    drawAvatarCirculo(ctx, ARTE_W / 2, cy, g, escala);
    ctx.fillStyle = '#ffffff';
    ctx.font = fonte(84, 800);
    ctx.textAlign = 'center';
    ctx.fillText(`@${g.username}`.slice(0, 26), ARTE_W / 2, cy + 330 * escala + 130);
  } else {
    // Vários ganhadores: nomes empilhados dentro de pílulas brancas.
    const lista = opts.ganhadores.slice(0, 5);
    const alt = 132; const gap = 34;
    let y = cy - ((lista.length * (alt + gap)) - gap) / 2;
    for (const g of lista) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(140, y, ARTE_W - 280, alt, 66);
      ctx.fill();
      ctx.fillStyle = '#0a2a6b';
      ctx.font = fonte(58, 800);
      ctx.textAlign = 'center';
      ctx.fillText(`@${g.username}`.slice(0, 28), ARTE_W / 2, y + alt / 2 + 20);
      y += alt + gap;
    }
  }
  drawRodape(ctx, logo, opts.codigo);
}

function drawCountdownFrame(
  ctx: CanvasRenderingContext2D,
  conta: string,
  num: number,
  pop: number, // 0..1 dentro do segundo
  estrelas: StarSeed[],
) {
  drawBg(ctx, estrelas);
  drawHeader(ctx, conta);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = fonte(56, 700);
  ctx.textAlign = 'center';
  ctx.fillText('Sorteando…', ARTE_W / 2, 560);

  const cy = 1010;
  drawRaios(ctx, ARTE_W / 2, cy);
  // Anel de progresso do segundo.
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 18;
  ctx.beginPath(); ctx.arc(ARTE_W / 2, cy, 330, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#ffd335';
  ctx.beginPath(); ctx.arc(ARTE_W / 2, cy, 330, -Math.PI / 2, -Math.PI / 2 + pop * Math.PI * 2); ctx.stroke();
  // Número com "pop" (entra grande e assenta).
  const escala = 1 + 0.35 * Math.max(0, 1 - pop * 4);
  ctx.save();
  ctx.translate(ARTE_W / 2, cy);
  ctx.scale(escala, escala);
  ctx.fillStyle = '#ffffff';
  ctx.font = fonte(430, 800);
  ctx.fillText(String(num), 0, 150);
  ctx.restore();
}

// ── confete ──────────────────────────────────────────────────────────────────

type Confete = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; cor: string; w: number; h: number };

const CORES_CONFETE = ['#ffd335', '#55f52f', '#ff5f7a', '#4cc9ff', '#ffffff', '#ff9f43'];

function gerarConfete(qtd = 140): Confete[] {
  const out: Confete[] = [];
  for (let i = 0; i < qtd; i++) {
    out.push({
      x: Math.random() * ARTE_W,
      y: -100 - Math.random() * ARTE_H * 0.8,
      vx: -2 + Math.random() * 4,
      vy: 7 + Math.random() * 9,
      rot: Math.random() * Math.PI,
      vr: -0.15 + Math.random() * 0.3,
      cor: CORES_CONFETE[i % CORES_CONFETE.length],
      w: 14 + Math.random() * 14,
      h: 8 + Math.random() * 10,
    });
  }
  return out;
}

function drawConfete(ctx: CanvasRenderingContext2D, confete: Confete[]) {
  for (const c of confete) {
    c.x += c.vx; c.y += c.vy; c.rot += c.vr;
    // Recicla: caiu da tela → volta pro topo, chove confete a revelação inteira.
    if (c.y > ARTE_H + 40) { c.y = -40; c.x = Math.random() * ARTE_W; }
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.cor;
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
  }
}

// ── show + gravação ──────────────────────────────────────────────────────────

function escolherMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidatos: Array<[string, string]> = [
    ['video/mp4;codecs=avc1.42E01E', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm', 'webm'],
  ];
  for (const [mime, ext] of candidatos) {
    try { if (MediaRecorder.isTypeSupported(mime)) return { mime, ext }; } catch {}
  }
  return null;
}

export type ShowResultado = { blob: Blob | null; ext: string };

/**
 * Roda o show no canvas (contagem 5→0 + revelação com confete) GRAVANDO a
 * animação. Resolve quando termina, com o vídeo pronto (ou blob null se o
 * navegador não suportar MediaRecorder — o show visual acontece do mesmo jeito).
 */
export function runSorteioShow(canvas: HTMLCanvasElement, opts: ArteOpts, logo: HTMLImageElement | null): Promise<ShowResultado> {
  return new Promise((resolve) => {
    canvas.width = ARTE_W;
    canvas.height = ARTE_H;
    const ctx = canvas.getContext('2d')!;
    const estrelas = gerarEstrelas();
    const confete = gerarConfete();

    const escolha = escolherMime();
    let recorder: MediaRecorder | null = null;
    const pedacos: BlobPart[] = [];
    if (escolha) {
      try {
        const stream = canvas.captureStream(30);
        recorder = new MediaRecorder(stream, { mimeType: escolha.mime, videoBitsPerSecond: 8_000_000 });
        recorder.ondataavailable = (e) => { if (e.data.size > 0) pedacos.push(e.data); };
        recorder.start(250);
      } catch { recorder = null; }
    }

    const MS_POR_NUMERO = 900;
    const MS_CONTAGEM = MS_POR_NUMERO * 6; // 5,4,3,2,1,0
    const MS_REVELACAO = 4200;
    const inicio = performance.now();

    const finalizar = () => {
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = () => resolve({ blob: new Blob(pedacos, { type: escolha!.mime }), ext: escolha!.ext });
        recorder.stop();
      } else {
        resolve({ blob: null, ext: escolha?.ext ?? 'webm' });
      }
    };

    const tick = (agora: number) => {
      const t = agora - inicio;
      if (t < MS_CONTAGEM) {
        const idx = Math.min(5, Math.floor(t / MS_POR_NUMERO));
        const pop = (t % MS_POR_NUMERO) / MS_POR_NUMERO;
        drawCountdownFrame(ctx, opts.conta, 5 - idx, pop, estrelas);
        requestAnimationFrame(tick);
      } else if (t < MS_CONTAGEM + MS_REVELACAO) {
        const tr = (t - MS_CONTAGEM) / MS_REVELACAO;
        const escala = 0.9 + 0.1 * Math.min(1, tr * 5); // círculo "assenta"
        drawVencedorFrame(ctx, opts, estrelas, logo, escala);
        drawConfete(ctx, confete);
        requestAnimationFrame(tick);
      } else {
        drawVencedorFrame(ctx, opts, estrelas, logo, 1);
        finalizar();
      }
    };
    requestAnimationFrame(tick);
  });
}

/** PNG estático 1080×1920 do card de vencedor (pra postar no feed/story). */
export async function renderVencedorImagem(opts: ArteOpts, logo: HTMLImageElement | null): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = ARTE_W;
  canvas.height = ARTE_H;
  const ctx = canvas.getContext('2d')!;
  drawVencedorFrame(ctx, opts, gerarEstrelas(), logo, 1);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

export function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
