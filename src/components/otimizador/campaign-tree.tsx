"use client";

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Layers, PauseCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CreativeThumb } from '@/components/otimizador/creative-thumb';
import {
  NIVEL_BADGE,
  NIVEL_LABEL,
  agruparPorObjetivo,
  categoriaDoNode,
  categoriaMeta,
  collectAllIds,
  ctrDoNode,
  deliveryDisplay,
  hookBarTone,
  nodeToneClass,
  rotulosDoGrupo,
  statusDisplay,
  videoRetencaoResumo,
  type Categoria,
  type NivelFiltro,
  type TreeNode,
} from '@/lib/optimizer-ui';

// Coluna "Retenção": no criativo, mini-curva de 4 barras (hook/p25/p50/p75) coloridas pelo hook
// rate; em imagem/carrossel (eh_video=false) mostra N/A. Em conjunto/campanha, badge de contagem
// (nunca média, ver videoRetencaoResumo).
function RetencaoCell({ node }: { node: TreeNode }) {
  if (node.nivel === 'ad') {
    const rv = node.retencao_video;
    if (!rv || !rv.eh_video || rv.hook_rate == null) {
      return <span className="text-xs text-muted-foreground">N/A</span>;
    }
    const bars = [rv.hook_rate, rv.p25_rate, rv.p50_rate, rv.p75_rate];
    const tone = hookBarTone(rv.hook_rate);
    const fmt = (v: number | null) => (v == null ? '—' : `${v.toFixed(0)}%`);
    const title = `Hook (3s): ${fmt(rv.hook_rate)} | P25: ${fmt(rv.p25_rate)} | P50: ${fmt(rv.p50_rate)} | P75: ${fmt(rv.p75_rate)}`;
    return (
      <div className="flex items-center justify-end gap-1.5" title={title}>
        <div className="flex h-4 items-end gap-0.5">
          {bars.map((v, i) => (
            <span key={i} className={cn('w-1 rounded-sm', tone)} style={{ height: `${Math.max(15, Math.min(100, v ?? 0))}%` }} />
          ))}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{fmt(rv.hook_rate)}</span>
      </div>
    );
  }

  const resumo = videoRetencaoResumo(node);
  if (!resumo) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn('text-xs font-medium', resumo.low > 0 ? 'text-red-300' : 'text-emerald-300')}>
      {resumo.low > 0 ? `${resumo.low}/${resumo.total} c/ hook baixo` : `${resumo.total}/${resumo.total} ok`}
    </span>
  );
}

function TreeTableRow({ node, depth, selectedId, onSelect, onQuickPause, filtroNivel, filtroCategoria, apenasComAcao, openIds, onToggle }: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (n: TreeNode) => void;
  onQuickPause: (n: TreeNode) => void;
  filtroNivel: NivelFiltro;
  filtroCategoria: Categoria | null;
  apenasComAcao: boolean;
  openIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const open = openIds.has(node.rec_id);
  const hasChildren = node.filhos.length > 0;
  const cat = categoriaDoNode(node);
  const status = statusDisplay(node);
  const entrega = deliveryDisplay(node.status_entrega);
  const isAd = node.nivel === 'ad';
  const mostraPausaRapida = isAd && cat === 'pausar';

  // Um nó aparece se ele mesmo casa com o filtro OU algum descendente casa (pra manter contexto
  // hierárquico visível — filtrar só criativos não deve esconder a campanha-pai).
  function subtreeMatches(n: TreeNode): boolean {
    const own = (filtroNivel === 'todos' || n.nivel === filtroNivel) &&
      (!filtroCategoria || categoriaDoNode(n) === filtroCategoria) &&
      (!apenasComAcao || n.texto_recomendacao.trim().length > 0);
    if (own) return true;
    return (n.filhos as TreeNode[]).some(subtreeMatches);
  }
  if (!subtreeMatches(node)) return null;

  const metricaCusto = node.metricas_chave.find((m) => /custo|cpl|cpa/i.test(m.rotulo));
  const metricaResultado = node.metricas_chave.find((m) => m.rotulo !== 'Gasto' && m !== metricaCusto);
  const gasto = node.metricas_chave.find((m) => m.rotulo === 'Gasto');

  return (
    <>
      <tr
        className={cn(
          'cursor-pointer border-b border-border/60 hover:bg-surface-soft',
          selectedId === node.rec_id && 'bg-primary/5',
          nodeToneClass(node),
        )}
        onClick={() => onSelect(node)}
      >
        <td className="py-2 pr-2">
          <div className="flex items-center gap-2" style={{ paddingLeft: depth * 20 }}>
            {hasChildren ? (
              <button onClick={(e) => { e.stopPropagation(); onToggle(node.rec_id); }} className="shrink-0 text-muted-foreground hover:text-foreground">
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
              </button>
            ) : <span className="w-3.5 shrink-0" />}
            {isAd && <CreativeThumb tone={mostraPausaRapida ? 'border-red-400/40' : 'border-border'} imageUrl={node.imagem_url} alt={node.objeto_nome} />}
            <span className="min-w-0 truncate text-sm text-foreground" title={node.objeto_nome}>{node.objeto_nome}</span>
          </div>
        </td>
        <td className="py-2 pr-2">
          <span className={cn('inline-block shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold', NIVEL_BADGE[node.nivel])}>
            {NIVEL_LABEL[node.nivel]}
          </span>
        </td>
        <td className="py-2 pr-2">
          <span className={cn('inline-block shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold', entrega.tone)}>{entrega.label}</span>
        </td>
        <td className="py-2 pr-2">
          <span className={cn('inline-block shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold', status.tone)}>{status.label}</span>
        </td>
        <td className="py-2 pr-2 text-right text-xs text-muted-foreground">{gasto?.valor ?? '—'}</td>
        <td className="py-2 pr-2 text-right text-xs text-muted-foreground">{metricaResultado?.valor ?? '—'}</td>
        <td className="py-2 pr-2 text-right text-xs text-muted-foreground">{metricaCusto?.valor ?? '—'}</td>
        <td className="py-2 pr-2 text-right text-xs text-muted-foreground">{ctrDoNode(node)}</td>
        <td className="py-2 pr-2 text-right"><RetencaoCell node={node} /></td>
        <td className="py-2 pr-2 text-right">
          {mostraPausaRapida ? (
            <button
              onClick={(e) => { e.stopPropagation(); onQuickPause(node); }}
              title="Pausar este criativo"
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-red-400/50 bg-red-400/10 text-red-300 hover:bg-red-400/20"
            >
              <PauseCircle className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className={cn('inline-block shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold', categoriaMeta(cat).tone)}>
              {categoriaMeta(cat).label}
            </span>
          )}
        </td>
      </tr>
      {open && hasChildren && (node.filhos as TreeNode[]).map((child) => (
        <TreeTableRow key={child.rec_id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} onQuickPause={onQuickPause}
          filtroNivel={filtroNivel} filtroCategoria={filtroCategoria} apenasComAcao={apenasComAcao} openIds={openIds} onToggle={onToggle} />
      ))}
    </>
  );
}

function ObjetivoSection({ objetivo, nodes, selectedId, onSelect, onQuickPause, filtroNivel, filtroCategoria, apenasComAcao, openIds, onToggle, open, onToggleGroup }: {
  objetivo: string;
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (n: TreeNode) => void;
  onQuickPause: (n: TreeNode) => void;
  filtroNivel: NivelFiltro;
  filtroCategoria: Categoria | null;
  apenasComAcao: boolean;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  open: boolean;
  onToggleGroup: () => void;
}) {
  const rotulos = rotulosDoGrupo(nodes);
  return (
    <div className="border-b border-border last:border-b-0">
      <button onClick={onToggleGroup} className="flex w-full items-center gap-2 bg-surface-soft px-3 py-2 text-left hover:bg-surface-soft/80">
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="text-xs font-bold uppercase tracking-wide text-foreground">{objetivo}</span>
        <span className="text-xs text-muted-foreground">{nodes.length} campanha{nodes.length === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pl-3 pr-2 font-bold">Campanha / Conjunto / Criativo</th>
              <th className="py-2 pr-2 font-bold">Nível</th>
              <th className="py-2 pr-2 font-bold">Entrega</th>
              <th className="py-2 pr-2 font-bold">Saúde</th>
              <th className="py-2 pr-2 text-right font-bold">Gasto</th>
              <th className="py-2 pr-2 text-right font-bold">{rotulos.resultado}</th>
              <th className="py-2 pr-2 text-right font-bold">{rotulos.custo}</th>
              <th className="py-2 pr-2 text-right font-bold">CTR</th>
              <th className="py-2 pr-2 text-right font-bold">Retenção</th>
              <th className="py-2 pr-2 text-right font-bold">Ação recomendada</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <TreeTableRow key={n.rec_id} node={n} depth={0} selectedId={selectedId} onSelect={onSelect} onQuickPause={onQuickPause}
                filtroNivel={filtroNivel} filtroCategoria={filtroCategoria} apenasComAcao={apenasComAcao} openIds={openIds} onToggle={onToggle} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const CLOSED_GROUPS_KEY = 'otimizador:closedGroups';

function loadClosedGroups(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(CLOSED_GROUPS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function CampaignTable({ nodes, selectedId, onSelect, onQuickPause, filtroNivel, filtroCategoria, apenasComAcao }: {
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (n: TreeNode) => void;
  onQuickPause: (n: TreeNode) => void;
  filtroNivel: NivelFiltro;
  filtroCategoria: Categoria | null;
  apenasComAcao: boolean;
}) {
  // Por padrão só as campanhas (nível raiz) vêm abertas — igual ao comportamento anterior por linha.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(nodes.map((n) => n.rec_id)));
  // Estado de accordion dos objetivos persiste em localStorage — não reseta ao recarregar/trocar conta.
  const [closedGroups, setClosedGroups] = useState<Set<string>>(loadClosedGroups);
  const rootIdsKey = nodes.map((n) => n.rec_id).join(',');
  useEffect(() => {
    setOpenIds(new Set(nodes.map((n) => n.rec_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootIdsKey]);

  const toggleOne = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroup = (objetivo: string) => {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(objetivo)) next.delete(objetivo); else next.add(objetivo);
      try { window.localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const grupos = useMemo(() => agruparPorObjetivo(nodes), [nodes]);

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card/90">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5 text-xs font-semibold text-muted-foreground">
        <span className="flex items-center gap-2"><Layers className="h-3.5 w-3.5" /> Árvore de campanhas</span>
        <div className="flex items-center gap-3">
          <button onClick={() => setOpenIds(new Set(collectAllIds(nodes)))} className="font-normal normal-case text-muted-foreground hover:text-foreground hover:underline">
            Expandir tudo
          </button>
          <button onClick={() => setOpenIds(new Set())} className="font-normal normal-case text-muted-foreground hover:text-foreground hover:underline">
            Recolher tudo
          </button>
          <span className="font-normal normal-case text-muted-foreground">{nodes.length} campanha{nodes.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="max-h-[calc(100vh-430px)] min-h-[360px] overflow-auto">
        {grupos.map((g) => (
          <ObjetivoSection
            key={g.objetivo}
            objetivo={g.objetivo}
            nodes={g.nodes}
            selectedId={selectedId}
            onSelect={onSelect}
            onQuickPause={onQuickPause}
            filtroNivel={filtroNivel}
            filtroCategoria={filtroCategoria}
            apenasComAcao={apenasComAcao}
            openIds={openIds}
            onToggle={toggleOne}
            open={!closedGroups.has(g.objetivo)}
            onToggleGroup={() => toggleGroup(g.objetivo)}
          />
        ))}
        {nodes.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhuma campanha nesta análise.</p>}
      </div>
    </div>
  );
}
