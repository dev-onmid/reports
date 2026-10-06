"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Link2,
  Moon,
  Plug,
  RefreshCw,
  XCircle,
} from 'lucide-react';
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

function LinhaRotina({ r, agora }: { r: RotinaStatus; agora: string }) {
  const e = ESTADO[r.estado];
  const grave = r.estado === 'parado' || r.estado === 'erro';
  return (
    <div
      className={cn(
        'rounded-[14px] border bg-[#0d1519]/92 p-4 transition-colors',
        grave ? 'border-red-500/40' : r.estado === 'atencao' ? 'border-amber-500/30' : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.dot, grave && 'animate-pulse')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="truncate text-[13px] font-semibold text-foreground">{r.nome}</h4>
            <span className={cn('text-[10px] font-bold uppercase tracking-widest', e.cor)}>{e.rotulo}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.oQueFaz}</p>
          <p className={cn('mt-1.5 text-xs', grave ? 'text-red-300' : r.estado === 'atencao' ? 'text-amber-300' : 'text-muted-foreground')}>
            {r.motivo}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>Programada: {r.cadencia}</span>
            <span>Última execução: {quando(r.ultimaExecucao, agora)}</span>
            {r.rastroRotulo && <span>{r.rastroRotulo}: {quando(r.rastroEm, agora)}</span>}
          </div>
          {r.ultimaResposta && (
            <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground/70" title={r.ultimaResposta}>
              {r.ultimaResposta}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function RotinasPanel() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

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
  const PRECISA = new Set<EstadoRotina>(['parado', 'erro', 'atencao']);
  const precisamDeAtencao = dados.rotinas.filter((r) => PRECISA.has(r.estado));
  const resto = dados.rotinas.filter((r) => !PRECISA.has(r.estado));

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
        <div className="rounded-[14px] border border-amber-500/40 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-200">
          <strong className="font-semibold">Sem leitura de execução.</strong> O painel não está enxergando os
          arquivos que os crons gravam na VPS, então só consegue mostrar o rastro de cada rotina no banco.
          Enquanto isso, &quot;sem leitura&quot; não quer dizer que a rotina parou.
        </div>
      )}

      {/* ── O que precisa de você ───────────────────────────────────────
          Fica no topo e SAI dos grupos abaixo (sem duplicar): com 25 rotinas,
          o que está quebrado some no meio da lista se não vier primeiro. */}
      {precisamDeAtencao.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h3 className={LABEL}>Precisa de você agora</h3>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {precisamDeAtencao.map((r) => <LinhaRotina key={r.id} r={r} agora={agora} />)}
          </div>
        </section>
      )}

      {precisamDeAtencao.length === 0 && (
        <div className="flex items-center gap-2 rounded-[14px] border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
          Nenhuma rotina parada ou com erro.
        </div>
      )}

      {/* ── Conexões ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <h3 className={LABEL}>Conexões das plataformas</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {dados.conexoes.map((c) => (
            <div
              key={c.id}
              className={cn(
                'flex items-start gap-3 rounded-[14px] border bg-[#0d1519]/92 p-4',
                c.estado === 'erro' ? 'border-red-500/40' : c.estado === 'atencao' ? 'border-amber-500/30' : 'border-border',
              )}
            >
              <span className={cn(
                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                c.estado === 'ok' ? 'bg-emerald-400' : c.estado === 'atencao' ? 'bg-amber-400' : 'bg-red-400',
              )} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground">{c.plataforma}</p>
                <p className="truncate text-xs text-muted-foreground" title={c.conta}>{c.conta}</p>
                <p className={cn(
                  'mt-1 text-xs',
                  c.estado === 'erro' ? 'text-red-300' : c.estado === 'atencao' ? 'text-amber-300' : 'text-muted-foreground',
                )}>
                  {c.motivo}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Rotinas por grupo ───────────────────────────────────────── */}
      {GRUPOS.map((g) => {
        const lista = resto.filter((r) => r.grupo === (g.id as GrupoRotina));
        if (lista.length === 0) return null;
        const acima = precisamDeAtencao.filter((r) => r.grupo === (g.id as GrupoRotina)).length;
        return (
          <section key={g.id} className="space-y-3">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              <h3 className={LABEL}>{g.nome}</h3>
              {acima > 0 && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-300">
                  +{acima} acima
                </span>
              )}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {lista.map((r) => <LinhaRotina key={r.id} r={r} agora={agora} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
