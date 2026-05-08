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

const pictureCache = new Map<string, string | null>();

async function fetchClientPicture(clientId: string): Promise<string | null> {
  if (pictureCache.has(clientId)) return pictureCache.get(clientId)!;

  try {
    const res = await fetch(`/api/clients/${clientId}/links`);
    if (!res.ok) { pictureCache.set(clientId, null); return null; }
    const links = await res.json() as Array<{ platform: string; accountId: string }>;
    const fbLink = links.find((l) => l.platform === 'facebook' || l.platform === 'instagram');
    if (!fbLink) { pictureCache.set(clientId, null); return null; }
    const url = `https://graph.facebook.com/${fbLink.accountId}/picture?type=square`;
    pictureCache.set(clientId, url);
    return url;
  } catch {
    pictureCache.set(clientId, null);
    return null;
  }
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
          className="w-full h-full object-cover"
          onError={() => setImgUrl(null)}
        />
      ) : (
        letters
      )}
    </div>
  );
}
