"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { getAuthSession } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { Send, Bot, User, Loader2, Settings2, Save, X, ChevronDown, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Role = string | undefined;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
};

type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_done'; name: string }
  | { type: 'done'; role?: string }
  | { type: 'error'; message: string };

const TOOL_LABELS: Record<string, string> = {
  list_clients: 'listando clientes',
  get_client_accounts: 'buscando contas de anúncios',
  get_crm_data: 'consultando CRM',
  get_meta_campaigns: 'analisando campanhas Meta Ads',
  get_google_campaigns: 'analisando campanhas Google Ads',
  get_account_balances: 'verificando saldos',
};

function ToolBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 animate-pulse">
      <Wrench className="w-3 h-3" />
      {TOOL_LABELS[name] ?? name}
    </span>
  );
}

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
          <div className="flex flex-wrap gap-1 mb-1">
            {msg.toolsUsed.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                <Wrench className="w-2.5 h-2.5" />
                {TOOL_LABELS[t] ?? t}
              </span>
            ))}
          </div>
        )}
        <div className={cn(
          'px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-card border border-border text-foreground rounded-tl-sm'
        )}>
          {msg.content}
        </div>
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center">
          <User className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

export default function AgentePage() {
  const session = getAuthSession();
  const userRole: Role = session?.role;
  const isAdmin = userRole === 'Administrador';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [instructionsLoading, setInstructionsLoading] = useState(false);
  const [scrolledUp, setScrolledUp] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load instructions
  useEffect(() => {
    setInstructionsLoading(true);
    fetch('/api/agent/instructions')
      .then(r => r.json())
      .then((d: { instructions: string }) => {
        setInstructions(d.instructions);
        setInstructionsDraft(d.instructions);
      })
      .catch(() => {})
      .finally(() => setInstructionsLoading(false));
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (!scrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, scrolledUp]);

  const handleScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
    setScrolledUp(!atBottom);
  }, []);

  async function saveInstructions() {
    setSavingInstructions(true);
    try {
      const res = await fetch('/api/agent/instructions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: instructionsDraft, role: userRole }),
      });
      if (res.ok) {
        setInstructions(instructionsDraft);
        setShowInstructions(false);
      }
    } catch { /* ignore */ }
    finally { setSavingInstructions(false); }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setActiveTools([]);

    // Build history for API
    const history = [...messages, userMsg].map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const assistantId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', toolsUsed: [] }]);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, role: userRole }),
      });

      if (!res.ok || !res.body) throw new Error('Falha na conexão');

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
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + event.text } : m
              ));
            } else if (event.type === 'tool_start') {
              currentActive = [...currentActive, event.name];
              setActiveTools([...currentActive]);
              if (!toolsUsed.includes(event.name)) toolsUsed.push(event.name);
            } else if (event.type === 'tool_done') {
              currentActive = currentActive.filter(t => t !== event.name);
              setActiveTools([...currentActive]);
            } else if (event.type === 'done') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, toolsUsed } : m
              ));
              setActiveTools([]);
            } else if (event.type === 'error') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content || `Erro: ${event.message}` } : m
              ));
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: `Desculpe, ocorreu um erro. Por favor tente novamente.` } : m
      ));
    } finally {
      setLoading(false);
      setActiveTools([]);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setInstructionsDraft(instructions); setShowInstructions(true); }}
              className="gap-2 text-xs"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Treinar Luna
            </Button>
          )}
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setMessages([]); setActiveTools([]); }}
              className="gap-2 text-xs text-muted-foreground"
            >
              <X className="w-3.5 h-3.5" />
              Limpar
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1"
      >
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center py-12">
            <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center shadow-[0_0_30px_rgba(85,245,47,0.15)]">
              <Bot className="w-10 h-10 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">Olá! Sou a Luna</h2>
              <p className="text-sm text-muted-foreground max-w-md">
                Sua assistente de tráfego pago. Tenho acesso a todos os dados do sistema — clientes, campanhas, saldos, métricas e CRM.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
              {[
                'Quais clientes estão ativos?',
                'Como estão as campanhas do cliente X este mês?',
                'Qual o saldo das contas Meta do cliente Y?',
                'Me mostra o CPL das campanhas ativas',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                  className="text-xs text-left px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-primary/5 hover:border-primary/30 text-muted-foreground hover:text-foreground transition-all"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {/* Active tool indicators */}
        {activeTools.length > 0 && (
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-wrap gap-1.5 items-center pt-1.5">
              {activeTools.map((t, i) => <ToolBadge key={i} name={t} />)}
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

      {/* Scroll to bottom button */}
      {scrolledUp && (
        <button
          onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setScrolledUp(false); }}
          className="absolute bottom-20 right-4 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:opacity-90 transition-opacity"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      )}

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border pt-4">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre clientes, campanhas, métricas..."
            rows={1}
            disabled={loading}
            className={cn(
              'flex-1 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50',
              'max-h-32 overflow-y-auto disabled:opacity-50 disabled:cursor-not-allowed transition-all',
            )}
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            size="icon"
            className="h-10 w-10 rounded-xl shrink-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          Enter para enviar · Shift+Enter para quebra de linha
        </p>
      </div>

      {/* Instructions modal */}
      {showInstructions && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-background rounded-2xl border border-border shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Settings2 className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-foreground">Treinar Luna</h2>
                  <p className="text-xs text-muted-foreground">Edite as instruções e personalidade da Luna</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowInstructions(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              {instructionsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <textarea
                  value={instructionsDraft}
                  onChange={(e) => setInstructionsDraft(e.target.value)}
                  className="w-full h-64 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                  placeholder="Insira as instruções para a Luna..."
                />
              )}
              <p className="text-xs text-muted-foreground mt-3">
                Defina a personalidade, tom de voz e comportamento da Luna. Estas instruções ficam ativas em todas as conversas.
              </p>
            </div>
            <div className="flex justify-end gap-2 p-6 border-t border-border">
              <Button variant="outline" onClick={() => setShowInstructions(false)}>Cancelar</Button>
              <Button onClick={saveInstructions} disabled={savingInstructions} className="gap-2">
                {savingInstructions ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
