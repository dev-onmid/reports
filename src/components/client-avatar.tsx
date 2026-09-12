"use client";

import { useEffect, useState } from 'react';

const COLOR_PALETTE = [
  '#7B2CFF', '#3B82F6', '#10B981', '#F59E0B',
  '#EC4899', '#EF4444', '#8B5CF6', '#06B6D4',
  '#84CC16', '#F97316',
];

function nameColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Mapa de avatares de TODOS os clientes, buscado UMA vez por carga de página e
 * compartilhado por todos os `ClientAvatar` da tela (uma lista tem 40+).
 *
 * ⚠️ A URL NÃO é montada aqui. Antes este arquivo fazia
 * `graph.facebook.com/{accountId}/picture` com o id do primeiro vínculo
 * Meta que encontrasse — e o id do Instagram responde 400 nesse endpoint, o
 * que deixava sem foto todo cliente cujo vínculo mais antigo era o Instagram.
 * Quem escolhe a fonte agora é o servidor (`client-avatar-source.ts`).
 */
let mapaPendente: Promise<Record<string, string>> | null = null;

function carregarMapa(): Promise<Record<string, string>> {
  mapaPendente ??= fetch('/api/clients/avatars')
    .then((r) => (r.ok ? r.json() : { avatars: {} }))
    .then((d: { avatars?: Record<string, string> }) => d.avatars ?? {})
    .catch(() => {
      // Falha de rede não pode deixar a sessão inteira sem foto: zera para que
      // o próximo avatar montado tente de novo.
      mapaPendente = null;
      return {};
    });
  return mapaPendente;
}

export async function fetchClientPicture(clientId: string): Promise<string | null> {
  const mapa = await carregarMapa();
  return mapa[clientId] ?? null;
}

export function ClientAvatar({
  clientId,
  name,
  size = 'md',
}: {
  clientId: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const color = nameColor(name);
  const letters = initials(name);
  const dim = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-14 h-14 text-xl' : 'w-10 h-10 text-sm';

  useEffect(() => {
    void fetchClientPicture(clientId).then(setImgUrl);
  }, [clientId]);

  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center shrink-0 font-bold text-white overflow-hidden select-none`}
      style={{ backgroundColor: color }}
    >
      {imgUrl ? (
        <img
          src={imgUrl}
          alt={name}
          /* A foto do Instagram vem no tamanho original do fbcdn (medido: até
             178KB) e não dá para pedir menor — numa lista de 40+ clientes isso
             seria alguns MB de uma vez. `lazy` faz baixar só o que está à
             vista; o resto desce conforme rola. */
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={() => setImgUrl(null)}
        />
      ) : (
        letters
      )}
    </div>
  );
}
