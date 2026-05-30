'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Search, MessageCircle, RefreshCw, Send, Paperclip,
  Image, Mic, Video, FileText, MapPin, X, CheckCircle2,
  AlertCircle, History,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  tipo: string;
  created_at: string;
};

type MediaType = 'imagem' | 'audio' | 'video' | 'documento' | 'localizacao';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CANAL_COLORS: Record<string, string> = {
  Facebook: 'bg-blue-500', Google: 'bg-red-500', Instagram: 'bg-pink-600',
  TikTok: 'bg-zinc-800', YouTube: 'bg-red-600', Indicação: 'bg-violet-600',
  Whatsapp: 'bg-emerald-500', WhatsApp: 'bg-emerald-500',
};

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

function isImageUrl(url: string) {
  return /\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(url);
}
function isAudioUrl(url: string) {
  return /\.(mp3|ogg|wav|m4a|opus)(\?.*)?$/i.test(url);
}
function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov|avi)(\?.*)?$/i.test(url);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChannelDot({ canal }: { canal: string | null }) {
  const bg = CANAL_COLORS[canal ?? ''] ?? 'bg-zinc-500';
  return (
    <span className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-black text-white', bg)}>
      {(canal ?? '?').slice(0, 2).toUpperCase()}
    </span>
  );
}

function StatusDot({ status }: { status: string | null }) {
  const active = status === 'Em Atendimento' || status === 'Agendado' || status === 'Reagendado';
  return <span className={cn('h-2 w-2 rounded-full shrink-0', active ? 'bg-sky-400' : 'bg-zinc-600')} />;
}

function MessageBubble({ msg }: { msg: CrmMessage }) {
  const isOut = msg.direction === 'out';
  const time = new Date(msg.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const content = (() => {
    const t = msg.tipo ?? 'texto';
    const text = msg.text;

    if (t === 'localizacao') {
      return (
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-emerald-400" />
          <span className="text-xs">{text}</span>
        </div>
      );
    }
    if (t === 'imagem' || (t === 'texto' && isImageUrl(text))) {
      return (
        <div className="space-y-1.5">
          <img src={text} alt="Imagem" className="max-w-full rounded-xl object-cover max-h-56" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <p className="text-xs text-muted-foreground break-all opacity-70">{text}</p>
        </div>
      );
    }
    if (t === 'audio' || (t === 'texto' && isAudioUrl(text))) {
      return <audio controls src={text} className="max-w-full h-10" />;
    }
    if (t === 'video' || (t === 'texto' && isVideoUrl(text))) {
      return <video controls src={text} className="max-w-full max-h-48 rounded-xl" />;
    }
    if (t === 'documento') {
      return (
        <a href={text} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs hover:bg-muted/50 transition-colors">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <span className="truncate">{text.split('/').pop() ?? 'Documento'}</span>
        </a>
      );
    }
    return <p className="text-sm whitespace-pre-wrap break-words">{text}</p>;
  })();

  return (
    <div className={cn('flex', isOut ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[72%] rounded-2xl px-3.5 py-2.5 shadow-sm',
        isOut
          ? 'bg-primary/25 text-foreground rounded-br-sm'
          : 'bg-card border border-border text-foreground rounded-bl-sm',
      )}>
        {content}
        <p className="mt-1 text-[10px] opacity-50 text-right select-none">{time}</p>
      </div>
    </div>
  );
}

// ── Media attachment modal ────────────────────────────────────────────────────

function MediaModal({
  tipo,
  onSend,
  onClose,
}: {
  tipo: MediaType;
  onSend: (payload: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [url,    setUrl]    = useState('');
  const [caption, setCaption] = useState('');
  const [lat,    setLat]    = useState('');
  const [lng,    setLng]    = useState('');
  const [name,   setName]   = useState('');
  const [sending, setSending] = useState(false);

  const labels: Record<MediaType, string> = {
    imagem: 'Imagem', audio: 'Áudio (voz)', video: 'Vídeo', documento: 'Documento', localizacao: 'Localização',
  };
  const icons: Record<MediaType, React.ReactNode> = {
    imagem: <Image className="h-4 w-4" />,
    audio: <Mic className="h-4 w-4" />,
    video: <Video className="h-4 w-4" />,
    documento: <FileText className="h-4 w-4" />,
    localizacao: <MapPin className="h-4 w-4" />,
  };

  async function handleSend() {
    setSending(true);
    if (tipo === 'localizacao') {
      await onSend({ tipo, lat: parseFloat(lat), lng: parseFloat(lng), location_name: name });
    } else {
      await onSend({ tipo, url: url.trim(), caption: caption.trim() });
    }
    setSending(false);
  }

  const isLocation = tipo === 'localizacao';
  const canSend = isLocation ? (lat && lng) : url.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-card rounded-2xl border border-border shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-bold">
            {icons[tipo]} {labels[tipo]}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-4 py-4 space-y-3">
          {isLocation ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Latitude</span>
                  <input value={lat} onChange={e => setLat(e.target.value)} placeholder="-23.5505"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Longitude</span>
                  <input value={lng} onChange={e => setLng(e.target.value)} placeholder="-46.6333"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nome do local (opcional)</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Nosso consultório"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
              </label>
            </>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">URL do arquivo</span>
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
              </label>
              {(tipo === 'imagem' || tipo === 'video') && (
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Legenda (opcional)</span>
                  <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Legenda da mídia"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </label>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancelar</button>
          <button onClick={handleSend} disabled={sending || !canSend}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <Send className="h-3.5 w-3.5" /> {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ChatView ─────────────────────────────────────────────────────────────

export function ChatView({ clientId }: { clientId: string }) {
  const [leads,      setLeads]      = useState<InboxLead[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages,   setMessages]   = useState<CrmMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [replyText,  setReplyText]  = useState('');
  const [sending,    setSending]    = useState(false);
  const [sendStatus, setSendStatus] = useState<'ok' | 'err' | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  const [mediaModal, setMediaModal] = useState<MediaType | null>(null);
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const pollRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef     = useRef<HTMLTextAreaElement>(null);

  const selectedLead = leads.find(l => l.id === selectedId) ?? null;

  // ── Scroll helpers ──────────────────────────────────────────────────────────
  function isNearBottom() {
    const el = messagesAreaRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }
  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    const el = messagesAreaRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }

  // ── Data loading ────────────────────────────────────────────────────────────
  const loadInbox = useCallback(() => {
    fetch(`/api/crm/inbox?clientId=${clientId}`)
      .then(r => r.json())
      .then((rows: InboxLead[]) => { setLeads(Array.isArray(rows) ? rows : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [clientId]);

  const loadMessages = useCallback((leadId: string, initial = false) => {
    if (initial) setMsgLoading(true);
    const atBottom = isNearBottom();
    fetch(`/api/crm/${leadId}/messages`)
      .then(r => r.json())
      .then((d: { messages: CrmMessage[] }) => {
        setMessages(d.messages ?? []);
        setMsgLoading(false);
        // Only auto-scroll if user was near bottom (or initial load)
        if (atBottom || initial) {
          requestAnimationFrame(() => scrollToBottom(initial ? 'instant' : 'smooth'));
        }
      })
      .catch(() => setMsgLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    loadMessages(selectedId, true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadMessages(selectedId), 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedId, loadMessages]);

  // ── Send helpers ────────────────────────────────────────────────────────────
  async function syncHistory() {
    if (!selectedId || !selectedLead) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/crm/sync-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selectedId, clientId }),
      });
      const data = await res.json() as { ok?: boolean; imported?: number; error?: string };
      if (data.ok) {
        setSyncResult(data.imported === 0 ? 'Nenhuma mensagem nova encontrada.' : `${data.imported} mensagem(ns) importada(s)!`);
        if ((data.imported ?? 0) > 0) loadMessages(selectedId, true);
      } else {
        setSyncResult(data.error ?? 'Erro ao sincronizar');
      }
    } catch {
      setSyncResult('Erro de conexão');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 5000);
    }
  }

  async function doSend(payload: Record<string, unknown>) {
    if (!selectedId) return;
    setSending(true);
    setSendStatus(null);
    try {
      const res = await fetch(`/api/crm/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'out', ...payload }),
      });
      const data = await res.json() as { wa_sent?: boolean };
      setSendStatus(data.wa_sent ? 'ok' : 'err');
      setTimeout(() => setSendStatus(null), 3000);
      loadMessages(selectedId);
      loadInbox();
      requestAnimationFrame(() => scrollToBottom());
    } finally {
      setSending(false);
    }
  }

  async function sendText() {
    if (!replyText.trim()) return;
    const text = replyText.trim();
    setReplyText('');
    textareaRef.current?.focus();
    await doSend({ tipo: 'texto', text });
  }

  async function sendMedia(payload: Record<string, unknown>) {
    setMediaModal(null);
    await doSend(payload);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendText();
    }
  }

  // Auto-resize textarea
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setReplyText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  const filtered = leads.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (l.nome ?? '').toLowerCase().includes(q) || (l.numero ?? '').includes(q);
  });

  const ATTACH_OPTIONS: { tipo: MediaType; label: string; icon: React.ReactNode; color: string }[] = [
    { tipo: 'imagem',     label: 'Imagem',     icon: <Image     className="h-4 w-4" />, color: 'text-blue-400' },
    { tipo: 'audio',      label: 'Áudio',      icon: <Mic       className="h-4 w-4" />, color: 'text-violet-400' },
    { tipo: 'video',      label: 'Vídeo',      icon: <Video     className="h-4 w-4" />, color: 'text-pink-400' },
    { tipo: 'documento',  label: 'Documento',  icon: <FileText  className="h-4 w-4" />, color: 'text-amber-400' },
    { tipo: 'localizacao', label: 'Localização', icon: <MapPin  className="h-4 w-4" />, color: 'text-emerald-400' },
  ];

  return (
    <>
      {/* ── Main layout: fills available space, no external scroll ── */}
      <div className="flex h-full min-h-0 rounded-xl border border-border overflow-hidden bg-card">

        {/* ── Left: Inbox list ── */}
        <div className="flex flex-col w-[300px] shrink-0 border-r border-border bg-card min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">Inbox</span>
              {leads.length > 0 && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{leads.length}</span>
              )}
            </div>
            <button onClick={loadInbox} className="text-muted-foreground hover:text-foreground transition-colors" title="Atualizar">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Search */}
          <div className="px-3 py-2 border-b border-border shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar contato..."
                className="w-full rounded-lg border border-border bg-background pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>
          {/* Lead list — ONLY this section scrolls on the left */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="p-4 text-xs text-muted-foreground text-center">Carregando…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-xs text-muted-foreground text-center italic">Nenhuma conversa</div>
            ) : filtered.map(lead => (
              <button key={lead.id} onClick={() => setSelectedId(lead.id)}
                className={cn(
                  'w-full flex items-start gap-3 px-4 py-3 text-left border-b border-border/40 hover:bg-muted/30 transition-colors',
                  selectedId === lead.id && 'bg-primary/10 border-l-2 border-l-primary',
                )}>
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
                    {lead.status && <span className="text-[9px] font-bold text-muted-foreground/60">{lead.status}</span>}
                    {Number(lead.unread_count) > 0 && (
                      <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-black">
                        {lead.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: Conversation ── */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-background/50">
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
                <div className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold">{(selectedLead.nome ?? selectedLead.numero ?? '?').slice(0, 1).toUpperCase()}</span>
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
                  {/* Sync history button */}
                  <button
                    onClick={() => void syncHistory()}
                    disabled={syncing}
                    title="Buscar histórico de mensagens anteriores"
                    className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-50 transition-colors"
                  >
                    <History className="h-3 w-3" />
                    {syncing ? 'Buscando…' : 'Histórico'}
                  </button>
                </div>
              </div>
              {/* Sync result toast */}
              {syncResult && (
                <div className="px-4 py-2 text-xs font-semibold bg-primary/10 border-b border-border text-primary">
                  {syncResult}
                </div>
              )}

              {/* Messages — ONLY this scrolls */}
              <div
                ref={messagesAreaRef}
                className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-2"
              >
                {msgLoading && messages.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-8">Carregando mensagens…</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground italic py-8">Nenhuma mensagem ainda.</div>
                ) : (
                  messages.map(m => <MessageBubble key={m.id} msg={m} />)
                )}
              </div>

              {/* Input area */}
              <div className="border-t border-border bg-card shrink-0">
                {/* Send status indicator */}
                {sendStatus && (
                  <div className={cn(
                    'flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold border-b border-border',
                    sendStatus === 'ok' ? 'text-emerald-400 bg-emerald-500/5' : 'text-amber-400 bg-amber-500/5',
                  )}>
                    {sendStatus === 'ok'
                      ? <><CheckCircle2 className="h-3.5 w-3.5" /> Enviado via WhatsApp</>
                      : <><AlertCircle  className="h-3.5 w-3.5" /> Salvo — sem instância WA configurada</>}
                  </div>
                )}

                <div className="flex items-end gap-2 px-3 py-2.5">
                  {/* Attachment button */}
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setAttachMenu(v => !v)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      title="Anexar mídia"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                    {attachMenu && (
                      <div className="absolute bottom-11 left-0 z-30 rounded-xl border border-border bg-popover shadow-xl overflow-hidden w-44">
                        {ATTACH_OPTIONS.map(opt => (
                          <button key={opt.tipo}
                            onClick={() => { setMediaModal(opt.tipo); setAttachMenu(false); }}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs hover:bg-muted/50 transition-colors">
                            <span className={opt.color}>{opt.icon}</span>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Textarea */}
                  <textarea
                    ref={textareaRef}
                    value={replyText}
                    onChange={handleTextareaChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Mensagem… (Enter enviar, Shift+Enter quebra linha)"
                    rows={1}
                    className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary overflow-hidden"
                    style={{ minHeight: 36, maxHeight: 140 }}
                  />

                  {/* Send button */}
                  <button
                    onClick={() => void sendText()}
                    disabled={!replyText.trim() || sending}
                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                    title="Enviar"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Attach menu backdrop */}
      {attachMenu && (
        <div className="fixed inset-0 z-20" onClick={() => setAttachMenu(false)} />
      )}

      {/* Media modal */}
      {mediaModal && (
        <MediaModal tipo={mediaModal} onSend={sendMedia} onClose={() => setMediaModal(null)} />
      )}
    </>
  );
}
