"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { getAuthSession } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import {
  Send, Bot, User, Loader2, Settings2, Save, X, ChevronDown,
  Wrench, Mic, MicOff, Plus, Trash2, FileText, Link2, Type,
  Webhook, MessageSquare, BookOpen, Zap, Upload, Globe, CheckCircle,
  ToggleLeft, ToggleRight, Play, Pause, Download, ArrowRight, Clock3,
  MapPin, Sparkles, ShieldCheck, SlidersHorizontal,
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
    <div className={cn('flex gap-4', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-[#66cdd0]/45 bg-white shadow-[0_10px_28px_rgba(0,109,103,0.18)]">
          <Bot className="h-5 w-5 text-[#006d67]" />
        </div>
      )}
      <div className={cn('flex max-w-[78%] flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
        {msg.toolsUsed && msg.toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-0.5">
            {[...new Set(msg.toolsUsed)].map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-[#66cdd0]/35 bg-[#e8f7f7] px-2.5 py-1 text-[10px] font-bold text-[#006d67]">
                <Wrench className="w-2.5 h-2.5" />{getToolLabel(t)}
              </span>
            ))}
          </div>
        )}
        <div className={cn(
          'whitespace-pre-wrap rounded-[26px] px-5 py-4 text-sm font-semibold leading-relaxed shadow-[0_16px_34px_rgba(0,0,0,0.10)]',
          isUser
            ? 'rounded-tr-md bg-[#cc4700] text-white'
            : 'rounded-tl-md border border-[#e8edf4] bg-[#f6f8fd] text-[#006d67]'
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
                className="group flex w-full items-center gap-3 rounded-2xl border border-[#e8edf4] bg-white px-4 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.08)] transition-all hover:border-[#66cdd0]/70 hover:bg-[#f6fbfb]"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fff0e7]">
                  <FileText className="h-4 w-4 text-[#f97316]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-bold text-[#006d67]">{att.label}</p>
                  <p className="text-xs font-semibold text-[#8a8f99]">{att.filename}</p>
                </div>
                <Download className="h-4 w-4 shrink-0 text-[#8a8f99] transition-colors group-hover:text-[#006d67]" />
              </a>
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-[#ffb392] bg-[#fff0e7]">
          <User className="h-5 w-5 text-[#cc4700]" />
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

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
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

  const isEmpty = messages.length === 0;

  return (
    <div className="-m-6 flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-[#fbfcfd] text-[#0f2233]">
      {/* Header */}
      <div className="flex h-28 shrink-0 items-center justify-between gap-4 border-b border-[#eef1f6] bg-white px-5 shadow-[0_8px_24px_rgba(15,34,51,0.06)] lg:px-14">
        <div className="flex min-w-0 items-center gap-6 xl:gap-11">
          <div className="leading-none">
            <div className="text-[38px] font-black tracking-[-0.06em] text-[#f97316]">luna</div>
            <div className="-mt-1 ml-12 inline-flex rounded-sm bg-[#66cdd0] px-2 py-0.5 text-[11px] font-black tracking-[-0.03em] text-white">IA</div>
          </div>
          <nav className="hidden items-center gap-8 text-xl font-black tracking-[-0.04em] text-[#13263a] xl:flex">
            <span>Sobre</span>
            <span>Ajuda</span>
            <span>Campanhas</span>
            <span>Relatórios</span>
            <span>CRM</span>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowTraining(true)}
              className="h-14 rounded-md bg-[#cc4700] px-4 text-sm font-black tracking-[-0.04em] text-white shadow-[0_10px_24px_rgba(204,71,0,0.22)] transition-transform hover:-translate-y-0.5 sm:h-16 sm:px-9 sm:text-xl"
            >
              Treinar Luna
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => { setMessages([]); setActiveTools([]); }}
              className="hidden h-16 items-center gap-2 rounded-md border border-[#ffb392] bg-[#fff3ec] px-8 text-xl font-black tracking-[-0.04em] text-[#a9430c] sm:flex"
            >
              <X className="h-5 w-5" /> Limpar
            </button>
          )}
        </div>
      </div>

      <div className="mx-4 mt-6 shrink-0 overflow-hidden rounded-b-2xl rounded-t-sm bg-[#006d67] shadow-[0_18px_36px_rgba(0,109,103,0.16)] lg:mx-12">
        <div className="flex h-20 items-center justify-between px-5 lg:px-10">
          <div className="flex items-center gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#66cdd0] shadow-[0_10px_22px_rgba(0,0,0,0.14)]">
              <Bot className="h-8 w-8 text-white" />
            </div>
            <div>
              <p className="text-[15px] font-black uppercase tracking-[0.18em] text-[#9fe5e6]">Assistente inteligente Onmid</p>
              <h1 className="text-xl font-black tracking-[-0.05em] text-white lg:text-3xl">Fale com a Luna IA para acelerar decisões de marketing</h1>
            </div>
          </div>
          <div className="hidden rounded-full bg-[#cc4700] px-9 py-4 text-lg font-black tracking-[-0.04em] text-white lg:block">
            Online agora
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between px-4 py-6 lg:px-12 lg:py-8">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f97316] text-white">
              <ArrowRight className="h-6 w-6" />
            </span>
            <h2 className="text-2xl font-light tracking-[-0.05em] text-[#66cdd0] lg:text-3xl">
              Conversa com <strong className="font-black text-[#66cdd0]">Luna IA</strong>
            </h2>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-5 text-base font-black tracking-[-0.04em] text-[#006d67] lg:gap-12 lg:text-lg">
            <span className="flex items-center gap-2"><SlidersHorizontal className="h-5 w-5 text-[#66cdd0]" /> Filtrar contexto</span>
            <span className="flex items-center gap-2">Ordenar por <ChevronDown className="h-5 w-5 text-[#66cdd0]" /></span>
          </div>
        </div>
        <div className="hidden items-center gap-8 xl:flex">
          {[
            ['Hoje', 'a partir de', 'respostas rápidas'],
            ['Relatórios', 'a partir de', 'PDF + insights'],
            ['Campanhas', 'a partir de', 'ações em tempo real'],
          ].map(([day, sub, value], index) => (
            <div key={day} className={cn(
              'min-w-52 rounded-3xl px-8 py-5 text-center',
              index === 1 ? 'bg-white shadow-[0_16px_28px_rgba(15,34,51,0.14)]' : 'bg-transparent'
            )}>
              <p className="text-2xl font-black tracking-[-0.05em] text-[#006d67]">{day}</p>
              <p className="text-sm font-black text-[#66cdd0]">{sub}</p>
              <p className="text-xl font-black tracking-[-0.04em] text-[#66cdd0]">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-4 mb-8 grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-[28px] bg-white shadow-[0_12px_32px_rgba(15,34,51,0.18)] lg:mx-12 lg:grid-cols-[450px_minmax(0,1fr)]">
        <aside className="hidden flex-col bg-[#f4f6fb] lg:flex">
          <div className="border-b border-white px-9 py-5 text-center">
            <p className="text-xl font-black tracking-[-0.04em] text-[#66cdd0]">Sua Luna pode ajudar entre:</p>
            <div className="mt-4 flex items-center justify-center gap-8 text-[#006d67]">
              <span className="flex items-center gap-1 text-3xl font-black tracking-[-0.05em]"><Clock3 className="h-7 w-7" />Agora</span>
              <span className="text-2xl font-black">e</span>
              <span className="flex items-center gap-1 text-3xl font-black tracking-[-0.05em]"><Clock3 className="h-7 w-7" />Sempre</span>
            </div>
          </div>
          <div className="flex-1 px-10 py-8">
            <p className="text-lg font-black tracking-[-0.04em] text-[#888]">Previsão de <span className="text-[#006d67]">resposta em segundos</span></p>
            <div className="mt-8 space-y-9">
              {[
                [MapPin, 'Origem', 'ONMID Reports'],
                [Sparkles, 'Destino', 'Insights, CRM, campanhas e relatórios'],
                [ShieldCheck, 'Seguro', 'Ações protegidas por contexto'],
              ].map(([Icon, label, text]) => {
                const ItemIcon = Icon as React.ElementType;
                return (
                  <div key={String(label)} className="flex gap-4">
                    <ItemIcon className="mt-1 h-7 w-7 shrink-0 text-[#006d67]" />
                    <div>
                      <p className="text-lg font-black tracking-[-0.04em] text-[#66cdd0]">{label as string}</p>
                      <p className="text-2xl font-black leading-tight tracking-[-0.05em] text-[#006d67]">{text as string}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-col bg-white">
          <div ref={messagesRef} onScroll={handleScroll} className="min-h-0 flex-1 space-y-8 overflow-y-auto px-10 py-10">
            {isEmpty && (
              <div className="grid gap-12 lg:grid-cols-[1fr_0.95fr]">
                <div className="flex items-start gap-8">
                  <div className="mt-2 text-[#66cdd0]">
                    <Bot className="h-14 w-14 stroke-[1.5]" />
                  </div>
                  <div>
                    <h2 className="text-4xl font-black tracking-[-0.06em] text-[#006d67]">Luna IA</h2>
                    <button className="mt-5 flex items-center gap-2 text-xl font-black tracking-[-0.05em] text-[#66cdd0] underline decoration-[#66cdd0]/70 underline-offset-4">
                      <ArrowRight className="h-5 w-5 text-[#f97316]" />Comodidades
                    </button>
                  </div>
                </div>
                <div className="rounded-[26px] bg-[#f4f6fb] p-7 shadow-[0_18px_30px_rgba(15,34,51,0.18)]">
                  <div className="mb-4 inline-flex rounded-md bg-[#66cdd0] px-4 py-2 text-sm font-black uppercase text-white">Melhor resposta do dia</div>
                  <p className="text-2xl font-black tracking-[-0.05em] text-[#66cdd0]">Apenas pergunte</p>
                  <p className="mt-1 text-4xl font-black tracking-[-0.06em] text-[#006d67]">“Como estão minhas campanhas?”</p>
                  <p className="mt-4 text-lg font-black tracking-[-0.04em] text-[#f97316]">Você economizará tempo de análise</p>
                </div>
                <div className="lg:col-span-2">
                  <div className="h-px bg-[#d6d6d6]" />
                </div>
                {[
                  'Quais clientes estão ativos?',
                  'Gera um relatório do cliente X este mês',
                  'Pausa a campanha Y do cliente Z',
                  'Qual o CPL das campanhas ativas?',
                ].map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    className="rounded-[26px] bg-[#f4f6fb] px-7 py-6 text-left text-2xl font-black tracking-[-0.05em] text-[#006d67] shadow-[0_14px_26px_rgba(15,34,51,0.12)] transition-transform hover:-translate-y-0.5"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
            {activeTools.length > 0 && (
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#66cdd0]/45 bg-white">
                  <Bot className="h-5 w-5 text-[#006d67]" />
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1.5">
                  {activeTools.map((t, i) => (
                    <span key={i} className="inline-flex animate-pulse items-center gap-1 rounded-full border border-[#66cdd0]/35 bg-[#e8f7f7] px-3 py-1 text-xs font-black text-[#006d67]">
                      <Wrench className="h-3 w-3" />{getToolLabel(t)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {loading && activeTools.length === 0 && (
              <div className="flex gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#66cdd0]/45 bg-white">
                  <Bot className="h-5 w-5 text-[#006d67]" />
                </div>
                <div className="rounded-[26px] rounded-tl-md border border-[#e8edf4] bg-[#f6f8fd] px-5 py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-[#006d67]" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {scrolledUp && (
            <button onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setScrolledUp(false); }}
              className="absolute bottom-24 right-8 flex h-10 w-10 items-center justify-center rounded-full bg-[#f97316] text-white shadow-lg transition-opacity hover:opacity-90">
              <ChevronDown className="h-5 w-5" />
            </button>
          )}

          <div className="shrink-0 border-t border-[#e6e6e6] bg-white px-10 py-6">
            <div className="flex items-end gap-3 rounded-[26px] bg-[#f4f6fb] p-4 shadow-[0_14px_26px_rgba(15,34,51,0.12)]">
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  className={cn(
                    'flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#66cdd0]/45 bg-white text-[#006d67]',
                    listening && 'animate-pulse border-red-300 bg-red-50 text-red-500'
                  )}
                  title={listening ? 'Parar gravação' : 'Gravar áudio'}
                >
                  {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
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
                className={cn(
                  'max-h-32 min-h-14 flex-1 resize-none bg-transparent px-3 py-4 text-lg font-bold tracking-[-0.03em] text-[#006d67] outline-none',
                  'placeholder:text-[#66cdd0]/80 disabled:cursor-not-allowed disabled:opacity-50',
                )}
                style={{ fieldSizing: 'content' } as React.CSSProperties}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="flex h-14 w-28 shrink-0 items-center justify-center rounded-full bg-[#cc4700] text-white shadow-[0_10px_22px_rgba(204,71,0,0.24)] transition-opacity disabled:opacity-45"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-[#9aa3ad]">
              Enter para enviar · Shift+Enter para nova linha{voiceSupported ? ' · Microfone para voz' : ''}
            </p>
          </div>
        </main>
      </div>

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
