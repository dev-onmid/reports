"use client";

import { useMemo, useState } from 'react';
import { ResultsTabs } from '@/components/results-tabs';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Clapperboard,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Search,
  Video,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Baixar criativos da Biblioteca de Anúncios do Meta: cola o link (página
// inteira via view_all_page_id ou anúncio único via id), o servidor extrai os
// vídeos/imagens e cada card ganha botão de download — sem inspecionar página.
// Herda a flag `radar` pelo prefixo /resultados.

interface AdMedia {
  type: 'video' | 'image';
  url: string;
  sdUrl?: string;
  previewImage?: string;
}

interface LibraryAd {
  adArchiveId: string;
  pageName: string;
  pageProfilePicture: string | null;
  isActive: boolean;
  startDate: number | null;
  endDate: number | null;
  publisherPlatforms: string[];
  displayFormat: string | null;
  bodyText: string | null;
  ctaText: string | null;
  linkUrl: string | null;
  media: AdMedia[];
}

type MediaFilter = 'all' | 'video' | 'image';

function fmtDate(epochSeconds: number | null): string {
  if (!epochSeconds) return '—';
  return new Date(epochSeconds * 1000).toLocaleDateString('pt-BR');
}

function slugify(name: string): string {
  // ⚠️ range de diacríticos SEMPRE escapado \u0300-\u036f — ver lição no CLAUDE.md.
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'criativo'
  );
}

function downloadHref(mediaUrl: string, filename: string): string {
  return `/api/ads-library/download?u=${encodeURIComponent(mediaUrl)}&name=${encodeURIComponent(filename)}`;
}

function mediaFilename(ad: LibraryAd, media: AdMedia, index: number): string {
  const ext = media.type === 'video' ? 'mp4' : 'jpg';
  const suffix = ad.media.length > 1 ? `-${index + 1}` : '';
  return `${slugify(ad.pageName)}-${ad.adArchiveId}${suffix}.${ext}`;
}

export default function BibliotecaMetaPage() {
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ads, setAds] = useState<LibraryAd[]>([]);
  const [pageName, setPageName] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  const filteredAds = useMemo(() => {
    if (filter === 'all') return ads;
    return ads.filter((ad) => ad.media.some((m) => m.type === filter));
  }, [ads, filter]);

  const counts = useMemo(() => {
    let videos = 0;
    let images = 0;
    for (const ad of ads) {
      for (const m of ad.media) {
        if (m.type === 'video') videos++;
        else images++;
      }
    }
    return { videos, images };
  }, [ads]);

  async function search() {
    const url = link.trim();
    if (!url || loading) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    setAds([]);
    setPageName(null);
    setFilter('all');
    try {
      const res = await fetch('/api/ads-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(data.error ?? `Falha na busca (HTTP ${res.status}).`);
        return;
      }
      setAds(Array.isArray(data.ads) ? data.ads : []);
      setPageName(data.pageName ?? null);
      if (data.error) setError(data.error);
    } catch {
      setError('Não foi possível falar com o servidor — tente de novo.');
    } finally {
      setLoading(false);
    }
  }

  // Dispara os downloads em sequência (um <a> por mídia, com pausa) — o
  // navegador agrupa tudo na pasta de downloads.
  async function downloadAll() {
    const jobs: { href: string }[] = [];
    for (const ad of filteredAds) {
      ad.media.forEach((m, i) => {
        if (filter !== 'all' && m.type !== filter) return;
        jobs.push({ href: downloadHref(m.url, mediaFilename(ad, m, i)) });
      });
    }
    for (let i = 0; i < jobs.length; i++) {
      setBulkProgress(`Baixando ${i + 1} de ${jobs.length}…`);
      const a = document.createElement('a');
      a.href = jobs[i].href;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Pausa pra não estourar o limite de downloads simultâneos do navegador.
      await new Promise((r) => setTimeout(r, 700));
    }
    setBulkProgress(null);
  }

  const totalMedia = counts.videos + counts.images;

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="font-bebas text-3xl uppercase tracking-wide">Biblioteca Meta — Baixar criativos</h1>
        <p className="text-sm text-muted-foreground">
          Cole o link da Biblioteca de Anúncios do Meta e baixe os vídeos e imagens em um clique — sem
          inspecionar página.
        </p>
      </div>
      <ResultsTabs />

      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') search();
            }}
            placeholder="https://www.facebook.com/ads/library/?view_all_page_id=… ou ?id=…"
            className="flex-1"
          />
          <Button onClick={search} disabled={loading || !link.trim()} className="shrink-0">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            {loading ? 'Buscando…' : 'Buscar criativos'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Funciona com o link da página inteira (todos os anúncios ativos) ou de um anúncio específico. A
          busca traz os anúncios da primeira página da Biblioteca (~30 mais recentes na ordenação do link).
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {!loading && searched && !error && ads.length === 0 && (
        <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum criativo encontrado nesse link.
        </div>
      )}

      {ads.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-bebas text-xl uppercase tracking-wide truncate">
                {pageName ?? 'Resultados'}
              </div>
              <div className="text-xs text-muted-foreground">
                {ads.length} anúncio{ads.length === 1 ? '' : 's'} · {counts.videos} vídeo
                {counts.videos === 1 ? '' : 's'} · {counts.images} {counts.images === 1 ? 'imagem' : 'imagens'}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {(
                [
                  ['all', `Todos (${totalMedia})`],
                  ['video', `Vídeos (${counts.videos})`],
                  ['image', `Imagens (${counts.images})`],
                ] as [MediaFilter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                    filter === key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button onClick={downloadAll} disabled={bulkProgress !== null} variant="outline" className="shrink-0">
              {bulkProgress ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {bulkProgress ?? 'Baixar todos'}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAds.map((ad) => (
              <AdCard key={ad.adArchiveId} ad={ad} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AdCard({ ad }: { ad: LibraryAd }) {
  const first = ad.media[0];
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="relative aspect-square bg-black/40">
        {first ? (
          first.type === 'video' ? (
            <video
              src={first.url}
              poster={first.previewImage}
              controls
              preload="none"
              className="h-full w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={first.url} alt="" className="h-full w-full object-contain" loading="lazy" />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Clapperboard className="h-8 w-8" />
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
              ad.isActive ? 'bg-primary/90 text-black' : 'bg-zinc-700/90 text-zinc-200',
            )}
          >
            {ad.isActive ? 'Ativo' : 'Inativo'}
          </span>
          {first && (
            <span className="flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              {first.type === 'video' ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
              {ad.displayFormat === 'CAROUSEL' ? 'Carrossel' : first.type === 'video' ? 'Vídeo' : 'Imagem'}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Início: {fmtDate(ad.startDate)}</span>
          <a
            href={`https://www.facebook.com/ads/library/?id=${ad.adArchiveId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground"
            title="Abrir na Biblioteca de Anúncios"
          >
            <ExternalLink className="h-3 w-3" />
            {ad.adArchiveId.slice(-8)}
          </a>
        </div>
        {ad.bodyText && <p className="line-clamp-2 text-xs text-muted-foreground">{ad.bodyText}</p>}
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          {ad.media.length === 0 && (
            <span className="text-xs text-muted-foreground">Sem mídia baixável neste anúncio.</span>
          )}
          {ad.media.map((m, i) => (
            <div key={m.url} className="flex items-center gap-1.5">
              <a
                href={downloadHref(m.url, mediaFilename(ad, m, i))}
                className={cn(buttonVariants({ size: 'sm' }), 'h-8 min-w-0 flex-1 px-2')}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {m.type === 'video' ? 'Baixar HD' : 'Baixar imagem'}
                {ad.media.length > 1 ? ` ${i + 1}` : ''}
              </a>
              {m.type === 'video' && m.sdUrl && m.sdUrl !== m.url && (
                <a
                  href={downloadHref(m.sdUrl, mediaFilename(ad, m, i).replace(/\.mp4$/, '-sd.mp4'))}
                  className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'h-8 shrink-0 px-2 text-xs')}
                >
                  SD
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
