/**
 * Cor da barra de progresso da meta.
 *
 * Faixas pedidas pelo Matheus: 0–30% vermelho, 31–50% amarelo, 51–80% azul,
 * 81–100% verde, e acima de 100% verde com brilho pulsante ("estourou a meta
 * com força").
 *
 * ⚠️ "Tem que ser um degradê na hora de trocar" e "0 a 30 vermelho" se
 * contradizem no ponto exato da fronteira: se o degradê for centrado nela, aos
 * 30% a barra já está laranja. A transição por isso acontece DEPOIS do limite
 * (30→38 vermelho→amarelo), então cada faixa vale inteira como especificada e
 * a troca continua suave, sem corte seco.
 *
 * ⚠️ Amarelo e azul são quase opostos: QUALQUER interpolação em linha reta
 * entre eles passa perto do cinza no meio (medido: o ponto médio em OKLab dá
 * #9c9c9c, croma 0). Não há cor intermediária honesta — girar o matiz pelo
 * caminho curto passaria pelo VERDE, que é justamente a cor de "meta batida",
 * e pelo caminho longo passaria pelo vermelho. Por isso a janela de degradê é
 * curta: a zona ambígua existe, e o que dá para fazer é mantê-la estreita.
 *
 * Puro e client-safe.
 */

/** Tons das faixas. Verde é o da marca (o Matheus pediu "verde como está"). */
export const COR_FAIXA = {
  vermelho: '#e34948',
  amarelo: '#eda100',
  azul: '#3987e5',
  verde: '#6cff2f',
} as const;

/**
 * Largura (em pontos percentuais) do degradê depois de cada limite.
 *
 * Curta de propósito (ver a nota sobre amarelo↔azul acima): alargar deixaria
 * a barra lavada por uma faixa grande do percurso. A suavidade da TROCA vem
 * principalmente da transição de CSS no componente, que anima a mudança de cor
 * ao longo do tempo; esta janela só evita o degrau exato na fronteira.
 */
export const JANELA_DEGRADE = 6;

/**
 * Limite superior de cada faixa, a cor da faixa SEGUINTE e a largura do degradê.
 *
 * ⚠️ Amarelo→azul tem janela ZERO — de propósito, e foi decidido OLHANDO a
 * barra renderizada: aos 53% ela saía CINZA (#9c9c9c), com cara de desativada.
 * Amarelo e azul são quase opostos, então nenhuma cor do meio é honesta:
 * interpolar em linha reta cai no cinza, girar o matiz pelo caminho curto passa
 * pelo VERDE (a cor de meta batida, a 53% seria mentira) e pelo caminho longo
 * passa pelo VERMELHO (que é a faixa de risco). Como não existe meio-termo
 * defensável, essa troca é direta — a suavidade vem da transição de CSS, que
 * atravessa a mudança em menos de um segundo.
 *
 * As outras duas têm meio-termo natural e ficam com degradê: vermelho→amarelo
 * passa por laranja, azul→verde por um verde-água.
 */
const TRANSICOES: Array<{ limite: number; de: string; para: string; janela: number }> = [
  { limite: 30, de: COR_FAIXA.vermelho, para: COR_FAIXA.amarelo, janela: JANELA_DEGRADE },
  { limite: 50, de: COR_FAIXA.amarelo, para: COR_FAIXA.azul, janela: 0 },
  { limite: 80, de: COR_FAIXA.azul, para: COR_FAIXA.verde, janela: JANELA_DEGRADE },
];

// ── sRGB ⇄ OKLab ────────────────────────────────────────────────────────────

function hexParaRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

const paraLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const paraSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbParaOklab(hex: string): [number, number, number] {
  const [r0, g0, b0] = hexParaRgb(hex);
  const r = paraLinear(r0), g = paraLinear(g0), b = paraLinear(b0);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function oklabParaHex([L, A, B]: [number, number, number]): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  const canal = (v: number) => {
    const n = Math.round(Math.min(1, Math.max(0, paraSrgb(v))) * 255);
    return n.toString(16).padStart(2, '0');
  };
  return '#'
    + canal(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    + canal(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    + canal(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

/** Mistura dois hex em OKLab. `t` 0 = `a`, 1 = `b`. */
export function misturarOklab(a: string, b: string, t: number): string {
  const x = rgbParaOklab(a);
  const y = rgbParaOklab(b);
  const k = Math.min(1, Math.max(0, t));
  return oklabParaHex([
    x[0] + (y[0] - x[0]) * k,
    x[1] + (y[1] - x[1]) * k,
    x[2] + (y[2] - x[2]) * k,
  ]);
}

// ── A cor da barra ──────────────────────────────────────────────────────────

export type ProgressoVisual = {
  /** Hex da barra. */
  cor: string;
  /** Passou de 100% — a UI acrescenta o brilho pulsante. */
  estourou: boolean;
  /** `true` quando texto escuro é legível sobre a barra. */
  textoEscuro: boolean;
};

/**
 * Luminância relativa (WCAG). Decide se o rótulo por cima da barra vai escuro
 * ou claro — preto sobre o azul ou o vermelho é ilegível, e a barra muda de cor
 * agora, então a escolha não pode ser fixa.
 */
export function luminancia(hex: string): number {
  const [r, g, b] = hexParaRgb(hex).map(paraLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function progressoVisual(pct: number): ProgressoVisual {
  const p = Number.isFinite(pct) ? Math.max(0, pct) : 0;
  let cor: string = COR_FAIXA.verde;

  for (const t of TRANSICOES) {
    if (p <= t.limite) { cor = t.de; break; }
    if (t.janela > 0 && p < t.limite + t.janela) {
      cor = misturarOklab(t.de, t.para, (p - t.limite) / t.janela);
      break;
    }
  }

  return { cor, estourou: p > 100, textoEscuro: luminancia(cor) > 0.35 };
}
