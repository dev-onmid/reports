'use client';

import { Fragment, useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  Search, MessageCircle, RefreshCw, Send, Paperclip,
  Image, Mic, Video, FileText, MapPin, X, CheckCircle2,
  AlertCircle, History, Filter, MoreHorizontal, Smile,
  CheckSquare2, Square, Trash2, Ban, UserX,
  Wifi, WifiOff, AlertTriangle, Check, CheckCheck, Clock3,
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
  whatsapp_status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | string | null;
  whatsapp_error?: string | null;
};

type MediaType = 'imagem' | 'audio' | 'video' | 'documento' | 'localizacao';

const DEFAULT_STATUS_OPTIONS = ['Em Atendimento', 'Agendado', 'Reagendado', 'Fechado', 'Comprou', 'Paciente', 'Não Retorna', 'Distante', 'Sem Interesse', 'Desqualificado'];

type InstanceStatus = 'checking' | 'connected' | 'disconnected' | 'no_instance' | 'unknown';
type InstanceInfo = { id: string; nome: string; provider: string; status: string };

const INSTANCE_ALERT_KEY = 'crm-instance-alert-shown';
const INSTANCE_ALERT_COOLDOWN = 10 * 60 * 1000; // 10 min
const AUTO_HISTORY_CONVERSATIONS = 30;
const AUTO_HISTORY_MESSAGES_PER_CONVERSATION = 10;
const AUTO_HISTORY_CONCURRENCY = 3;

const COMMON_EMOJIS = [
  '😊','😂','❤️','👍','🙏','😍','🎉','✅','🔥','💪',
  '👋','🤝','😎','🚀','💯','⭐','🤔','😅','👀','💰',
  '😁','🤩','🥳','😢','😭','🤣','😘','💬','📅','✨',
];

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
  const waStatus = msg.whatsapp_status ?? (isOut ? 'sent' : null);

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
        isOut && waStatus === 'failed'
          ? 'bg-red-500/10 text-foreground border border-red-500/35'
          : isOut
          ? 'bg-primary/25 text-foreground border border-primary/20'
          : 'bg-card text-foreground border border-border',
      )}>
        {content}
        <div className="flex items-center justify-end gap-1 mt-0.5">
          <span className={cn('text-[11px] select-none', isOut ? 'text-[#9BB5A8]' : 'text-[#8696A0]')}>
            {time}
          </span>
          {isOut && (
            <MessageDeliveryIcon status={waStatus} error={msg.whatsapp_error} />
          )}
        </div>
      </div>
    </div>
  );
}

function MessageDeliveryIcon({ status, error }: { status: string | null; error?: string | null }) {
  const wrap = (label: string, icon: ReactNode) => (
    <span className="inline-flex" aria-label={label} title={label}>{icon}</span>
  );
  if (status === 'failed') {
    return wrap(error ?? 'Falha ao enviar', <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />);
  }
  if (status === 'read') {
    return wrap('Lida', <CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#53BDEB]" />);
  }
  if (status === 'delivered') {
    return wrap('Entregue', <CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#9BB5A8]/70" />);
  }
  if (status === 'pending') {
    return wrap('Enviando', <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />);
  }
  return wrap('Enviada', <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />);
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

// ── Confirm dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirmar',
  confirmClass = 'bg-red-500 hover:bg-red-600 text-white',
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  confirmClass?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-card rounded-2xl border border-border shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-5 space-y-2">
          <p className="text-sm font-bold">{title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancelar</button>
          <button onClick={() => { onConfirm(); onClose(); }} className={cn('rounded-lg px-4 py-2 text-sm font-semibold', confirmClass)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ChatView ─────────────────────────────────────────────────────────────

export function ChatView({
  clientId,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  focusLeadId,
}: {
  clientId: string;
  statusOptions?: string[];
  focusLeadId?: string | null;
}) {
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
  const [importingChats, setImportingChats] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [recordingAudio, setRecordingAudio] = useState(false);

  // Select mode
  const [selectMode,      setSelectMode]      = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkAction,      setBulkAction]      = useState<'deleting' | 'clearing' | null>(null);

  // More menu (per-conversation)
  const [moreMenu,     setMoreMenu]     = useState(false);
  const [clearingChat, setClearingChat] = useState(false);

  // Emoji picker
  const [emojiPicker, setEmojiPicker] = useState(false);

  // Instance status
  const [instanceStatus,  setInstanceStatus]  = useState<InstanceStatus>('checking');
  const [instanceInfos,   setInstanceInfos]   = useState<InstanceInfo[]>([]);
  const [instanceAlertOpen, setInstanceAlertOpen] = useState(false);

  // Confirm dialog
  const [debugModal, setDebugModal] = useState<{ loading: boolean; data: unknown } | null>(null);

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    confirmClass?: string;
    onConfirm: () => void;
  } | null>(null);

  const messagesAreaRef  = useRef<HTMLDivElement>(null);
  const pollRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef      = useRef<HTMLTextAreaElement>(null);
  const autoSyncedRef    = useRef<Set<string>>(new Set());
  const autoRecentHistoryLeadIdsRef = useRef<Set<string>>(new Set());
  const autoRecentHistoryRunningRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingCancelledRef = useRef(false);

  const selectedLead = leads.find(l => l.id === selectedId) ?? null;
  const recentLeadIds = leads
    .slice(0, AUTO_HISTORY_CONVERSATIONS)
    .map(lead => lead.id)
    .join('|');

  useEffect(() => {
    if (!focusLeadId) return;
    queueMicrotask(() => setSelectedId(focusLeadId));
  }, [focusLeadId]);

  useEffect(() => () => {
    recordingCancelledRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    recordingStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

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

  // ── Instance status ─────────────────────────────────────────────────────────
  const loadInstanceStatus = useCallback(() => {
    fetch(`/api/crm/instance-status?clientId=${clientId}`)
      .then(r => r.json())
      .then((data: { status: string; instances?: InstanceInfo[] }) => {
        const status = data.status as InstanceStatus;
        setInstanceStatus(status);
        setInstanceInfos(data.instances ?? []);
        if (status === 'disconnected' || status === 'no_instance') {
          const lastShown = Number(sessionStorage.getItem(INSTANCE_ALERT_KEY) ?? 0);
          if (!lastShown || Date.now() - lastShown > INSTANCE_ALERT_COOLDOWN) {
            setInstanceAlertOpen(true);
            sessionStorage.setItem(INSTANCE_ALERT_KEY, String(Date.now()));
          }
        }
      })
      .catch(() => setInstanceStatus('unknown'));
  }, [clientId]);

  useEffect(() => {
    loadInstanceStatus();
    const id = setInterval(loadInstanceStatus, 30_000);
    return () => clearInterval(id);
  }, [loadInstanceStatus]);

  // ── Data loading ────────────────────────────────────────────────────────────
  const loadInbox = useCallback(() => {
    fetch(`/api/crm/inbox?clientId=${clientId}`)
      .then(async r => {
        const json = await r.json().catch(() => null);
        if (Array.isArray(json)) {
          setLeads(json as InboxLead[]);
        } else {
          console.warn('[inbox GET] resposta inesperada:', json);
          setLeads([]);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('[inbox GET] fetch error:', err);
        setLoading(false);
      });
  }, [clientId]);

  async function importConversations(searchTerm = '') {
    setImportingChats(true);
    setImportResult(null);
    try {
      const res = await fetch(`/api/crm/inbox?clientId=${clientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search: searchTerm.trim(), limit: 500 }),
      });
      const data = await res.json() as {
        ok?: boolean;
        imported?: number;
        matched?: number;
        fetched?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setImportResult(data.error ?? 'Não foi possível puxar conversas.');
        return;
      }
      if (searchTerm.trim()) {
        setImportResult(`${data.matched ?? 0} encontrada(s) de ${data.fetched ?? 0} na API.`);
      } else if ((data.fetched ?? 0) === 0) {
        setImportResult('API retornou 0 conversas. Verifique a instância nas configurações.');
      } else {
        setImportResult(`${data.imported ?? 0} sincronizada(s) (${data.fetched ?? 0} recebidas da API).`);
      }
      loadInbox();
      setTimeout(loadInbox, 800);
    } catch {
      setImportResult('Erro ao puxar conversas.');
    } finally {
      setImportingChats(false);
      setTimeout(() => setImportResult(null), 5000);
    }
  }

  const loadMessages = useCallback((leadId: string, initial = false) => {
    if (initial) setMsgLoading(true);
    const atBottom = isNearBottom();
    fetch(`/api/crm/${leadId}/messages`)
      .then(r => r.json())
      .then((d: { messages: CrmMessage[] }) => {
        setMessages(d.messages ?? []);
        setMsgLoading(false);
        if (atBottom || initial) {
          requestAnimationFrame(() => scrollToBottom(initial ? 'instant' : 'smooth'));
        }
      })
      .catch(() => setMsgLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-sync recent conversation history ─────────────────────────────────
  useEffect(() => {
    if (loading || !recentLeadIds || autoRecentHistoryRunningRef.current) return;

    const targets = recentLeadIds
      .split('|')
      .filter(id => !autoRecentHistoryLeadIdsRef.current.has(id));

    if (targets.length === 0) return;

    targets.forEach(id => autoRecentHistoryLeadIdsRef.current.add(id));
    autoRecentHistoryRunningRef.current = true;
    let cancelled = false;

    async function syncOne(leadId: string) {
      const res = await fetch('/api/crm/sync-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          clientId,
          limit: AUTO_HISTORY_MESSAGES_PER_CONVERSATION,
        }),
      });
      const data = await res.json().catch(() => ({})) as { imported?: number };
      return res.ok ? data.imported ?? 0 : 0;
    }

    async function run() {
      let cursor = 0;
      let imported = 0;
      async function worker() {
        while (!cancelled) {
          const leadId = targets[cursor];
          cursor += 1;
          if (!leadId) return;
          try {
            imported += await syncOne(leadId);
          } catch {
            // Best-effort background sync. Manual history/debug buttons still surface errors.
          }
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(AUTO_HISTORY_CONCURRENCY, targets.length) },
          () => worker(),
        ),
      );

      autoRecentHistoryRunningRef.current = false;
      if (cancelled || imported === 0) return;
      loadInbox();
      if (selectedId && targets.includes(selectedId)) loadMessages(selectedId, true);
    }

    void run();
    return () => { cancelled = true; };
  }, [clientId, loadInbox, loadMessages, loading, recentLeadIds, selectedId]);

  // ── Inbox auto-refresh ─────────────────────────────────────────────────────
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
  const isRecentLead = selectedLead
    ? selectedLead.last_message_at !== null
      && (Date.now() - new Date(selectedLead.last_message_at).getTime()) < 3 * 86_400_000
    : false;

  useEffect(() => {
    if (!selectedId) {
      queueMicrotask(() => setMessages([]));
      return;
    }
    const loadTimer = window.setTimeout(() => loadMessages(selectedId, true), 0);
    if (!isRecentLead) return () => window.clearTimeout(loadTimer);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadMessages(selectedId), 5_000);
    return () => {
      window.clearTimeout(loadTimer);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedId, loadMessages, isRecentLead]);

  // ── Auto-sync history when conversation has no messages ────────────────────
  useEffect(() => {
    if (!selectedId || msgLoading || messages.length > 0) return;
    if (autoSyncedRef.current.has(selectedId)) return;
    autoSyncedRef.current.add(selectedId);
    const id = selectedId;
    void syncHistory(id).then(imported => {
      // If nothing was imported (e.g. a transient API/instance hiccup, or a fix that
      // only went live after the first attempt), don't cache the failure for the whole
      // session — allow a retry the next time this conversation is opened.
      if (!imported) autoSyncedRef.current.delete(id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, msgLoading, messages.length]);

  // ── Select mode helpers ─────────────────────────────────────────────────────
  function toggleSelectLead(id: string) {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedLeadIds(new Set());
  }

  // ── Bulk actions ────────────────────────────────────────────────────────────
  async function bulkDelete() {
    setBulkAction('deleting');
    try {
      await Promise.all([...selectedLeadIds].map(id => fetch(`/api/crm/${id}`, { method: 'DELETE' })));
      setLeads(prev => prev.filter(l => !selectedLeadIds.has(l.id)));
      if (selectedId && selectedLeadIds.has(selectedId)) {
        setSelectedId(null);
        setMessages([]);
      }
      exitSelectMode();
    } finally {
      setBulkAction(null);
    }
  }

  async function bulkClearChats() {
    setBulkAction('clearing');
    try {
      await Promise.all([...selectedLeadIds].map(id =>
        fetch(`/api/crm/${id}/messages`, { method: 'DELETE' }),
      ));
      if (selectedId && selectedLeadIds.has(selectedId)) setMessages([]);
      exitSelectMode();
    } finally {
      setBulkAction(null);
    }
  }

  // ── Per-conversation actions ────────────────────────────────────────────────
  async function clearCurrentChat() {
    if (!selectedId) return;
    setClearingChat(true);
    setMoreMenu(false);
    try {
      await fetch(`/api/crm/${selectedId}/messages`, { method: 'DELETE' });
      setMessages([]);
    } finally {
      setClearingChat(false);
    }
  }

  async function blockContact() {
    if (!selectedId) return;
    setMoreMenu(false);
    await changeSelectedStatus('Bloqueado');
  }

  async function deleteCurrentLead() {
    if (!selectedId) return;
    setMoreMenu(false);
    try {
      await fetch(`/api/crm/${selectedId}`, { method: 'DELETE' });
      setLeads(prev => prev.filter(l => l.id !== selectedId));
      setSelectedId(null);
      setMessages([]);
    } catch {
      setSendStatus('err');
      setSendError('Erro ao excluir lead');
      setTimeout(() => { setSendStatus(null); setSendError(null); }, 5000);
    }
  }

  // ── Send helpers ────────────────────────────────────────────────────────────
  async function syncHistory(leadId?: string): Promise<number> {
    const id = leadId ?? selectedId;
    if (!id) return 0;
    setSyncing(true);
    setSyncResult(null);
    let imported = 0;
    try {
      const res = await fetch('/api/crm/sync-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: id, clientId }),
      });
      const data = await res.json() as { ok?: boolean; imported?: number; error?: string; firstError?: string | null };
      imported = data.imported ?? 0;
      if (data.ok) {
        if (imported > 0) {
          setSyncResult(`${imported} mensagem(ns) importada(s)!`);
          loadMessages(id, true);
        } else if (data.firstError) {
          // Surface the real DB error (e.g. a NOT NULL / missing column) so it's diagnosable
          setSyncResult(`Falha ao gravar: ${data.firstError}`);
        } else {
          setSyncResult('Histórico sem mensagens novas.');
        }
      } else {
        setSyncResult(data.error ?? 'Erro ao sincronizar');
      }
    } catch {
      setSyncResult('Erro de conexão');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 5000);
    }
    return imported;
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
      const rawText = await res.text();
      let data: { wa_sent?: boolean; error?: string; wa_error?: string } = {};
      try { data = JSON.parse(rawText) as typeof data; } catch { /* non-JSON */ }

      if (!res.ok) {
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

  function preferredAudioMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const options = [
      'audio/ogg;codecs=opus',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ];
    return options.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
  }

  function audioExtension(mimeType: string) {
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4')) return 'm4a';
    if (mimeType.includes('mpeg')) return 'mp3';
    return 'webm';
  }

  async function uploadAndSendRecordedAudio(blob: Blob) {
    if (!selectedId || blob.size === 0) return;
    setSending(true);
    setSendStatus(null);
    setSendError(null);
    try {
      const formData = new FormData();
      const ext = audioExtension(blob.type);
      formData.append('file', new File([blob], `audio-${Date.now()}.${ext}`, {
        type: blob.type || 'audio/webm',
      }));
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setSendStatus('err');
        setSendError(data.error ?? 'Não foi possível subir o áudio');
        setTimeout(() => { setSendStatus(null); setSendError(null); }, 6000);
        return;
      }
      setSending(false);
      await doSend({ tipo: 'audio', url: data.url });
    } catch (err) {
      setSendStatus('err');
      setSendError(err instanceof Error ? err.message : 'Erro ao gravar áudio');
      setTimeout(() => { setSendStatus(null); setSendError(null); }, 6000);
    } finally {
      setSending(false);
    }
  }

  async function startAudioRecording() {
    if (!selectedId || recordingAudio) return;
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSendStatus('err');
      setSendError('Este navegador não permite gravação de áudio aqui.');
      setTimeout(() => { setSendStatus(null); setSendError(null); }, 6000);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingCancelledRef.current = false;
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        setRecordingAudio(false);
        stream.getTracks().forEach(track => track.stop());
        recordingStreamRef.current = null;
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(recordingChunksRef.current, { type });
        recordingChunksRef.current = [];
        if (recordingCancelledRef.current) return;
        void uploadAndSendRecordedAudio(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingAudio(true);
      setSendStatus(null);
      setSendError(null);
    } catch (err) {
      setRecordingAudio(false);
      setSendStatus('err');
      setSendError(err instanceof Error ? err.message : 'Não foi possível acessar o microfone');
      setTimeout(() => { setSendStatus(null); setSendError(null); }, 6000);
    }
  }

  function stopAudioRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  }

  function toggleAudioRecording() {
    if (recordingAudio) {
      stopAudioRecording();
    } else {
      void startAudioRecording();
    }
  }

  async function changeSelectedStatus(status: string) {
    if (!selectedId || !selectedLead) return;
    const previousStatus = selectedLead.status;
    setLeads(prev => prev.map(lead => (
      lead.id === selectedId || (lead.numero && selectedLead.numero && normalizeNumber(lead.numero) === normalizeNumber(selectedLead.numero))
        ? { ...lead, status }
        : lead
    )));
    try {
      const res = await fetch(`/api/crm/${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      loadInbox();
    } catch (err) {
      setLeads(prev => prev.map(lead => (
        lead.id === selectedId ? { ...lead, status: previousStatus } : lead
      )));
      setSendStatus('err');
      setSendError(err instanceof Error ? err.message : 'Erro ao alterar status');
      setTimeout(() => { setSendStatus(null); setSendError(null); }, 5000);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendText();
    }
  }

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
      {/* ── Main layout ── */}
      <div className="flex h-full min-h-0 overflow-hidden rounded-[var(--radius)] border border-border bg-card">

        {/* ── Left: Inbox list ── */}
        <div className="flex w-[340px] shrink-0 flex-col border-r border-border bg-card min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            {selectMode ? (
              <>
                <div className="flex items-center gap-2">
                  <CheckSquare2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-bold text-primary">
                    {selectedLeadIds.size > 0 ? `${selectedLeadIds.size} selecionado(s)` : 'Selecionar'}
                  </span>
                </div>
                <button
                  onClick={exitSelectMode}
                  className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="Cancelar seleção"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  <span className="text-sm font-bold">Inbox</span>
                  {leads.length > 0 && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{leads.length}</span>
                  )}
                  {/* Instance status badge */}
                  <button
                    onClick={() => setInstanceAlertOpen(true)}
                    className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold transition-colors"
                    title={instanceStatus === 'connected' ? 'WhatsApp conectado' : instanceStatus === 'checking' ? 'Verificando...' : 'WhatsApp desconectado — clique para detalhes'}
                  >
                    {instanceStatus === 'connected' && (
                      <><Wifi className="h-3 w-3 text-emerald-400" /><span className="text-emerald-400">ON</span></>
                    )}
                    {(instanceStatus === 'disconnected' || instanceStatus === 'no_instance') && (
                      <><WifiOff className="h-3 w-3 text-red-400 animate-pulse" /><span className="text-red-400">OFF</span></>
                    )}
                    {instanceStatus === 'checking' && (
                      <><Wifi className="h-3 w-3 text-muted-foreground animate-pulse" /></>
                    )}
                    {instanceStatus === 'unknown' && (
                      <><Wifi className="h-3 w-3 text-amber-400" /><span className="text-amber-400">?</span></>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={loadInbox} className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Atualizar">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setSelectMode(true)}
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="Selecionar conversas"
                  >
                    <CheckSquare2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      const wrongName = window.prompt(
                        'Nome errado a remover (ex: "Matheus Campos").\nDeixe em branco para limpar só leads sem resposta e grupos:',
                        '',
                      );
                      if (wrongName === null) return;
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
              </>
            )}
          </div>

          {/* Search */}
          <div className="px-3 py-3 border-b border-border shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar contato..."
                onKeyDown={e => {
                  if (e.key === 'Enter') void importConversations(search);
                }}
                className="h-9 w-full rounded-[var(--radius)] border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void importConversations(search)}
                disabled={importingChats}
                className="flex-1 rounded-[var(--radius)] border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                {importingChats ? 'Puxando...' : search.trim() ? 'Buscar no WhatsApp' : 'Carregar mais conversas'}
              </button>
            </div>
            {importResult && (
              <p className="mt-2 text-[11px] text-muted-foreground">{importResult}</p>
            )}
          </div>

          {/* Lead list */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="p-4 text-xs text-muted-foreground text-center">Carregando…</div>
            ) : filtered.length === 0 ? (
              <div className="space-y-3 p-6 text-center">
                <p className="text-xs italic text-muted-foreground">Nenhuma conversa</p>
                <button
                  type="button"
                  onClick={() => void importConversations(search)}
                  disabled={importingChats}
                  className="rounded-[var(--radius)] border border-primary/35 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {importingChats ? 'Puxando...' : 'Puxar do WhatsApp'}
                </button>
              </div>
            ) : filtered.map(lead => (
              <button
                key={lead.id}
                onClick={() => {
                  if (selectMode) {
                    toggleSelectLead(lead.id);
                  } else {
                    setSelectedId(lead.id);
                  }
                }}
                className={cn(
                  'w-full flex items-start gap-3 border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-muted/30',
                  !selectMode && selectedId === lead.id && 'border-l-2 border-l-primary bg-primary/10',
                  selectMode && selectedLeadIds.has(lead.id) && 'bg-primary/10',
                )}
              >
                {selectMode ? (
                  <div className="flex items-center justify-center h-9 w-9 shrink-0">
                    {selectedLeadIds.has(lead.id)
                      ? <CheckSquare2 className="h-5 w-5 text-primary" />
                      : <Square className="h-5 w-5 text-muted-foreground" />}
                  </div>
                ) : (
                  <ContactAvatar
                    lead={lead}
                    size="sm"
                    showChannel
                    avatarOverride={chatAvatars[normalizeNumber(lead.numero)]}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold truncate">{leadName(lead)}</span>
                      {lead.status === 'Bloqueado' && (
                        <Ban className="h-3 w-3 shrink-0 text-red-400" />
                      )}
                      {lead.last_message_at !== null && (Date.now() - new Date(lead.last_message_at).getTime()) < 3 * 86_400_000 && lead.status !== 'Bloqueado' && (
                        <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" title="Tempo real ativo" />
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeFmt(lead.last_message_at)}</span>
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
            {!loading && filtered.length > 0 && (
              <div className="p-3">
                <button
                  type="button"
                  onClick={() => void importConversations(search)}
                  disabled={importingChats}
                  className="w-full rounded-[var(--radius)] border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                >
                  {importingChats ? 'Puxando conversas...' : 'Carregar mais conversas'}
                </button>
              </div>
            )}
          </div>

          {/* Bulk action bar */}
          {selectMode && selectedLeadIds.size > 0 && (
            <div className="shrink-0 border-t border-border bg-card p-3 space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground">
                {selectedLeadIds.size} conversa(s) selecionada(s)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDialog({
                    title: 'Limpar conversas',
                    description: `Apagar todas as mensagens de ${selectedLeadIds.size} conversa(s) selecionada(s)? Esta ação não pode ser desfeita.`,
                    confirmLabel: 'Limpar',
                    confirmClass: 'bg-amber-500 hover:bg-amber-600 text-white',
                    onConfirm: () => void bulkClearChats(),
                  })}
                  disabled={!!bulkAction}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 px-2 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-500/10 disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  {bulkAction === 'clearing' ? 'Limpando...' : 'Limpar chats'}
                </button>
                <button
                  onClick={() => setConfirmDialog({
                    title: 'Excluir leads',
                    description: `Excluir permanentemente ${selectedLeadIds.size} lead(s) selecionado(s)? Esta ação não pode ser desfeita.`,
                    confirmLabel: 'Excluir',
                    onConfirm: () => void bulkDelete(),
                  })}
                  disabled={!!bulkAction}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-500/30 px-2 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                >
                  <UserX className="h-3 w-3" />
                  {bulkAction === 'deleting' ? 'Excluindo...' : 'Excluir leads'}
                </button>
              </div>
            </div>
          )}
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
                    {selectedLead.status === 'Bloqueado' && (
                      <Ban className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{selectedLead.numero ?? 'Sem número'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="relative">
                    <select
                      value={selectedLead.status ?? ''}
                      onChange={event => void changeSelectedStatus(event.target.value)}
                      className="h-8 appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-xs font-semibold text-foreground outline-none transition-colors hover:border-primary/50 focus:border-primary"
                    >
                      {!selectedLead.status && <option value="">Sem status</option>}
                      {selectedLead.status && !statusOptions.includes(selectedLead.status) && (
                        <option value={selectedLead.status}>{selectedLead.status}</option>
                      )}
                      {statusOptions.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                      <option value="Bloqueado">Bloqueado</option>
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">▾</span>
                  </div>
                  {selectedLead.fechou && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-primary/15 text-primary">Fechou</span>
                  )}
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
                    title="Importar histórico de mensagens"
                    className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-50 transition-colors"
                  >
                    <History className="h-3 w-3" />
                    {syncing ? 'Buscando…' : 'Histórico'}
                  </button>
                  <button
                    onClick={async () => {
                      if (!selectedId) return;
                      setDebugModal({ loading: true, data: null });
                      try {
                        const res = await fetch('/api/crm/sync-history/debug', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ leadId: selectedId, clientId }),
                        });
                        const data = await res.json();
                        setDebugModal({ loading: false, data });
                      } catch (err) {
                        setDebugModal({ loading: false, data: { error: String(err) } });
                      }
                    }}
                    title="Debug: ver resposta bruta da API"
                    className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:border-amber-400/40 transition-colors"
                  >
                    <AlertCircle className="h-3 w-3" />
                    Debug
                  </button>

                  {/* More options dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setMoreMenu(v => !v)}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-[var(--radius)] border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
                        moreMenu && 'bg-muted text-foreground',
                      )}
                      title="Mais opções"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {moreMenu && (
                      <div className="absolute right-0 top-10 z-40 w-52 rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
                        <button
                          onClick={() => setConfirmDialog({
                            title: 'Limpar conversa',
                            description: 'Apagar todas as mensagens desta conversa? Esta ação não pode ser desfeita.',
                            confirmLabel: 'Limpar',
                            confirmClass: 'bg-amber-500 hover:bg-amber-600 text-white',
                            onConfirm: () => void clearCurrentChat(),
                          })}
                          disabled={clearingChat}
                          className="flex w-full items-center gap-2.5 px-4 py-3 text-sm hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4 text-amber-400 shrink-0" />
                          {clearingChat ? 'Limpando...' : 'Limpar conversa'}
                        </button>
                        <button
                          onClick={() => setConfirmDialog({
                            title: 'Bloquear contato',
                            description: `Bloquear "${leadName(selectedLead)}"? O status será alterado para "Bloqueado".`,
                            confirmLabel: 'Bloquear',
                            confirmClass: 'bg-orange-500 hover:bg-orange-600 text-white',
                            onConfirm: () => void blockContact(),
                          })}
                          className="flex w-full items-center gap-2.5 px-4 py-3 text-sm hover:bg-muted/50 transition-colors text-left"
                        >
                          <Ban className="h-4 w-4 text-orange-400 shrink-0" />
                          Bloquear contato
                        </button>
                        <div className="h-px bg-border" />
                        <button
                          onClick={() => setConfirmDialog({
                            title: 'Excluir lead',
                            description: `Excluir permanentemente "${leadName(selectedLead)}"? Esta ação não pode ser desfeita.`,
                            confirmLabel: 'Excluir',
                            onConfirm: () => void deleteCurrentLead(),
                          })}
                          className="flex w-full items-center gap-2.5 px-4 py-3 text-sm hover:bg-muted/50 transition-colors text-left text-red-400"
                        >
                          <UserX className="h-4 w-4 shrink-0" />
                          Excluir lead
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Instance disconnected banner */}
              {(instanceStatus === 'disconnected' || instanceStatus === 'no_instance') && (
                <button
                  type="button"
                  onClick={() => setInstanceAlertOpen(true)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-xs font-semibold bg-red-500/10 border-b border-red-500/20 text-red-400 hover:bg-red-500/15 transition-colors text-left"
                >
                  <WifiOff className="h-3.5 w-3.5 shrink-0 animate-pulse" />
                  {instanceStatus === 'no_instance'
                    ? 'Nenhuma instância WhatsApp configurada. Clique para saber mais.'
                    : 'WhatsApp desconectado — mensagens podem não ser enviadas. Clique para detalhes.'}
                </button>
              )}

              {/* Sync result toast */}
              {syncResult && (
                <div className="px-4 py-2 text-xs font-semibold bg-primary/10 border-b border-border text-primary">
                  {syncResult}
                </div>
              )}

              {/* Messages */}
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
                {recordingAudio && (
                  <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs font-semibold text-red-300">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
                    Gravando áudio — clique no microfone para enviar
                  </div>
                )}

                <div className="flex items-end gap-3 px-3 py-3">
                  {/* Attachment button */}
                  <div className="relative shrink-0">
                    <button
                      onClick={() => { setAttachMenu(v => !v); setEmojiPicker(false); }}
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

                  {/* Voice recording button */}
                  <div className="relative -ml-14 mb-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={toggleAudioRecording}
                      disabled={!selectedId || (sending && !recordingAudio)}
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-[var(--radius)] transition-colors disabled:opacity-40',
                        recordingAudio
                          ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                      )}
                      title={recordingAudio ? 'Parar e enviar áudio' : 'Gravar áudio'}
                    >
                      <Mic className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Emoji button */}
                  <div className="relative mb-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => { setEmojiPicker(v => !v); setAttachMenu(false); }}
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-[var(--radius)] transition-colors',
                        emojiPicker ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                      )}
                      title="Emoji"
                    >
                      <Smile className="h-4 w-4" />
                    </button>
                    {emojiPicker && (
                      <div className="absolute bottom-10 right-0 z-30 rounded-xl border border-border bg-popover shadow-xl p-2 grid grid-cols-5 gap-0.5">
                        {COMMON_EMOJIS.map(e => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => {
                              setReplyText(t => t + e);
                              setEmojiPicker(false);
                              textareaRef.current?.focus();
                            }}
                            className="flex h-9 w-9 items-center justify-center text-lg hover:bg-muted/50 rounded transition-colors"
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

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

      {/* Backdrops */}
      {attachMenu && (
        <div className="fixed inset-0 z-20" onClick={() => setAttachMenu(false)} />
      )}
      {moreMenu && (
        <div className="fixed inset-0 z-30" onClick={() => setMoreMenu(false)} />
      )}
      {emojiPicker && (
        <div className="fixed inset-0 z-20" onClick={() => setEmojiPicker(false)} />
      )}

      {/* Media modal */}
      {mediaModal && (
        <MediaModal tipo={mediaModal} onSend={sendMedia} onClose={() => setMediaModal(null)} />
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          confirmClass={confirmDialog.confirmClass}
          onConfirm={confirmDialog.onConfirm}
          onClose={() => setConfirmDialog(null)}
        />
      )}

      {/* Debug modal */}
      {debugModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setDebugModal(null)}>
          <div className="w-full max-w-2xl bg-card rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <p className="text-sm font-bold text-amber-400">Debug — Resposta da API WhatsApp</p>
              <button onClick={() => setDebugModal(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {debugModal.loading ? (
                <p className="text-xs text-muted-foreground">Consultando API…</p>
              ) : (
                <pre className="text-[10px] text-foreground whitespace-pre-wrap break-all leading-relaxed">
                  {JSON.stringify(debugModal.data, null, 2)}
                </pre>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border shrink-0">
              <p className="text-[10px] text-muted-foreground">Cole esta resposta no chat para diagnóstico.</p>
            </div>
          </div>
        </div>
      )}

      {/* Instance alert modal */}
      {instanceAlertOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setInstanceAlertOpen(false)}>
          <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <div className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                instanceStatus === 'connected' ? 'bg-emerald-500/15' : 'bg-red-500/15',
              )}>
                {instanceStatus === 'connected'
                  ? <Wifi className="h-5 w-5 text-emerald-400" />
                  : <WifiOff className="h-5 w-5 text-red-400" />}
              </div>
              <div>
                <p className="text-sm font-bold">Status do WhatsApp</p>
                <p className={cn('text-xs font-semibold', instanceStatus === 'connected' ? 'text-emerald-400' : 'text-red-400')}>
                  {instanceStatus === 'connected' ? 'Conectado' : instanceStatus === 'no_instance' ? 'Sem instância configurada' : 'Desconectado'}
                </p>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3">
              {instanceStatus === 'no_instance' ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Nenhuma instância WhatsApp está configurada para este cliente. Configure em{' '}
                      <span className="font-semibold text-foreground">Clientes → Rastreamento</span>{' '}
                      para enviar e receber mensagens.
                    </p>
                  </div>
                </div>
              ) : instanceStatus !== 'connected' ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      A instância está desconectada. Mensagens <span className="font-semibold text-foreground">não serão enviadas</span> até que o WhatsApp seja reconectado.
                      Acesse <span className="font-semibold text-foreground">Clientes → Rastreamento</span> para escanear o QR Code e reconectar.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <div className="flex items-start gap-3">
                    <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      WhatsApp conectado e funcionando normalmente.
                    </p>
                  </div>
                </div>
              )}

              {instanceInfos.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Instâncias</p>
                  {instanceInfos.map(inst => (
                    <div key={inst.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{inst.nome}</p>
                        <p className="text-[10px] text-muted-foreground">{inst.provider === 'evolution' ? 'Evolution API' : 'Z-API'}</p>
                      </div>
                      <span className={cn(
                        'flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold shrink-0',
                        inst.status === 'connected'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : inst.status === 'unknown'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-red-500/15 text-red-400',
                      )}>
                        {inst.status === 'connected'
                          ? <><Wifi className="h-2.5 w-2.5" /> Conectado</>
                          : inst.status === 'unknown'
                            ? <><Wifi className="h-2.5 w-2.5" /> Desconhecido</>
                            : <><WifiOff className="h-2.5 w-2.5" /> Desconectado</>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-5 pb-5">
              <button
                onClick={loadInstanceStatus}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Verificar novamente
              </button>
              <button
                onClick={() => setInstanceAlertOpen(false)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
