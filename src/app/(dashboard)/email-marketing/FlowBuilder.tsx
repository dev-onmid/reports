"use client";

import { useCallback, useState } from 'react';
import {
  ReactFlow, addEdge, useNodesState, useEdgesState,
  Controls, Background, BackgroundVariant,
  Handle, Position, Panel, MarkerType,
  type Node, type Edge, type Connection, type NodeProps,
} from '@xyflow/react';
import {
  Mail, Clock, GitBranch, Play, Plus, Trash2, X,
  Save, RefreshCw, Check, ChevronLeft, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type GmailAccount = { id: string; email: string; display_name: string };

// ─── Custom node components (defined at module level — required by React Flow) ──

function StartNode({ selected }: NodeProps) {
  return (
    <div className={cn('rounded-xl border-2 px-5 py-3 shadow-xl min-w-[180px] bg-emerald-950/90',
      selected ? 'border-emerald-400' : 'border-emerald-700/60')}>
      <div className="flex items-center gap-2">
        <Play className="h-4 w-4 fill-emerald-400 text-emerald-400" />
        <span className="text-sm font-bold text-emerald-300">Início do Fluxo</span>
      </div>
      <p className="mt-1 text-[10px] text-emerald-600">Contato entra no fluxo</p>
      <Handle type="source" position={Position.Right}
        className="!bg-emerald-400 !border-emerald-900 !w-3 !h-3" />
    </div>
  );
}

function EmailNode({ data, selected }: NodeProps) {
  const d = data as { subject?: string; accountEmail?: string };
  return (
    <div className={cn('rounded-xl border-2 shadow-xl min-w-[220px] max-w-[260px] bg-sky-950/90',
      selected ? 'border-sky-400' : 'border-sky-700/60')}>
      <Handle type="target" position={Position.Left}
        className="!bg-sky-400 !border-sky-900 !w-3 !h-3" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Mail className="h-4 w-4 text-sky-400 shrink-0" />
          <span className="text-sm font-bold text-sky-300">E-mail</span>
        </div>
        <p className={cn('text-xs truncate', d.subject ? 'text-white/90 font-medium' : 'text-muted-foreground italic')}>
          {d.subject || 'Clique para editar assunto'}
        </p>
        {d.accountEmail && (
          <p className="text-[10px] text-sky-600/80 truncate mt-0.5">{d.accountEmail}</p>
        )}
      </div>
      <Handle type="source" position={Position.Right}
        className="!bg-sky-400 !border-sky-900 !w-3 !h-3" />
    </div>
  );
}

function DelayNode({ data, selected }: NodeProps) {
  const d = data as { days?: number };
  const dias = d.days ?? 1;
  return (
    <div className={cn('rounded-xl border-2 px-5 py-3 shadow-xl min-w-[160px] bg-amber-950/90',
      selected ? 'border-amber-400' : 'border-amber-700/60')}>
      <Handle type="target" position={Position.Left}
        className="!bg-amber-400 !border-amber-900 !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-bold text-amber-300">Aguardar</span>
      </div>
      <p className="mt-1 text-base font-bold text-amber-200">{dias} dia{dias !== 1 ? 's' : ''}</p>
      <Handle type="source" position={Position.Right}
        className="!bg-amber-400 !border-amber-900 !w-3 !h-3" />
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps) {
  const d = data as { check?: string };
  return (
    <div className={cn('rounded-xl border-2 px-5 py-4 shadow-xl min-w-[210px] bg-violet-950/90',
      selected ? 'border-violet-400' : 'border-violet-700/60')}>
      <Handle type="target" position={Position.Left}
        className="!bg-violet-400 !border-violet-900 !w-3 !h-3" />
      <div className="flex items-center gap-2 mb-2">
        <GitBranch className="h-4 w-4 text-violet-400" />
        <span className="text-sm font-bold text-violet-300">Condição</span>
      </div>
      <p className="text-xs text-violet-200 mb-4">
        {d.check === 'clicked' ? 'Clicou em link?' : 'Abriu o e-mail?'}
      </p>
      <div className="space-y-4 text-xs pr-5">
        <p className="font-bold text-emerald-400">Sim →</p>
        <p className="font-bold text-rose-400">Não →</p>
      </div>
      <Handle id="yes" type="source" position={Position.Right} style={{ top: '58%' }}
        className="!bg-emerald-400 !border-emerald-900 !w-3 !h-3" />
      <Handle id="no" type="source" position={Position.Right} style={{ top: '76%' }}
        className="!bg-rose-400 !border-rose-900 !w-3 !h-3" />
    </div>
  );
}

function EndNode({ selected }: NodeProps) {
  return (
    <div className={cn('rounded-xl border-2 px-5 py-3 shadow-xl min-w-[160px] bg-zinc-900/90',
      selected ? 'border-zinc-500' : 'border-zinc-700/50')}>
      <Handle type="target" position={Position.Left}
        className="!bg-zinc-500 !border-zinc-800 !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-zinc-500" />
        <span className="text-sm font-bold text-zinc-400">Fim</span>
      </div>
      <p className="mt-1 text-[10px] text-zinc-600">Contato conclui o fluxo</p>
    </div>
  );
}

const NODE_TYPES = {
  start: StartNode, email: EmailNode, delay: DelayNode,
  condition: ConditionNode, end: EndNode,
} as const;

const INIT_NODES: Node[] = [
  { id: 'start', type: 'start', position: { x: 60, y: 180 }, data: {}, deletable: false },
];

const ADD_OPTIONS = [
  { type: 'email' as const, label: 'E-mail', Icon: Mail, color: 'text-sky-400' },
  { type: 'delay' as const, label: 'Aguardar', Icon: Clock, color: 'text-amber-400' },
  { type: 'condition' as const, label: 'Condição', Icon: GitBranch, color: 'text-violet-400' },
  { type: 'end' as const, label: 'Fim', Icon: CheckCircle2, color: 'text-zinc-400' },
];

// ─── FlowBuilder component ────────────────────────────────────────────────────

interface FlowBuilderProps {
  flowId: string | null;
  initialName?: string;
  initialAccountEmail?: string;
  initialNodes?: Node[];
  initialEdges?: Edge[];
  accounts: GmailAccount[];
  onClose: () => void;
  onSaved: (flowId: string, name: string) => void;
}

export function FlowBuilder({
  flowId, initialName = '', initialAccountEmail = '',
  initialNodes, initialEdges, accounts, onClose, onSaved,
}: FlowBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes ?? INIT_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges ?? []);
  const [name, setName] = useState(initialName);
  const [account, setAccount] = useState(initialAccountEmail || accounts[0]?.email || '');
  const [selId, setSelId] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const selNode = nodes.find((n) => n.id === selId) ?? null;
  const showPanel = !!(selNode && selNode.type !== 'start' && selNode.type !== 'end');
  const sd = (selNode?.data ?? {}) as Record<string, unknown>;

  const onConnect = useCallback((conn: Connection) => {
    const isYes = conn.sourceHandle === 'yes';
    const isNo = conn.sourceHandle === 'no';
    const color = isYes ? '#22c55e' : isNo ? '#ef4444' : '#64748b';
    setEdges((eds) => addEdge({
      ...conn, type: 'smoothstep',
      style: { stroke: color, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      ...(isYes || isNo ? {
        label: isYes ? 'Sim' : 'Não',
        labelStyle: { fill: color, fontSize: 10, fontWeight: 700 },
        labelBgStyle: { fill: '#09090b', fillOpacity: 0.9 },
        labelBgPadding: [4, 6] as [number, number],
        labelBgBorderRadius: 4,
      } : {}),
    }, eds));
  }, [setEdges]);

  function addNode(type: 'email' | 'delay' | 'condition' | 'end') {
    setAddMenu(false);
    const id = `${type}-${Date.now()}`;
    const data: Record<string, unknown> =
      type === 'email' ? { subject: '', bodyHtml: '', accountEmail: accounts[0]?.email ?? '' }
      : type === 'delay' ? { days: 1 }
      : type === 'condition' ? { check: 'opened' }
      : {};
    setNodes((nds) => [...nds, {
      id, type, data,
      position: { x: 160 + (nds.length - 1) * 60, y: 80 + ((nds.length - 1) % 3) * 80 },
    }]);
    setSelId(id);
  }

  function patch(updates: Record<string, unknown>) {
    if (!selId) return;
    setNodes((nds) => nds.map((n) => n.id === selId ? { ...n, data: { ...n.data, ...updates } } : n));
  }

  function deleteNode() {
    if (!selId || selId === 'start') return;
    setNodes((nds) => nds.filter((n) => n.id !== selId));
    setEdges((eds) => eds.filter((e) => e.source !== selId && e.target !== selId));
    setSelId(null);
  }

  async function handleSave() {
    if (!name.trim()) { setErr('Nome obrigatório'); return; }
    setSaving(true); setErr('');
    try {
      if (flowId) {
        const res = await fetch(`/api/email/flows/${flowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodesJson: nodes, edgesJson: edges }),
        });
        if (!res.ok) { setErr('Erro ao salvar'); return; }
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        onSaved(flowId, name);
      } else {
        const res = await fetch('/api/email/flows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountEmail: account, name, nodesJson: nodes, edgesJson: edges, flowMode: 'graph' }),
        });
        const data = await res.json() as { id?: string; error?: string };
        if (!data.id) { setErr(data.error ?? 'Erro ao criar fluxo'); return; }
        onSaved(data.id, name);
      }
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#09090b' }}>
      {/* ── Header ── */}
      <div className="h-14 shrink-0 border-b border-border bg-background/95 backdrop-blur-sm flex items-center gap-3 px-4">
        <button type="button" onClick={onClose}
          className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" />Voltar
        </button>
        <div className="h-4 w-px bg-border" />
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          className="h-8 flex-1 max-w-xs rounded-lg border border-border bg-background px-3 text-sm font-semibold outline-none focus:border-primary"
          placeholder="Nome do fluxo..."
        />
        {!flowId && accounts.length > 0 && (
          <select value={account} onChange={(e) => setAccount(e.target.value)}
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-primary">
            {accounts.map((a) => <option key={a.email} value={a.email}>{a.email}</option>)}
          </select>
        )}
        <div className="flex-1" />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button type="button" onClick={handleSave} disabled={saving}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50',
            saved ? 'bg-emerald-600 text-white' : 'bg-primary text-black hover:bg-primary/90',
          )}>
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" />
            : saved ? <Check className="h-4 w-4" />
            : <Save className="h-4 w-4" />}
          {saving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar'}
        </button>
      </div>

      {/* ── Canvas + side panel ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* React Flow */}
        <div className="flex-1 h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => { setSelId(n.id); setAddMenu(false); }}
            onPaneClick={() => { setSelId(null); setAddMenu(false); }}
            nodeTypes={NODE_TYPES}
            fitView
            deleteKeyCode="Delete"
            style={{ background: 'transparent' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1f2937" />
            <Controls />

            {/* Add node floating button */}
            <Panel position="top-right">
              <div className="relative">
                <button type="button" onClick={() => setAddMenu(!addMenu)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-black font-bold shadow-lg hover:bg-primary/90 transition-all">
                  <Plus className="h-5 w-5" />
                </button>
                {addMenu && (
                  <div className="absolute top-12 right-0 min-w-[170px] rounded-xl border border-border bg-card shadow-2xl p-1.5 z-10">
                    {ADD_OPTIONS.map(({ type, label, Icon, color }) => (
                      <button key={type} type="button" onClick={() => addNode(type)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors">
                        <Icon className={cn('h-4 w-4 shrink-0', color)} />{label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {/* Edit panel (slides in on node selection) */}
        {showPanel && (
          <div className="w-72 shrink-0 border-l border-border bg-card flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-xs font-bold uppercase tracking-wider">
                {selNode!.type === 'email' ? 'Editar E-mail'
                  : selNode!.type === 'delay' ? 'Aguardar'
                  : 'Condição'}
              </h3>
              <div className="flex gap-1">
                <button type="button" onClick={deleteNode}
                  className="rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setSelId(null)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {selNode!.type === 'email' && (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold">Conta Gmail</span>
                    <select value={(sd.accountEmail as string) ?? ''}
                      onChange={(e) => patch({ accountEmail: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-primary">
                      {accounts.map((a) => <option key={a.email} value={a.email}>{a.email}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold">Assunto</span>
                    <input value={(sd.subject as string) ?? ''}
                      onChange={(e) => patch({ subject: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                      placeholder="Assunto do e-mail" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold">Corpo HTML</span>
                    <p className="text-[10px] text-muted-foreground">{'{nome}'} · {'{email}'}</p>
                    <textarea value={(sd.bodyHtml as string) ?? ''}
                      onChange={(e) => patch({ bodyHtml: e.target.value })}
                      rows={9}
                      className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono outline-none focus:border-primary resize-y"
                      placeholder="<p>Olá {nome}, ...</p>" />
                  </label>
                </>
              )}
              {selNode!.type === 'delay' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold">Aguardar (dias)</span>
                  <input type="number" min={0} step={1}
                    value={(sd.days as number) ?? 1}
                    onChange={(e) => patch({ days: Number(e.target.value) })}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
                  <p className="text-[10px] text-muted-foreground">0 = avançar imediatamente</p>
                </label>
              )}
              {selNode!.type === 'condition' && (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold">Verificar se contato</span>
                    <select value={(sd.check as string) ?? 'opened'}
                      onChange={(e) => patch({ check: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-primary">
                      <option value="opened">Abriu algum e-mail deste fluxo</option>
                      <option value="clicked">Clicou em algum link deste fluxo</option>
                    </select>
                  </label>
                  <div className="rounded-lg bg-muted/30 p-3 text-[10px] text-muted-foreground space-y-1.5">
                    <p>Handle <span className="text-emerald-400 font-bold">verde</span> = caminho para quem <strong>SIM</strong>.</p>
                    <p>Handle <span className="text-rose-400 font-bold">vermelho</span> = caminho para quem <strong>NÃO</strong>.</p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
