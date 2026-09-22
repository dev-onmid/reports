'use client';

import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Card de meta em "bullet graph" (Stephen Few): uma barra só responde as três
 * perguntas que a barra de progresso antiga misturava.
 *
 *  - TRILHA de fundo = meta do MÊS inteiro;
 *  - BARRA = realizado;
 *  - MARCADOR vertical = esperado até hoje (meta parcial).
 *
 * A cor é do RITMO (realizado ÷ esperado), não do progresso contra o mês: no dia
 * 5, ter feito 16% da meta mensal é estar em dia, e a barra antiga pintava isso
 * de vermelho.
 */

const VERDE = '#55f52f';
const AMBAR = '#f5a524';
const VERMELHO = '#e52020';

export function corDoRitmo(ritmoPct: number): string {
  if (ritmoPct >= 100) return VERDE;
  if (ritmoPct >= 75) return AMBAR;
  return VERMELHO;
}

export function BulletMetaCard({
  titulo, icon: Icon, fonte, fonteTitulo, metaMes, esperado, realizado, formatar,
  rotuloEsperado = 'Esperado até hoje', projecao, rodape,
}: {
  titulo: string;
  icon: ElementType;
  /** Chip de fonte do número ("CRM", "Meta + Google (plataformas)"). */
  fonte: string;
  fonteTitulo?: string;
  /** Meta do mês inteiro (trilha). */
  metaMes: number;
  /** Meta parcial — o que deveria estar feito na janela (marcador). */
  esperado: number;
  realizado: number;
  formatar: (n: number) => string;
  rotuloEsperado?: string;
  /** Projeção linear de fechamento do mês; null/undefined = não mostra. */
  projecao?: number | null;
  rodape?: ReactNode;
}) {
  const temMeta = metaMes > 0;
  const base = esperado > 0 ? esperado : metaMes;
  const ritmo = base > 0 ? (realizado / base) * 100 : 0;
  const cor = temMeta ? corDoRitmo(ritmo) : '#9aa4aa';
  // Escala cobre a meta e, se estourou, o realizado — senão a barra vazaria.
  const escala = Math.max(metaMes, realizado, esperado, 1);
  const larguraBarra = Math.max(0, Math.min(100, (realizado / escala) * 100));
  const larguraTrilha = temMeta ? Math.min(100, (metaMes / escala) * 100) : 100;
  const posMarcador = esperado > 0 ? Math.min(100, (esperado / escala) * 100) : null;
  const estourouMes = temMeta && realizado > metaMes;
  const mostraEsperado = esperado > 0 && Math.round(esperado) !== Math.round(metaMes);
  const pctMeta = temMeta && projecao != null ? (projecao / metaMes) * 100 : null;

  return (
    <section className="relative overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#55f52f]/20 bg-[#55f52f]/10 text-[#55f52f]">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">{titulo}</h2>
            <span
              className="rounded-[4px] bg-[#172027] px-1.5 py-0.5 text-[10px] font-semibold text-[#87929B]"
              title={fonteTitulo}
            >
              {fonte}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="min-w-0">
              <p className="truncate font-heading text-3xl leading-none" style={{ color: temMeta ? cor : '#f4f7f8' }}>
                {realizado > 0 ? formatar(realizado) : '—'}
              </p>
              <p className="mt-1.5 text-xs font-medium text-[#a7b0b6]">Realizado</p>
            </div>
            {mostraEsperado ? (
              <div className="min-w-0">
                <p className="truncate font-heading text-2xl leading-none text-[#f4f7f8]">{formatar(esperado)}</p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[#a7b0b6]">
                  <span className="inline-block h-3 w-0.5 bg-[#f4f7f8]" /> {rotuloEsperado}
                </p>
              </div>
            ) : <div />}
            <div className="min-w-0">
              <p className="truncate font-heading text-2xl leading-none text-[#f4f7f8]">{temMeta ? formatar(metaMes) : '—'}</p>
              <p className="mt-1.5 text-xs font-medium text-[#a7b0b6]">Meta do mês</p>
            </div>
          </div>

          {temMeta ? (
            <div className="mt-5">
              <div className="relative h-6 rounded-md bg-[#081014]">
                {/* Trilha = meta do mês */}
                <div className="absolute inset-y-0 left-0 rounded-md border border-white/10 bg-white/[0.06]" style={{ width: `${larguraTrilha}%` }} />
                {/* Realizado */}
                <div
                  className={cn('absolute left-0 top-1/2 h-3 -translate-y-1/2 rounded-sm', estourouMes && 'meta-estourada')}
                  style={{ width: `${larguraBarra}%`, backgroundColor: cor, transition: 'width 600ms ease, background-color 700ms ease' }}
                />
                {/* Esperado até hoje */}
                {posMarcador !== null && (
                  <div
                    className="absolute -top-1 -bottom-1 w-0.5 rounded bg-[#f4f7f8]"
                    style={{ left: `calc(${posMarcador}% - 1px)` }}
                    title={`${rotuloEsperado}: ${formatar(esperado)}`}
                  />
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-[#a7b0b6]">
                <span>
                  Ritmo:{' '}
                  <span className="font-black" style={{ color: cor }}>
                    {ritmo.toFixed(0)}%
                  </span>{' '}
                  {mostraEsperado ? `do ${rotuloEsperado.toLowerCase()}` : 'da meta'}
                </span>
                <span>{((realizado / metaMes) * 100).toFixed(0)}% da meta do mês</span>
              </div>
              {projecao != null && pctMeta !== null && (
                <p className="mt-1.5 text-xs text-[#a7b0b6]">
                  Projeção de fechamento:{' '}
                  <span className="font-bold text-[#f4f7f8]">{formatar(projecao)}</span>{' '}
                  <span className={cn('font-bold', pctMeta >= 100 ? 'text-[#55f52f]' : pctMeta >= 75 ? 'text-amber-300' : 'text-[#ff6b6b]')}>
                    ({pctMeta.toFixed(0)}% da meta)
                  </span>
                </p>
              )}
            </div>
          ) : (
            <p className="mt-5 text-xs text-[#9aa4aa]">Sem meta cadastrada no planejamento do cliente.</p>
          )}
          {rodape && <div className="mt-2 text-xs text-[#a7b0b6]">{rodape}</div>}
        </div>
      </div>
    </section>
  );
}
