"use client";

import Link from 'next/link';
import { Ban, ExternalLink, Loader2, MinusCircle, PauseCircle, PlayCircle, Rocket, Search, SkipForward, Target } from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { CreativeThumb } from '@/components/otimizador/creative-thumb';
import {
  NIVEL_LABEL,
  SEV,
  categoriaDoNode,
  categoriaMeta,
  type FilaRec,
} from '@/lib/optimizer-ui';

// Cartão do Briefing — UMA decisão por vez, no estilo co-piloto. Título como pergunta/afirmação,
// o "por quê" com a prova nos números, e ações grandes: aplicar / não fazer / pular.
export function BriefingCard({ rec, index, total, busy, onAplicar, onIgnorar, onPular }: {
  rec: FilaRec;
  index: number;
  total: number;
  busy: boolean;
  onAplicar: (rec: FilaRec) => void;
  onIgnorar: (rec: FilaRec) => void;
  onPular: () => void;
}) {
  const sev = SEV[rec.severidade];
  const cat = categoriaDoNode(rec);
  const catMeta = categoriaMeta(cat);
  const CatIcon = cat === 'pausar' ? PauseCircle : cat === 'escalar' ? Rocket : cat === 'revisar' ? Search : cat === 'manter' ? MinusCircle : Target;

  const acaoLabel = rec.acao_estruturada
    ? (rec.acao_estruturada.tipo === 'PAUSAR' ? 'Pausar agora'
      : rec.acao_estruturada.tipo === 'ATIVAR' ? 'Ativar agora'
        : 'Ajustar orçamento')
    : null;
  const AcaoIcon = rec.acao_estruturada?.tipo === 'ATIVAR' ? PlayCircle : rec.acao_estruturada?.tipo === 'PAUSAR' ? PauseCircle : Rocket;
  const podeAplicar = !!rec.acao_estruturada && rec.aplicavel;

  const ringColor = rec.severidade === 'urgente' ? '#f87171' : rec.severidade === 'atencao' ? '#fbbf24' : '#34d399';

  const caminho = [rec.campanha_nome, rec.nivel !== 'campaign' ? rec.conjunto_nome : null, rec.nivel === 'ad' ? rec.objeto_nome : null]
    .filter(Boolean).join(' › ');

  const metricas = rec.metricas_chave.filter((m) => m.valor && m.valor !== '—').slice(0, 3);

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Contexto da conta + progresso */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', sev.dot)} />
          <span className="truncate text-sm font-semibold text-foreground" title={rec.cliente_nome}>{rec.cliente_nome}</span>
          <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold', sev.badge)}>{sev.label}</span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">Decisão {index + 1} de {total}</span>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-border bg-card">
        <div className="h-1" style={{ backgroundColor: ringColor }} />
        <div className="p-5 sm:p-6">
          <div className="mb-1.5 flex items-center gap-2">
            <CatIcon className={cn('h-4 w-4', catMeta.tone.replace(/border-\S+|bg-\S+/g, '').trim())} />
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{catMeta.label}</span>
            {rec.objetivo && <span className="text-[11px] text-muted-foreground">· {rec.objetivo}</span>}
          </div>

          <h2 className="text-xl font-bold leading-snug text-foreground">{rec.titulo}</h2>
          {caminho && <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{NIVEL_LABEL[rec.nivel]}</span>
            <span className="truncate" title={caminho}>{caminho}</span>
          </p>}

          {/* Por quê */}
          {rec.motivos.length > 0 && (
            <>
              <p className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Por quê</p>
              <ul className="space-y-1.5">
                {rec.motivos.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: ringColor }} />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Prova nos números */}
          {metricas.length > 0 && (
            <div className="mt-4 flex gap-2">
              {metricas.map((m) => (
                <div key={m.rotulo} className="flex-1 rounded-[var(--radius)] bg-background/70 p-2.5">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" title={m.rotulo}>{m.rotulo}</p>
                  <p className="mt-1 text-lg font-bold text-foreground">{m.valor}</p>
                </div>
              ))}
            </div>
          )}

          {rec.nivel === 'ad' && rec.imagem_url && (
            <div className="mt-4 flex items-center gap-2">
              <CreativeThumb tone={cat === 'pausar' ? 'border-red-400/40' : 'border-border'} imageUrl={rec.imagem_url} alt={rec.objeto_nome} />
              <span className="truncate text-xs text-muted-foreground" title={rec.objeto_nome}>{rec.objeto_nome}</span>
            </div>
          )}

          {/* Ações */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {podeAplicar ? (
              <button
                onClick={() => onAplicar(rec)}
                disabled={busy}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                style={{ minWidth: 160 }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AcaoIcon className="h-4 w-4" />}
                {acaoLabel}
              </button>
            ) : (
              <Link
                href={`/otimizador?clientId=${encodeURIComponent(rec.cliente_id)}`}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground hover:border-primary/40"
                style={{ minWidth: 160 }}
              >
                <ExternalLink className="h-4 w-4" /> Ver no Otimizador
              </Link>
            )}
            <button
              onClick={() => onIgnorar(rec)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              <Ban className="h-4 w-4" /> Não fazer
            </button>
            <button
              onClick={onPular}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              <SkipForward className="h-4 w-4" /> Pular
            </button>
          </div>
        </div>
      </div>

      {/* Progresso em pontos */}
      <div className="mt-4 flex items-center justify-center gap-1.5">
        {Array.from({ length: Math.min(total, 12) }).map((_, i) => (
          <span
            key={i}
            className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-6 bg-primary' : i < index ? 'w-1.5 bg-primary/50' : 'w-1.5 bg-border')}
          />
        ))}
      </div>
    </div>
  );
}
