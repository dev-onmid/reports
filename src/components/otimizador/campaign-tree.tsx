"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  FileText,
  Heart,
  Layers,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  ShoppingBag,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { CreativeThumb } from '@/components/otimizador/creative-thumb';
import {
  PREMIUM,
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
  success: PREMIUM.emerald,
  danger: PREMIUM.red,
  neutral: PREMIUM.txt3,
};

const NIVEL_TAG: Record<string, { label: string; color: string; bg: string }> = {
  campaign: { label: 'CAMPANHA', color: PREMIUM.purple, bg: 'rgba(123,44,255,0.15)' },
  adset: { label: 'CONJUNTO', color: PREMIUM.blue, bg: 'rgba(56,189,248,0.14)' },
  ad: { label: 'CRIATIVO', color: PREMIUM.txt2, bg: 'rgba(255,255,255,0.06)' },
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

const hexToColor: Record<string, string> = { 'bg-emerald-400': PREMIUM.emerald, 'bg-amber-400': PREMIUM.amber, 'bg-red-400': PREMIUM.red };

// Mini-curva de retenção (hook/p25/p50/p75) no criativo; contagem no conjunto/campanha.
function RetencaoInline({ node }: { node: TreeNode }) {
  if (node.nivel === 'ad') {
    const rv = node.retencao_video;
    if (!rv || !rv.eh_video || rv.hook_rate == null) return null;
    const bars = [rv.hook_rate, rv.p25_rate, rv.p50_rate, rv.p75_rate];
    const cor = hexToColor[hookBarTone(rv.hook_rate)] ?? PREMIUM.txt3;
    const fadigado = rv.hook_rate < 25;
    return (
      <span className="flex items-end gap-[2px]" style={{ height: 12 }} title={`Hook ${rv.hook_rate.toFixed(0)}%`}>
        {bars.map((v, i) => (
          <span key={i} style={{ width: 3, height: `${Math.max(12, Math.min(100, v ?? 0))}%`, background: cor, borderRadius: 1 }} />
        ))}
        <span style={{ fontSize: 10, color: fadigado ? PREMIUM.red : PREMIUM.txt3, marginLeft: 5 }}>
          hook {rv.hook_rate.toFixed(0)}%{fadigado ? ' · cansou' : ''}
        </span>
      </span>
    );
  }
  const resumo = videoRetencaoResumo(node);
  if (!resumo || resumo.low === 0) return null;
  return <span style={{ fontSize: 10, color: PREMIUM.red }}>{resumo.low}/{resumo.total} c/ hook baixo</span>;
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
  const custoColor = node.severidade === 'urgente' ? PREMIUM.red : node.severidade === 'ok' ? PREMIUM.emerald : PREMIUM.txt;
  const vsMeta = vsMetaLabel(metricaCusto?.valor, cplIdeal, cplMaximo);

  return (
    <>
      <div
        onClick={() => onSelect(node)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: `10px 16px 10px ${16 + depth * 18}px`,
          borderBottom: `0.5px solid ${PREMIUM.borderSoft}`,
          background: selected ? 'rgba(85,245,47,0.06)' : cat === 'pausar' ? 'rgba(248,113,113,0.04)' : 'transparent',
          opacity: inativo ? 0.45 : 1,
        }}
      >
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); onToggle(node.rec_id); }} style={{ color: PREMIUM.txt2, width: 12, flex: 'none' }}>
            <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
          </button>
        ) : <span style={{ width: 12, flex: 'none' }} />}

        {isAd
          ? <CreativeThumb tone={cat === 'pausar' ? 'border-red-400/40' : 'border-border'} imageUrl={node.imagem_url} alt={node.objeto_nome} />
          : <span style={{ padding: '2px 8px', borderRadius: 6, background: tag.bg, color: tag.color, fontSize: 10, fontWeight: 600, flex: 'none' }}>{tag.label}</span>}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: sevColor, flex: 'none' }} />
            <span style={{ fontSize: node.nivel === 'campaign' ? 14 : 13, fontWeight: node.nivel === 'campaign' ? 600 : 400, color: PREMIUM.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={node.objeto_nome}>
              {node.objeto_nome}
            </span>
            {entrega.label === 'Pausado' && <span style={{ fontSize: 10, color: PREMIUM.txt3, border: `1px solid ${PREMIUM.border}`, borderRadius: 4, padding: '0 5px' }}>pausado</span>}
          </div>
          <div style={{ marginTop: 3 }}><RetencaoInline node={node} /></div>
        </div>

        <div style={{ width: 52, textAlign: 'right', fontSize: 13, color: PREMIUM.txt, flex: 'none' }}>{metricaResultado?.valor ?? '—'}</div>
        <div style={{ width: 72, textAlign: 'right', fontSize: 13, fontWeight: 500, color: custoColor, flex: 'none' }}>{metricaCusto?.valor ?? '—'}</div>
        <div style={{ width: 80, textAlign: 'right', fontSize: 11, color: vsMeta ? VS_META_TONE[vsMeta.tone] : PREMIUM.txt3, flex: 'none' }}>{vsMeta?.text ?? '—'}</div>
        <div style={{ width: 84, textAlign: 'right', flex: 'none' }}>
          {acao?.kind === 'pausar' ? (
            <button
              onClick={(e) => { e.stopPropagation(); onQuickPause(node); }}
              style={{ padding: '6px 12px', background: PREMIUM.red, borderRadius: 8, color: PREMIUM.bg, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}
            >Pausar</button>
          ) : acao?.kind === 'escalar' ? (
            <span style={{ padding: '6px 12px', border: `1px solid rgba(85,245,47,0.4)`, borderRadius: 8, color: PREMIUM.green, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>↑ Escalar</span>
          ) : acao ? (
            <span style={{ fontSize: 12, color: PREMIUM.txt3 }}>{acao.label}</span>
          ) : <span style={{ fontSize: 12, color: PREMIUM.txt3 }}>—</span>}
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
    <div style={{ background: PREMIUM.surf, border: `1px solid ${pior === 'urgente' ? 'rgba(248,113,113,0.25)' : PREMIUM.border}`, borderRadius: 14, overflow: 'hidden' }}>
      <button onClick={onToggleGroup} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', width: '100%', textAlign: 'left', borderBottom: open ? `1px solid ${PREMIUM.borderSoft}` : 'none' }}>
        <ChevronRight size={14} style={{ color: PREMIUM.txt2, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flex: 'none' }} />
        <span style={{ display: 'flex', width: 30, height: 30, borderRadius: 8, background: `${sevColor}1f`, color: sevColor, alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <Icon size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: PREMIUM.txt }}>{objetivo}</div>
          <div style={{ fontSize: 12, color: PREMIUM.txt3 }}>{nodes.length} campanha{nodes.length === 1 ? '' : 's'} · {rotulos.resultado} · {rotulos.custo}</div>
        </div>
        <span style={{ padding: '3px 10px', borderRadius: 20, background: `${sevColor}1f`, color: sevColor, fontSize: 12, fontWeight: 600, flex: 'none' }}>{sevLabel}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 16px', borderBottom: `1px solid ${PREMIUM.borderSoft}`, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: PREMIUM.txt3 }}>
          <span style={{ width: 12, flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 0 }}>Campanha · conjunto · criativo</span>
          <span style={{ width: 52, textAlign: 'right', flex: 'none' }}>{rotulos.resultado}</span>
          <span style={{ width: 72, textAlign: 'right', flex: 'none' }}>{rotulos.custo}</span>
          <span style={{ width: 80, textAlign: 'right', flex: 'none' }}>vs. meta</span>
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
    <div className="space-y-3">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 2px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: PREMIUM.txt2 }}>
          <Layers size={14} /> Campanhas por objetivo
        </span>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: PREMIUM.txt3 }}>
          <button onClick={() => setOpenIds(new Set(collectAllIds(nodes)))} style={{ color: PREMIUM.txt3 }}>Expandir tudo</button>
          <button onClick={() => setOpenIds(new Set())} style={{ color: PREMIUM.txt3 }}>Recolher tudo</button>
        </div>
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
      {nodes.length === 0 && <p style={{ padding: 16, fontSize: 14, color: PREMIUM.txt3 }}>Nenhuma campanha nesta análise.</p>}
    </div>
  );
}
