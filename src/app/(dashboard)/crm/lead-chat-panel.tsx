'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Send, Paperclip, Smile, X, AlertCircle, CheckCircle2,
  MessageCircle, ExternalLink, Loader2,
} from 'lucide-react';
import {
  MessageBubble, DateSeparator, dateSeparatorLabel, formatPhoneBR,
  type CrmMessage,
} from './chat-view';

const EMOJIS = [
  '😊','😂','❤️','👍','🙏','😍','🎉','✅','🔥','💪',
  '👋','🤝','😎','🚀','💯','⭐','🤔','😅','👀','💰',
  '😁','🤩','🥳','😢','😭','🤣','😘','💬','📅','✨',
];

// O tipo que o backend espera é derivado do MIME do arquivo — o mesmo conjunto
// que o MessageBubble sabe renderizar.
function tipoFromFile(file: File): 'imagem' | 'audio' | 'video' | 'documento' {
  if (file.type.startsWith('image/')) return 'imagem';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'documento';
}

/**
 * Conversa do lead embutida ao lado do formulário de edição.
 *
 * Reaproveita as bolhas do inbox (`chat-view`) e fala com as mesmas rotas, mas
 * sem a coluna de conversas: aqui o lead já está escolhido pelo modal. O poll
 * segue o mesmo desenho do inbox — incremental a cada 3s e um refresh completo
 * a cada ~30s pra atualizar os checks de entrega.
 */
export function LeadChatPanel({
  leadId, nome, numero, clientId, onOpenFullChat,
}: {
  leadId: string;
  nome: string | null;
  numero: string | null;
  clientId?: string;
  onOpenFullChat?: () => void;
}) {
  const [messages, setMessages] = useState<CrmMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<'ok' | 'err' | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const areaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastMsgTsRef = useRef<string | null>(null);
  const pollCountRef = useRef(0);
  const syncedRef = useRef(false);

  function isNearBottom() {
    const el = areaRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }
  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    areaRef.current?.scrollTo({ top: areaRef.current.scrollHeight, behavior });
  }

  const loadMessages = useCallback((initial = false, opts?: { incremental?: boolean }) => {
    if (initial) setLoading(true);
    const atBottom = isNearBottom();
    const incremental = Boolean(opts?.incremental && lastMsgTsRef.current);
    const url = incremental
      ? `/api/crm/${leadId}/messages?after=${encodeURIComponent(lastMsgTsRef.current as string)}`
      : `/api/crm/${leadId}/messages`;
    fetch(url)
      .then(r => r.ok ? r.json() as Promise<{ messages?: CrmMessage[] }> : null)
      .then(d => {
        const incoming = d?.messages ?? [];
        if (incremental) {
          if (incoming.length > 0) {
            setMessages(prev => {
              const seen = new Set(prev.map(m => m.id));
              const fresh = incoming.filter(m => !seen.has(m.id));
              if (fresh.length === 0) return prev;
              // Tira as bolhas otimistas que a mensagem real acabou de substituir
              const base = prev.filter(m => !(
                String(m.id).startsWith('temp-')
                && fresh.some(f => f.direction === 'out' && f.text === m.text)
              ));
              return [...base, ...fresh];
            });
          }
        } else {
          setMessages(incoming);
        }
        const last = incoming[incoming.length - 1];
        if (last?.created_at) lastMsgTsRef.current = last.created_at;
        setLoading(false);
        if ((atBottom || initial) && (!incremental || incoming.length > 0)) {
          requestAnimationFrame(() => scrollToBottom(initial ? 'instant' : 'smooth'));
        }
      })
      .catch(() => setLoading(false));
  }, [leadId]);

  useEffect(() => {
    lastMsgTsRef.current = null;
    pollCountRef.current = 0;
    syncedRef.current = false;
    queueMicrotask(() => setMessages([]));
    const first = window.setTimeout(() => loadMessages(true), 0);
    const poll = window.setInterval(() => {
      pollCountRef.current += 1;
      const full = pollCountRef.current % 10 === 0;
      loadMessages(false, { incremental: !full });
    }, 3_000);
    return () => { window.clearTimeout(first); window.clearInterval(poll); };
  }, [loadMessages]);

  // Conversa vazia costuma ser histórico que nunca foi importado da Evolution —
  // puxa uma vez e recarrega, igual o inbox faz ao abrir um lead sem mensagens.
  useEffect(() => {
    if (loading || messages.length > 0 || syncedRef.current || !clientId) return;
    syncedRef.current = true;
    let cancelled = false;
    fetch('/api/crm/sync-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, clientId, limit: 50 }),
    })
      .then(r => r.ok ? r.json() as Promise<{ imported?: number }> : null)
      .then(data => { if (!cancelled && (data?.imported ?? 0) > 0) loadMessages(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId, leadId, loading, loadMessages, messages.length]);

  async function doSend(payload: Record<string, unknown>): Promise<boolean> {
    setSending(true);
    setSendStatus(null);
    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempId,
      direction: 'out',
      text: String(payload.text ?? payload.url ?? ''),
      tipo: String(payload.tipo ?? 'texto'),
      created_at: new Date().toISOString(),
      whatsapp_status: 'pending',
      whatsapp_error: null,
    }]);
    requestAnimationFrame(() => scrollToBottom());
    try {
      const res = await fetch(`/api/crm/${leadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'out', ...payload }),
      });
      const data = await res.json().catch(() => ({})) as { wa_sent?: boolean; error?: string; wa_error?: string };
      if (!res.ok) {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        setSendStatus('err');
        setSendError(data.error ?? `Erro ${res.status}`);
      } else {
        setSendStatus(data.wa_sent ? 'ok' : 'err');
        if (!data.wa_sent && data.wa_error) setSendError(data.wa_error);
        loadMessages();
        requestAnimationFrame(() => scrollToBottom());
      }
      window.setTimeout(() => { setSendStatus(null); setSendError(null); }, 6000);
      return res.ok;
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setSendStatus('err');
      setSendError(String(err));
      window.setTimeout(() => { setSendStatus(null); setSendError(null); }, 6000);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function sendText() {
    const body = text.trim();
    if (!body || sending) return;
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    const ok = await doSend({ tipo: 'texto', text: body });
    // Falhou: devolve o texto pro campo em vez de descartar o que foi digitado
    if (!ok) setText(body);
  }

  async function sendFile(file: File) {
    setUploading(true);
    setSendError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setSendStatus('err');
        setSendError(data.error ?? 'Não foi possível subir o arquivo');
        window.setTimeout(() => { setSendStatus(null); setSendError(null); }, 6000);
        return;
      }
      await doSend({ tipo: tipoFromFile(file), url: data.url });
    } catch (err) {
      setSendStatus('err');
      setSendError(err instanceof Error ? err.message : 'Erro ao enviar arquivo');
      window.setTimeout(() => { setSendStatus(null); setSendError(null); }, 6000);
    } finally {
      setUploading(false);
    }
  }

  const busy = sending || uploading;

  return (
    // ⚠️ `w-full` não é enfeite: o wrapper no modal é flex em LINHA, e sem
    // largura declarada esta raiz encolhe até o conteúdo — sobrava uma faixa
    // morta à direita do chat dentro do próprio modal.
    <div className="flex h-full w-full min-h-0 flex-col bg-background/40">
      {/* Cabeçalho */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
            {(nome ?? numero ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-foreground">{nome || formatPhoneBR(numero) || 'Sem nome'}</p>
            <p className="truncate text-[10px] text-muted-foreground">{formatPhoneBR(numero) || 'Sem número'}</p>
          </div>
        </div>
        {onOpenFullChat && (
          <button
            type="button"
            onClick={onOpenFullChat}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" /> Inbox
          </button>
        )}
      </div>

      {/* Mensagens */}
      <div ref={areaRef} className="flex-1 min-h-0 space-y-1 overflow-y-auto py-3">
        {loading ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Carregando mensagens…</p>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageCircle className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">Nenhuma mensagem ainda. Mande a primeira abaixo.</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const showSep = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
            return (
              <Fragment key={m.id}>
                {showSep && <DateSeparator label={dateSeparatorLabel(m.created_at)} />}
                <MessageBubble msg={m} onImageClick={setLightboxSrc} />
              </Fragment>
            );
          })
        )}
      </div>

      {/* Feedback de envio */}
      {(sendStatus || sendError) && (
        <div className={cn(
          'flex shrink-0 items-center gap-1.5 px-4 py-1.5 text-[11px]',
          sendStatus === 'ok' ? 'text-emerald-400' : 'text-red-400',
        )}>
          {sendStatus === 'ok'
            ? <><CheckCircle2 className="h-3 w-3" /> Enviado no WhatsApp</>
            : <><AlertCircle className="h-3 w-3 shrink-0" /> <span className="truncate">{sendError ?? 'Falha ao enviar'}</span></>}
        </div>
      )}

      {/* Composer */}
      <div className="relative shrink-0 border-t border-border px-3 py-2.5">
        {emojiOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} />
            <div className="absolute bottom-full left-3 z-20 mb-2 grid w-[248px] grid-cols-10 gap-0.5 rounded-lg border border-border bg-card p-2 shadow-xl">
              {EMOJIS.map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => { setText(prev => prev + e); setEmojiOpen(false); textareaRef.current?.focus(); }}
                  className="rounded p-0.5 text-base leading-none hover:bg-muted"
                >
                  {e}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="flex items-end gap-1.5">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void sendFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => setEmojiOpen(v => !v)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Emojis"
          >
            <Smile className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            aria-label="Anexar arquivo"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </button>
          <textarea
            ref={textareaRef}
            value={text}
            rows={1}
            placeholder="Escreva uma mensagem…"
            onChange={e => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendText(); }
            }}
            className="max-h-[120px] min-h-[36px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-tight focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => void sendText()}
            disabled={busy || !text.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            aria-label="Enviar"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Lightbox acima do modal (z-50) */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxSrc(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
          <img src={lightboxSrc} alt="Imagem" className="max-h-full max-w-full rounded-lg object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
