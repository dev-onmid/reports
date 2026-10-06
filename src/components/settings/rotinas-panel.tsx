"use client";

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Moon, RefreshCw, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GRUPOS, type ConexaoStatus, type EstadoRotina, type GrupoRotina, type RotinaStatus } from '@/lib/rotinas-saude';

type Resposta = {
  agora: string;
  rotinas: RotinaStatus[];
  conexoes: ConexaoStatus[];
  resumo: { total: number; problemas: number; atencao: number; conexoesComProblema: number };
  leituraIndisponivel: boolean;
};

const ESTADO: Record<EstadoRotina, { rotulo: string; cor: string; dot: string; Icone: React.ElementType }> = {
  ok:          { rotulo: 'Rodando',     cor: 'text-emerald-400', dot: 'bg-emerald-400',  Icone: CheckCircle2 },
  ocioso:      { rotulo: 'Sem trabalho', cor: 'text-sky-400',    dot: 'bg-sky-400',      Icone: Moon },
  atencao:     { rotulo: 'Atenção',     cor: 'text-amber-400',   dot: 'bg-amber-400',    Icone: AlertTriangle },
  parado:      { rotulo: 'Parado',      cor: 'text-red-400',     dot: 'bg-red-400',      Icone: XCircle },
  erro:        { rotulo: 'Com erro',    cor: 'text-red-400',     dot: 'bg-red-400',      Icone: XCircle },
  sem_leitura: { rotulo: 'Sem leitura', cor: 'text-muted-foreground', dot: 'bg-muted-foreground', Icone: Clock },
};

function quando(iso: string | null, agora: string): string {
  if (!iso) return '—';
  const min = (new Date(agora).getTime() - new Date(iso).getTime()) / 60_000;
  if (!Number.isFinite(min)) return '—';
  if (min < 1) return 'agora';
  if (min < 60) return `há ${Math.round(min)} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} dias`;
}

const LABEL = 'text-[10px] font-bold uppercase tracking-widest text-muted-foreground';

function Kpi({ valor, rotulo, tom }: { valor: number; rotulo: string; tom: string }) {
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-border bg-[#0d1519]/92 p-4">
      <div className={cn('absolute left-0 top-0 h-0.5 w-full', tom)} />
      <p className={LABEL}>{rotulo}</p>
      <p className="font-heading mt-1 text-3xl leading-none text-foreground">{valor}</p>
    </div>
  );
}

/**
 * Chave de liga/desliga — é ESPELHO, não controle: ligar e desligar rotina
 * exigiria o app mexer na crontab da VPS, coisa que ele não faz. Serve para a
 * linha ser lida de relance, sem precisar de texto.
 */
function Chave({ estado }: { estado: EstadoRotina }) {
  const ligado = estado === 'ok' || estado === 'ocioso' || estado === 'atencao';
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors',
        estado === 'sem_leitura' ? 'border-border bg-muted/30' : ligado ? 'border-transparent' : 'border-transparent',
        estado === 'ok' && 'bg-emerald-500/80',
        estado === 'ocioso' && 'bg-sky-500/70',
        estado === 'atencao' && 'bg-amber-500/80',
        (estado === 'parado' || estado === 'erro') && 'bg-red-500/70',
      )}
    >
      <span className={cn('h-3 w-3 rounded-full bg-white shadow transition-transform', ligado ? 'translate-x-3.5' : 'translate-x-0.5', estado === 'sem_leitura' && 'bg-muted-foreground')} />
    </span>
  );
}

/** Uma rotina = uma linha. O detalhe só aparece quando o gestor pede. */
function LinhaRotina({ r, agora, aberta, onToggle }: { r: RotinaStatus; agora: string; aberta: boolean; onToggle: () => void }) {
  const e = ESTADO[r.estado];
  const grave = r.estado === 'parado' || r.estado === 'erro';
  return (
    <div className={cn('rounded-lg border bg-[#0d1519]/92 transition-colors', grave ? 'border-red-500/40' : r.estado === 'atencao' ? 'border-amber-500/30' : 'border-border')}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
        title={r.motivo}
      >
        <Chave estado={r.estado} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{r.nome}</span>
        <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-widest', e.cor)}>{e.rotulo}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', aberta && 'rotate-180')} />
      </button>
      {aberta && (
        <div className="space-y-1.5 border-t border-border/60 px-3 py-2.5">
          <p className="text-xs leading-relaxed text-muted-foreground">{r.oQueFaz}</p>
          <p className={cn('text-xs', grave ? 'text-red-300' : r.estado === 'atencao' ? 'text-amber-300' : 'text-muted-foreground')}>{r.motivo}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>Programada: {r.cadencia}</span>
            <span>Última execução: {quando(r.ultimaExecucao, agora)}</span>
            {r.rastroRotulo && <span>{r.rastroRotulo}: {quando(r.rastroEm, agora)}</span>}
          </div>
          {r.ultimaResposta && (
            <p className="truncate font-mono text-[11px] text-muted-foreground/70" title={r.ultimaResposta}>{r.ultimaResposta}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function RotinasPanel() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  // ⚠️ `.then` em vez de `async/await` de propósito: os setState precisam ficar
  // dentro do callback da promise. Chamados direto no corpo do efeito, viram
  // render em cascata (e o lint do projeto barra).
  const carregar = useCallback(() => {
    return fetch('/api/admin/rotinas', { cache: 'no-store' })
      .then((res) => res.json().then((json: Resposta & { error?: string }) => ({ res, json })))
      .then(({ res, json }) => {
        if (!res.ok) { setErro(json.error ?? 'Falha ao carregar.'); setDados(null); }
        else { setDados(json); setErro(null); }
      })
      .catch(() => setErro('Não foi possível falar com o servidor.'))
      .finally(() => setCarregando(false));
  }, []);

  // Atualiza sozinho de minuto em minuto: o painel fica aberto numa aba e tem
  // de envelhecer junto com a realidade, não com o momento em que foi aberto.
  useEffect(() => {
    void carregar();
    const t = setInterval(() => { void carregar(); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  const toggle = (id: string) =>
    setAbertas((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  if (erro) {
    return (
      <div className="rounded-[14px] border border-red-500/40 bg-red-500/5 p-6 text-sm text-red-300">
        {erro}
      </div>
    );
  }

  if (!dados) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Carregando rotinas…</div>;
  }

  const { resumo, agora } = dados;
  const saudaveis = dados.rotinas.filter((r) => r.estado === 'ok' || r.estado === 'ocioso').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg uppercase leading-none tracking-wide text-foreground">
            Rotinas do servidor
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            O que roda sozinho na VPS alimentando o CRM, as integrações e os envios.
          </p>
        </div>
        <button
          onClick={() => { setCarregando(true); void carregar(); }}
          disabled={carregando}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', carregando && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi valor={resumo.problemas} rotulo="Com problema" tom={resumo.problemas > 0 ? 'bg-red-500' : 'bg-border'} />
        <Kpi valor={resumo.atencao} rotulo="Atenção" tom={resumo.atencao > 0 ? 'bg-amber-500' : 'bg-border'} />
        <Kpi valor={saudaveis} rotulo="Saudáveis" tom="bg-primary" />
        <Kpi valor={resumo.conexoesComProblema} rotulo="Conexões a revisar" tom={resumo.conexoesComProblema > 0 ? 'bg-red-500' : 'bg-border'} />
      </div>

      {dados.leituraIndisponivel && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200">
          <strong className="font-semibold">Sem leitura de execução.</strong> O painel não está enxergando os arquivos
          que os crons gravam na VPS — &quot;sem leitura&quot; aqui não quer dizer que a rotina parou.
        </div>
      )}

      {/* ── Conexões: uma linha cada ─────────────────────────────── */}
      <section className="space-y-2">
        <h3 className={LABEL}>Conexões das plataformas</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dados.conexoes.map((c) => (
            <div
              key={c.id}
              title={`${c.conta} — ${c.motivo}`}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border bg-[#0d1519]/92 px-3 py-2',
                c.estado === 'erro' ? 'border-red-500/40' : c.estado === 'atencao' ? 'border-amber-500/30' : 'border-border',
              )}
            >
              <span className={cn('h-2 w-2 shrink-0 rounded-full', c.estado === 'ok' ? 'bg-emerald-400' : c.estado === 'atencao' ? 'bg-amber-400' : 'bg-red-400')} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{c.plataforma}</span>
              <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-widest', c.estado === 'ok' ? 'text-emerald-400' : c.estado === 'atencao' ? 'text-amber-400' : 'text-red-400')}>
                {c.estado === 'ok' ? 'Conectada' : c.estado === 'atencao' ? 'Atenção' : 'Revisar'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Rotinas por grupo, uma linha cada ────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {GRUPOS.map((g) => {
          const lista = dados.rotinas.filter((r) => r.grupo === (g.id as GrupoRotina));
          if (lista.length === 0) return null;
          return (
            <section key={g.id} className="space-y-2">
              <h3 className={LABEL}>{g.nome}</h3>
              <div className="space-y-1.5">
                {lista.map((r) => (
                  <LinhaRotina key={r.id} r={r} agora={agora} aberta={abertas.has(r.id)} onToggle={() => toggle(r.id)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
