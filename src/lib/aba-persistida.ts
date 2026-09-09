"use client";

import { useCallback, useState } from 'react';

/**
 * Aba que sobrevive ao F5.
 *
 * O problema que isto resolve: toda aba do sistema vivia só em `useState`, então
 * atualizar a página devolvia o usuário para a primeira aba — em Configurações,
 * no cliente, no CRM, nos Disparos. Quem estava em "Uso IA" recarregava e caía
 * em "Usuários", sem pista do porquê.
 *
 * A URL é a fonte de verdade (`?tab=ia`): é ela que sobrevive ao refresh, ao
 * botão voltar e ao link colado para um colega. A localStorage é só a rede
 * embaixo — cobre a visita nova, sem parâmetro nenhum.
 *
 * ⚠️ `history.replaceState`, não `router.replace`: é o caminho documentado do
 * Next 16 para mexer na query sem navegar (docs/01-app/01-getting-started/
 * 04-linking-and-navigating.md, "Native History API"). `router.replace`
 * re-renderiza a rota e derrubaria o estado da própria tela a cada clique de
 * aba. E `replaceState` em vez de `pushState` de propósito: com push, cada aba
 * visitada viraria uma entrada no histórico e o botão voltar passaria a
 * percorrer abas em vez de sair da página.
 */

/** Normaliza e valida um candidato contra a lista de abas reais. */
function aceitar<T extends string>(
  bruto: string | null | undefined,
  valores: readonly T[],
  normalizar?: (v: string) => string,
): T | null {
  if (!bruto) return null;
  const v = normalizar ? normalizar(bruto) : bruto;
  return (valores as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * Decide a aba inicial, em ordem de prioridade. PURA — é aqui que mora a regra,
 * e é isto que o teste exercita.
 *
 * `forcada` existe para o deep-link que precisa vencer a preferência salva: o
 * CRM aberto em `?lead=` tem de abrir na conversa, senão a aba guardada ganha e
 * o lead pedido não aparece em lugar nenhum.
 */
export function escolherAba<T extends string>(
  candidatos: { forcada?: string | null; url?: string | null; salva?: string | null },
  valores: readonly T[],
  padrao: T,
  normalizar?: (v: string) => string,
): T {
  return aceitar(candidatos.forcada, valores, normalizar)
    ?? aceitar(candidatos.url, valores, normalizar)
    ?? aceitar(candidatos.salva, valores, normalizar)
    ?? padrao;
}

export const chaveDaAba = (chave: string) => `aba:${chave}`;

type Opcoes<T extends string> = {
  /** Nome do parâmetro na URL. Sub-aba usa outro nome para não brigar com a aba de cima. */
  param?: string;
  /** Converte rótulo antigo no atual (link velho não pode cair no default). */
  normalizar?: (v: string) => string;
  /** Vence tudo — para deep-link que não pode perder para a aba salva. */
  forcar?: () => string | null;
};

export function useAbaPersistida<T extends string>(
  chave: string,
  valores: readonly T[],
  padrao: T,
  opcoes: Opcoes<T> = {},
): [T, (v: T) => void] {
  const { param = 'tab', normalizar, forcar } = opcoes;

  const [aba, setAba] = useState<T>(() => {
    // Estas telas só montam depois do AuthGuard liberar (client-only), então ler
    // window aqui não gera divergência de hidratação.
    if (typeof window === 'undefined') return padrao;
    let salva: string | null = null;
    try { salva = localStorage.getItem(chaveDaAba(chave)); } catch { /* modo privado */ }
    return escolherAba<T>(
      {
        forcada: forcar?.() ?? null,
        url: new URLSearchParams(window.location.search).get(param),
        salva,
      },
      valores, padrao, normalizar,
    );
  });

  const trocar = useCallback((v: T) => {
    setAba(v);
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(chaveDaAba(chave), v); } catch { /* modo privado */ }
    try {
      const params = new URLSearchParams(window.location.search);
      params.set(param, v);
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    } catch { /* histórico bloqueado: a aba ainda troca, só não sobrevive ao F5 */ }
  }, [chave, param]);

  return [aba, trocar];
}
