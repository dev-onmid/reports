'use client';

import { Fragment, useEffect, useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Search, MessageCircle, RefreshCw, Send, Paperclip,
  Image, Mic, Video, FileText, MapPin, X, CheckCircle2,
  AlertCircle, History, Filter, MoreHorizontal, Smile,
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
  avatar_url?: string | null;
  profile_picture_url?: string | null;
  picture_url?: string | null;
  avatarUrl?: string | null;
  profilePicUrl?: string | null;
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

function msgTimeFmt(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function leadName(lead: InboxLead | null) {
  if (!lead) return '—';
  return lead.nome ?? lead.numero ?? '—';
}

function leadAvatarUrl(lead: InboxLead | null) {
  if (!lead) return null;
  return lead.avatar_url ?? lead.profile_picture_url ?? lead.picture_url ?? lead.avatarUrl ?? lead.profilePicUrl ?? null;
}

function normalizeNumber(raw: string | null | undefined) {
  return (raw ?? '').replace(/\D/g, '');
}

function dateSeparatorLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
  return <span className={cn('h-2 w-2 rounded-full shrink-0', active ? 'bg-primary' : 'bg-zinc-600')} />;
}

function ContactAvatar({
  lead,
  size = 'md',
  showChannel = false,
  avatarOverride,
}: {
  lead: InboxLead;
  size?: 'sm' | 'md' | 'lg';
  showChannel?: boolean;
  avatarOverride?: string | null;
}) {
  const avatarUrl = avatarOverride ?? leadAvatarUrl(lead);
  const sizeClass = size === 'lg' ? 'h-12 w-12' : size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
  const initial = leadName(lead).slice(0, 1).toUpperCase();

  return (
    <div className={cn('relative shrink-0 rounded-full bg-muted/60', sizeClass)}>
      {avatarUrl ? (
        <>
          <div className="flex h-full w-full items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
            {initial}
          </div>
          <img
            src={avatarUrl}
            alt={leadName(lead)}
            className="absolute inset-0 h-full w-full rounded-full object-cover"
            onError={event => { (event.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
          {initial}
        </div>
      )}
      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
      {showChannel && (
        <span className="absolute -bottom-1 -left-1">
          <ChannelDot canal={lead.canal} />
        </span>
      )}
    </div>
  );
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center my-3">
      <span className="rounded-[var(--radius)] border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function MessageBubble({ msg }: { msg: CrmMessage }) {
  const isOut = msg.direction === 'out';
  const t = msg.tipo ?? 'texto';
  const text = msg.text;
  const time = msgTimeFmt(msg.created_at);

  const content = (() => {
    if (t === 'localizacao') {
      return (
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-emerald-400" />
          <span className="text-sm">{text}</span>
        </div>
      );
    }
    if (t === 'imagem' || (t === 'texto' && isImageUrl(text))) {
      return (
        <div className="space-y-1">
          <img src={text} alt="Imagem" className="max-w-full rounded-lg object-cover max-h-60"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
      );
    }
    if (t === 'audio' || (t === 'texto' && isAudioUrl(text))) {
      return <audio controls src={text} className="max-w-full h-9 rounded-lg" />;
    }
    if (t === 'video' || (t === 'texto' && isVideoUrl(text))) {
      return <video controls src={text} className="max-w-full max-h-52 rounded-lg" />;
    }
    if (t === 'documento') {
      return (
        <a href={text} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 text-xs hover:bg-black/30 transition-colors">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{text.split('/').pop() ?? 'Documento'}</span>
        </a>
      );
    }
    return <p className="text-[13.5px] leading-[1.45] whitespace-pre-wrap break-words">{text}</p>;
  })();

  return (
    <div className={cn('flex px-3', isOut ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'relative max-w-[72%] rounded-[var(--radius)] px-3 pb-1.5 pt-2 shadow-sm',
        isOut
          ? 'bg-primary/25 text-foreground border border-primary/20'
          : 'bg-card text-foreground border border-border',
      )}>
        {content}
        <div className="flex items-center justify-end gap-1 mt-0.5">
          <span className={cn('text-[11px] select-none', isOut ? 'text-[#9BB5A8]' : 'text-[#8696A0]')}>
            {time}
          </span>
          {isOut && (
            <svg viewBox="0 0 18 11" className="h-2.5 w-[18px] shrink-0 text-[#53BDEB]" fill="currentColor">
              <path d="M17.394.601L6.35 11.648 1.606 6.903l-.803.803L6.35 13.255 18.197 1.404 17.394.601zM1 5.702L.197 6.505l3.396 3.395.803-.803L1 5.702zm10.646.95l-5.26 5.26-.804-.803 5.26-5.26.804.803z" />
            </svg>
          )}
        </div>
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
  const [sendError,  setSendError]  = useState<string | null>(null);
  const [chatAvatars, setChatAvatars] = useState<Record<string, string>>({});

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

  // ── Inbox auto-refresh (real-time) ─────────────────────────────────────────
  // Polls every 8s so new WA messages appear automatically in the sidebar.
  useEffect(() => {
    loadInbox();
    const id = setInterval(loadInbox, 8_000);
    return () => clearInterval(id);
  }, [loadInbox]);

  useEffect(() => {
    fetch(`/api/disparos/extract/chats?clientId=${clientId}&type=conversations`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: Array<{ phone?: string; profilePicUrl?: string }>) => {
        const next: Record<string, string> = {};
        rows.forEach(row => {
          const phone = normalizeNumber(row.phone);
          if (phone && row.profilePicUrl) next[phone] = row.profilePicUrl;
        });
        setChatAvatars(next);
      })
      .catch(() => {});
  }, [clientId]);

  // ── Messages auto-refresh ───────────────────────────────────────────────────
  // Only keeps the 5s poll alive for conversations with activity in the last 3 days.
  // Older conversations load once and stop — use the manual "Histórico" button instead.
  const isRecentLead = selectedLead
    ? (Date.now() - new Date(selectedLead.last_message_at ?? selectedLead.created_at).getTime()) < 3 * 86_400_000
    : false;

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    loadMessages(selectedId, true);
    if (!isRecentLead) return; // older conversation: load once, no polling
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadMessages(selectedId), 5_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedId, loadMessages, isRecentLead]);

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
      // Handle non-JSON responses (e.g. Vercel 500 HTML pages)
      const rawText = await res.text();
      let data: { wa_sent?: boolean; error?: string; wa_error?: string } = {};
      try { data = JSON.parse(rawText) as typeof data; } catch { /* non-JSON */ }

      if (!res.ok) {
        console.error('[doSend error]', res.status, rawText);
        setSendStatus('err');
        setSendError(data.error ?? `Erro ${res.status}`);
      } else {
        setSendStatus(data.wa_sent ? 'ok' : 'err');
        if (!data.wa_sent && data.wa_error) setSendError(data.wa_error);
        loadMessages(selectedId);
        loadInbox();
        requestAnimationFrame(() => scrollToBottom());
      }
      setTimeout(() => { setSendStatus(null); setSendError(null); }, 6000);
    } catch (err) {
      console.error('[doSend fetch error]', err);
      setSendStatus('err');
      setSendError(String(err));
      setTimeout(() => { setSendStatus(null); setSendError(null); }, 6000);
    } finally {
      setSending(false);
    }
  }

  async function sendText() {
    if (!replyText.trim()) return;
    const text = replyText.trim();
    setReplyText('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
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
  const selectedAvatar = selectedLead ? chatAvatars[normalizeNumber(selectedLead.numero)] : null;

  return (
    <>
      {/* ── Main layout: fills available space, no external scroll ── */}
      <div className="flex h-full min-h-0 overflow-hidden rounded-[var(--radius)] border border-border bg-card">

        {/* ── Left: Inbox list ── */}
        <div className="flex w-[340px] shrink-0 flex-col border-r border-border bg-card min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">Inbox</span>
              {leads.length > 0 && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{leads.length}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={loadInbox} className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Atualizar">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => {
                  const wrongName = window.prompt(
                    'Nome errado a remover (ex: "Matheus Campos").\nDeixe em branco para limpar só leads sem resposta e grupos:',
                    '',
                  );
                  if (wrongName === null) return; // cancelled
                  fetch('/api/crm/cleanup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId, wrongName: wrongName.trim() || undefined }),
                  })
                    .then(r => r.json())
                    .then((d: { groupsDeleted?: number; namesCleared?: number }) => {
                      alert(`✓ ${d.groupsDeleted ?? 0} grupos removidos\n✓ ${d.namesCleared ?? 0} nomes corrigidos`);
                      loadInbox();
                    })
                    .catch(() => alert('Erro na limpeza'));
                }}
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-muted-foreground hover:bg-muted hover:text-amber-400 transition-colors"
                title="Limpar grupos e nomes incorretos"
              >
                <Filter className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {/* Search */}
          <div className="px-3 py-3 border-b border-border shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar contato..."
                className="h-9 w-full rounded-[var(--radius)] border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
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
                  'w-full flex items-start gap-3 border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-muted/30',
                  selectedId === lead.id && 'border-l-2 border-l-primary bg-primary/10',
                )}>
                <ContactAvatar
                  lead={lead}
                  size="sm"
                  showChannel
                  avatarOverride={chatAvatars[normalizeNumber(lead.numero)]}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold truncate">{leadName(lead)}</span>
                      {/* Live indicator — auto-updates enabled */}
                      {(Date.now() - new Date(lead.last_message_at ?? lead.created_at).getTime()) < 3 * 86_400_000 && (
                        <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" title="Tempo real ativo" />
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeFmt(lead.last_message_at ?? lead.created_at)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {lead.last_direction === 'out' && <span className="text-primary/70">Você: </span>}
                    {lead.last_message ?? 'Nenhuma mensagem'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    {lead.status && <span className="text-[10px] text-muted-foreground">{lead.status}</span>}
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
        <div className="flex min-w-0 min-h-0 flex-1 flex-col bg-background/50">
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
              <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 shrink-0">
                <ContactAvatar lead={selectedLead} size="md" avatarOverride={selectedAvatar} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">{leadName(selectedLead)}</p>
                    <StatusDot status={selectedLead.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">Online agora</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedLead.status && (
                    <span className="hidden text-xs text-muted-foreground sm:inline">{selectedLead.status}</span>
                  )}
                  {selectedLead.fechou && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-primary/15 text-primary">Fechou</span>
                  )}
                  {/* Live / static indicator + sync button */}
                  {isRecentLead ? (
                    <span className="flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      Ao vivo
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-muted-foreground px-2 py-1 rounded-full bg-muted/40 border border-border">
                      Arquivado
                    </span>
                  )}
                  <button
                    onClick={() => void syncHistory()}
                    disabled={syncing}
                    title="Importar histórico de mensagens da Evolution API"
                    className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-50 transition-colors"
                  >
                    <History className="h-3 w-3" />
                    {syncing ? 'Buscando…' : 'Histórico'}
                  </button>
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-[var(--radius)] border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Mais opções"
                  >
                    <MoreHorizontal className="h-4 w-4" />
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
                className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-2 [background-image:linear-gradient(rgba(14,15,20,0.84),rgba(14,15,20,0.84)),radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.08)_1px,transparent_0)] [background-size:auto,18px_18px]"
              >
                {msgLoading && messages.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-8">Carregando mensagens…</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground italic py-8">Nenhuma mensagem ainda.</div>
                ) : (
                  messages.map((m, index) => {
                    const previous = messages[index - 1];
                    const showDate = !previous
                      || new Date(previous.created_at).toDateString() !== new Date(m.created_at).toDateString();
                    return (
                      <Fragment key={m.id}>
                        {showDate && <DateSeparator label={dateSeparatorLabel(m.created_at)} />}
                        <MessageBubble msg={m} />
                      </Fragment>
                    );
                  })
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
                      : <><AlertCircle  className="h-3.5 w-3.5" /> {sendError ?? 'Salvo — falha ao enviar pelo WhatsApp'}</>}
                  </div>
                )}

                <div className="flex items-end gap-3 px-3 py-3">
                  {/* Attachment button */}
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setAttachMenu(v => !v)}
                      className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
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
                    className="flex-1 resize-none rounded-[var(--radius)] border border-border bg-background px-3 py-3 pr-11 text-sm focus:outline-none focus:ring-1 focus:ring-primary overflow-hidden"
                    style={{ minHeight: 44, maxHeight: 140 }}
                  />
                  <button
                    type="button"
                    className="-ml-14 mb-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground hover:text-foreground"
                    title="Emoji"
                  >
                    <Smile className="h-4 w-4" />
                  </button>

                  {/* Send button */}
                  <button
                    onClick={() => void sendText()}
                    disabled={!replyText.trim() || sending}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius)] bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
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
