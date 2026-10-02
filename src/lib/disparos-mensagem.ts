/**
 * Monta a mensagem de disparo para UM contato: troca {nome}, {primeiro_nome} e
 * {telefone}, e costura a frase quando o contato não tem nome.
 *
 * Pedido do Matheus (2026-10-02): "vou anexar a planilha completa, só tem que dar
 * para ver o nome e o número vinculado". Planilha de cliente traz o nome do jeito
 * que o sistema dele exporta — "MARIA APARECIDA DA SILVA", "joão" — e a mensagem
 * precisa sair como se alguém tivesse digitado: "Oi Maria".
 *
 * ⚠️ Usada pelo worker E pelo tick (envio real) e pela tela (prévia). Uma
 * implementação só: prévia que monta diferente do envio é ilustração, não prévia.
 * ⚠️ Pura e client-safe — `fidelidade.ts` só importa tipos.
 */
import { limparPontuacao } from '@/lib/fidelidade';

const PARTICULAS = new Set(['da', 'das', 'de', 'do', 'dos', 'e', "d'"]);

/**
 * Corrige a CAIXA só quando o nome veio todo maiúsculo ou todo minúsculo —
 * "MARIA SILVA" e "maria silva" viram "Maria Silva". Nome em caixa mista
 * ("McDonald", "DiCaprio") foi digitado assim por alguém e fica como está.
 */
export function formatarNome(nome: string | null | undefined): string {
  const limpo = String(nome ?? '').replace(/\s+/g, ' ').trim();
  if (!limpo) return '';
  const letras = limpo.replace(/[^\p{L}]/gu, '');
  if (!letras) return '';
  const tudoMaiusculo = letras === letras.toUpperCase();
  const tudoMinusculo = letras === letras.toLowerCase();
  if (!tudoMaiusculo && !tudoMinusculo) return limpo;
  return limpo
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && PARTICULAS.has(p)) ? p : p.replace(/^(\p{Ll})/u, c => c.toUpperCase()))
    .join(' ');
}

export function primeiroNomeDe(nome: string | null | undefined): string {
  return formatarNome(nome).split(' ')[0] ?? '';
}

export const VARIAVEIS_DISPARO = ['{primeiro_nome}', '{nome}', '{telefone}'] as const;

const RE_VAR_NOME = /\{(?:primeiro_)?nome\}/;

export function usaNome(template: string): boolean {
  return RE_VAR_NOME.test(template);
}

/**
 * ⚠️ Sem nome, a variável vira vazio e `limparPontuacao` recompõe a frase:
 * "Oi {nome}, tudo bem?" → "Oi, tudo bem?". Substituto fixo ("cliente",
 * "tudo bem") já entregou "tudo bem, tudo bem?" na Fidelidade — apagar e
 * recompor funciona para qualquer forma de frase.
 * A limpeza só roda quando o nome faltou: mensagem de quem TEM nome sai
 * exatamente como foi escrita.
 */
export function montarMensagem(template: string, contato: { phone: string; name?: string | null }): string {
  const nome = formatarNome(contato.name);
  const trocado = template
    .replace(/\{primeiro_nome\}/g, nome.split(' ')[0] ?? '')
    .replace(/\{nome\}/g, nome)
    .replace(/\{telefone\}/g, contato.phone);
  if (nome || !usaNome(template)) return trocado;
  return limparPontuacao(trocado, /^\s*\{(?:primeiro_)?nome\}/.test(template));
}
