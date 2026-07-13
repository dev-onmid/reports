"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Ban, Loader2, Printer, Rocket } from 'lucide-react';
import { AccountHealthHero } from '@/components/otimizador/account-health-hero';
import { ObjectiveHighlightCard } from '@/components/otimizador/objective-highlight-card';
import {
  agruparPorObjetivo,
  categoriaDoNode,
  flattenTree,
  formatDateTime,
  type ArvoreResumo,
  type TreeNode,
} from '@/lib/optimizer-ui';

// Modo apresentação — visão read-only, limpa, pra projetar/mandar pro cliente. Reusa o hero de
// saúde e os cards por objetivo; sem botões de ação, sem dados técnicos. Recebe ?clientId=... e
// puxa a mesma árvore da tela operacional (zero backend novo).
function ApresentacaoContent() {
  const params = useSearchParams();
  const clientId = params.get('clientId') ?? '';

  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [resumo, setResumo] = useState<ArvoreResumo | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    let alive = true;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/otimizador/arvore?clientId=${encodeURIComponent(clientId)}&hours=200`);
        if (!res.ok) return;
        const data = await res.json() as { campanhas: TreeNode[]; resumo: ArvoreResumo | null; generated_at: string | null };
        if (!alive) return;
        setTreeNodes(data.campanhas ?? []);
        setResumo(data.resumo);
        setGeneratedAt(data.generated_at);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [clientId]);

  const flatNodes = useMemo(() => flattenTree(treeNodes), [treeNodes]);
  const grupos = useMemo(() => agruparPorObjetivo(treeNodes), [treeNodes]);
  const clienteNome = treeNodes[0]?.cliente_nome ?? 'Cliente';

  const oportunidades = useMemo(() => flatNodes.filter((n) => categoriaDoNode(n) === 'escalar').slice(0, 4), [flatNodes]);
  const alertas = useMemo(() => flatNodes.filter((n) => categoriaDoNode(n) === 'pausar').slice(0, 4), [flatNodes]);

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando apresentação...
      </div>
    );
  }

  if (!clientId || !resumo) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 p-10 text-center">
        <p className="text-lg font-semibold text-foreground">Nada para apresentar ainda</p>
        <p className="text-sm text-muted-foreground">Rode uma análise na tela do Otimizador e abra a apresentação a partir dela.</p>
        <Link href="/otimizador" className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 py-2 text-sm text-foreground hover:border-primary/40">
          <ArrowLeft className="h-4 w-4" /> Voltar ao Otimizador
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-4 sm:p-6 xl:p-8">
      {/* Cabeçalho de apresentação */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 print:border-black/10">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/onmid-logo-white.png" alt="Onmid" className="h-7 w-auto object-contain" />
          <div className="border-l border-border pl-3">
            <p className="text-lg font-bold leading-tight text-foreground">{clienteNome}</p>
            <p className="text-xs text-muted-foreground">
              Saúde da conta{resumo.semana_analise ? ` · semana ${resumo.semana_analise}` : ''} · {formatDateTime(generatedAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Link href={`/otimizador?clientId=${encodeURIComponent(clientId)}`} className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 py-2 text-sm text-foreground hover:border-primary/40">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 py-2 text-sm text-foreground hover:border-primary/40">
            <Printer className="h-4 w-4" /> Imprimir / PDF
          </button>
        </div>
      </header>

      {/* Saúde geral */}
      <AccountHealthHero resumo={resumo} nodes={flatNodes} generatedAt={generatedAt} proximaAnalise={null} />

      {/* Destaques por objetivo */}
      {grupos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Desempenho por objetivo</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {grupos.map((g) => (
              <ObjectiveHighlightCard key={g.objetivo} objetivo={g.objetivo} nodes={g.nodes} />
            ))}
          </div>
        </section>
      )}

      {/* Ganhos e alertas da semana */}
      {(oportunidades.length > 0 || alertas.length > 0) && (
        <section className="grid gap-3 lg:grid-cols-2">
          {oportunidades.length > 0 && (
            <div className="rounded-[12px] border border-sky-400/30 bg-sky-400/5 p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-sky-300">
                <Rocket className="h-4 w-4" /> Oportunidades de crescimento
              </h3>
              <ul className="space-y-2.5">
                {oportunidades.map((n) => (
                  <li key={n.rec_id} className="text-sm text-foreground">
                    <span className="font-medium">{n.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{n.campanha_nome}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {alertas.length > 0 && (
            <div className="rounded-[12px] border border-red-400/30 bg-red-400/5 p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-red-300">
                <Ban className="h-4 w-4" /> Pontos de atenção
              </h3>
              <ul className="space-y-2.5">
                {alertas.map((n) => (
                  <li key={n.rec_id} className="text-sm text-foreground">
                    <span className="font-medium">{n.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{n.campanha_nome}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function ApresentacaoPage() {
  return (
    <Suspense fallback={<div className="flex h-72 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...</div>}>
      <ApresentacaoContent />
    </Suspense>
  );
}
