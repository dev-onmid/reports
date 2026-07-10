"use client";

import { useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Thumbnail do criativo — mostra a imagem real do anúncio (imagem_url, vinda da Meta) quando
// disponível; cai pro placeholder de ícone em vídeo/carrossel sem imagem estática, em análises
// antigas sem o campo, OU quando a imagem 404 (URLs da Meta expiram). Cor da borda segue a
// categoria do nó (vermelho = pausar). Passar o mouse por cima amplia num preview flutuante
// (`position: fixed`, calculado a partir do bounding rect no hover) — escapa do `overflow-auto`
// da tabela sem precisar de portal.
export function CreativeThumb({ tone, imageUrl, alt }: { tone: string; imageUrl?: string | null; alt: string }) {
  const [hoverPos, setHoverPos] = useState<{ top: number; left: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const ZOOM = 220;

  if (!imageUrl || failed) {
    return (
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-background', tone)}>
        <ImageIcon className="h-3.5 w-3.5 opacity-70" />
      </span>
    );
  }

  function handleEnter() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(r.right + 8, window.innerWidth - ZOOM - 12);
    const top = Math.min(Math.max(8, r.top - ZOOM / 2 + r.height / 2), window.innerHeight - ZOOM - 12);
    setHoverPos({ top, left });
  }

  return (
    <span
      ref={ref}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setHoverPos(null)}
      className="relative inline-block shrink-0"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={alt} onError={() => setFailed(true)} className={cn('h-7 w-7 rounded border object-cover bg-background', tone)} />
      {hoverPos && (
        <div
          className="pointer-events-none fixed z-50 rounded-[var(--radius)] border border-border bg-card p-1.5 shadow-xl"
          style={{ top: hoverPos.top, left: hoverPos.left }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={alt} onError={() => setFailed(true)} className="rounded object-contain" style={{ width: ZOOM, height: ZOOM }} />
          <p className="mt-1 max-w-[220px] truncate text-[10px] text-muted-foreground" title={alt}>{alt}</p>
        </div>
      )}
    </span>
  );
}
