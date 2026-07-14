"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  FileText,
  Heart,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  ShoppingBag,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { CreativeThumb } from '@/components/otimizador/creative-thumb';
import {
  SEV_HEX,
  agruparPorObjetivo,
  categoriaDoNode,
  collectAllIds,
  deliveryDisplay,
  flattenTree,
  hookBarTone,
  rotulosDoGrupo,
  videoRetencaoResumo,
  vsMetaLabel,
  type Categoria,
  type NivelFiltro,
  type Severidade,
  type TreeNode,
} from '@/lib/optimizer-ui';

const VS_META_TONE: Record<'success' | 'danger' | 'neutral', string> = {
  success: 'var(--text-success)',
  danger: 'var(--text-danger)',
  neutral: 'var(--text-muted)',
};

const NIVEL_TAG: Record<string, { label: string; color: string; bg: string }> = {
  campaign: { label: 'CAMPANHA', color: 'var(--text-pro)', bg: 'var(--bg-pro)' },
  adset: { label: 'CONJUNTO', color: 'var(--text-accent)', bg: 'var(--bg-accent)' },
  ad: { label: 'CRIATIVO', color: 'var(--text-secondary)', bg: 'var(--surface-1)' },
};

function objIcon(objetivo: string): LucideIcon {
  const t = (objetivo ?? '').toLowerCase();
  if (/whats|conversa|mensag/.test(t)) return MessageCircle;
  if (/lead|formul/.test(t)) return FileText;
  if (/venda|compra|cardáp|cardap/.test(t)) return ShoppingBag;
  if (/tráfego|trafego|clique|site/.test(t)) return MousePointerClick;
  if (/engaj/.test(t)) return Heart;
  if (/reconhec|alcance|marca/.test(t)) return Megaphone;
  return Target;
}

function piorSeveridade(nodes: TreeNode[]): Severidade {
  const rank = (s: Severidade) => (s === 'urgente' ? 0 : s === 'atencao' ? 1 : 2);
  let pior: Severidade = 'ok';
  for (const n of flattenTree(nodes)) if (rank(n.severidade) < rank(pior)) pior = n.severidade;
  return pior;
}

const hexToColor: Record<string, string> = { 'bg-emerald-400': 'var(--text-success)', 'bg-amber-400': 'var(--text-warning)', 'bg-red-400': 'var(--text-danger)' };

// Mini-curva de retenção (hook/p25/p50/p75) no criativo; contagem no conjunto/campanha.
function RetencaoInline({ node }: { node: TreeNode }) {
  if (node.nivel === 'ad') {
    const rv = node.retencao_video;
    if (!rv || !rv.eh_video || rv.hook_rate == null) return null;
    const bars = [rv.hook_rate, rv.p25_rate, rv.p50_rate, rv.p75_rate];
    const cor = hexToColor[hookBarTone(rv.hook_rate)] ?? 'var(--text-muted)';
    const fadigado = rv.hook_rate < 25;
    return (
      <span className="flex items-end gap-[2px]" style={{ height: 12 }} title={`Hook ${rv.hook_rate.toFixed(0)}%`}>
        {bars.map((v, i) => (
          <span key={i} style={{ width: 3, height: `${Math.max(12, Math.min(100, v ?? 0))}%`, background: cor, borderRadius: 1 }} />
        ))}
        <span style={{ fontSize: 10, color: fadigado ? 'var(--text-danger)' : 'var(--text-muted)', marginLeft: 5 }}>
          hook {rv.hook_rate.toFixed(0)}%{fadigado ? ' · cansou' : ''}
        </span>
      </span>
    );
  }
  const resumo = videoRetencaoResumo(node);
  if (!resumo || resumo.low === 0) return null;
  return <span style={{ fontSize: 10, color: 'var(--text-danger)' }}>{resumo.low}/{resumo.total} c/ hook baixo</span>;
}

function acaoDoNode(node: TreeNode): { label: string; kind: 'pausar' | 'escalar' | 'muted' } | null {
  const cat = categoriaDoNode(node);
  if (cat === 'pausar') return { label: 'Pausar', kind: 'pausar' };
  if (cat === 'escalar') return { label: 'Escalar', kind: 'escalar' };
  if (cat === 'revisar') return { label: 'Revisar', kind: 'muted' };
  if (cat === 'investigar') return { label: 'Verificar', kind: 'muted' };
  if (cat === 'manter') return { label: 'Manter', kind: 'muted' };
  return null;
}

function TreeRow({ node, depth, selectedId, onSelect, onQuickPause, filtroNivel, filtroCategoria, apenasComAcao, openIds, onToggle, cplIdeal, cplMaximo }: {
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
  cplIdeal: number | null;
  cplMaximo: number | null;
}) {
  function subtreeMatches(n: TreeNode): boolean {
    const own = (filtroNivel === 'todos' || n.nivel === filtroNivel)
      && (!filtroCategoria || categoriaDoNode(n) === filtroCategoria)
      && (!apenasComAcao || n.texto_recomendacao.trim().length > 0);
    return own || (n.filhos as TreeNode[]).some(subtreeMatches);
  }
  if (!subtreeMatches(node)) return null;

  const open = openIds.has(node.rec_id);
  const hasChildren = node.filhos.length > 0;
  const isAd = node.nivel === 'ad';
  const cat = categoriaDoNode(node);
  const acao = acaoDoNode(node);
  const tag = NIVEL_TAG[node.nivel];
  const selected = selectedId === node.rec_id;
  const inativo = node.status === 'ignorado' || node.status === 'aplicado';
  const entrega = deliveryDisplay(node.status_entrega);
  const sevColor = SEV_HEX[node.severidade];

  const metricaCusto = node.metricas_chave.find((m) => /custo|cpl|cpa/i.test(m.rotulo));
  const metricaResultado = node.metricas_chave.find((m) => m.rotulo !== 'Gasto' && m !== metricaCusto);
  const custoColor = node.severidade === 'urgente' ? 'var(--text-danger)' : node.severidade === 'ok' ? 'var(--text-success)' : 'var(--text-primary)';
  const vsMeta = vsMetaLabel(metricaCusto?.valor, cplIdeal, cplMaximo);

  return (
    <>
      <div
        onClick={() => onSelect(node)}
        className={selected ? '' : 'hover:bg-[var(--surface-1)]'}
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: `9px 12px 9px ${12 + depth * 18}px`,
          borderBottom: `0.5px solid var(--border)`,
          background: selected ? 'var(--bg-accent)' : 'transparent',
          opacity: inativo ? 0.45 : 1,
        }}
      >
        {selected && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--fill-accent)' }} />}
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); onToggle(node.rec_id); }} style={{ color: 'var(--text-secondary)', width: 12, flex: 'none' }}>
            <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
          </button>
        ) : <span style={{ width: 12, flex: 'none' }} />}

        {isAd
          ? <CreativeThumb tone={cat === 'pausar' ? 'border-red-400/40' : 'border-border'} imageUrl={node.imagem_url} alt={node.objeto_nome} />
          : <span style={{ padding: '2px 6px', borderRadius: 10, background: tag.bg, color: tag.color, fontSize: 9, fontWeight: 600, flex: 'none' }}>{tag.label}</span>}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: sevColor, flex: 'none' }} />
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={node.objeto_nome}>
              {node.objeto_nome}
            </span>
            {entrega.label === 'Pausado' && <span style={{ fontSize: 10, color: 'var(--text-muted)', border: `0.5px solid var(--border)`, borderRadius: 4, padding: '0 5px' }}>pausado</span>}
          </div>
          <div style={{ marginTop: 1 }}><RetencaoInline node={node} /></div>
        </div>

        <div style={{ width: 52, textAlign: 'right', fontSize: 12, color: 'var(--text-primary)', flex: 'none' }}>{metricaResultado?.valor ?? '—'}</div>
        <div style={{ width: 72, textAlign: 'right', fontSize: 12, fontWeight: 500, color: custoColor, flex: 'none' }}>{metricaCusto?.valor ?? '—'}</div>
        <div style={{ width: 70, textAlign: 'right', fontSize: 10, color: vsMeta ? VS_META_TONE[vsMeta.tone] : 'var(--text-muted)', flex: 'none' }}>{vsMeta?.text ?? '—'}</div>
        <div style={{ width: 84, textAlign: 'right', flex: 'none' }}>
          {acao?.kind === 'pausar' ? (
            <button
              onClick={(e) => { e.stopPropagation(); onQuickPause(node); }}
              style={{ padding: '3px 9px', background: 'var(--bg-danger)', borderRadius: 6, color: 'var(--text-danger)', fontSize: 10, fontWeight: 500, border: 'none', whiteSpace: 'nowrap' }}
            >Pausar</button>
          ) : acao?.kind === 'escalar' ? (
            <span style={{ padding: '3px 9px', background: 'var(--bg-success)', borderRadius: 6, color: 'var(--text-success)', fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap' }}>↑ Escalar</span>
          ) : acao ? (
            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{acao.label}</span>
          ) : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>}
        </div>
      </div>

      {open && hasChildren && (node.filhos as TreeNode[]).map((child) => (
        <TreeRow key={child.rec_id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} onQuickPause={onQuickPause}
          filtroNivel={filtroNivel} filtroCategoria={filtroCategoria} apenasComAcao={apenasComAcao} openIds={openIds} onToggle={onToggle}
          cplIdeal={cplIdeal} cplMaximo={cplMaximo} />
      ))}
    </>
  );
}

function ObjetivoBoard({ objetivo, nodes, open, onToggleGroup, ...rowProps }: {
  objetivo: string;
  nodes: TreeNode[];
  open: boolean;
  onToggleGroup: () => void;
  selectedId: string | null;
  onSelect: (n: TreeNode) => void;
  onQuickPause: (n: TreeNode) => void;
  filtroNivel: NivelFiltro;
  filtroCategoria: Categoria | null;
  apenasComAcao: boolean;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  cplIdeal: number | null;
  cplMaximo: number | null;
}) {
  const rotulos = rotulosDoGrupo(nodes);
  const pior = piorSeveridade(nodes);
  const sevColor = SEV_HEX[pior];
  const Icon = objIcon(objetivo);
  const sevLabel = pior === 'urgente' ? 'Crítico' : pior === 'atencao' ? 'Atenção' : 'Saudável';

  return (
    <div style={{ background: 'var(--surface-1)', border: `0.5px solid ${pior === 'urgente' ? 'var(--text-danger)' : 'var(--border)'}`, borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={onToggleGroup} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', width: '100%', textAlign: 'left', borderBottom: open ? `0.5px solid var(--border)` : 'none' }}>
        <ChevronRight size={13} style={{ color: 'var(--text-secondary)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flex: 'none' }} />
        <span style={{ display: 'flex', width: 24, height: 24, borderRadius: 6, background: `${sevColor}1f`, color: sevColor, alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <Icon size={13} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{objetivo}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{nodes.length} campanha{nodes.length === 1 ? '' : 's'} · {rotulos.resultado} · {rotulos.custo}</div>
        </div>
        <span style={{ padding: '2px 8px', borderRadius: 20, background: `${sevColor}1f`, color: sevColor, fontSize: 10, fontWeight: 600, flex: 'none' }}>{sevLabel}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: `0.5px solid var(--border)`, fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
          <span style={{ width: 12, flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 0 }}>Campanha</span>
          <span style={{ width: 52, textAlign: 'right', flex: 'none' }}>{rotulos.resultado}</span>
          <span style={{ width: 72, textAlign: 'right', flex: 'none' }}>{rotulos.custo}</span>
          <span style={{ width: 70, textAlign: 'right', flex: 'none' }}>vs. meta</span>
          <span style={{ width: 84, textAlign: 'right', flex: 'none' }}>Ação</span>
        </div>
      )}
      {open && nodes.map((n) => (
        <TreeRow key={n.rec_id} node={n} depth={0} {...rowProps} />
      ))}
    </div>
  );
}

const CLOSED_GROUPS_KEY = 'otimizador:closedGroups';
function loadClosedGroups(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(CLOSED_GROUPS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

export function CampaignTable({ nodes, selectedId, onSelect, onQuickPause, filtroNivel, filtroCategoria, apenasComAcao, cplIdeal = null, cplMaximo = null }: {
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (n: TreeNode) => void;
  onQuickPause: (n: TreeNode) => void;
  filtroNivel: NivelFiltro;
  filtroCategoria: Categoria | null;
  apenasComAcao: boolean;
  cplIdeal?: number | null;
  cplMaximo?: number | null;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(nodes.map((n) => n.rec_id)));
  const [closedGroups, setClosedGroups] = useState<Set<string>>(loadClosedGroups);
  const rootIdsKey = nodes.map((n) => n.rec_id).join(',');
  useEffect(() => {
    setOpenIds(new Set(nodes.map((n) => n.rec_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootIdsKey]);

  const toggleOne = (id: string) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleGroup = (objetivo: string) => setClosedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(objetivo)) next.delete(objetivo); else next.add(objetivo);
    try { window.localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });

  const grupos = useMemo(() => agruparPorObjetivo(nodes), [nodes]);

  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '0 4px', fontSize: 10, color: 'var(--text-muted)' }}>
        <button onClick={() => setOpenIds(new Set(collectAllIds(nodes)))} style={{ color: 'var(--text-muted)' }}>Expandir tudo</button>
        <button onClick={() => setOpenIds(new Set())} style={{ color: 'var(--text-muted)' }}>Recolher tudo</button>
      </div>
      {grupos.map((g) => (
        <ObjetivoBoard
          key={g.objetivo}
          objetivo={g.objetivo}
          nodes={g.nodes}
          open={!closedGroups.has(g.objetivo)}
          onToggleGroup={() => toggleGroup(g.objetivo)}
          selectedId={selectedId}
          onSelect={onSelect}
          onQuickPause={onQuickPause}
          filtroNivel={filtroNivel}
          filtroCategoria={filtroCategoria}
          apenasComAcao={apenasComAcao}
          openIds={openIds}
          onToggle={toggleOne}
          cplIdeal={cplIdeal}
          cplMaximo={cplMaximo}
        />
      ))}
      {nodes.length === 0 && <p style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma campanha nesta análise.</p>}
    </div>
  );
}
