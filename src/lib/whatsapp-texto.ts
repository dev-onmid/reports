/**
 * Faz o texto gerado por IA parecer digitado por uma pessoa no celular.
 *
 * Pedido do Matheus (2026-10-01): "sem _ e mais informais, para parecer que
 * foram feitos a mão".
 *
 * ⚠️ Não é só estética: `_assim_` virando itálico e `*assim*` virando negrito é
 * marca de mensagem montada em ferramenta. Ninguém formata texto no WhatsApp
 * digitando marcação — e disparo com cara de disparo é o que a pessoa denuncia.
 *
 * ⚠️ Pedir no prompt NÃO basta (o modelo escorrega e volta a formatar), então a
 * limpeza roda SEMPRE na saída. Prompt e faxina juntos.
 */

/** Remove a marcação do WhatsApp preservando a palavra que estava dentro dela. */
export function tirarMarcacao(texto: string): string {
  return texto
    // _itálico_ → itálico. A borda (início/fim ou não-palavra) evita comer o
    // underscore de nome_de_variavel e de {nome} no meio da frase.
    .replace(/(^|[^\p{L}\p{N}])_([^_\n]+)_(?=$|[^\p{L}\p{N}])/gu, '$1$2')
    .replace(/(^|[^\p{L}\p{N}])\*([^*\n]+)\*(?=$|[^\p{L}\p{N}])/gu, '$1$2')
    .replace(/(^|[^\p{L}\p{N}])~([^~\n]+)~(?=$|[^\p{L}\p{N}])/gu, '$1$2')
    .replace(/```+/g, '')
    .replace(/`([^`\n]+)`/g, '$1');
}

/**
 * Limpa os vícios de escrita de IA que denunciam o texto.
 *
 * ⚠️ O travessão (—) é o mais revelador de todos: praticamente ninguém digita
 * em-dash no teclado do celular. Vira hífen simples.
 */
export type OpcoesHumanizar = {
  /**
   * Manter negrito, itálico e riscado (asterisco, underscore, til). Ligado quando a mensagem ORIGINAL do
   * gestor já usa marcação — aí tirar seria descaracterizar o padrão dele
   * (2026-10-02: a original tinha negrito no produto e emoji por parágrafo; as
   * variações saíam em bloco liso, "ruim de ler").
   */
  manterMarcacao?: boolean;
  /** Manter marcador de lista no começo da linha (idem: só se a original tem). */
  manterListas?: boolean;
};

export function humanizarTexto(texto: string | null | undefined, opts: OpcoesHumanizar = {}): string {
  let t = String(texto ?? '');
  if (!t.trim()) return '';

  if (!opts.manterMarcacao) t = tirarMarcacao(t);

  t = t
    .replace(/[—–]/g, '-')          // — e – viram hífen
    .replace(/…/g, '...')                 // … vira três pontos
    .replace(/[“”]/g, '"')           // aspas curvas viram retas
    .replace(/[‘’]/g, "'")
    .replace(/ /g, ' ')                   // espaço duro
    // Bullet de lista ("- item", "• item", "1. item") no começo da linha: pessoa
    // não escreve lista formatada numa conversa.
    .replace(opts.manterListas ? /(?!)/g : /^[ \t]*[-•*·]\s+/gm, '')
    .replace(opts.manterListas ? /(?!)/g : /^[ \t]*\d+[.)]\s+/gm, '')
    // Cabeçalho de markdown, se escapar.
    .replace(/^[ \t]*#{1,6}\s+/gm, '');

  t = t
    .replace(/[ \t]{2,}/g, ' ')                // espaço duplo
    .replace(/[ \t]+$/gm, '')                  // espaço no fim da linha
    .replace(/\n{3,}/g, '\n\n')                // no máximo uma linha em branco
    .replace(/\s+([,.!?;:])/g, '$1');          // espaço antes de pontuação

  return t.trim();
}

// ───────────────────────── formato da mensagem original ─────────────────────────

/** O que a mensagem do gestor TEM — é isso que as variações precisam espelhar. */
export type PerfilMensagem = {
  caracteres: number;
  /** Blocos separados por linha em branco. Um bloco só = texto corrido. */
  paragrafos: number;
  emojis: number;
  negrito: boolean;
  italico: boolean;
  listas: boolean;
};

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function perfilDaMensagem(texto: string | null | undefined): PerfilMensagem {
  const t = String(texto ?? '').replace(/\r\n?/g, '\n').trim();
  const paragrafos = t ? t.split(/\n[ \t]*\n+/).filter(b => b.trim()).length : 0;
  return {
    caracteres: t.length,
    paragrafos,
    emojis: (t.match(EMOJI_RE) ?? []).length,
    negrito: /(^|[^\p{L}\p{N}])\*[^*\n]+\*(?=$|[^\p{L}\p{N}])/mu.test(t),
    italico: /(^|[^\p{L}\p{N}])_[^_\n]+_(?=$|[^\p{L}\p{N}])/mu.test(t),
    listas: /^[ \t]*(?:[-•·]|\d+[.)])\s+\S/m.test(t),
  };
}

/**
 * Regras de FORMATO para o prompt, derivadas da mensagem original.
 *
 * ⚠️ A lição de 2026-10-02: regra fixa ("zero formatação", "no máximo um emoji")
 * destruiu o padrão de quem já escrevia bem — a original tinha 4 parágrafos,
 * emoji e negrito, e as variações viraram um bloco liso sem nada. O formato
 * não é opinião do gerador: é cópia do que o gestor fez. Original crua gera
 * variação crua; original com parágrafos e emoji gera variação igual.
 */
export function regrasDeFormato(p: PerfilMensagem): string[] {
  // Medido em 02/10 com a régua "80% a 115%": o modelo entregou 372 a 435 chars
  // para uma original de 330 (até +32%). Ele estoura o teto que recebe, então o
  // teto declarado é a PRÓPRIA original — assim o excesso pousa perto dela.
  const min = Math.max(40, Math.round(p.caracteres * 0.75));
  const max = p.caracteres;
  const regras: string[] = [
    'ESPELHE O FORMATO DA MENSAGEM ORIGINAL - ela é o padrão, não uma sugestão:',
    `- Tamanho: entre ${min} e ${max} caracteres (a original tem ${p.caracteres}). Variação MAIS LONGA que a original está errada: corte adjetivo e repetição até caber. Conte antes de responder.`,
  ];
  if (p.paragrafos >= 2) {
    regras.push(`- Estrutura: ${p.paragrafos} parágrafos curtos separados por UMA linha em branco (no JSON, use \\n\\n entre eles), como na original. Nunca um bloco único.`);
  } else {
    regras.push('- Estrutura: texto corrido como a original, sem quebrar em vários parágrafos.');
  }
  if (p.emojis > 0) {
    const lo = Math.max(1, p.emojis - 1); const hi = p.emojis + 1;
    regras.push(`- Emojis: entre ${lo} e ${hi} (a original tem ${p.emojis}), nos mesmos lugares que ela usa (abertura, destaque da oferta, chamada final). Emoji diferente a cada variação.`);
  } else {
    regras.push('- Emojis: a original não usa. No máximo UM, e só se couber naturalmente.');
  }
  if (p.negrito) {
    regras.push('- Negrito: a original destaca termos com *asteriscos simples* (produto, oferta, prazo). Faça o mesmo nos termos equivalentes - e só neles. Nunca use _itálico_, ~riscado~, crase ou #.');
  } else {
    regras.push('- Formatação: ZERO. Nunca use *asterisco*, _underscore_, ~til~, crase ou # - nem para ênfase. A original não tem, e marcação em texto que não tinha denuncia ferramenta.');
  }
  if (p.listas) {
    regras.push('- Lista: a original usa itens em linhas separadas; pode manter o mesmo recurso.');
  } else {
    regras.push('- Nada de lista com marcador nem item numerado.');
  }
  regras.push('- Nunca use travessão (—). Use hífen, vírgula ou outra frase.');
  return regras;
}
