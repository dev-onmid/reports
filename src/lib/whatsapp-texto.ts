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
export function humanizarTexto(texto: string | null | undefined): string {
  let t = String(texto ?? '');
  if (!t.trim()) return '';

  t = tirarMarcacao(t);

  t = t
    .replace(/[—–]/g, '-')          // — e – viram hífen
    .replace(/…/g, '...')                 // … vira três pontos
    .replace(/[“”]/g, '"')           // aspas curvas viram retas
    .replace(/[‘’]/g, "'")
    .replace(/ /g, ' ')                   // espaço duro
    // Bullet de lista ("- item", "• item", "1. item") no começo da linha: pessoa
    // não escreve lista formatada numa conversa.
    .replace(/^[ \t]*[-•*·]\s+/gm, '')
    .replace(/^[ \t]*\d+[.)]\s+/gm, '')
    // Cabeçalho de markdown, se escapar.
    .replace(/^[ \t]*#{1,6}\s+/gm, '');

  t = t
    .replace(/[ \t]{2,}/g, ' ')                // espaço duplo
    .replace(/[ \t]+$/gm, '')                  // espaço no fim da linha
    .replace(/\n{3,}/g, '\n\n')                // no máximo uma linha em branco
    .replace(/\s+([,.!?;:])/g, '$1');          // espaço antes de pontuação

  return t.trim();
}
