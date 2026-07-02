"use client";

import { useCallback, useState } from 'react';
import { DictateButton } from '@/components/ui/dictate-button';
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  addEdge,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react';
import {
  Zap, Mail, MessageCircle, Camera, Clock,
  GitBranch, CheckCircle2, X, Plus, Trash2, ChevronDown,
} from 'lucide-react';

// ── Node Components (module level — required by React Flow) ─────────────────

function TriggerNode({ data, selected }: NodeProps) {
  return (
    <div className={`min-w-[180px] rounded-xl border-2 p-3 ${selected ? 'border-[#55F52F]' : 'border-[#55F52F]/50'} bg-[#111722] shadow-lg`}>
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#55F52F]/20">
          <Zap className="h-4 w-4 text-[#55F52F]" />
        </div>
        <div>
          <p className="text-xs font-semibold text-[#55F52F]">Gatilho</p>
          <p className="text-[10px] text-slate-400">{(data.label as string) ?? 'Webhook / Entrada'}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#55F52F] !border-none !w-3 !h-3" />
    </div>
  );
}

function EmailNode({ data, selected }: NodeProps) {
  return (
    <div className={`min-w-[180px] rounded-xl border-2 p-3 ${selected ? 'border-sky-400' : 'border-sky-400/40'} bg-[#111722] shadow-lg`}>
      <Handle type="target" position={Position.Top} className="!bg-sky-400 !border-none !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-400/20">
          <Mail className="h-4 w-4 text-sky-400" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-sky-400">E-mail</p>
          <p className="truncate text-[10px] text-slate-400">{(data.subject as string) || 'Sem assunto'}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-sky-400 !border-none !w-3 !h-3" />
    </div>
  );
}

function WhatsappNode({ data, selected }: NodeProps) {
  return (
    <div className={`min-w-[180px] rounded-xl border-2 p-3 ${selected ? 'border-[#25d366]' : 'border-[#25d366]/40'} bg-[#111722] shadow-lg`}>
      <Handle type="target" position={Position.Top} className="!bg-[#25d366] !border-none !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#25d366]/20">
          <MessageCircle className="h-4 w-4 text-[#25d366]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#25d366]">WhatsApp</p>
          <p className="truncate text-[10px] text-slate-400">{(data.message as string) || 'Mensagem'}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#25d366] !border-none !w-3 !h-3" />
    </div>
  );
}

function InstagramNode({ data, selected }: NodeProps) {
  return (
    <div className={`min-w-[180px] rounded-xl border-2 p-3 ${selected ? 'border-[#e1306c]' : 'border-[#e1306c]/40'} bg-[#111722] shadow-lg`}>
      <Handle type="target" position={Position.Top} className="!bg-[#e1306c] !border-none !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e1306c]/20">
          <Camera className="h-4 w-4 text-[#e1306c]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#e1306c]">Instagram DM</p>
          <p className="truncate text-[10px] text-slate-400">{(data.message as string) || 'Mensagem'}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#e1306c] !border-none !w-3 !h-3" />
    </div>
  );
}

function DelayNode({ data, selected }: NodeProps) {
  return (
    <div className={`min-w-[160px] rounded-xl border-2 p-3 ${selected ? 'border-amber-400' : 'border-amber-400/40'} bg-[#111722] shadow-lg`}>
      <Handle type="target" position={Position.Top} className="!bg-amber-400 !border-none !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/20">
          <Clock className="h-4 w-4 text-amber-400" />
        </div>
        <div>
          <p className="text-xs font-semibold text-amber-400">Aguardar</p>
          <p className="text-[10px] text-slate-400">{String(data.value ?? 1)} {data.unit === 'hours' ? 'hora(s)' : 'dia(s)'}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-amber-400 !border-none !w-3 !h-3" />
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps) {
  const labels: Record<string, string> = {
    email_opened: 'E-mail aberto?',
    email_clicked: 'E-mail clicado?',
    whatsapp_replied: 'WhatsApp respondeu?',
    instagram_replied: 'Instagram respondeu?',
  };
  return (
    <div className={`min-w-[180px] rounded-xl border-2 p-3 ${selected ? 'border-violet-400' : 'border-violet-400/40'} bg-[#111722] shadow-lg`}>
      <Handle type="target" position={Position.Top} className="!bg-violet-400 !border-none !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-400/20">
          <GitBranch className="h-4 w-4 text-violet-400" />
        </div>
        <div>
          <p className="text-xs font-semibold text-violet-400">Condição</p>
          <p className="text-[10px] text-slate-400">{labels[data.check as string] ?? 'Verificar'}</p>
        </div>
      </div>
      {/* yes handle */}
      <Handle type="source" id="yes" position={Position.Bottom} style={{ left: '32%', bottom: -6 }} className="!bg-emerald-400 !border-2 !border-[#111722] !w-3 !h-3" />
      {/* no handle */}
      <Handle type="source" id="no" position={Position.Bottom} style={{ left: '68%', bottom: -6 }} className="!bg-rose-400 !border-2 !border-[#111722] !w-3 !h-3" />
      <div className="mt-2 flex justify-between px-2 text-[9px] text-slate-500">
        <span className="text-emerald-400">Sim</span>
        <span className="text-rose-400">Não</span>
      </div>
    </div>
  );
}

function EndNode({ selected }: NodeProps) {
  return (
    <div className={`min-w-[140px] rounded-xl border-2 p-3 ${selected ? 'border-slate-400' : 'border-slate-600'} bg-[#111722] shadow-lg`}>
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !border-none !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-600/30">
          <CheckCircle2 className="h-4 w-4 text-slate-400" />
        </div>
        <p className="text-xs font-semibold text-slate-400">Fim</p>
      </div>
    </div>
  );
}

const NODE_TYPES = {
  trigger: TriggerNode,
  email: EmailNode,
  whatsapp: WhatsappNode,
  instagram: InstagramNode,
  delay: DelayNode,
  condition: ConditionNode,
  end: EndNode,
};

// ── Types ────────────────────────────────────────────────────────────────────

type MCNodeData = {
  label?: string;
  // email
  accountEmail?: string;
  subject?: string;
  bodyHtml?: string;
  // whatsapp
  clientId?: string;
  message?: string;
  // instagram
  metaConnectionId?: string;
  // delay
  value?: number;
  unit?: 'hours' | 'days';
  // condition
  check?: string;
};

export type GmailAccount = { email: string };
export type ZapiClient = { id: string; name: string };
export type MetaConn = { id: string; display: string };

interface Props {
  automationId?: string;
  initialName?: string;
  initialNodes?: Node[];
  initialEdges?: Edge[];
  webhookToken?: string;
  gmailAccounts: GmailAccount[];
  zapiClients: ZapiClient[];
  metaConns: MetaConn[];
  onClose: () => void;
  onSaved: (id: string, name: string) => void;
}

const INIT_NODES: Node[] = [
  { id: 'trigger', type: 'trigger', position: { x: 200, y: 50 }, data: { label: 'Webhook / Entrada' }, deletable: false },
];

const EDGE_COLOR = '#475569';

// ── Main Component ───────────────────────────────────────────────────────────

export default function MultiChannelBuilder({
  automationId,
  initialName = '',
  initialNodes,
  initialEdges,
  webhookToken,
  gmailAccounts,
  zapiClients,
  metaConns,
  onClose,
  onSaved,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes ?? INIT_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges ?? []);
  const [name, setName] = useState(initialName || 'Nova automação');
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const selectedData = (selectedNode?.data ?? {}) as MCNodeData;
  const showPanel = selectedNode && !['trigger', 'end'].includes(selectedNode.type ?? '');

  const onConnect = useCallback(
    (params: Connection) => {
      const sourceNode = nodes.find((n) => n.id === params.source);
      let color = EDGE_COLOR;
      let label = '';
      if (params.sourceHandle === 'yes') { color = '#34d399'; label = 'Sim'; }
      if (params.sourceHandle === 'no') { color = '#f87171'; label = 'Não'; }
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'smoothstep',
            animated: false,
            label,
            labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
            labelBgStyle: { fill: '#111722', fillOpacity: 0.9 },
            markerEnd: { type: MarkerType.ArrowClosed, color },
            style: { stroke: color, strokeWidth: 2 },
          },
          eds,
        ),
      );
    },
    [nodes, setEdges],
  );

  const addNode = (type: string) => {
    setShowAddMenu(false);
    const id = `${type}-${Date.now()}`;
    const lastNode = nodes[nodes.length - 1];
    const pos = lastNode
      ? { x: lastNode.position.x, y: lastNode.position.y + 120 }
      : { x: 200, y: 200 };

    const defaults: Record<string, MCNodeData> = {
      email: { accountEmail: gmailAccounts[0]?.email ?? '', subject: '', bodyHtml: '' },
      whatsapp: { clientId: zapiClients[0]?.id ?? '', message: '' },
      instagram: { metaConnectionId: metaConns[0]?.id ?? '', message: '' },
      delay: { value: 1, unit: 'days' },
      condition: { check: 'email_opened' },
      end: {},
    };

    const newNode: Node = { id, type, position: pos, data: defaults[type] ?? {} };
    setNodes((nds) => [...nds, newNode]);
    setSelectedId(id);
  };

  const patch = (updates: Partial<MCNodeData>) => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId ? { ...n, data: { ...n.data, ...updates } } : n,
      ),
    );
  };

  const deleteNode = () => {
    if (!selectedId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      name,
      nodesJson: nodes,
      edgesJson: edges,
    };
    try {
      if (automationId) {
        await fetch(`/api/automations/multi/${automationId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        onSaved(automationId, name);
      } else {
        const res = await fetch('/api/automations/multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json() as { id: string; name: string; token: string };
        onSaved(data.id, data.name);
      }
    } finally {
      setSaving(false);
    }
  };

  const ADD_OPTIONS = [
    { type: 'email', label: 'E-mail', color: '#38bdf8', icon: Mail },
    { type: 'whatsapp', label: 'WhatsApp', color: '#25d366', icon: MessageCircle },
    { type: 'instagram', label: 'Instagram DM', color: '#e1306c', icon: Camera },
    { type: 'delay', label: 'Aguardar', color: '#fbbf24', icon: Clock },
    { type: 'condition', label: 'Condição', color: '#a78bfa', icon: GitBranch },
    { type: 'end', label: 'Fim', color: '#94a3b8', icon: CheckCircle2 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0f1a]">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/8 px-4">
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/8 hover:text-white">
          <X className="h-4 w-4" />
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-64 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-[#55F52F]/50 focus:outline-none"
          placeholder="Nome da automação"
        />
        {webhookToken && (
          <div className="hidden items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 sm:flex">
            <Zap className="h-3.5 w-3.5 text-[#55F52F]" />
            <span className="font-mono text-xs text-slate-400">/api/automations/multi/trigger/{webhookToken}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-[#55F52F] px-4 py-1.5 text-xs font-semibold text-black hover:bg-[#4ae028] disabled:opacity-60"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={{
            type: 'smoothstep',
            style: { stroke: EDGE_COLOR, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR },
          }}
        >
          <Background color="#1e2a3a" gap={20} />
          <Controls className="!bg-[#111722] !border-white/10 !text-white" />

          {/* Add node button */}
          <Panel position="top-right" className="m-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAddMenu(!showAddMenu)}
                className="flex items-center gap-1.5 rounded-xl bg-[#55F52F] px-3 py-2 text-xs font-semibold text-black shadow-lg hover:bg-[#4ae028]"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar nó
                <ChevronDown className="h-3 w-3" />
              </button>
              {showAddMenu && (
                <div className="absolute right-0 top-10 z-10 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#111722] shadow-xl">
                  {ADD_OPTIONS.map((opt) => (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => addNode(opt.type)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-white/5"
                    >
                      <opt.icon className="h-4 w-4" style={{ color: opt.color }} />
                      <span className="text-white">{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </ReactFlow>

        {/* Edit Panel */}
        {showPanel && selectedNode && (
          <div className="absolute right-0 top-0 h-full w-80 overflow-y-auto border-l border-white/8 bg-[#0d1420] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Editar nó</p>
              <button type="button" onClick={deleteNode} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-rose-400 hover:bg-rose-400/10">
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </button>
            </div>

            {selectedNode.type === 'email' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Conta Gmail</label>
                  <select
                    value={selectedData.accountEmail ?? ''}
                    onChange={(e) => patch({ accountEmail: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    {gmailAccounts.map((a) => <option key={a.email} value={a.email}>{a.email}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Assunto</label>
                  <input
                    value={selectedData.subject ?? ''}
                    onChange={(e) => patch({ subject: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none"
                    placeholder="Assunto do e-mail"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Corpo (HTML)</label>
                  <textarea
                    value={selectedData.bodyHtml ?? ''}
                    onChange={(e) => patch({ bodyHtml: e.target.value })}
                    rows={8}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                    placeholder="<p>Olá {nome},</p>"
                  />
                </div>
                <p className="text-[10px] text-slate-500">Variáveis: {'{nome}'} {'{email}'}</p>
              </div>
            )}

            {selectedNode.type === 'whatsapp' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Instância Z-API</label>
                  <select
                    value={selectedData.clientId ?? ''}
                    onChange={(e) => patch({ clientId: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    {zapiClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Mensagem</label>
                  <div className="relative">
                    <textarea
                      value={selectedData.message ?? ''}
                      onChange={(e) => patch({ message: e.target.value })}
                      rows={5}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none"
                      placeholder="Olá {nome}! Como posso ajudar?"
                    />
                    <DictateButton className="absolute bottom-2 right-2" onTranscript={(text) => patch({ message: (selectedData.message as string) ? `${selectedData.message} ${text}` : text })} />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500">Variáveis: {'{nome}'} {'{email}'}</p>
              </div>
            )}

            {selectedNode.type === 'instagram' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Conexão Meta</label>
                  <select
                    value={selectedData.metaConnectionId ?? ''}
                    onChange={(e) => patch({ metaConnectionId: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    {metaConns.map((c) => <option key={c.id} value={c.id}>{c.display}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Mensagem</label>
                  <div className="relative">
                    <textarea
                      value={selectedData.message ?? ''}
                      onChange={(e) => patch({ message: e.target.value })}
                      rows={5}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none"
                      placeholder="Olá {nome}! Vi que você entrou em contato."
                    />
                    <DictateButton className="absolute bottom-2 right-2" onTranscript={(text) => patch({ message: (selectedData.message as string) ? `${selectedData.message} ${text}` : text })} />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500">Variáveis: {'{nome}'} {'{email}'}</p>
              </div>
            )}

            {selectedNode.type === 'delay' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Aguardar</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={selectedData.value ?? 1}
                      onChange={(e) => patch({ value: Number(e.target.value) })}
                      className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                    />
                    <select
                      value={selectedData.unit ?? 'days'}
                      onChange={(e) => patch({ unit: e.target.value as 'hours' | 'days' })}
                      className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      <option value="hours">Horas</option>
                      <option value="days">Dias</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {selectedNode.type === 'condition' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Verificar se</label>
                  <select
                    value={selectedData.check ?? 'email_opened'}
                    onChange={(e) => patch({ check: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    <option value="email_opened">E-mail foi aberto</option>
                    <option value="email_clicked">E-mail teve clique</option>
                    <option value="whatsapp_replied">WhatsApp respondeu</option>
                    <option value="instagram_replied">Instagram respondeu</option>
                  </select>
                </div>
                <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-2 text-[10px] text-slate-400">
                  Conecte o handle <span className="font-semibold text-emerald-400">verde (Sim)</span> para quando a condição for verdadeira e o <span className="font-semibold text-rose-400">vermelho (Não)</span> para quando não for.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
