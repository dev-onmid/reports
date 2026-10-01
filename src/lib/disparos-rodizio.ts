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
 * Quantos pares (texto + imagem) DIFERENTES a campanha produz antes de repetir.
 *
 * ⚠️ Não é `mensagens × imagens`: os dois índices andam juntos (um por envio),
 * então o par se repete no mínimo múltiplo comum. 5 textos com 5 imagens dão
 * só **5** pares (texto 1 sempre com a imagem 1) — enquanto 5 textos com 4
 * imagens dão 20. É exatamente isso que a tela precisa mostrar, senão o
 * gestor sobe 5 imagens para 5 textos achando que fez 25 combinações.
 */
export function combinacoesRodizio(mensagens: number, imagens: number): number {
  const m = Math.max(1, Math.trunc(mensagens) || 1);
  const n = Math.trunc(imagens) || 0;
  if (n <= 0) return m;
  return (m * n) / mdc(m, n);
}

function mdc(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) { [x, y] = [y, x % y]; }
  return x || 1;
}
