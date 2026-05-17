"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { getAuthSession } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import {
  Send, Bot, User, Loader2, Settings2, Save, X, ChevronDown,
  Wrench, Mic, MicOff, Plus, Trash2, FileText, Link2, Type,
  Webhook, MessageSquare, BookOpen, Zap, Upload, Globe, CheckCircle,
  ToggleLeft, ToggleRight, Play, Pause, Download,
  Sparkles, ShieldCheck, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type Role = string | undefined;

type FileAttachment = {
  url: string;
  filename: string;
  label: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  attachments?: FileAttachment[];
};

type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_done'; name: string }
  | { type: 'file_attachment'; url: string; filename: string; label: string }
  | { type: 'done'; role?: string }
  | { type: 'error'; message: string };

type KnowledgeItem = {
  id: string;
  title: string;
  type: 'text' | 'url' | 'pdf';
  url?: string;
  preview?: string;
  created_at: string;
};

type ExternalTool = {
  id: string;
  name: string;
  description: string;
  type: 'webhook' | 'zapi_whatsapp';
  config: Record<string, string>;
  enabled: boolean;
};

const TOOL_LABELS: Record<string, string> = {
  list_clients: 'listando clientes',
  get_client_accounts: 'buscando contas',
  get_crm_data: 'consultando CRM',
  get_meta_campaigns: 'analisando Meta Ads',
  get_google_campaigns: 'analisando Google Ads',
  get_account_balances: 'verificando saldos',
  update_meta_campaign_status: 'atualizando campanha',
  generate_client_report: 'gerando relatório',
  generate_report_pdf: 'gerando PDF',
  send_report_pdf_whatsapp: 'gerando e enviando PDF',
  list_zapi_clients: 'buscando conexões WhatsApp',
};

function getToolLabel(name: string): string {
  if (name.startsWith('ext_')) return 'executando ferramenta';
  return TOOL_LABELS[name] ?? name;
}

// ---- Voice recording hook ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any;

function useVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<AnySR>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const w = window as AnySR;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  function toggle() {
    const w = window as AnySR;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const recognition = new SR();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (e: AnySR) => {
      const transcript = Array.from(e.results as AnySR[]).map((r: AnySR) => r[0].transcript).join('');
      onTranscript(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  return { listening, toggle, supported };
}

// ---- Sub-components ----

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/35 bg-primary/10 shadow-[0_0_26px_rgba(85,245,47,0.16)]">
          <Bot className="h-[18px] w-[18px] text-primary" />
        </div>
      )}
      <div className={cn('flex max-w-[78%] flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
        {msg.toolsUsed && msg.toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-0.5">
            {[...new Set(msg.toolsUsed)].map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                <Wrench className="w-2.5 h-2.5" />{getToolLabel(t)}
              </span>
            ))}
          </div>
        )}
        <div className={cn(
          'whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-[0_18px_45px_rgba(0,0,0,0.22)]',
          isUser
            ? 'rounded-tr-md border border-primary/30 bg-primary/15 text-primary'
            : 'rounded-tl-md border border-white/10 bg-[#101522]/90 text-slate-100'
        )}>
          {msg.content}
        </div>
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="flex flex-col gap-2 w-full">
            {msg.attachments.map((att, i) => (
              <a
                key={i}
                href={att.url}
                download={att.filename}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#101522] px-4 py-3 transition-all hover:border-primary/30 hover:bg-primary/5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
                  <FileText className="h-4 w-4 text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">{att.label}</p>
                  <p className="text-xs text-slate-500">{att.filename}</p>
                </div>
                <Download className="h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-primary" />
              </a>
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
          <User className="h-[18px] w-[18px] text-slate-300" />
        </div>
      )}
    </div>
  );
}

// ---- Training Modal ----
type TrainingTab = 'instructions' | 'knowledge' | 'tools';

function TrainingModal({
  onClose, userRole, instructions, onSaveInstructions,
}: {
  onClose: () => void;
  userRole: Role;
  instructions: string;
  onSaveInstructions: (v: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<TrainingTab>('instructions');
  const [draft, setDraft] = useState(instructions);
  const [saving, setSaving] = useState(false);

  // Knowledge
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [kLoading, setKLoading] = useState(false);
  const [kForm, setKForm] = useState<{ type: 'text' | 'url' | 'pdf'; title: string; content: string; url: string } | null>(null);
  const [kSaving, setKSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // External tools
  const [extTools, setExtTools] = useState<ExternalTool[]>([]);
  const [tLoading, setTLoading] = useState(false);
  const [tForm, setTForm] = useState<Partial<ExternalTool> | null>(null);
  const [tSaving, setTSaving] = useState(false);
  const [zapiClients, setZapiClients] = useState<{ id: string; name: string; instance_id: string; active: boolean }[]>([]);
  const [zapiMode, setZapiMode] = useState<'existing' | 'new'>('existing');

  useEffect(() => {
    if (tab === 'knowledge' && knowledge.length === 0) loadKnowledge();
    if (tab === 'tools' && extTools.length === 0) loadTools();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadKnowledge() {
    setKLoading(true);
    try {
      const r = await fetch('/api/agent/knowledge');
      if (r.ok) setKnowledge(await r.json() as KnowledgeItem[]);
    } finally { setKLoading(false); }
  }

  async function loadTools() {
    setTLoading(true);
    try {
      const [toolsRes, zapiRes] = await Promise.all([
        fetch('/api/agent/tools-config'),
        fetch('/api/disparos/clients'),
      ]);
      if (toolsRes.ok) setExtTools(await toolsRes.json() as ExternalTool[]);
      if (zapiRes.ok) setZapiClients(await zapiRes.json() as { id: string; name: string; instance_id: string; active: boolean }[]);
    } finally { setTLoading(false); }
  }

  async function saveKnowledge() {
    if (!kForm) return;
    setKSaving(true);
    try {
      const r = await fetch('/api/agent/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...kForm, role: userRole }),
      });
      if (r.ok) {
        setKForm(null);
        await loadKnowledge();
      }
    } finally { setKSaving(false); }
  }

  async function deleteKnowledge(id: string) {
    await fetch(`/api/agent/knowledge?id=${id}&role=${userRole}`, { method: 'DELETE' });
    setKnowledge(prev => prev.filter(k => k.id !== id));
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = (reader.result as string).split(',')[1];
      setKForm({ type: 'pdf', title: file.name.replace(/\.[^.]+$/, ''), content: b64, url: '' });
    };
    reader.readAsDataURL(file);
  }

  async function saveExtTool() {
    if (!tForm?.name || !tForm.description || !tForm.type) return;
    setTSaving(true);
    try {
      const r = await fetch('/api/agent/tools-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tForm, role: userRole }),
      });
      if (r.ok) {
        setTForm(null);
        await loadTools();
      }
    } finally { setTSaving(false); }
  }

  async function deleteExtTool(id: string) {
    await fetch(`/api/agent/tools-config?id=${id}&role=${userRole}`, { method: 'DELETE' });
    setExtTools(prev => prev.filter(t => t.id !== id));
  }

  async function toggleExtTool(tool: ExternalTool) {
    await fetch('/api/agent/tools-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...tool, enabled: !tool.enabled, role: userRole }),
    });
    setExtTools(prev => prev.map(t => t.id === tool.id ? { ...t, enabled: !t.enabled } : t));
  }

  const TABS: { key: TrainingTab; label: string; icon: React.ElementType }[] = [
    { key: 'instructions', label: 'Instruções', icon: Settings2 },
    { key: 'knowledge', label: 'Conhecimento', icon: BookOpen },
    { key: 'tools', label: 'Ferramentas', icon: Zap },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-background rounded-2xl border border-border shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <h2 className="font-bold text-foreground">Treinar Luna</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5 gap-1 bg-card/50">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* -- Instructions tab -- */}
          {tab === 'instructions' && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Defina a personalidade, tom de voz e comportamento da Luna. Ativas em todas as conversas.
              </p>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                className="w-full h-64 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground"
              />
              <div className="flex justify-end">
                <Button onClick={async () => { setSaving(true); await onSaveInstructions(draft); setSaving(false); onClose(); }} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Salvar
                </Button>
              </div>
            </div>
          )}

          {/* -- Knowledge tab -- */}
          {tab === 'knowledge' && (
            <div className="flex flex-col gap-4">
              {/* Add buttons */}
              {!kForm && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setKForm({ type: 'text', title: '', content: '', url: '' })}>
                    <Type className="w-3.5 h-3.5" />Texto
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setKForm({ type: 'url', title: '', content: '', url: '' })}>
                    <Globe className="w-3.5 h-3.5" />URL / Link
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-3.5 h-3.5" />PDF
                  </Button>
                  <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
                </div>
              )}

              {/* Add form */}
              {kForm && (
                <div className="border border-border rounded-xl p-4 bg-card flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    {kForm.type === 'text' && <Type className="w-4 h-4 text-primary" />}
                    {kForm.type === 'url' && <Globe className="w-4 h-4 text-primary" />}
                    {kForm.type === 'pdf' && <FileText className="w-4 h-4 text-primary" />}
                    <span className="text-sm font-medium capitalize">{kForm.type === 'pdf' ? 'Arquivo PDF' : kForm.type === 'url' ? 'URL / Link' : 'Nota de texto'}</span>
                    <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => setKForm(null)}><X className="w-3 h-3" /></Button>
                  </div>
                  <input
                    placeholder="Título"
                    value={kForm.title}
                    onChange={e => setKForm(p => p ? { ...p, title: e.target.value } : null)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {kForm.type === 'url' && (
                    <input
                      placeholder="https://..."
                      value={kForm.url}
                      onChange={e => setKForm(p => p ? { ...p, url: e.target.value, content: e.target.value } : null)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                  )}
                  {kForm.type === 'text' && (
                    <textarea
                      placeholder="Conteúdo..."
                      value={kForm.content}
                      onChange={e => setKForm(p => p ? { ...p, content: e.target.value } : null)}
                      rows={6}
                      className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                  )}
                  {kForm.type === 'pdf' && (
                    <p className="text-xs text-muted-foreground">Arquivo carregado. Clique em Adicionar para salvar.</p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setKForm(null)}>Cancelar</Button>
                    <Button size="sm" className="gap-2" onClick={saveKnowledge} disabled={kSaving || !kForm.title || (!kForm.content && kForm.type !== 'url') || (kForm.type === 'url' && !kForm.url)}>
                      {kSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Adicionar
                    </Button>
                  </div>
                </div>
              )}

              {/* Knowledge list */}
              {kLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : knowledge.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Nenhum conhecimento adicionado ainda.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {knowledge.map(item => (
                    <div key={item.id} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card hover:bg-card/80 transition-colors">
                      <div className="flex-shrink-0 mt-0.5">
                        {item.type === 'pdf' && <FileText className="w-4 h-4 text-red-400" />}
                        {item.type === 'url' && <Link2 className="w-4 h-4 text-blue-400" />}
                        {item.type === 'text' && <Type className="w-4 h-4 text-green-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        {item.url && <p className="text-xs text-muted-foreground truncate">{item.url}</p>}
                        {item.preview && <p className="text-xs text-muted-foreground line-clamp-1">{item.preview}</p>}
                      </div>
                      <button onClick={() => deleteKnowledge(item.id)} className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* -- Tools tab -- */}
          {tab === 'tools' && (
            <div className="flex flex-col gap-4">
              {!tForm && (
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setTForm({ type: 'webhook', config: {} })}>
                    <Webhook className="w-3.5 h-3.5" />Webhook (Make/Zapier)
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => { setTForm({ type: 'zapi_whatsapp', config: {} }); setZapiMode(zapiClients.length > 0 ? 'existing' : 'new'); }}>
                    <MessageSquare className="w-3.5 h-3.5" />WhatsApp Z-API
                  </Button>
                </div>
              )}

              {tForm && (
                <div className="border border-border rounded-xl p-4 bg-card flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    {tForm.type === 'webhook' ? <Webhook className="w-4 h-4 text-primary" /> : <MessageSquare className="w-4 h-4 text-primary" />}
                    <span className="text-sm font-medium">{tForm.type === 'webhook' ? 'Webhook (Make/Zapier)' : 'WhatsApp via Z-API'}</span>
                    <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => setTForm(null)}><X className="w-3 h-3" /></Button>
                  </div>

                  <input placeholder="Nome da ferramenta (ex: Enviar WhatsApp de boas-vindas)" value={tForm.name ?? ''} onChange={e => setTForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                  <input placeholder="Descrição — Luna usa isso para decidir quando acionar (ex: Use para enviar mensagem WhatsApp para um número)" value={tForm.description ?? ''} onChange={e => setTForm(p => ({ ...p, description: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />

                  {tForm.type === 'webhook' && (
                    <input placeholder="URL do webhook (ex: https://hook.make.com/...)" value={tForm.config?.url ?? ''} onChange={e => setTForm(p => ({ ...p, config: { ...p?.config, url: e.target.value } }))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                  )}

                  {tForm.type === 'zapi_whatsapp' && (
                    <div className="flex flex-col gap-3">
                      {/* Mode selector */}
                      {zapiClients.length > 0 && (
                        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                          <button onClick={() => setZapiMode('existing')} className={cn('flex-1 py-2 px-3 transition-colors', zapiMode === 'existing' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted/50')}>
                            Usar conexão existente
                          </button>
                          <button onClick={() => setZapiMode('new')} className={cn('flex-1 py-2 px-3 transition-colors border-l border-border', zapiMode === 'new' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted/50')}>
                            Configurar nova
                          </button>
                        </div>
                      )}

                      {/* Existing connections */}
                      {zapiMode === 'existing' && zapiClients.length > 0 && (
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-muted-foreground">Selecione uma conexão do Disparos:</p>
                          {zapiClients.map(zc => {
                            const selected = tForm.config?.zapi_client_id === zc.id;
                            return (
                              <button key={zc.id} onClick={() => setTForm(p => ({ ...p, config: { zapi_client_id: zc.id } }))}
                                className={cn(
                                  'flex items-center gap-3 p-3 rounded-xl border text-left transition-all',
                                  selected ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-primary/5'
                                )}>
                                <MessageSquare className={cn('w-4 h-4 shrink-0', selected ? 'text-primary' : '')} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{zc.name}</p>
                                  <p className="text-xs opacity-70">Instance: {zc.instance_id}</p>
                                </div>
                                {selected && <CheckCircle className="w-4 h-4 text-primary shrink-0" />}
                                {!zc.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">Inativo</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* New credentials */}
                      {(zapiMode === 'new' || zapiClients.length === 0) && (
                        <>
                          <input placeholder="Instance ID (Z-API)" value={tForm.config?.instance_id ?? ''} onChange={e => { const v = e.target.value; setTForm(p => { const c = { ...p?.config }; delete c.zapi_client_id; return { ...p, config: { ...c, instance_id: v } }; }); }}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                          <input placeholder="Token (Z-API)" value={tForm.config?.token ?? ''} onChange={e => setTForm(p => ({ ...p, config: { ...p?.config, token: e.target.value } }))}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                          <input placeholder="Security Token (opcional)" value={tForm.config?.security_token ?? ''} onChange={e => setTForm(p => ({ ...p, config: { ...p?.config, security_token: e.target.value } }))}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setTForm(null)}>Cancelar</Button>
                    <Button size="sm" className="gap-2" onClick={saveExtTool} disabled={tSaving || !tForm.name || !tForm.description}>
                      {tSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Adicionar
                    </Button>
                  </div>
                </div>
              )}

              {tLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : extTools.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Nenhuma ferramenta externa configurada.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {extTools.map(tool => (
                    <div key={tool.id} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card">
                      <div className="flex-shrink-0 mt-0.5">
                        {tool.type === 'webhook' ? <Webhook className="w-4 h-4 text-orange-400" /> : <MessageSquare className="w-4 h-4 text-green-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{tool.name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => toggleExtTool(tool)} className="text-muted-foreground hover:text-primary transition-colors">
                          {tool.enabled ? <ToggleRight className="w-5 h-5 text-primary" /> : <ToggleLeft className="w-5 h-5" />}
                        </button>
                        <button onClick={() => deleteExtTool(tool.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Main page ----

export default function AgentePage() {
  const session = getAuthSession();
  const userRole: Role = session?.role;
  const isAdmin = userRole === 'Administrador';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [showTraining, setShowTraining] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [scrolledUp, setScrolledUp] = useState(false);
  const [showMoreSuggestions, setShowMoreSuggestions] = useState(false);
  const [systemContext, setSystemContext] = useState<{ clients: number } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { listening, toggle: toggleVoice, supported: voiceSupported } = useVoiceInput((text) => {
    setInput(prev => (prev ? `${prev} ${text}` : text));
  });

  useEffect(() => {
    fetch('/api/agent/instructions')
      .then(r => r.json())
      .then((d: { instructions: string }) => setInstructions(d.instructions))
      .catch(() => {});

    fetch('/api/clients')
      .then(r => r.ok ? r.json() : [])
      .then((data: { status?: string }[]) => {
        const active = Array.isArray(data) ? data.filter(c => !c.status || c.status === 'Ativo').length : 0;
        setSystemContext({ clients: active });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!scrolledUp) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, scrolledUp]);

  const handleScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    setScrolledUp(el.scrollTop + el.clientHeight < el.scrollHeight - 60);
  }, []);

  async function saveInstructions(value: string) {
    await fetch('/api/agent/instructions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions: value, role: userRole }),
    });
    setInstructions(value);
  }

  async function sendMessage(quickText?: string) {
    const text = (quickText ?? input).trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    if (!quickText) setInput('');
    setLoading(true);
    setActiveTools([]);

    const history = [...messages, userMsg].map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    const assistantId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', toolsUsed: [] }]);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, role: userRole }),
      });
      if (!res.ok || !res.body) throw new Error('Falha');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const toolsUsed: string[] = [];
      let currentActive: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as StreamEvent;
            if (event.type === 'text') {
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + event.text } : m));
            } else if (event.type === 'file_attachment') {
              const att: FileAttachment = { url: event.url, filename: event.filename, label: event.label };
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, attachments: [...(m.attachments ?? []), att] } : m));
            } else if (event.type === 'tool_start') {
              currentActive = [...currentActive, event.name];
              setActiveTools([...currentActive]);
              if (!toolsUsed.includes(event.name)) toolsUsed.push(event.name);
            } else if (event.type === 'tool_done') {
              currentActive = currentActive.filter(t => t !== event.name);
              setActiveTools([...currentActive]);
            } else if (event.type === 'done') {
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, toolsUsed } : m));
              setActiveTools([]);
            } else if (event.type === 'error') {
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content || `Erro: ${event.message}` } : m));
            }
          } catch { /* ignore */ }
        }
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: 'Desculpe, ocorreu um erro. Tente novamente.' } : m));
    } finally {
      setLoading(false);
      setActiveTools([]);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function sendQuick(prompt: string) {
    void sendMessage(prompt);
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="relative flex h-full max-h-[calc(100vh-6rem)] flex-col gap-4 overflow-hidden text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_10%,rgba(123,44,255,0.18),transparent_28%),radial-gradient(circle_at_78%_16%,rgba(85,245,47,0.10),transparent_24%),linear-gradient(180deg,#050914_0%,#070b16_48%,#05070d_100%)]" />

      <div className="flex shrink-0 items-center justify-between rounded-2xl border border-white/8 bg-[#0b1020]/80 p-6 shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="flex items-center gap-5">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-primary/45 bg-primary/10 shadow-[0_0_35px_rgba(85,245,47,0.24)]">
            <Bot className="h-8 w-8 text-primary" />
            <span className="absolute inset-[-8px] rounded-full border border-primary/15" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.03em] text-white">Luna</h1>
            <p className="mt-1 text-sm text-slate-400">
              Assistente de tráfego pago <span className="mx-1 text-primary">•</span>
              <span className="font-semibold text-primary">Online</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setShowTraining(true)} className="h-12 gap-2 rounded-xl border-primary/35 bg-transparent px-7 text-sm font-bold text-white hover:bg-primary/10 hover:text-primary">
              <Settings2 className="w-4 h-4" />Treinar Luna
            </Button>
          )}
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => { setMessages([]); setActiveTools([]); }} className="h-12 gap-2 rounded-xl px-4 text-sm text-slate-400 hover:bg-white/5 hover:text-white">
              <X className="w-4 h-4" />Limpar
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section ref={messagesRef} onScroll={handleScroll} className="relative min-h-0 overflow-y-auto rounded-2xl border border-white/8 bg-[#090e1a]/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_80px_rgba(0,0,0,0.32)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(123,44,255,0.22),transparent_28%),radial-gradient(circle_at_70%_36%,rgba(85,245,47,0.12),transparent_34%)]" />
          <div className="pointer-events-none absolute inset-x-20 top-24 h-80 rounded-[50%] border border-primary/10" />
          <div className="pointer-events-none absolute inset-x-28 top-28 h-72 rounded-[50%] border border-violet-400/10" />

          <div className="relative min-h-full px-8 py-8">
            {isEmpty ? (
              <div className="flex min-h-[560px] flex-col items-center justify-center text-center">
                <div className="relative mb-8 flex h-28 w-28 items-center justify-center rounded-full border border-primary/25 bg-[#101827]/80 shadow-[0_0_60px_rgba(85,245,47,0.20)]">
                  <div className="absolute inset-5 rounded-full bg-primary/10 blur-xl" />
                  <Bot className="relative h-14 w-14 text-primary" />
                  <span className="absolute inset-[-18px] rounded-full border border-white/8" />
                </div>
                <h2 className="text-4xl font-bold tracking-[-0.04em] text-white">
                  Olá! Sou a <span className="text-primary">Luna</span>
                </h2>
                <p className="mt-4 text-xl text-slate-300">Seu copiloto de tráfego pago e gestão.</p>
                <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-400">
                  Tenho acesso ao sistema — clientes, campanhas, saldos, CRM, relatórios, pagamentos e métricas — para te ajudar a tomar decisões mais rápidas e inteligentes.
                </p>

                <div className="mt-10 grid w-full max-w-3xl gap-3 sm:grid-cols-2">
                  {[
                    { text: 'Quais clientes estão ativos?', sub: 'Veja os clientes com campanhas ativas', icon: Users, color: 'text-primary' },
                    { text: 'Gera um relatório do cliente X', sub: 'Performance, gastos e resultados', icon: FileText, color: 'text-violet-400' },
                    { text: 'Pausa a campanha Y do cliente Z', sub: 'Interrompa campanhas rapidamente', icon: Pause, color: 'text-amber-400' },
                    { text: 'Qual o CPL das campanhas ativas?', sub: 'Análise de CPL e custo por resultado', icon: Sparkles, color: 'text-primary' },
                    ...(showMoreSuggestions ? [
                      { text: 'Qual cliente tem o maior gasto hoje?', sub: 'Ranking por investimento', icon: Zap, color: 'text-amber-400' },
                      { text: 'Me mostra os leads do mês no CRM', sub: 'Resumo de leads e conversões', icon: Users, color: 'text-violet-400' },
                      { text: 'Quais campanhas estão pausadas?', sub: 'Status de campanhas inativas', icon: Play, color: 'text-sky-400' },
                      { text: 'Qual o saldo disponível das contas?', sub: 'Saldo Meta e Google Ads', icon: ShieldCheck, color: 'text-green-400' },
                    ] : []),
                  ].map(({ text, sub, icon: Icon, color }) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => sendQuick(text)}
                      className="group flex items-center gap-4 rounded-xl border border-white/10 bg-[#121827]/80 px-5 py-4 text-left transition-all hover:border-primary/25 hover:bg-[#151d2f]"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5">
                        <Icon className={cn('h-5 w-5', color)} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">{text}</span>
                        <span className="mt-1 block truncate text-xs text-slate-400">{sub}</span>
                      </span>
                      <ChevronDown className="-rotate-90 h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowMoreSuggestions(p => !p)}
                  className="mt-7 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#0c1220] px-5 py-2.5 text-sm font-medium text-slate-300 hover:border-white/20 hover:text-white transition-colors"
                >
                  {showMoreSuggestions ? 'Ver menos' : 'Ver mais sugestões'}
                  <ChevronDown className={cn('h-4 w-4 transition-transform', showMoreSuggestions && 'rotate-180')} />
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
                {activeTools.length > 0 && (
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/35 bg-primary/10">
                      <Bot className="h-[18px] w-[18px] text-primary" />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                      {activeTools.map((t, i) => (
                        <span key={i} className="inline-flex animate-pulse items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          <Wrench className="h-3 w-3" />{getToolLabel(t)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {loading && activeTools.length === 0 && (
                  <div className="flex gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/35 bg-primary/10">
                      <Bot className="h-[18px] w-[18px] text-primary" />
                    </div>
                    <div className="rounded-2xl rounded-tl-md border border-white/10 bg-[#101522] px-4 py-3">
                      <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </section>

        <aside className="hidden min-h-0 flex-col gap-4 xl:flex">
          <div className="rounded-2xl border border-violet-400/20 bg-[#0d1322]/90 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.28)]">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <Sparkles className="h-4 w-4 text-violet-400" />O que a Luna pode fazer
            </h3>
            <div className="mt-6 space-y-5">
              {[
                [FileText, 'Analisar dados e gerar insights', 'Relatórios, métricas e tendências'],
                [Zap, 'Gerenciar campanhas e orçamentos', 'Ative, pause ou ajuste campanhas'],
                [MessageSquare, 'Consultar clientes e saldos', 'Informações financeiras e status'],
                [User, 'Apoiar decisões com IA', 'Respostas rápidas e personalizadas'],
              ].map(([Icon, title, sub]) => {
                const ItemIcon = Icon as React.ElementType;
                return (
                  <div key={String(title)} className="flex gap-3">
                    <ItemIcon className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-100">{title as string}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{sub as string}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0d1322]/90 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.25)]">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <Zap className="h-4 w-4 text-primary" />Ações rápidas
            </h3>
            <div className="mt-5 space-y-3">
              {[
                ['Resumo do dia', 'O que aconteceu hoje', FileText, 'text-sky-400', 'Faz um resumo do dia: quais clientes estão com campanhas ativas, métricas principais e o que está chamando atenção agora.'],
                ['Top campanhas', 'Melhores desempenhos', Sparkles, 'text-amber-400', 'Quais são as campanhas com melhor desempenho hoje? Me mostra o ranking por CPL e volume de leads.'],
                ['Alertas e oportunidades', 'Pontos de atenção', Users, 'text-violet-400', 'Analisa os dados dos clientes e me diz quais alertas e oportunidades de melhoria existem agora.'],
              ].map(([title, sub, Icon, color, prompt]) => {
                const ItemIcon = Icon as React.ElementType;
                return (
                  <button key={String(title)} type="button" onClick={() => sendQuick(String(prompt))} className="group flex w-full items-center gap-3 rounded-xl bg-white/[0.035] px-4 py-3 text-left hover:bg-white/[0.06] transition-colors">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5">
                      <ItemIcon className={cn('h-4 w-4', color as string)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-100">{title as string}</span>
                      <span className="block text-xs text-slate-500">{sub as string}</span>
                    </span>
                    <ChevronDown className="-rotate-90 h-4 w-4 text-slate-500 group-hover:text-primary" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0d1322]/90 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Contexto do sistema</h3>
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {systemContext ? 'Atualizado agora' : 'Carregando...'}
              </span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/8 pt-4">
              <div>
                <p className="text-[11px] text-slate-500">Clientes ativos</p>
                <p className="mt-1 text-sm font-bold text-white">
                  {systemContext ? systemContext.clients : <span className="text-slate-500">—</span>}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Conversas hoje</p>
                <p className="mt-1 text-sm font-bold text-white">{messages.length > 0 ? '1' : '—'}</p>
              </div>
            </div>
            <p className="mt-5 flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="h-4 w-4 text-primary/70" />Seus dados estão protegidos e seguros.
            </p>
          </div>
        </aside>
      </div>

      <div className="mx-0 shrink-0 rounded-2xl border border-primary/35 bg-[#0a1020]/95 px-4 py-3 shadow-[0_0_0_1px_rgba(123,44,255,0.35),0_18px_58px_rgba(85,245,47,0.10)] xl:mr-[396px]">
        <div className="flex items-center gap-3">
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-primary',
                listening && 'animate-pulse border-red-400/40 bg-red-500/10 text-red-400'
              )}
              title={listening ? 'Parar gravação' : 'Gravar áudio'}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={listening ? 'Ouvindo...' : 'Pergunte sobre clientes, campanhas, métricas...'}
            rows={1}
            disabled={loading}
            className="max-h-20 min-h-11 flex-1 resize-none bg-transparent px-3 py-3 text-base leading-5 text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <span className="hidden text-xs text-slate-500 lg:block">Enter para enviar • Shift+Enter para nova linha</span>
          <button
            type="button"
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary transition-all hover:bg-primary/15 disabled:opacity-45"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <p className="shrink-0 text-center text-xs text-slate-500">
        Luna pode cometer erros. Sempre confira as informações importantes.
      </p>

      {showTraining && isAdmin && (
        <TrainingModal
          onClose={() => setShowTraining(false)}
          userRole={userRole}
          instructions={instructions}
          onSaveInstructions={saveInstructions}
        />
      )}
    </div>
  );
}
