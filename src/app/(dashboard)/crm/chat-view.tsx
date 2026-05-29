'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Search, MessageCircle, RefreshCw, Send } from 'lucide-react';

type InboxLead = {
  id: string;
  nome: string | null;
  numero: string | null;
  canal: string | null;
  origin: string | null;
  status: string | null;
  fechou: boolean;
  last_message: string | null;
  last_direction: 'in' | 'out' | null;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
};

type CrmMessage = {
  id: string;
  direction: 'in' | 'out';
  text: string;
  created_at: string;
};

const CANAL_COLORS: Record<string, string> = {
  Facebook:   'bg-blue-500',
  Google:     'bg-red-500',
  Instagram:  'bg-pink-600',
  TikTok:     'bg-zinc-800',
  YouTube:    'bg-red-600',
  Indicação:  'bg-violet-600',
  Whatsapp:   'bg-emerald-500',
  WhatsApp:   'bg-emerald-500',
};

function ChannelDot({ canal }: { canal: string | null }) {
  const bg = CANAL_COLORS[canal ?? ''] ?? 'bg-zinc-500';
  const label = canal?.slice(0, 2).toUpperCase() ?? '?';
  return (
    <span className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-black text-white', bg)}>
      {label}
    </span>
  );
}

function StatusDot({ status }: { status: string | null }) {
  const active = status === 'Em Atendimento' || status === 'Agendado' || status === 'Reagendado';
  return (
    <span className={cn('h-2 w-2 rounded-full shrink-0', active ? 'bg-sky-400' : 'bg-zinc-600')} />
  );
}

function timeFmt(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function ChatView({ clientId }: { clientId: string }) {
  const [leads, setLeads] = useState<InboxLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CrmMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedLead = leads.find(l => l.id === selectedId) ?? null;

  const loadInbox = useCallback(() => {
    fetch(`/api/crm/inbox?clientId=${clientId}`)
      .then(r => r.json())
      .then((rows: InboxLead[]) => {
        setLeads(Array.isArray(rows) ? rows : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [clientId]);

  const loadMessages = useCallback((leadId: string) => {
    setMsgLoading(true);
    fetch(`/api/crm/${leadId}/messages`)
      .then(r => r.json())
      .then((d: { messages: CrmMessage[] }) => {
        setMessages(d.messages ?? []);
        setMsgLoading(false);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      })
      .catch(() => setMsgLoading(false));
  }, []);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  useEffect(() => {
    if (!selectedId) return;
    loadMessages(selectedId);
    pollRef.current = setInterval(() => loadMessages(selectedId), 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedId, loadMessages]);

  async function sendNote() {
    if (!replyText.trim() || !selectedId) return;
    setSending(true);
    const text = replyText.trim();
    setReplyText('');
    try {
      await fetch(`/api/crm/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, direction: 'out' }),
      });
      loadMessages(selectedId);
      loadInbox();
    } finally {
      setSending(false);
    }
  }

  const filtered = leads.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (l.nome ?? '').toLowerCase().includes(q) || (l.numero ?? '').includes(q);
  });

  return (
    <div className="flex h-full min-h-0 gap-0 rounded-xl border border-border overflow-hidden" style={{ minHeight: 500 }}>
      {/* ── Left: Inbox list ── */}
      <div className="flex flex-col w-[320px] shrink-0 border-r border-border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">Inbox</span>
            {leads.length > 0 && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{leads.length}</span>
            )}
          </div>
          <button onClick={loadInbox} className="text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar contato..."
              className="w-full rounded-lg border border-border bg-background pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Lead list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-xs text-muted-foreground text-center">Carregando…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground text-center italic">Nenhuma conversa</div>
          ) : (
            filtered.map(lead => (
              <button
                key={lead.id}
                onClick={() => setSelectedId(lead.id)}
                className={cn(
                  'w-full flex items-start gap-3 px-4 py-3 text-left border-b border-border/40 hover:bg-muted/30 transition-colors',
                  selectedId === lead.id && 'bg-primary/10 border-l-2 border-l-primary',
                )}
              >
                {/* Avatar placeholder */}
                <div className="h-9 w-9 shrink-0 rounded-full bg-muted/60 flex items-center justify-center relative">
                  <span className="text-xs font-bold text-muted-foreground">
                    {(lead.nome ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                  <div className="absolute -bottom-0.5 -right-0.5">
                    <ChannelDot canal={lead.canal} />
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <StatusDot status={lead.status} />
                      <span className="text-xs font-semibold truncate">{lead.nome ?? lead.numero ?? '—'}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeFmt(lead.last_message_at ?? lead.created_at)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {lead.last_direction === 'out' && <span className="text-primary/70">Você: </span>}
                    {lead.last_message ?? 'Nenhuma mensagem'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    {lead.status && (
                      <span className="text-[9px] font-bold text-muted-foreground/60">{lead.status}</span>
                    )}
                    {Number(lead.unread_count) > 0 && (
                      <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-black">
                        {lead.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right: Conversation ── */}
      <div className="flex flex-col flex-1 min-w-0 bg-background/50">
        {!selectedLead ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center space-y-2">
              <MessageCircle className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">Selecione uma conversa</p>
            </div>
          </div>
        ) : (
          <>
            {/* Conversation header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
              <div className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center">
                <span className="text-xs font-bold">{(selectedLead.nome ?? '?').slice(0, 1).toUpperCase()}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold truncate">{selectedLead.nome ?? selectedLead.numero ?? '—'}</p>
                  <ChannelDot canal={selectedLead.canal} />
                </div>
                {selectedLead.numero && <p className="text-[11px] text-muted-foreground">{selectedLead.numero}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selectedLead.status && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-muted/50 text-muted-foreground">{selectedLead.status}</span>
                )}
                {selectedLead.fechou && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400">Fechou</span>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
              {msgLoading && messages.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground">Carregando…</div>
              ) : messages.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground italic">Nenhuma mensagem ainda.</div>
              ) : (
                messages.map(m => (
                  <div key={m.id} className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[75%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed',
                      m.direction === 'out'
                        ? 'bg-primary/20 text-foreground rounded-br-sm'
                        : 'bg-card border border-border text-foreground rounded-bl-sm',
                    )}>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      <p className="mt-1 text-[10px] opacity-50 text-right">
                        {new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply box */}
            <div className="flex items-end gap-2 px-4 py-3 border-t border-border bg-card shrink-0">
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendNote(); } }}
                placeholder="Escrever nota ou mensagem… (Enter para enviar)"
                rows={2}
                className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={() => void sendNote()}
                disabled={!replyText.trim() || sending}
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
