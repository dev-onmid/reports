"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { getAuthSession } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import {
  Send, Bot, User, Loader2, Settings2, Save, X, ChevronDown,
  Wrench, Mic, MicOff, Plus, Trash2, FileText, Link2, Type,
  Webhook, MessageSquare, BookOpen, Zap, Upload, Globe, CheckCircle,
  ToggleLeft, ToggleRight, Play, Pause, Download,
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
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      )}
      <div className={cn('max-w-[75%] flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
        {msg.toolsUsed && msg.toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-0.5">
            {[...new Set(msg.toolsUsed)].map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                <Wrench className="w-2.5 h-2.5" />{getToolLabel(t)}
              </span>
            ))}
          </div>
        )}
        <div className={cn(
          'px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
          isUser ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-card border border-border text-foreground rounded-tl-sm'
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
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-primary/5 hover:border-primary/30 transition-all group w-full"
              >
                <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{att.label}</p>
                  <p className="text-xs text-muted-foreground">{att.filename}</p>
                </div>
                <Download className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              </a>
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center">
          <User className="w-4 h-4 text-muted-foreground" />
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
    <div className="flex flex-col h-full max-h-[calc(100vh-6rem)] relative">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-primary/20 border-2 border-primary/40 flex items-center justify-center shadow-[0_0_12px_rgba(85,245,47,0.3)]">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Luna</h1>
            <p className="text-xs text-muted-foreground">Assistente de tráfego pago · Online</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setShowTraining(true)} className="gap-2 text-xs">
              <Settings2 className="w-3.5 h-3.5" />Treinar Luna
            </Button>
          )}
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => { setMessages([]); setActiveTools([]); }} className="gap-2 text-xs text-muted-foreground">
              <X className="w-3.5 h-3.5" />Limpar
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesRef} onScroll={handleScroll} className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center py-12">
            <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center shadow-[0_0_30px_rgba(85,245,47,0.15)]">
              <Bot className="w-10 h-10 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">Olá! Sou a Luna</h2>
              <p className="text-sm text-muted-foreground max-w-md">
                Tenho acesso total ao sistema — clientes, campanhas, saldos, CRM. Posso pausar campanhas, gerar relatórios e muito mais.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
              {[
                'Quais clientes estão ativos?',
                'Gera um relatório do cliente X este mês',
                'Pausa a campanha Y do cliente Z',
                'Qual o CPL das campanhas ativas?',
              ].map(s => (
                <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="text-xs text-left px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-primary/5 hover:border-primary/30 text-muted-foreground hover:text-foreground transition-all">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
        {activeTools.length > 0 && (
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-wrap gap-1.5 items-center pt-1.5">
              {activeTools.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 animate-pulse">
                  <Wrench className="w-3 h-3" />{getToolLabel(t)}
                </span>
              ))}
            </div>
          </div>
        )}
        {loading && activeTools.length === 0 && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {scrolledUp && (
        <button onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setScrolledUp(false); }}
          className="absolute bottom-20 right-4 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:opacity-90 transition-opacity">
          <ChevronDown className="w-4 h-4" />
        </button>
      )}

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border pt-4">
        <div className="flex gap-2 items-end">
          {voiceSupported && (
            <Button
              variant={listening ? 'default' : 'outline'}
              size="icon"
              onClick={toggleVoice}
              className={cn('h-10 w-10 rounded-xl shrink-0 transition-all', listening && 'animate-pulse bg-red-500 hover:bg-red-600 border-red-500')}
              title={listening ? 'Parar gravação' : 'Gravar áudio'}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={listening ? '🔴 Ouvindo...' : 'Pergunte sobre clientes, campanhas, métricas...'}
            rows={1}
            disabled={loading}
            className={cn(
              'flex-1 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50',
              'max-h-32 overflow-y-auto disabled:opacity-50 disabled:cursor-not-allowed',
              listening && 'border-red-400/50 ring-1 ring-red-400/30',
            )}
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <Button onClick={sendMessage} disabled={!input.trim() || loading} size="icon" className="h-10 w-10 rounded-xl shrink-0">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          Enter para enviar · Shift+Enter para nova linha{voiceSupported ? ' · Microfone para voz' : ''}
        </p>
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
