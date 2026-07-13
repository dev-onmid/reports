"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, WandSparkles } from 'lucide-react';
import { callerHeaders, getAuthSession } from '@/lib/auth-store';
import { BriefingCard } from '@/components/otimizador/briefing-card';
import type { FilaRec } from '@/lib/optimizer-ui';

// Briefing do dia — co-piloto. Reusa /api/otimizador/fila (decisões já achatadas e priorizadas)
// e apresenta UMA por vez; cada ação (aplicar/não fazer/pular) avança a fila. Escopo opcional por
// ?clientId= (briefing de uma conta) — sem ele, roda a fila global.
function BriefingContent() {
  const params = useSearchParams();
  const clientId = params.get('clientId') ?? '';

  const [recs, setRecs] = useState<FilaRec[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nomeConta, setNomeConta] = useState<string | null>(null);

  const session = getAuthSession();
  const autor = { autor_id: session?.userId ?? undefined, autor_nome: session?.name ?? undefined };

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      try {
        const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}&hours=200` : '?hours=200';
        const res = await fetch(`/api/otimizador/fila${qs}`);
        if (!res.ok) return;
        const data = await res.json() as { recs: FilaRec[]; contas?: Array<{ cliente_id: string; cliente_nome: string }> };
        if (!alive) return;
        setRecs(data.recs ?? []);
        setIndex(0);
        if (clientId) setNomeConta(data.contas?.find((c) => c.cliente_id === clientId)?.cliente_nome ?? null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [clientId]);

  function advance() {
    setErro(null);
    setIndex((i) => i + 1);
  }

  async function doAplicar(rec: FilaRec) {
    const acao = rec.acao_estruturada;
    if (!acao) return;
    setBusy(true);
    try {
      const res = await fetch('/api/otimizador/executar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...callerHeaders() },
        body: JSON.stringify({
          rec_id: rec.rec_id, analise_id: rec.analise_id, canal: rec.canal, client_id: rec.cliente_id,
          connection_id: rec.connection_id ?? '', account_id: rec.account_id ?? undefined,
          acao: acao.tipo, objeto_tipo: acao.objeto_tipo, objeto_id: acao.objeto_id, objeto_nome: rec.objeto_nome,
          parametros: acao.parametros, justificativa: rec.texto_recomendacao, ...autor,
        }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) { setErro(`Não foi possível aplicar: ${data.error ?? res.statusText}`); return; }
      advance();
    } catch {
      setErro('Erro de rede ao aplicar.');
    } finally {
      setBusy(false);
    }
  }

  async function doIgnorar(rec: FilaRec) {
    setBusy(true);
    try {
      await fetch('/api/otimizador/ignorar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...callerHeaders() },
        body: JSON.stringify({ rec_id: rec.rec_id, analise_id: rec.analise_id, cliente_id: rec.cliente_id, ...autor }),
      });
      advance();
    } catch {
      setErro('Erro ao marcar como revisado.');
    } finally {
      setBusy(false);
    }
  }

  const voltarHref = clientId ? `/otimizador?clientId=${encodeURIComponent(clientId)}` : '/otimizador/visao-geral';
  const current = recs[index];
  const acabou = !loading && recs.length > 0 && index >= recs.length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-4 xl:p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <WandSparkles className="h-4 w-4" /> Otimizador
          </div>
          <h1 className="text-2xl font-bold text-foreground">Briefing do dia{nomeConta ? ` · ${nomeConta}` : ''}</h1>
        </div>
        <Link href={voltarHref} className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 py-2 text-sm text-foreground hover:border-primary/40">
          <ArrowLeft className="h-4 w-4" /> Sair
        </Link>
      </header>

      {erro && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {erro}
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Montando o briefing...
        </div>
      ) : recs.length === 0 || acabou ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-[14px] border border-border bg-card p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <p className="text-lg font-bold text-foreground">{recs.length === 0 ? 'Nada pendente por aqui' : 'Briefing concluído!'}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {recs.length === 0
              ? 'Nenhuma decisão esperando nesta seleção. Volte quando a próxima análise rodar.'
              : `Você passou pelas ${recs.length} decisões. Bom trabalho.`}
          </p>
          <Link href={voltarHref} className="mt-1 inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 py-2 text-sm text-foreground hover:border-primary/40">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
        </div>
      ) : current ? (
        <BriefingCard
          rec={current}
          index={index}
          total={recs.length}
          busy={busy}
          onAplicar={doAplicar}
          onIgnorar={doIgnorar}
          onPular={advance}
        />
      ) : null}
    </div>
  );
}

export default function BriefingPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...</div>}>
      <BriefingContent />
    </Suspense>
  );
}
