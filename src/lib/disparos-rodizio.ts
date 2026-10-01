/**
 * Rodízio de conteúdo dos Disparos — mensagem E imagem.
 *
 * O rodízio de MENSAGEM já existia (coluna `message_index`); o de IMAGEM nasceu
 * em 2026-10-01. A regra é a mesma para os dois: round-robin por envio, um
 * índice próprio por campanha, avançando de 1 em 1.
 *
 * ⚠️ A leitura de `zapi_campaigns.image_url` vivia DUPLICADA em quatro lugares
 * (worker, tick, criação e a tela) — cada cópia com seu próprio `try/catch`.
 * `lerImagens` é a única agora: a coluna guarda uma imagem só como string crua
 * (data URL) OU um array JSON, e confundir os dois formatos é o que fazia a
 * campanha de uma imagem virar "nenhuma imagem" quando a string começava com
 * algo inesperado.
 */

/** Lê a coluna `image_url` nos dois formatos que existem em produção. */
export function lerImagens(imageUrl: string | null | undefined): string[] {
  if (!imageUrl) return [];
  const cru = String(imageUrl).trim();
  if (!cru) return [];

  if (cru.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(cru);
      if (Array.isArray(parsed)) {
        // Linha legada pode trazer buraco/vazio no array — entrar na roda com
        // uma imagem vazia faria o envio falhar num contato a cada N.
        const limpas = parsed.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
        return limpas.length > 0 ? limpas : [];
      }
    } catch {
      /* não era JSON: cai no caminho de string crua abaixo */
    }
  }
  return [cru];
}

/** Grava a coluna `image_url` no formato que `lerImagens` espera de volta. */
export function gravarImagens(imagens: string[]): string | null {
  const limpas = imagens.filter(u => typeof u === 'string' && u.trim().length > 0);
  if (limpas.length === 0) return null;
  return limpas.length === 1 ? limpas[0] : JSON.stringify(limpas);
}

/**
 * Item da vez no rodízio. Índice negativo ou lista vazia nunca estoura —
 * o motor chama isto a cada envio e um erro aqui queimaria o contato.
 */
export function doRodizio<T>(lista: T[], indice: number): T | null {
  if (lista.length === 0) return null;
  const i = Number.isFinite(indice) ? Math.trunc(indice) : 0;
  return lista[((i % lista.length) + lista.length) % lista.length];
}

/**
 * O par (texto, imagem) do envio número `indice`.
 *
 * ⚠️⚠️ O PULO DO GATO está no `passo`. O caminho ingênuo — cada índice andando
 * de 1 em 1 — faz o par se repetir no mínimo múltiplo comum, não em m×n: com 5
 * textos e 5 imagens o texto 1 sairia SEMPRE com a imagem 1, dando 5 pares em
 * vez de 25 (reclamação do Matheus, 2026-10-01).
 *
 * A correção: a imagem ganha um empurrão extra a cada volta completa dos textos
 * (`passo * voltas`). Fixando o texto em `a`, os envios dele são
 * `a, a+m, a+2m, …` e a imagem vira `(a + j*(m + passo)) % n` — que percorre as
 * n imagens se, e só se, `mdc(m + passo, n) = 1`. Por isso o passo é PROCURADO,
 * não chutado: o menor que satisfaz a condição. Ele sempre existe (no pior caso
 * o que faz `m + passo ≡ 1`), então m×n combinações valem para QUALQUER
 * quantidade de textos e imagens.
 *
 * E como o passo é pequeno, a imagem continua trocando a cada envio — o gestor
 * vê rodízio de verdade, não a mesma imagem cinco vezes seguidas.
 */
export function parDoRodizio(
  indice: number, totalMensagens: number, totalImagens: number,
): { mensagem: number; imagem: number } {
  const m = Math.max(1, Math.trunc(totalMensagens) || 1);
  const n = Math.max(0, Math.trunc(totalImagens) || 0);
  const i = Number.isFinite(indice) ? Math.max(0, Math.trunc(indice)) : 0;

  const mensagem = i % m;
  if (n <= 0) return { mensagem, imagem: 0 };

  const voltas = Math.floor(i / m);
  const imagem = ((i + passoDoRodizio(m, n) * voltas) % n + n) % n;
  return { mensagem, imagem };
}

/** Menor empurrão por volta que garante percorrer todas as imagens. */
function passoDoRodizio(m: number, n: number): number {
  for (let passo = 0; passo < n; passo++) {
    if (mdc(m + passo, n) === 1) return passo;
  }
  return 1; // inalcançável (passo ≡ 1-m mod n sempre serve), mas nunca devolve undefined
}

/**
 * Quantos pares (texto + imagem) DIFERENTES a campanha produz antes de repetir.
 * Com o passo de `parDoRodizio`, é sempre textos × imagens.
 */
export function combinacoesRodizio(mensagens: number, imagens: number): number {
  const m = Math.max(1, Math.trunc(mensagens) || 1);
  const n = Math.trunc(imagens) || 0;
  return n <= 0 ? m : m * n;
}

function mdc(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) { [x, y] = [y, x % y]; }
  return x || 1;
}
