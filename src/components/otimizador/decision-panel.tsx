"use client";

import { useEffect, useState } from 'react';
import {
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Flag,
  Layers,
  Loader2,
  PauseCircle,
  PlayCircle,
  Rocket,
  Search,
  ShieldCheck,
  Target,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CreativeThumb } from '@/components/otimizador/creative-thumb';
import {
  NIVEL_BADGE,
  NIVEL_LABEL,
  adManagerUrl,
  categoriaDoNode,
  criativosAfetados,
  deliveryDisplay,
  fatoValor,
  impactoDoNode,
  prioridadeDoNode,
  riscoDoNode,
  type FilaRec,
  type TreeNode,
} from '@/lib/optimizer-ui';

// Painel lateral de decisão — problema, motivos, ação recomendada, itens afetados, controles
// (Gerenciador + ligar/desligar) e a auditoria técnica ("por quê"). Sempre os mesmos 2 controles.
export function DecisionPanel({ node, busy, onApply, onJump }: {
  node: TreeNode;
  busy: boolean;
  onApply: (rec: FilaRec, params: { novo_orcamento_diario?: number }) => void;
  onJump: (recId: string) => void;
}) {
  const [why, setWhy] = useState(false);

  useEffect(() => {
    setWhy(false);
  }, [node.rec_id]);

  const cat = categoriaDoNode(node);
  const emAnalise = node.status === 'em_analise_humana';
  const link = adManagerUrl(node);
  const semAcao = !node.texto_recomendacao.trim() && cat === 'sem_diagnostico';
  const entrega = deliveryDisplay(node.status_entrega);

  // Único controle de execução do painel: liga/desliga o objeto direto, independente da
  // categoria/ação sugerida pela IA. Só desabilita quando o status não é Ativo nem Pausado
  // (ex: Arquivado) — ligar/desligar não se aplica nesses casos.
  const podeAlternar = entrega.label === 'Ativo' || entrega.label === 'Pausado';
  function handleManualToggle() {
    const tipo: 'PAUSAR' | 'ATIVAR' = entrega.label === 'Ativo' ? 'PAUSAR' : 'ATIVAR';
    onApply({ ...node, acao_estruturada: { tipo, objeto_tipo: node.nivel, objeto_id: node.objeto_id, objeto_nome: node.objeto_nome, parametros: {} } }, {});
  }

  // Decisão guiada: quando um CONJUNTO/CAMPANHA é selecionado, os criativos fracos dentro dele
  // viram "itens afetados" — o gestor pausa os criativos, não o objeto inteiro (o cerne do pedido).
  const afetados = (node.nivel === 'adset' || node.nivel === 'campaign') ? criativosAfetados(node) : [];
  const temAfetados = afetados.length > 0;
  const prioridade = prioridadeDoNode(node);
  const impacto = impactoDoNode(node);
  const risco = riscoDoNode(node);

  // Título "decisão clara": específico sobre o que será pausado, nunca genérico.
  const nomeNivelFilho = node.nivel === 'campaign' ? 'conjunto/campanha' : 'conjunto';
  const tituloGuiado = temAfetados
    ? `Pausar ${afetados.length} criativo${afetados.length > 1 ? 's' : ''} fraco${afetados.length > 1 ? 's' : ''} dentro deste ${nomeNivelFilho}`
    : node.titulo;

  const critico = node.severidade === 'urgente' || cat === 'pausar';

  const miniCards = [
    { icon: Layers, label: 'Nível do problema', value: NIVEL_LABEL[node.nivel], tone: 'text-foreground' },
    { icon: Flag, label: 'Prioridade', value: prioridade.label, tone: prioridade.tone },
    { icon: TrendingUp, label: 'Impacto esperado', value: impacto, tone: 'text-foreground' },
    { icon: ShieldCheck, label: 'Risco', value: risco.label, tone: risco.tone },
  ];

  return (
    <div className="sticky top-3 max-h-[calc(100vh-96px)] overflow-auto rounded-[var(--radius)] border border-border bg-card/95">
      {/* Cabeçalho da recomendação principal */}
      <div className={cn('relative overflow-hidden rounded-t-[var(--radius)] border-b p-3', critico ? 'border-red-400/30 bg-red-500/5' : 'border-border')}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: node.severidade === 'urgente' ? '#f87171' : node.severidade === 'atencao' ? '#fbbf24' : '#34d399' }} />
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recomendação principal</p>
        <div className="mt-1.5 flex items-start gap-2.5">
          <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] border', critico ? 'border-red-400/40 bg-red-400/10 text-red-300' : 'border-border bg-background text-muted-foreground')}>
            {cat === 'pausar' ? <PauseCircle className="h-5 w-5" /> : cat === 'escalar' ? <Rocket className="h-5 w-5" /> : cat === 'revisar' ? <Search className="h-5 w-5" /> : <Target className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn('text-base font-bold leading-snug', critico ? 'text-red-200' : 'text-foreground')}>{tituloGuiado}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold', NIVEL_BADGE[node.nivel])}>{NIVEL_LABEL[node.nivel]}</span>
              <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold', entrega.tone)}>Entrega: {entrega.label}</span>
              {node.status !== 'pendente' && (
                <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {node.status === 'aplicado' ? 'Aplicado' : node.status === 'ignorado' ? 'Revisado' : 'Em análise'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3 px-3 pb-3 pt-3">
        {/* 4 mini-cards: nível / prioridade / impacto / risco */}
        <div className="grid grid-cols-2 items-start gap-2">
          {miniCards.map((c) => (
            <div key={c.label} className="min-h-[58px] rounded-[var(--radius)] border border-border/70 bg-background p-2">
              <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                <c.icon className="h-3 w-3" /> {c.label}
              </p>
              <p className={cn('mt-1 text-sm font-semibold leading-tight', c.tone)}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Caminho: onde está o problema */}
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Caminho — onde está o problema</p>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs">
              <span className={cn('shrink-0 rounded border px-1 py-0.5 text-[9px] font-semibold', NIVEL_BADGE.campaign)}>Campanha</span>
              <span className="truncate text-foreground" title={node.campanha_nome}>{node.campanha_nome}</span>
            </div>
            {node.nivel !== 'campaign' && node.conjunto_nome && (
              <div className="flex items-center gap-1.5 text-xs" style={{ paddingLeft: 8 }}>
                <span className={cn('shrink-0 rounded border px-1 py-0.5 text-[9px] font-semibold', NIVEL_BADGE.adset)}>Conjunto</span>
                <span className="truncate text-foreground" title={node.conjunto_nome}>{node.conjunto_nome}</span>
              </div>
            )}
            {node.nivel === 'ad' && (
              <div className="flex items-center gap-1.5 text-xs" style={{ paddingLeft: 16 }}>
                <span className={cn('shrink-0 rounded border px-1 py-0.5 text-[9px] font-semibold', NIVEL_BADGE.ad)}>Criativo</span>
                <span className="truncate text-foreground" title={node.objeto_nome}>{node.objeto_nome}</span>
              </div>
            )}
          </div>
        </div>

        {/* O problema */}
        {(node.motivos.length > 0 || node.texto_recomendacao.trim()) && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">O problema</p>
            {node.motivos.length > 0 ? (
              <ul className="space-y-1.5">
                {node.motivos.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-foreground">{node.texto_recomendacao}</p>
            )}
            {/* mini métricas do nó */}
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                { label: 'Gasto', value: fatoValor(node, /gasto/i) },
                { label: 'Conversas', value: fatoValor(node, /convers|lead/i) },
                { label: 'Custo por conv.', value: fatoValor(node, /custo|cpl|cpa/i) },
              ].map((m) => (
                <div key={m.label} className="rounded-[var(--radius)] border border-border/70 bg-background p-2 text-center">
                  <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{m.label}</p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{m.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ação recomendada — o que fazer / o que não fazer */}
        {!semAcao && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ação recomendada</p>
            <ul className="space-y-1.5">
              {temAfetados ? (
                <>
                  <li className="flex items-start gap-2 text-sm text-foreground"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> Pausar os {afetados.length} criativos listados abaixo.</li>
                  <li className="flex items-start gap-2 text-sm text-foreground"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> Manter os criativos que já geram resultado.</li>
                  <li className="flex items-start gap-2 text-sm text-muted-foreground"><Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" /> Não pausar o {nomeNivelFilho} inteiro no momento.</li>
                </>
              ) : (
                <li className="flex items-start gap-2 text-sm text-foreground">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  {node.texto_recomendacao.trim() || 'Revisar este item antes de executar qualquer mudança.'}
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Itens afetados */}
        {temAfetados && (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Itens afetados ({afetados.length})</p>
            <div className="overflow-hidden rounded-[var(--radius)] border border-border">
              {afetados.map((a, i) => (
                <button
                  key={a.rec_id}
                  onClick={() => onJump(a.rec_id)}
                  className={cn('flex w-full items-center gap-2 p-2 text-left hover:bg-surface-soft', i < afetados.length - 1 && 'border-b border-border/60')}
                >
                  <CreativeThumb tone="border-red-400/40" imageUrl={a.imagem_url} alt={a.objeto_nome} />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={a.objeto_nome}>{a.objeto_nome}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{fatoValor(a, /gasto/i)}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{fatoValor(a, /convers|lead/i)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {emAnalise && (
          <div className="flex items-center gap-2 rounded-[var(--radius)] border border-secondary/30 bg-secondary/10 p-2.5 text-xs text-secondary">
            <UserRound className="h-3.5 w-3.5 shrink-0" /> Em análise humana{node.atribuido_a ? ` · ${node.atribuido_a}` : ''}
          </div>
        )}

        {/* Controles — sempre os mesmos dois, em qualquer situação: ver no Gerenciador e
            ligar/desligar o objeto direto. Nada de botões condicionais por categoria/IA. */}
        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-border bg-background text-sm font-medium text-foreground hover:border-primary/40">
              <ExternalLink className="h-4 w-4" /> Gerenciador
            </a>
          ) : <span />}
          <Button
            onClick={handleManualToggle}
            disabled={busy || !podeAlternar}
            title={podeAlternar ? undefined : `Status "${entrega.label}" não permite ligar/desligar por aqui`}
            className={cn('h-11 w-full', podeAlternar && entrega.label === 'Ativo' && 'bg-red-500 text-white hover:bg-red-600')}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : entrega.label === 'Ativo' ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
            {entrega.label === 'Ativo' ? 'Desativar' : 'Ativar'}
          </Button>
        </div>

        {semAcao && (
          <p className="rounded-[var(--radius)] border border-border bg-background p-3 text-sm text-muted-foreground">
            Sem diagnóstico específico neste nó — os números estão dentro do esperado.
          </p>
        )}

        {/* Auditoria técnica */}
        <div>
          <button onClick={() => setWhy((w) => !w)} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {why ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Por que essa recomendação? (dados técnicos)
          </button>
          {why && (
            <div className="mt-2 space-y-1 rounded-[var(--radius)] border border-border bg-background p-3">
              {node.fatos.map((f, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{f.rotulo}</span>
                  <span className="font-mono text-foreground">{f.valor}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-1 text-xs">
                <span className="text-muted-foreground">Confiança da análise</span>
                <span className="font-mono text-foreground">{node.confianca}</span>
              </div>
              {node.leitura && <p className="border-t border-border/60 pt-1.5 text-xs italic text-muted-foreground">{node.leitura}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
