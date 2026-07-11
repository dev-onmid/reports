"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, ShieldAlert, WandSparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Client } from '@/lib/mock-data';
import { SEV, type FilaConta, type Severidade } from '@/lib/optimizer-ui';

// ─── Sala de guerra ─────────────────────────────────────────────────────────
// Visão de SUPERVISÃO: todas as contas num olhar, ordenadas por "onde está sangrando".
// Reusa /api/otimizador/fila (severidade + pendências por conta) — zero backend novo. Clicar
// numa conta abre a visão operacional (/otimizador?clientId=…).

const SEV_RANK: Record<Severidade, number> = { urgente: 0, atencao: 1, ok: 2 };

// Seções da sala de guerra — o gestor/dono lê de cima pra baixo: primeiro o que exige ação.
const SECOES: Array<{ sev: Severidade; titulo: string; sub: string; icon: typeof ShieldAlert; tone: string }> = [
  { sev: 'urgente', titulo: 'Precisa de você agora', sub: 'Contas sangrando ou em crise', icon: ShieldAlert, tone: 'text-red-300' },
  { sev: 'atencao', titulo: 'De olho', sub: 'Merecem uma revisada', icon: AlertTriangle, tone: 'text-amber-300' },
  { sev: 'ok', titulo: 'Tudo certo', sub: 'Sem pendências no momento', icon: CheckCircle2, tone: 'text-emerald-300' },
];

function AccountCard({ conta }: { conta: FilaConta }) {
  const sev = SEV[conta.pior_severidade];
  return (
    <Link
      href={`/otimizador?clientId=${encodeURIComponent(conta.cliente_id)}`}
      className="group flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card/90 p-3 transition-colors hover:border-primary/40"
    >
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', sev.dot)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground" title={conta.cliente_nome}>{conta.cliente_nome}</p>
        <p className="text-xs text-muted-foreground">
          {conta.pendencias === 0 ? 'Sem pendências' : `${conta.pendencias} decisão${conta.pendencias === 1 ? '' : 'ões'} esperando`}
        </p>
      </div>
      {conta.pendencias > 0 && (
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold', sev.badge)}>{conta.pendencias}</span>
      )}
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}

export default function VisaoGeralPage() {
  const [contas, setContas] = useState<FilaConta[]>([]);
  const [semAnalise, setSemAnalise] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      try {
        const [filaRes, clientsRes] = await Promise.all([
          fetch('/api/otimizador/fila?hours=200'),
          fetch('/api/clients'),
        ]);
        let filaContas: FilaConta[] = [];
        if (filaRes.ok) {
          const data = await filaRes.json() as { contas: FilaConta[] };
          filaContas = data.contas ?? [];
        }
        let semAnaliseCount = 0;
        if (clientsRes.ok) {
          const clients = (await clientsRes.json() as Client[]).filter((c) => c.status !== 'Arquivado' && c.status !== 'Inativo');
          const comAnalise = new Set(filaContas.map((c) => c.cliente_id));
          semAnaliseCount = clients.filter((c) => !comAnalise.has(c.id)).length;
        }
        if (!alive) return;
        setContas(filaContas);
        setSemAnalise(semAnaliseCount);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const ordenadas = useMemo(() => {
    return [...contas].sort((a, b) => {
      const r = SEV_RANK[a.pior_severidade] - SEV_RANK[b.pior_severidade];
      return r !== 0 ? r : b.pendencias - a.pendencias;
    });
  }, [contas]);

  const porSeveridade = useMemo(() => {
    const map: Record<Severidade, FilaConta[]> = { urgente: [], atencao: [], ok: [] };
    for (const c of ordenadas) map[c.pior_severidade].push(c);
    return map;
  }, [ordenadas]);

  const totalPendencias = useMemo(() => contas.reduce((s, c) => s + c.pendencias, 0), [contas]);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 p-3 sm:p-4 xl:p-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <WandSparkles className="h-4 w-4" /> Otimizador
          </div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Sala de guerra</h1>
          <p className="text-sm text-muted-foreground">Todas as contas num olhar — o que precisa de você primeiro.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-center">
            <p className="text-lg font-bold leading-none text-foreground">{contas.length}</p>
            <p className="text-[11px] text-muted-foreground">contas</p>
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-center">
            <p className="text-lg font-bold leading-none text-foreground">{totalPendencias}</p>
            <p className="text-[11px] text-muted-foreground">decisões</p>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando contas...
        </div>
      ) : contas.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-card p-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-primary" />
          <p className="font-semibold text-foreground">Nenhuma análise recente ainda</p>
          <p className="text-sm text-muted-foreground">Rode a primeira análise em uma conta pra ela aparecer aqui.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {SECOES.map((secao) => {
            const lista = porSeveridade[secao.sev];
            if (lista.length === 0) return null;
            const Icon = secao.icon;
            return (
              <section key={secao.sev} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className={cn('h-4 w-4', secao.tone)} />
                  <h2 className={cn('text-sm font-bold uppercase tracking-wide', secao.tone)}>{secao.titulo}</h2>
                  <span className="text-xs text-muted-foreground">· {lista.length}</span>
                  <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">— {secao.sub}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {lista.map((c) => <AccountCard key={c.cliente_id} conta={c} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!loading && semAnalise > 0 && (
        <p className="text-xs text-muted-foreground">
          + {semAnalise} conta{semAnalise === 1 ? '' : 's'} sem análise recente. Abra uma no{' '}
          <Link href="/otimizador" className="font-semibold text-primary hover:underline">Otimizador</Link> para rodar a primeira.
        </p>
      )}
    </div>
  );
}
