"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { useClients } from '@/lib/client-store';
import { cn } from '@/lib/utils';
import {
  Search, ExternalLink, RefreshCw, Trash2, X,
  Bookmark, Globe, ChevronDown, SlidersHorizontal,
  Sparkles, LayoutGrid, Calendar, ArrowUpDown, Play,
  Copy, Download, ChevronLeft, ChevronRight, Clock,
} from 'lucide-react';
import type { AdLibraryAd } from '@/app/api/meta/ad-library/route';
import type { SavedAd } from '@/app/api/ad-library/saved/route';

// ─── Inline SVG brand icons ────────────────────────────────────────────────
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.791-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f09433" />
          <stop offset="25%" stopColor="#e6683c" />
          <stop offset="50%" stopColor="#dc2743" />
          <stop offset="75%" stopColor="#cc2366" />
          <stop offset="100%" stopColor="#bc1888" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="5" fill="url(#ig-grad)" />
      <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1.5" fill="none" />
      <circle cx="17.5" cy="6.5" r="1" fill="white" />
    </svg>
  );
}

// ─── Constants ─────────────────────────────────────────────────────────────
const AD_COUNTRIES = [
  { code: 'BR', label: '🇧🇷 Brasil' },
  { code: 'US', label: '🇺🇸 EUA' },
  { code: 'PT', label: '🇵🇹 Portugal' },
  { code: 'AR', label: '🇦🇷 Argentina' },
  { code: 'MX', label: '🇲🇽 México' },
];

// ─── Avatar color palette ──────────────────────────────────────────────────
const AVATAR_COLORS = [
  'bg-violet-500', 'bg-emerald-500', 'bg-sky-500', 'bg-amber-500',
  'bg-rose-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500',
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}


// ─── Ad Detail Modal ────────────────────────────────────────────────────────
function AdDetailModal({
  ad,
  savedId,
  onClose,
  onSave,
  onRemove,
  saving,
  clients,
}: {
  ad: AdLibraryAd;
  savedId: string | null;
  onClose: () => void;
  onSave: (clientId: string) => void;
  onRemove: () => void;
  saving: boolean;
  clients: { id: string; name: string }[];
}) {
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const body = ad.creativeBodies[0] ?? '';
  const isActive = ad.adActiveStatus === 'ACTIVE';
  const platforms = ad.publisherPlatforms ?? [];
  const hasFb = platforms.some(p => p.toLowerCase().includes('facebook')) || platforms.length === 0;
  const hasIg = platforms.some(p => p.toLowerCase().includes('instagram'));
  const initial = ad.pageName.charAt(0).toUpperCase();
  const dateStart = ad.deliveryStartTime ? new Date(ad.deliveryStartTime).toLocaleDateString('pt-BR') : null;
  const daysRunning = ad.deliveryStartTime
    ? Math.floor((Date.now() - new Date(ad.deliveryStartTime).getTime()) / 86400000)
    : null;

  const isCarousel = ad.mediaType === 'carousel' && ad.cards.length > 0;
  const currentCard = isCarousel ? ad.cards[carouselIdx] : null;
  const displayImage = currentCard?.imageUrl ?? ad.imageUrl;
  const displayVideo = currentCard?.videoUrl ?? ad.videoUrl;
  const displayThumb = currentCard?.thumbnailUrl ?? ad.videoThumbnailUrl;

  function copyText() {
    const text = [body, ...(ad.creativeBodies.slice(1))].filter(Boolean).join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl lg:flex-row" style={{ maxHeight: '92vh' }}>

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground hover:text-foreground backdrop-blur-sm transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* ── Left: Creative ── */}
        <div className="flex flex-col bg-zinc-950 lg:w-[55%] shrink-0">
          <div className="flex flex-1 items-center justify-center overflow-hidden" style={{ minHeight: '300px', maxHeight: '70vh' }}>
            {displayVideo ? (
              <video
                ref={videoRef}
                key={displayVideo}
                src={displayVideo}
                poster={displayThumb ?? undefined}
                controls
                autoPlay
                muted
                loop
                playsInline
                className="max-h-full max-w-full object-contain"
                style={{ maxHeight: '65vh' }}
              />
            ) : displayImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={displayImage}
                alt=""
                className="max-h-full max-w-full object-contain"
                style={{ maxHeight: '65vh' }}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex min-h-[260px] w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 p-8">
                <p className="text-center text-sm text-zinc-300 leading-relaxed">{body || 'Anúncio de texto'}</p>
              </div>
            )}
          </div>

          {/* Carousel navigation */}
          {isCarousel && ad.cards.length > 1 && (
            <div className="flex items-center justify-center gap-3 border-t border-border bg-zinc-900/80 px-4 py-3">
              <button
                type="button"
                onClick={() => setCarouselIdx(i => Math.max(0, i - 1))}
                disabled={carouselIdx === 0}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex gap-1.5">
                {ad.cards.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCarouselIdx(i)}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === carouselIdx ? 'w-5 bg-white' : 'w-1.5 bg-white/30',
                    )}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setCarouselIdx(i => Math.min(ad.cards.length - 1, i + 1))}
                disabled={carouselIdx === ad.cards.length - 1}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="text-[11px] text-muted-foreground">{carouselIdx + 1} / {ad.cards.length}</span>
            </div>
          )}
        </div>

        {/* ── Right: Details ── */}
        <div className="flex flex-col overflow-y-auto lg:flex-1" style={{ maxHeight: '92vh' }}>
          <div className="flex flex-col gap-4 p-5">

            {/* Advertiser */}
            <div className="flex items-center gap-3">
              <div className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
                avatarColor(ad.pageName)
              )}>
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{ad.pageName}</p>
                <p className="text-[11px] text-muted-foreground">Patrocinado</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {hasFb && <FacebookIcon className="h-4 w-4 text-[#1877f2]" />}
                {hasIg && <InstagramIcon className="h-4 w-4" />}
              </div>
            </div>

            {/* Status + duration */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(
                'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
                isActive ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-400'
              )}>
                {isActive ? 'Ativo' : 'Inativo'}
              </span>
              {daysRunning !== null && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {daysRunning === 0 ? 'Iniciou hoje' : `Ativo há ${daysRunning} dia${daysRunning !== 1 ? 's' : ''}`}
                  {dateStart && <span className="text-muted-foreground/50">· desde {dateStart}</span>}
                </span>
              )}
              {ad.mediaType && (
                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                  {ad.mediaType === 'video' ? '▶ Vídeo' : ad.mediaType === 'carousel' ? '⊞ Carrossel' : ad.mediaType === 'image' ? '🖼 Imagem' : '📝 Texto'}
                </span>
              )}
              {ad.callToAction && (
                <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                  {ad.callToAction.replace(/_/g, ' ')}
                </span>
              )}
            </div>

            {/* Ad copy */}
            {ad.creativeBodies.length > 0 && (
              <div className="rounded-xl border border-border bg-background/50 p-3 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Copy do anúncio</p>
                {ad.creativeBodies.map((b, i) => (
                  <p key={i} className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{b}</p>
                ))}
                {ad.creativeTitles.length > 0 && (
                  <>
                    <div className="h-px bg-border my-2" />
                    {ad.creativeTitles.map((t, i) => (
                      <p key={i} className="text-xs font-semibold text-foreground">{t}</p>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Carousel card info */}
            {currentCard && (currentCard.title || currentCard.body) && (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Card {carouselIdx + 1}</p>
                {currentCard.title && <p className="text-sm font-semibold text-foreground">{currentCard.title}</p>}
                {currentCard.body && <p className="text-xs text-muted-foreground leading-relaxed">{currentCard.body}</p>}
              </div>
            )}

            {/* Link */}
            {ad.linkUrl && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{ad.linkUrl.replace(/^https?:\/\/(www\.)?/, '')}</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={copyText}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copiado!' : 'Copiar texto'}
              </button>

              {(displayImage || displayVideo) && (
                <a
                  href={displayImage ?? displayVideo ?? '#'}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              )}

              {ad.adSnapshotUrl && (
                <a
                  href={ad.adSnapshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Ver no Facebook
                </a>
              )}
            </div>

            {/* Save for client */}
            <div className="border-t border-border pt-3">
              {savedId ? (
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  {saving ? 'Removendo...' : 'Remover dos salvos'}
                </button>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowClientPicker(v => !v)}
                    disabled={saving}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  >
                    <Bookmark className="h-4 w-4" />
                    {saving ? 'Salvando...' : 'Salvar para cliente'}
                  </button>
                  {showClientPicker && (
                    <div className="absolute bottom-full mb-1.5 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl p-1">
                      <div className="flex items-center justify-between px-2 py-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Escolha o cliente</p>
                        <button type="button" onClick={() => setShowClientPicker(false)}>
                          <X className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {clients.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { onSave(c.id); setShowClientPicker(false); }}
                            className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium hover:bg-muted/50 transition-colors truncate"
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AdCard ────────────────────────────────────────────────────────────────
function AdCard({
  ad,
  savedId,
  onSave,
  onRemove,
  onSelect,
  saving,
  clients,
}: {
  ad: AdLibraryAd;
  savedId: string | null;
  onSave: (clientId: string) => void;
  onRemove: () => void;
  onSelect: () => void;
  saving: boolean;
  clients: { id: string; name: string }[];
}) {
  const [showClientPicker, setShowClientPicker] = useState(false);
  const body = ad.creativeBodies[0] ?? '';
  const initial = ad.pageName.charAt(0).toUpperCase();
  const dateStart = ad.deliveryStartTime
    ? new Date(ad.deliveryStartTime).toLocaleDateString('pt-BR')
    : null;
  const isActive = ad.adActiveStatus === 'ACTIVE';
  const platforms = ad.publisherPlatforms ?? [];
  const hasFb = platforms.some(p => p.toLowerCase().includes('facebook')) || platforms.length === 0;
  const hasIg = platforms.some(p => p.toLowerCase().includes('instagram'));
  const snapshotUrl = ad.adSnapshotUrl;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5">
      {/* ── Media area ── */}
      <div className="relative w-full overflow-hidden bg-zinc-900" style={{ minHeight: '200px' }}>
        {/* Actual media */}
        <button type="button" onClick={onSelect} className="block w-full text-left group cursor-pointer">
          {(ad.videoThumbnailUrl ?? ad.videoUrl) ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ad.videoThumbnailUrl ?? ''}
                alt=""
                className="w-full object-cover"
                style={{ maxHeight: '260px', minHeight: '160px' }}
                referrerPolicy="no-referrer"
                loading="lazy"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/30 transition-colors">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm opacity-80 group-hover:opacity-100 transition-opacity">
                  <Play className="h-5 w-5 fill-current ml-0.5" />
                </div>
              </div>
            </div>
          ) : ad.imageUrl ? (
            <div className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ad.imageUrl}
                alt=""
                className="w-full object-cover group-hover:scale-105 transition-transform duration-300"
                style={{ maxHeight: '300px', minHeight: '160px' }}
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            </div>
          ) : (
            <div className="flex min-h-[160px] items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 p-5 group-hover:from-zinc-700/80 transition-colors">
              <p className="text-center text-sm text-zinc-300 leading-relaxed line-clamp-5">{body || 'Anúncio de texto'}</p>
            </div>
          )}
        </button>

        {/* Status badge — top left */}
        <div className="absolute left-3 top-3 z-10">
          <span className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm',
            isActive
              ? 'border-emerald-500/60 text-emerald-400 bg-black/50'
              : 'border-zinc-500/40 text-zinc-400 bg-black/50'
          )}>
            {isActive ? 'Ativo' : 'Inativo'}
          </span>
        </div>

        {/* Media type badge */}
        {ad.mediaType && ad.mediaType !== 'text' && (
          <div className="absolute left-3 bottom-3 z-10">
            <span className="inline-flex items-center rounded-full border border-white/20 bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white/80 backdrop-blur-sm capitalize">
              {ad.mediaType === 'video' ? '▶ Vídeo' : ad.mediaType === 'carousel' ? '⊞ Carrossel' : '🖼 Imagem'}
            </span>
          </div>
        )}

        {/* Bookmark icon — top right */}
        <div className="absolute right-3 top-3 z-10">
          {savedId ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={saving}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-red-500/40 bg-black/50 text-red-400 backdrop-blur-sm hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowClientPicker(v => !v)}
                disabled={saving}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/70 backdrop-blur-sm hover:border-emerald-500/60 hover:text-emerald-400 transition-colors"
              >
                <Bookmark className="h-3.5 w-3.5" />
              </button>
              {showClientPicker && (
                <div className="absolute right-0 top-full mt-1.5 z-50 w-52 rounded-xl border border-border bg-card shadow-xl p-1">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Salvar para cliente</p>
                    <button type="button" onClick={() => setShowClientPicker(false)}>
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {clients.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { onSave(c.id); setShowClientPicker(false); }}
                        className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium hover:bg-muted/50 transition-colors truncate"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-col gap-3 p-4">
        {/* Advertiser row */}
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
            avatarColor(ad.pageName)
          )}>
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-foreground">{ad.pageName}</p>
            <p className="text-[10px] text-muted-foreground">Patrocinado</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasFb && <FacebookIcon className="h-4 w-4 text-[#1877f2]" />}
            {hasIg && <InstagramIcon className="h-4 w-4" />}
          </div>
        </div>

        {/* Ad text */}
        {body && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
        )}

        {/* URL row */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
          <Globe className="h-3 w-3 shrink-0" />
          {ad.linkUrl ? (
            <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer"
              className="truncate hover:text-foreground transition-colors max-w-[160px]">
              {ad.linkUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
            </a>
          ) : (
            <span className="truncate text-[10px]">facebook.com/ads</span>
          )}
          {ad.callToAction && (
            <span className="ml-auto shrink-0 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {ad.callToAction.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5 mt-auto">
        <span className="text-[11px] text-muted-foreground">
          {dateStart ? `Desde ${dateStart}` : '—'}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSelect}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Ver detalhes
          </button>
          {savedId ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={saving}
              className="flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Remover
            </button>
          ) : (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowClientPicker(v => !v)}
                disabled={saving}
                className="flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                <Bookmark className="h-3 w-3" />
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────
export default function BibliotecaPage() {
  const { clients } = useClients();
  const activeClients = clients.filter(c => c.status !== 'Inativo');

  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('BR');
  const [adStatus, setAdStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [results, setResults] = useState<AdLibraryAd[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedMap, setSavedMap] = useState<Record<string, { id: string; clientId: string }>>({});
  const [activeView, setActiveView] = useState<'search' | 'saved'>('search');
  const [allSaved, setAllSaved] = useState<SavedAd[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [filterClientId, setFilterClientId] = useState('');
  const [selectedAd, setSelectedAd] = useState<AdLibraryAd | null>(null);
  const handleSelectAd = useCallback((ad: AdLibraryAd) => setSelectedAd(ad), []);

  // Load all saved ads
  useEffect(() => {
    setSavedLoading(true);
    const url = filterClientId
      ? `/api/ad-library/saved?clientId=${filterClientId}`
      : '/api/ad-library/saved?clientId=__all__';
    fetch(url)
      .then(r => r.ok ? r.json() as Promise<SavedAd[]> : [])
      .then(data => {
        setAllSaved(data);
        const map: Record<string, { id: string; clientId: string }> = {};
        for (const s of data) map[s.adArchiveId] = { id: s.id, clientId: s.clientId };
        setSavedMap(map);
      })
      .catch(() => {})
      .finally(() => setSavedLoading(false));
  }, [filterClientId]);

  async function doSearch(cursor?: string) {
    if (!query.trim()) return;
    if (cursor) setLoadingMore(true);
    else { setSearching(true); setResults([]); setNextCursor(null); }
    setSearchError('');
    try {
      const params = new URLSearchParams({ q: query, country, status: adStatus, limit: '20' });
      if (cursor) params.set('after', cursor);
      const res = await fetch(`/api/meta/ad-library?${params}`);
      const json = await res.json() as { data?: AdLibraryAd[]; paging?: { cursors?: { after?: string }; next?: string }; error?: string };
      if (!res.ok) { setSearchError(json.error ?? 'Erro na busca.'); return; }
      setResults(prev => cursor ? [...prev, ...(json.data ?? [])] : (json.data ?? []));
      setNextCursor(json.paging?.cursors?.after ?? (json.paging?.next ? 'next' : null));
    } catch {
      setSearchError('Erro de conexão.');
    } finally {
      setSearching(false);
      setLoadingMore(false);
    }
  }

  async function saveAd(ad: AdLibraryAd, clientId: string) {
    setSavingId(ad.adArchiveId);
    try {
      const res = await fetch('/api/ad-library/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, ad }),
      });
      if (res.ok) {
        const saved = await res.json() as SavedAd;
        setSavedMap(prev => ({ ...prev, [ad.adArchiveId]: { id: saved.id, clientId } }));
        setAllSaved(prev => [saved, ...prev.filter(s => s.adArchiveId !== ad.adArchiveId)]);
      }
    } finally {
      setSavingId(null);
    }
  }

  async function removeAd(savedId: string, adArchiveId: string) {
    setSavingId(savedId);
    try {
      await fetch(`/api/ad-library/saved/${savedId}`, { method: 'DELETE' });
      setSavedMap(prev => { const n = { ...prev }; delete n[adArchiveId]; return n; });
      setAllSaved(prev => prev.filter(s => s.id !== savedId));
    } finally {
      setSavingId(null);
    }
  }

  const displayedSaved = filterClientId
    ? allSaved.filter(s => s.clientId === filterClientId)
    : allSaved;

  const countryLabel = AD_COUNTRIES.find(c => c.code === country)?.label ?? 'Brasil';

  return (
    <div className="space-y-6 pb-10">

      {/* ════ HEADER ════ */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 shadow-[0_0_18px_2px_rgba(139,92,246,0.35)]">
          <LayoutGrid className="h-6 w-6 text-violet-400" />
        </div>
        <div>
          <h1 className="font-heading font-normal text-4xl uppercase leading-none tracking-wide text-foreground">
            Biblioteca de Anúncios
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Pesquise anúncios no Meta Ad Library e salve por cliente.
          </p>
        </div>
      </div>

      {/* ════ SEARCH ROW ════ */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Input */}
        <div className="flex flex-1 min-w-0 items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-zinc-900/70 px-4 py-2.5 shadow-[0_0_12px_0px_rgba(34,197,94,0.15)] focus-within:border-emerald-500/70 focus-within:shadow-[0_0_18px_2px_rgba(34,197,94,0.2)] transition-all">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Digite palavras-chave, marca, produto ou tema do anúncio..."
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        {/* Buscar */}
        <button
          type="button"
          onClick={() => doSearch()}
          disabled={searching || !query.trim()}
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50 transition-colors"
        >
          {searching
            ? <RefreshCw className="h-4 w-4 animate-spin" />
            : <Search className="h-4 w-4" />}
          Buscar
        </button>

        {/* Salvos */}
        <button
          type="button"
          onClick={() => setActiveView(activeView === 'saved' ? 'search' : 'saved')}
          className={cn(
            'flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors',
            activeView === 'saved'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
              : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30'
          )}
        >
          <Bookmark className="h-4 w-4" />
          Salvos
          {allSaved.length > 0 && (
            <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
              {allSaved.length}
            </span>
          )}
        </button>
      </div>

      {/* ════ FILTER ROW ════ */}
      <div className="flex flex-wrap items-center gap-2">
        {/* País */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">País</span>
          <div className="relative flex items-center">
            <select
              value={country}
              onChange={e => setCountry(e.target.value)}
              className="h-8 appearance-none rounded-lg border border-border bg-card pl-3 pr-7 text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              {AD_COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-muted-foreground" />
          </div>
        </div>

        {/* Plataforma */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Plataforma</span>
          <div className="relative flex items-center">
            <select className="h-8 appearance-none rounded-lg border border-border bg-card pl-3 pr-7 text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer">
              <option>Todas</option>
              <option>Facebook</option>
              <option>Instagram</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-muted-foreground" />
          </div>
        </div>

        {/* Tipo de mídia */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Tipo de mídia</span>
          <div className="relative flex items-center">
            <select
              value={adStatus}
              onChange={e => setAdStatus(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
              className="h-8 appearance-none rounded-lg border border-border bg-card pl-3 pr-7 text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="ALL">Todos</option>
              <option value="ACTIVE">Ativos</option>
              <option value="INACTIVE">Inativos</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-muted-foreground" />
          </div>
        </div>

        {/* Data veiculação */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Data veiculação</span>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:border-foreground/30 transition-colors"
          >
            Últimos 180 dias
            <Calendar className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>

        {/* Mais filtros */}
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors ml-auto"
        >
          <SlidersHorizontal className="h-3 w-3" />
          Mais filtros
        </button>
      </div>

      {/* ════ SEARCH VIEW ════ */}
      {activeView === 'search' && (
        <div className="space-y-5">

          {/* Error */}
          {searchError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-2">
              <p className="text-sm font-bold text-red-400">Erro na busca</p>
              <p className="text-xs text-red-400/80">{searchError}</p>
              <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground">Como resolver:</p>
                <p>1. Acesse <strong>developers.facebook.com</strong> → selecione o app usado na integração Meta</p>
                <p>2. Vá em <strong>Produtos → Marketing API → Permissões</strong> e confirme que <code className="rounded bg-red-500/10 px-1">ads_read</code> tem acesso <strong>Standard</strong></p>
                <p>3. Se necessário, solicite acesso à <strong>Ads Library API</strong> em <strong>facebook.com/ads/library/api</strong></p>
                <p>4. Após aprovação, reconecte a integração Meta em <strong>Integrações</strong></p>
              </div>
            </div>
          )}

          {/* Skeleton while searching */}
          {searching && (
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-80 animate-pulse rounded-2xl border border-border bg-card" />
              ))}
            </div>
          )}

          {/* Results */}
          {!searching && results.length > 0 && (
            <>
              {/* Results header */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  <span className="font-semibold text-foreground">{results.length} anúncios encontrados</span>
                  <span className="text-xs text-muted-foreground">
                    Resultados dos últimos 180 dias no {countryLabel.replace(/^.+ /, '')}
                  </span>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  Mais recentes
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>

              {/* Card grid */}
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {results.map(ad => {
                  const saved = savedMap[ad.adArchiveId];
                  return (
                    <AdCard
                      key={ad.adArchiveId}
                      ad={ad}
                      savedId={saved?.id ?? null}
                      onSave={(clientId) => saveAd(ad, clientId)}
                      onRemove={() => saved && removeAd(saved.id, ad.adArchiveId)}
                      onSelect={() => handleSelectAd(ad)}
                      saving={savingId === ad.adArchiveId || savingId === saved?.id}
                      clients={activeClients}
                    />
                  );
                })}
              </div>

              {/* Load more */}
              {nextCursor && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => doSearch(nextCursor)}
                    disabled={loadingMore}
                    className="flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-2.5 text-xs font-bold text-muted-foreground hover:bg-muted/50 transition-colors"
                  >
                    {loadingMore
                      ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      : <ChevronDown className="h-3.5 w-3.5" />}
                    {loadingMore ? 'Carregando...' : 'Carregar mais'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Empty / initial state */}
          {!searching && results.length === 0 && !searchError && (
            <div className="rounded-2xl border border-border bg-card/40 py-20 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10">
                <Search className="h-7 w-7 text-violet-400/60" />
              </div>
              <p className="text-sm font-semibold text-muted-foreground">
                {query.trim() ? 'Nenhum anúncio encontrado.' : 'Digite palavras-chave para pesquisar.'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/50">
                {query.trim()
                  ? 'Tente outros termos ou mude o filtro de status.'
                  : 'Exemplos: implante dentário, clínica estética, consultório...'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ════ SAVED VIEW ════ */}
      {activeView === 'saved' && (
        <div className="space-y-5">
          {/* Saved filter row */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex items-center">
              <select
                value={filterClientId}
                onChange={e => setFilterClientId(e.target.value)}
                className="h-9 appearance-none rounded-xl border border-border bg-card pl-4 pr-8 text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <option value="">Todos os clientes</option>
                {activeClients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 h-3 w-3 text-muted-foreground" />
            </div>
            {savedLoading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {/* Saved empty */}
          {displayedSaved.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card/40 py-20 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
                <Bookmark className="h-7 w-7 text-emerald-400/60" />
              </div>
              <p className="text-sm font-semibold text-muted-foreground">Nenhum anúncio salvo.</p>
              <p className="mt-1 text-xs text-muted-foreground/50">Busque anúncios e salve para um cliente.</p>
            </div>
          ) : (
            <>
              {/* Saved results header */}
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <span className="font-semibold text-foreground">
                  {displayedSaved.length} anúncio{displayedSaved.length !== 1 ? 's' : ''} salvo{displayedSaved.length !== 1 ? 's' : ''}
                </span>
                {filterClientId && (
                  <span className="text-xs text-muted-foreground">
                    para {activeClients.find(c => c.id === filterClientId)?.name}
                  </span>
                )}
              </div>

              {/* Saved card grid */}
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {displayedSaved.map(ad => (
                  <AdCard
                    key={ad.id}
                    ad={ad}
                    savedId={ad.id}
                    onSave={() => {}}
                    onRemove={() => removeAd(ad.id, ad.adArchiveId)}
                    onSelect={() => handleSelectAd(ad)}
                    saving={savingId === ad.id}
                    clients={activeClients}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {/* ════ AD DETAIL MODAL ════ */}
      {selectedAd && (
        <AdDetailModal
          ad={selectedAd}
          savedId={savedMap[selectedAd.adArchiveId]?.id ?? null}
          onClose={() => setSelectedAd(null)}
          onSave={(clientId) => { saveAd(selectedAd, clientId); }}
          onRemove={() => {
            const s = savedMap[selectedAd.adArchiveId];
            if (s) removeAd(s.id, selectedAd.adArchiveId);
          }}
          saving={savingId === selectedAd.adArchiveId || savingId === (savedMap[selectedAd.adArchiveId]?.id ?? '')}
          clients={activeClients}
        />
      )}
    </div>
  );
}
