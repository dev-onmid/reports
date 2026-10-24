'use client';

import { useState } from 'react';
import { ArrowLeftRight, CalendarDays } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  faixaAtual, faixaComparacao, OPCOES_COMPARACAO, type Faixa, type ModoComparacao, type PeriodoDashboard,
} from '@/lib/dashboard-periodo';

/**
 * Período personalizado + "Comparar com" numa janela só, aplicados JUNTOS no
 * botão "Aplicar" (pedido do Matheus, 2026-10-23). Antes as datas ficavam numa
 * faixa embaixo do cabeçalho e cada data digitada já recarregava a tela inteira
 * — com o comparativo, eram duas faixas e o dobro de recargas, e ficava lento.
 * Aqui nada muda até aplicar.
 *
 * No CELULAR é a porta única de período: os atalhos (7 dias, este mês…) moram
 * aqui em vez de numa fileira cortada no cabeçalho.
 */

export type EscolhaPeriodo = {
  /** Escolheu um atalho (7 dias, este mês…). */
  atalho: PeriodoDashboard | null;
  /** Digitou datas: vira personalizado com elas. */
  periodo: { de: string; ate: string } | null;
  modo: ModoComparacao;
  compDe: string;
  compAte: string;
};

const br = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const dias = (f: Faixa) => Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86_400_000) + 1;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const CAMPO = 'h-11 w-full rounded-[10px] border border-white/[0.10] bg-[#0b1216] px-3 text-sm font-semibold text-[#f4f7f8] outline-none [color-scheme:dark] focus:border-[#6cff2f]';
const ROTULO = 'text-[10px] font-black uppercase tracking-[0.07em] text-[#9aa4aa]';

export function PeriodoModal({ aberto, onFechar, period, faixa, modo, compDe, compAte, hoje, onAplicar, atalhos = [] }: {
  aberto: boolean;
  /** Atalhos de período mostrados no topo (sem "personalizado"). */
  atalhos?: Array<{ value: PeriodoDashboard; label: string }>;
  onFechar: () => void;
  period: PeriodoDashboard;
  /** Janela que a tela está mostrando agora. */
  faixa: Faixa;
  modo: ModoComparacao;
  compDe: string;
  compAte: string;
  hoje: string;
  onAplicar: (e: EscolhaPeriodo) => void;
}) {
  // Rascunho: começa no que está valendo e só sai daqui no "Aplicar".
  const [atalho, setAtalho] = useState<PeriodoDashboard | null>(null);
  const [de, setDe] = useState(faixa.from);
  const [ate, setAte] = useState(faixa.to);
  const escolherAtalho = (p: PeriodoDashboard) => {
    const f = faixaAtual(p);
    setAtalho(p); setDe(f.from); setAte(f.to);
  };
  const digitar = (campo: 'de' | 'ate', v: string) => { setAtalho(null); if (campo === 'de') setDe(v); else setAte(v); };
  const [m, setM] = useState<ModoComparacao>(modo);
  const [cDe, setCDe] = useState(compDe);
  const [cAte, setCAte] = useState(compAte);

  const periodoOk = ISO.test(de) && ISO.test(ate) && de <= ate;
  const mexeuPeriodo = !atalho && (de !== faixa.from || ate !== faixa.to);
  const faixaNova: Faixa = periodoOk ? { from: de, to: ate } : faixa;
  const periodNovo: PeriodoDashboard = atalho ?? (mexeuPeriodo ? 'custom' : period);
  const periodoAtivo = atalho ?? (mexeuPeriodo ? 'custom' : period);
  const comparacaoOk = m !== 'datas' || (ISO.test(cDe) && ISO.test(cAte) && cDe <= cAte);
  const prev = faixaComparacao(m, periodNovo, faixaNova, { from: cDe, to: cAte });
  const podeAplicar = periodoOk && comparacaoOk;

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[92dvh] w-[95vw] overflow-y-auto border border-white/[0.08] bg-[#0d1519] p-0 sm:max-w-[520px]">
        <div className="flex flex-col gap-5 p-5">
          <DialogTitle className="flex items-center gap-2.5 font-sans text-[15px] font-black uppercase tracking-[0.04em] text-[#f4f7f8]">
            <CalendarDays className="h-5 w-5 text-[#6cff2f]" /> Período e comparação
          </DialogTitle>

          <section className="flex flex-col gap-2">
            <p className={ROTULO}>Período analisado</p>
            {atalhos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {atalhos.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => escolherAtalho(a.value)}
                    className={cn(
                      'min-h-[40px] rounded-[10px] border px-2 text-[12.5px] font-bold transition-colors',
                      periodoAtivo === a.value ? 'border-[#6cff2f] bg-[#6cff2f] text-black' : 'border-white/[0.08] text-[#c9d1d6] hover:text-white',
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1"><span className="text-[11px] text-[#9aa4aa]">De</span>
                <input type="date" value={de} max={ate || hoje} onChange={(e) => digitar('de', e.target.value)} className={CAMPO} />
              </label>
              <label className="flex flex-col gap-1"><span className="text-[11px] text-[#9aa4aa]">Até</span>
                <input type="date" value={ate} min={de || undefined} max={hoje} onChange={(e) => digitar('ate', e.target.value)} className={CAMPO} />
              </label>
            </div>
            <p className="text-[12px] text-[#9aa4aa]">
              {periodoOk ? `${br(de)} a ${br(ate)} · ${dias(faixaNova)} ${dias(faixaNova) === 1 ? 'dia' : 'dias'}` : 'Escolha as duas datas.'}
            </p>
          </section>

          <section className="flex flex-col gap-2 border-t border-white/[0.06] pt-4">
            <p className={cn(ROTULO, 'flex items-center gap-1.5')}><ArrowLeftRight className="h-3.5 w-3.5 text-[#6cff2f]" /> Comparar com</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {OPCOES_COMPARACAO.map((o) => (
                <button
                  key={o.valor}
                  type="button"
                  onClick={() => {
                    if (o.valor === 'datas' && !(cDe && cAte) && prev) { setCDe(prev.from); setCAte(prev.to); }
                    setM(o.valor);
                  }}
                  className={cn(
                    'rounded-[10px] border px-3 py-2.5 text-left text-[13px] font-bold transition-colors',
                    m === o.valor ? 'border-[#6cff2f]/60 bg-[#6cff2f]/10 text-[#f4f7f8]' : 'border-white/[0.08] text-[#a7b0b6] hover:text-white',
                  )}
                >
                  {o.rotulo}
                </button>
              ))}
            </div>
            {m === 'datas' && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1"><span className="text-[11px] text-[#9aa4aa]">Comparar de</span>
                  <input type="date" value={cDe} max={cAte || undefined} onChange={(e) => setCDe(e.target.value)} className={CAMPO} />
                </label>
                <label className="flex flex-col gap-1"><span className="text-[11px] text-[#9aa4aa]">até</span>
                  <input type="date" value={cAte} min={cDe || undefined} onChange={(e) => setCAte(e.target.value)} className={CAMPO} />
                </label>
              </div>
            )}
            <p className="text-[12px] text-[#9aa4aa]">
              {prev ? `Comparado com ${br(prev.from)} a ${br(prev.to)} · ${dias(prev)} ${dias(prev) === 1 ? 'dia' : 'dias'}` : 'Sem período para comparar.'}
            </p>
          </section>
        </div>

        <div className="flex justify-end gap-2 rounded-b-xl border-t border-white/[0.06] bg-black/20 px-5 py-3.5">
          <button type="button" onClick={onFechar} className="rounded-[10px] px-4 py-2 text-[13px] font-bold text-[#a7b0b6] hover:text-white">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!podeAplicar}
            onClick={() => onAplicar({ atalho: atalho && atalho !== period ? atalho : null, periodo: mexeuPeriodo ? { de, ate } : null, modo: m, compDe: cDe, compAte: cAte })}
            className="rounded-[10px] bg-[#6cff2f] px-5 py-2 text-[13px] font-black text-black disabled:opacity-40"
          >
            Aplicar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
