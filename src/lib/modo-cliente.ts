"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

/**
 * "Modo cliente" do CRM: a tela está sendo usada por um FUNCIONÁRIO DO CLIENTE
 * (team='cliente'), não pela equipe da Onmid.
 *
 * ⚠️ Isto é só APRESENTAÇÃO — esconde o que é da agência (rastreio de anúncio,
 * IA, configuração de funil, anúncios) para não confundir a recepção. Quem
 * garante o que essa pessoa alcança é o servidor: o proxy recusa qualquer rota
 * fora da lista dela (src/lib/acesso.ts). Esconder aqui sem a trava lá seria
 * só maquiagem.
 */

const CHAVE = 'onmid-session';
const nada = () => () => {};
const lerSessao = () => { try { return localStorage.getItem(CHAVE); } catch { return null; } };

/**
 * Sessão crua do localStorage. `undefined` = ainda no servidor/hidratação (não
 * dá para saber quem é); a tela espera em vez de montar a casca errada.
 */
export function useSessaoLocal(): { team?: string; name?: string; perfil?: string } | null | undefined {
  const cru = useSyncExternalStore(nada, lerSessao, () => '__ssr__');
  return useMemo(() => {
    if (cru === '__ssr__') return undefined;
    if (!cru) return null;
    try { return JSON.parse(cru) as { team?: string; name?: string; perfil?: string }; } catch { return null; }
  }, [cru]);
}

export function useEhUsuarioCliente(): boolean {
  return useSessaoLocal()?.team === 'cliente';
}

/** Gestor do cliente: além do CRM, vê os resultados e cadastra a equipe. */
export function useEhGestorCliente(): boolean {
  const s = useSessaoLocal();
  return s?.team === 'cliente' && s?.perfil === 'gestor';
}

export const ModoClienteContext = createContext(false);

export function useModoCliente(): boolean {
  return useContext(ModoClienteContext);
}

/** Nome de quem está logado — usado em "Meus leads". */
export function useMeuNome(): string {
  return useSessaoLocal()?.name ?? '';
}
