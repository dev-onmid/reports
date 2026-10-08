"use client";

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight, Clapperboard, Image as ImageIcon, Play, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import dados from '@/lib/formatos-criativos.json';

// Página de apoio para reuniões: os 50 formatos de criativo da biblioteca
// "50 Formatos que escalam" (Serraglio), com a explicação de cada um e os
// vídeos de exemplo tocando aqui mesmo — sem abrir o Google Drive.
// Os dados foram capturados da biblioteca em 2026-10-07
// (src/lib/formatos-criativos.json); os arquivos saem de
// /api/formatos-criativos/midia (cópia local quando existe).

type Exemplo = { drive_id: string; nome: string; tipo: string; arquivo: string };
type Formato = {
  numero: number;
  titulo: string;
  descricao: string;
  grupo: string;
  pasta_drive: string;
  exemplos: Exemplo[];
};

const FORMATOS = (dados as { formatos: Formato[] }).formatos;
const GRUPOS = Array.from(new Set(FORMATOS.map((f) => f.grupo)));

function semAcento(s: string) {
  // ⚠️ range de diacríticos SEMPRE escapado — ver lição no CLAUDE.md.
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const midiaUrl = (e: Exemplo) => `/api/formatos-criativos/midia?f=${encodeURIComponent(e.arquivo)}`;
const num = (n: number) => String(n).padStart(2, '0');

export default function FormatosCriativosPage() {
  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState<string | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);

  const lista = useMemo(() => {
    const q = semAcento(busca.trim());
    return FORMATOS.filter(
      (f) =>
        (!grupo || f.grupo === grupo) &&
        (!q || semAcento(`${f.numero} ${f.titulo} ${f.descricao}`).includes(q)),
    );
  }, [busca, grupo]);

  const idx = aberto === null ? -1 : lista.findIndex((f) => f.numero === aberto);
  const atual = idx >= 0 ? lista[idx] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl uppercase tracking-wide text-white">Formatos de Criativos</h1>
          <p className="mt-1 text-sm text-white/60">
            50 formatos de anúncio com explicação e exemplos para levar ideias às reuniões.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar formato…"
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip ativo={grupo === null} onClick={() => setGrupo(null)}>
          Todos ({FORMATOS.length})
        </Chip>
        {GRUPOS.map((g) => (
          <Chip key={g} ativo={grupo === g} onClick={() => setGrupo(g)}>
            {g.replace('FORMATOS ', '')}
          </Chip>
        ))}
      </div>

      {lista.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/50">Nenhum formato encontrado.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {lista.map((f) => (
            <button
              key={f.numero}
              type="button"
              onClick={() => setAberto(f.numero)}
              className="group overflow-hidden rounded-[14px] border border-white/10 bg-[#0d1519]/92 text-left transition hover:border-primary/60"
            >
              <div className="relative aspect-[9/16] max-h-72 w-full overflow-hidden bg-black">
                {f.exemplos[0] && <Capa exemplo={f.exemplos[0]} />}
                <span className="absolute left-2 top-2 bg-primary px-1.5 py-0.5 font-heading text-lg leading-none text-black">
                  {num(f.numero)}
                </span>
                <span className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/80">
                  <Play className="h-3 w-3" /> {f.exemplos.length}
                </span>
              </div>
              <div className="p-3">
                <h3 className="text-sm font-bold leading-snug text-white">{f.titulo}</h3>
                <p className="mt-1 line-clamp-2 text-xs text-white/50">{f.descricao}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {atual && (
        <FormatoModal
          key={atual.numero}
          formato={atual}
          onClose={() => setAberto(null)}
          onAnterior={idx > 0 ? () => setAberto(lista[idx - 1].numero) : undefined}
          onProximo={idx < lista.length - 1 ? () => setAberto(lista[idx + 1].numero) : undefined}
        />
      )}
    </div>
  );
}

// Capa do card: o primeiro frame do próprio exemplo. A miniatura do Drive
// (drive.google.com/thumbnail) falha sem sessão do Google e com volume.
function Capa({ exemplo }: { exemplo: Exemplo }) {
  const cls = 'h-full w-full object-cover opacity-80 transition group-hover:scale-105 group-hover:opacity-100';
  if (exemplo.tipo !== 'video') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={midiaUrl(exemplo)} alt="" loading="lazy" className={cls} />;
  }
  return <video src={`${midiaUrl(exemplo)}#t=0.5`} preload="metadata" muted playsInline className={cls} />;
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition',
        ativo ? 'border-primary bg-primary text-black' : 'border-white/15 text-white/70 hover:border-white/40',
      )}
    >
      {children}
    </button>
  );
}

function FormatoModal({
  formato,
  onClose,
  onAnterior,
  onProximo,
}: {
  formato: Formato;
  onClose: () => void;
  onAnterior?: () => void;
  onProximo?: () => void;
}) {
  const [ex, setEx] = useState(0);
  const exemplo = formato.exemplos[ex];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onAnterior) onAnterior();
      if (e.key === 'ArrowRight' && onProximo) onProximo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onAnterior, onProximo]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-0 sm:p-6" onClick={onClose}>
      <div
        className="relative flex h-full w-full max-w-4xl flex-col overflow-hidden border border-white/10 bg-[#0e0f14] sm:h-auto sm:max-h-[92vh] sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-3 top-3 z-10 bg-black/60 p-1.5 text-white/70 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-black sm:w-[46%] sm:flex-none">
          {exemplo?.tipo === 'video' ? (
            <video
              key={exemplo.arquivo}
              src={midiaUrl(exemplo)}
              controls
              playsInline
              autoPlay
              className="h-full max-h-[60vh] w-full object-contain sm:max-h-[86vh]"
            />
          ) : exemplo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={exemplo.arquivo}
              src={midiaUrl(exemplo)}
              alt={exemplo.nome}
              className="h-full max-h-[60vh] w-full object-contain sm:max-h-[86vh]"
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4 overflow-y-auto p-5 sm:flex-1 sm:p-7">
          <div className="flex items-center gap-3 pr-8">
            <span className="bg-primary px-2 py-1 font-heading text-2xl leading-none text-black">{num(formato.numero)}</span>
            <h2 className="font-heading text-3xl uppercase leading-none tracking-wide text-white">{formato.titulo}</h2>
          </div>
          <p className="text-sm leading-relaxed text-white/80">{formato.descricao}</p>

          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/50">
              Exemplos ({formato.exemplos.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {formato.exemplos.map((e, i) => (
                <button
                  key={e.arquivo}
                  type="button"
                  onClick={() => setEx(i)}
                  className={cn(
                    'flex items-center gap-1.5 border px-3 py-2 text-xs font-bold transition',
                    i === ex ? 'border-primary bg-primary/10 text-primary' : 'border-white/15 text-white/70 hover:border-white/40',
                  )}
                >
                  {e.tipo === 'video' ? <Clapperboard className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  Exemplo {i + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={onAnterior}
              disabled={!onAnterior}
              className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-white/60 hover:text-white disabled:opacity-25"
            >
              <ChevronLeft className="h-4 w-4" /> Anterior
            </button>
            <button
              type="button"
              onClick={onProximo}
              disabled={!onProximo}
              className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-white/60 hover:text-white disabled:opacity-25"
            >
              Próximo <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
