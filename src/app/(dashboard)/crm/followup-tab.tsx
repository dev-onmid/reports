"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Pencil, Trash2, X,
  ToggleLeft, ToggleRight, Clock, MessageSquare, Zap,
  ArrowRight, AlertCircle, CheckCircle2, Timer, Send,
  Upload, Mic, Square, Loader2, Users,
  CalendarDays, MoreVertical, Paperclip, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DictateButton } from '@/components/ui/dictate-button';

// ── Types ─────────────────────────────────────────────────────────────────────

type Regra = {
  id: string;
  nome: string;
  status_gatilho: string;
  ativo: boolean;
  created_at: string;
  total_mensagens: number;
};

type TipoParte = 'texto' | 'imagem' | 'audio' | 'video' | 'documento';

type Parte = { tipo: TipoParte; conteudo: string };

type Mensagem = {
  id: string;
  ordem: number;
  tipo: TipoParte;
  conteudo: string;
  partes: Parte[] | null;
  delay_minutos: number;
  timer_sem_resposta_horas: number;
  acao_sem_resposta: 'mover_status' | 'proxima_mensagem';
  status_destino: string | null;
};

type Execucao = {
  id: string;
  lead_id: string;
  lead_nome: string | null;
  lead_numero: string | null;
  regra_nome: string;
  msg_tipo: string;
  msg_conteudo: string;
  msg_ordem: number;
  status: 'aguardando_envio' | 'aguardando_resposta' | 'respondido' | 'expirado' | 'cancelado';
  scheduled_at: string;
  enviado_em: string | null;
  expira_em: string | null;
  respondido_em: string | null;
};

const TIPO_OPTIONS: { value: TipoParte; label: string; emoji: string }[] = [
  { value: 'texto',     label: 'Texto',        emoji: '💬' },
  { value: 'imagem',    label: 'Imagem',       emoji: '🖼️' },
  { value: 'audio',     label: 'Áudio (voz)',  emoji: '🎤' },
  { value: 'video',     label: 'Vídeo',        emoji: '🎬' },
  { value: 'documento', label: 'Documento',    emoji: '📄' },
];

const FORMATO_GUIDE: Record<TipoParte, { formatos: string; dica: string }> = {
  texto:     { formatos: '', dica: '' },
  imagem:    { formatos: '.jpg .jpeg .png .webp .gif', dica: 'Google Drive: Compartilhar → clicar link → trocar /view por /uc?export=download&id=ID_DO_ARQUIVO' },
  audio:     { formatos: '.mp3 .ogg .opus .m4a (recomendado .ogg ou .opus para voz)', dica: 'Google Drive: mesmo processo da imagem. Arquivo .ogg ativa o ícone de áudio de voz no WhatsApp.' },
  video:     { formatos: '.mp4 (único formato aceito pelo WhatsApp)', dica: 'Google Drive: mesmo processo. Dropbox: troque ?dl=0 por ?dl=1 no link.' },
  documento: { formatos: '.pdf .docx .xlsx .pptx .txt', dica: 'Qualquer CDN com link direto funciona. Google Drive: mesmo processo da imagem.' },
};

const ACAO_OPTIONS = [
  { value: 'mover_status',      label: 'Mover para outro status' },
  { value: 'proxima_mensagem',  label: 'Enviar próxima mensagem' },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60_000);
  const hours = Math.floor(abs / 3_600_000);
  const days = Math.floor(abs / 86_400_000);
  const prefix = diff < 0 ? 'em ' : 'há ';
  if (mins < 1)   return diff < 0 ? 'agora' : 'agora';
  if (hours < 1)  return `${prefix}${mins}min`;
  if (days < 1)   return `${prefix}${hours}h`;
  return `${prefix}${days}d`;
}

const STATUS_BADGE: Record<string, string> = {
  aguardando_envio:     'bg-amber-500/15 text-amber-400',
  aguardando_resposta:  'bg-blue-500/15 text-blue-400',
  respondido:           'bg-emerald-500/15 text-emerald-400',
  expirado:             'bg-red-500/15 text-red-400',
  cancelado:            'bg-zinc-500/15 text-zinc-400',
};

const STATUS_LABEL: Record<string, string> = {
  aguardando_envio:    'Aguardando envio',
  aguardando_resposta: 'Aguardando resposta',
  respondido:          'Respondido',
  expirado:            'Expirado',
  cancelado:           'Cancelado',
};

function MiniSparkline({
  color,
  values,
}: {
  color: string;
  values: number[];
}) {
  const width = 180;
  const height = 28;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-7 w-full" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
    </svg>
  );
}

// ── File upload helper ────────────────────────────────────────────────────────

async function uploadFile(file: File): Promise<{ url?: string; error?: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json() as { url?: string; error?: string };
  return data;
}

// ── Audio recorder hook ───────────────────────────────────────────────────────

function useAudioRecorder(onDone: (url: string) => void) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [seconds,   setSeconds]   = useState(0);
  const [error,     setError]     = useState<string | null>(null);
  const recRef   = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setUploading(true);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: mimeType });
        const result = await uploadFile(file);
        setUploading(false);
        if (result.url) onDone(result.url);
        else setError(result.error ?? 'Falha ao fazer upload do áudio');
      };
      rec.start(100);
      recRef.current = rec;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch (err) {
      setError('Não foi possível acessar o microfone: ' + String(err));
    }
  }

  function stop() {
    recRef.current?.stop();
    recRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }

  return { recording, uploading, seconds, error, start, stop };
}

// ── Single parte editor row ───────────────────────────────────────────────────

function ParteRow({
  parte,
  onChange,
  onDelete,
  showDelete,
}: {
  parte: Parte;
  onChange: (p: Parte) => void;
  onDelete: () => void;
  showDelete: boolean;
}) {
  const [showGuia,   setShowGuia]   = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [uploadErr,  setUploadErr]  = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const guia = FORMATO_GUIDE[parte.tipo];
  const hasGuia = parte.tipo !== 'texto';

  // Accept attrs per type
  const acceptMap: Record<TipoParte, string> = {
    texto:     '',
    imagem:    'image/jpeg,image/png,image/webp,image/gif',
    audio:     'audio/*',
    video:     'video/mp4',
    documento: '.pdf,.docx,.xlsx,.pptx,.txt,application/pdf',
  };

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadErr(null);
    setUploading(true);
    const result = await uploadFile(file);
    setUploading(false);
    if (result.url) onChange({ ...parte, conteudo: result.url });
    else setUploadErr(result.error ?? 'Erro no upload');
    // Reset input
    e.target.value = '';
  }

  const recorder = useAudioRecorder(url => onChange({ ...parte, conteudo: url }));

  return (
    <div className="rounded-xl border border-border bg-background/50 p-3 space-y-2">
      {/* Tipo pills */}
      <div className="flex items-center gap-2">
        <div className="flex flex-wrap gap-1 flex-1">
          {TIPO_OPTIONS.map(o => (
            <button key={o.value} type="button"
              onClick={() => onChange({ ...parte, tipo: o.value, conteudo: '' })}
              className={cn(
                'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors',
                parte.tipo === o.value
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
              )}>
              <span>{o.emoji}</span> {o.label}
            </button>
          ))}
        </div>
        {showDelete && (
          <button type="button" onClick={onDelete}
            className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors p-1">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Content input */}
      {parte.tipo === 'texto' ? (
        <div className="space-y-1">
          <div className="relative">
            <textarea
              value={parte.conteudo}
              onChange={e => onChange({ ...parte, conteudo: e.target.value })}
              rows={3}
              placeholder="Olá {{nome}}, tudo bem? Gostaria de saber se tem alguma dúvida..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <DictateButton className="absolute bottom-2 right-2" onTranscript={(text) => onChange({ ...parte, conteudo: parte.conteudo ? `${parte.conteudo} ${text}` : text })} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Variáveis: {['{{nome}}', '{{telefone}}', '{{status}}', '{{campanha}}'].map(v => (
              <code key={v} className="bg-muted px-1 rounded mr-1">{v}</code>
            ))}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* URL input */}
          <input
            value={parte.conteudo}
            onChange={e => onChange({ ...parte, conteudo: e.target.value })}
            placeholder="https://... (ou use os botões abaixo)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* File picker */}
            <button type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-50 transition-colors">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? 'Enviando…' : 'Escolher arquivo'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={acceptMap[parte.tipo]}
              onChange={handleFileChange}
            />

            {/* Audio recorder — only for audio type */}
            {parte.tipo === 'audio' && (
              recorder.recording ? (
                <button type="button" onClick={recorder.stop}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors animate-pulse">
                  <Square className="h-3.5 w-3.5" />
                  Parar ({recorder.seconds}s)
                </button>
              ) : (
                <button type="button" onClick={recorder.start}
                  disabled={recorder.uploading}
                  className="flex items-center gap-1.5 rounded-lg border border-violet-500/50 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-400 hover:bg-violet-500/20 disabled:opacity-50 transition-colors">
                  {recorder.uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
                  {recorder.uploading ? 'Salvando…' : 'Gravar áudio'}
                </button>
              )
            )}

            {/* Format guide */}
            {hasGuia && (
              <button type="button"
                onClick={() => setShowGuia(v => !v)}
                className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors">
                <AlertCircle className="h-3 w-3" />
                {showGuia ? 'Ocultar guia' : 'Guia de formatos'}
              </button>
            )}
          </div>

          {/* Audio recorder error */}
          {recorder.error && (
            <p className="text-[11px] text-red-400">{recorder.error}</p>
          )}

          {/* Upload error */}
          {uploadErr && (
            <p className="text-[11px] text-red-400">{uploadErr}</p>
          )}

          {/* Preview when URL is set */}
          {parte.conteudo && (
            <div className="text-[11px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{parte.conteudo}</span>
            </div>
          )}

          {/* Format guide panel */}
          {showGuia && (
            <div className="rounded-lg bg-muted/50 border border-border px-3 py-2.5 text-[11px] space-y-1.5">
              <p><span className="font-bold text-foreground">Formatos aceitos:</span> <span className="text-muted-foreground">{guia.formatos}</span></p>
              <div className="border-t border-border/50 pt-1.5 space-y-1">
                <p className="font-bold text-foreground">Usando link (URL):</p>
                <p className="text-muted-foreground">{guia.dica}</p>
                <p className="text-muted-foreground"><span className="text-emerald-400 font-bold">✓</span> Cloudinary, AWS S3, CDN direto — funcionam sem configuração.</p>
                <p className="text-muted-foreground"><span className="text-red-400 font-bold">✗</span> YouTube, Instagram, links de preview — não funcionam.</p>
              </div>
              <div className="border-t border-border/50 pt-1.5">
                <p className="font-bold text-foreground">Usando upload direto:</p>
                <p className="text-muted-foreground">Clique em "Escolher arquivo". Requer <code className="bg-muted px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> nas variáveis da Vercel e bucket <code className="bg-muted px-1 rounded">crm-media</code> público no Supabase Storage.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Message editor modal ──────────────────────────────────────────────────────

function MensagemModal({
  initial,
  statusOptions,
  onSave,
  onClose,
}: {
  initial: Partial<Mensagem> | null;
  statusOptions: string[];
  onSave: (data: Omit<Mensagem, 'id' | 'ordem'>) => Promise<void>;
  onClose: () => void;
}) {
  const initialPartes: Parte[] = (() => {
    if (initial?.partes?.length) return initial.partes;
    if (initial?.conteudo) return [{ tipo: initial.tipo ?? 'texto', conteudo: initial.conteudo }];
    return [{ tipo: 'texto', conteudo: '' }];
  })();

  const [partes,   setPartes]   = useState<Parte[]>(initialPartes);
  const [delayMin, setDelayMin] = useState(String(initial?.delay_minutos ?? 0));
  const [timerH,   setTimerH]   = useState(String(initial?.timer_sem_resposta_horas ?? 24));
  const [acao,     setAcao]     = useState<Mensagem['acao_sem_resposta']>(initial?.acao_sem_resposta ?? 'mover_status');
  const [destino,  setDestino]  = useState(initial?.status_destino ?? '');
  const [saving,   setSaving]   = useState(false);

  function addParte() {
    setPartes(prev => [...prev, { tipo: 'texto', conteudo: '' }]);
  }

  function updateParte(i: number, p: Parte) {
    setPartes(prev => prev.map((x, idx) => idx === i ? p : x));
  }

  function deleteParte(i: number) {
    setPartes(prev => prev.filter((_, idx) => idx !== i));
  }

  const canSave = partes.length > 0 && partes.every(p => p.conteudo.trim().length > 0);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    await onSave({
      tipo: partes[0].tipo,
      conteudo: partes[0].conteudo.trim(),
      partes: partes.map(p => ({ tipo: p.tipo, conteudo: p.conteudo.trim() })),
      delay_minutos: Math.max(0, parseInt(delayMin) || 0),
      timer_sem_resposta_horas: Math.max(0.5, parseFloat(timerH) || 24),
      acao_sem_resposta: acao,
      status_destino: acao === 'mover_status' ? (destino || null) : null,
    });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold">{initial?.id ? 'Editar passo' : 'Novo passo'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* Info box */}
          <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-[11px] text-muted-foreground">
            💡 Um <strong className="text-foreground">passo</strong> pode ter várias partes enviadas em sequência — misture texto, imagem, áudio e vídeo como quiser.
          </div>

          {/* Partes */}
          {partes.map((p, i) => (
            <ParteRow key={i} parte={p}
              onChange={updated => updateParte(i, updated)}
              onDelete={() => deleteParte(i)}
              showDelete={partes.length > 1}
            />
          ))}

          <button type="button" onClick={addParte}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-xs font-semibold text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
            <Plus className="h-3.5 w-3.5" /> Adicionar parte
          </button>

          <div className="border-t border-border pt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Delay antes de enviar</span>
                <div className="relative">
                  <input type="number" min="0" value={delayMin} onChange={e => setDelayMin(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-12 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">min</span>
                </div>
                <p className="text-[10px] text-muted-foreground">0 = envia imediatamente</p>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Timer sem resposta</span>
                <div className="relative">
                  <input type="number" min="0.5" step="0.5" value={timerH} onChange={e => setTimerH(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-12 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">h</span>
                </div>
                <p className="text-[10px] text-muted-foreground">Ex: 24h = 1 dia sem resposta</p>
              </label>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Se não responder em {timerH}h:</span>
              <div className="flex gap-3">
                {ACAO_OPTIONS.map(o => (
                  <label key={o.value} className="flex items-center gap-2 cursor-pointer flex-1 rounded-lg border border-border p-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-colors">
                    <input type="radio" value={o.value} checked={acao === o.value} onChange={() => setAcao(o.value as Mensagem['acao_sem_resposta'])}
                      className="accent-primary shrink-0" />
                    <span className="text-xs font-semibold">{o.label}</span>
                  </label>
                ))}
              </div>
              {acao === 'mover_status' && (
                <select value={destino} onChange={e => setDestino(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary appearance-none">
                  <option value="">— Selecionar status destino —</option>
                  {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !canSave}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rule detail (message sequence) ───────────────────────────────────────────

function RegraDetail({
  regra, clientId, statusOptions, onBack,
}: {
  regra: Regra;
  clientId: string;
  statusOptions: string[];
  onBack: () => void;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editing,   setEditing]   = useState<Mensagem | null | 'new'>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/crm/followup/regras/${regra.id}/mensagens`)
      .then(r => r.ok ? r.json() as Promise<Mensagem[]> : [])
      .then(d => { setMensagens(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [regra.id]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(data: Omit<Mensagem, 'id' | 'ordem'>) {
    const payload = { ...data, partes: data.partes ?? null };
    if (editing === 'new') {
      await fetch(`/api/crm/followup/regras/${regra.id}/mensagens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, clientId }),
      });
    } else if (editing !== null && typeof editing === 'object') {
      await fetch(`/api/crm/followup/mensagens/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    setEditing(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover esta mensagem?')) return;
    await fetch(`/api/crm/followup/mensagens/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-xs font-semibold flex items-center gap-1">
          ← Voltar
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-bold">{regra.nome}</span>
        <span className="ml-1 text-xs text-muted-foreground">Gatilho: <strong>{regra.status_gatilho}</strong></span>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Carregando mensagens…</div>
      ) : (
        <div className="space-y-2">
          {mensagens.map((msg, i) => (
            <div key={msg.id} className="rounded-xl border border-border bg-card p-4 flex gap-4 items-start">
              {/* Step indicator */}
              <div className="flex flex-col items-center shrink-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold">
                  {msg.ordem}
                </div>
                {i < mensagens.length - 1 && <div className="w-px flex-1 bg-border mt-1 min-h-4" />}
              </div>

              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase">
                    {TIPO_OPTIONS.find(t => t.value === msg.tipo)?.label ?? msg.tipo}
                  </span>
                  {msg.delay_minutos > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3" /> {msg.delay_minutos >= 60 ? `${(msg.delay_minutos/60).toFixed(1)}h delay` : `${msg.delay_minutos}min delay`}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Timer className="h-3 w-3" /> timer {msg.timer_sem_resposta_horas}h
                  </span>
                </div>

                <p className="text-sm text-foreground line-clamp-2 break-all">
                  {msg.tipo === 'texto' ? msg.conteudo : `URL: ${msg.conteudo}`}
                </p>

                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  {msg.acao_sem_resposta === 'mover_status'
                    ? `Mover para "${msg.status_destino ?? '—'}"`
                    : 'Enviar próxima mensagem'}
                </div>
              </div>

              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditing(msg)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleDelete(msg.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {mensagens.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-muted/5 p-8 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
              <p className="text-xs text-muted-foreground">Adicione a primeira mensagem da cadência.</p>
            </div>
          )}

          <button onClick={() => setEditing('new')}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 py-3 text-sm font-semibold text-primary hover:bg-primary/5 transition-colors">
            <Plus className="h-4 w-4" /> Adicionar mensagem
          </button>
        </div>
      )}

      {editing !== null && (
        <MensagemModal
          initial={editing === 'new' ? null : editing}
          statusOptions={statusOptions}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ── Executions monitor ────────────────────────────────────────────────────────

function ExecucoesView({ clientId, onProcess, processing }: { clientId: string; onProcess: () => void; processing: boolean }) {
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/crm/followup/execucoes?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<Execucao[]> : [])
      .then(d => { setExecucoes(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function handleCancel(id: string) {
    await fetch(`/api/crm/followup/execucoes/${id}/cancelar`, { method: 'POST' });
    load();
  }

  const visible = filter
    ? execucoes.filter(e => e.status === filter)
    : execucoes;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {['', 'aguardando_envio', 'aguardando_resposta', 'respondido', 'expirado', 'cancelado'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
              filter === s ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
            {s === '' ? 'Todos' : STATUS_LABEL[s]}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">↻ Atualizar</button>
        <button onClick={onProcess} disabled={processing}
          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors">
          {processing ? '…' : '▶ Processar agora'}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Nenhuma execução encontrada.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/30">
              <tr>
                {['Lead', 'Regra', 'Mensagem', 'Status', 'Enviado', 'Expira', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(e => (
                <tr key={e.id} className="border-t border-border/40 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5">
                    <p className="font-semibold">{e.lead_nome ?? '—'}</p>
                    <p className="text-muted-foreground">{e.lead_numero}</p>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{e.regra_nome}</td>
                  <td className="px-3 py-2.5 max-w-[160px]">
                    <p className="text-muted-foreground text-[10px]">#{e.msg_ordem} {e.msg_tipo}</p>
                    <p className="truncate">{e.msg_conteudo.slice(0, 40)}{e.msg_conteudo.length > 40 ? '…' : ''}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', STATUS_BADGE[e.status] ?? 'bg-zinc-500/15 text-zinc-400')}>
                      {STATUS_LABEL[e.status] ?? e.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{relativeTime(e.enviado_em)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{relativeTime(e.expira_em)}</td>
                  <td className="px-3 py-2.5">
                    {(e.status === 'aguardando_envio' || e.status === 'aguardando_resposta') && (
                      <button onClick={() => handleCancel(e.id)}
                        className="rounded border border-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-400 hover:bg-red-500/10 transition-colors">
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main FollowupTab ──────────────────────────────────────────────────────────

export function FollowupTab({
  clientId,
  statusOptions,
}: {
  clientId: string;
  statusOptions: string[];
}) {
  const [regras,     setRegras]     = useState<Regra[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view,       setView]       = useState<'regras' | 'execucoes'>('regras');
  const [showNew,    setShowNew]    = useState(false);
  const [processing, setProcessing] = useState(false);
  const [execSummary, setExecSummary] = useState<Execucao[]>([]);

  // New rule form
  const [newNome,    setNewNome]    = useState('');
  const [newGatilho, setNewGatilho] = useState('');
  const [creating,   setCreating]   = useState(false);

  const loadRegras = useCallback(() => {
    setLoading(true);
    fetch(`/api/crm/followup/regras?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<Regra[]> : [])
      .then(d => { setRegras(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [clientId]);

  const loadExecSummary = useCallback(() => {
    fetch(`/api/crm/followup/execucoes?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<Execucao[]> : [])
      .then(setExecSummary)
      .catch(() => setExecSummary([]));
  }, [clientId]);

  useEffect(() => { loadRegras(); }, [loadRegras]);
  useEffect(() => { loadExecSummary(); }, [loadExecSummary]);

  async function handleToggle(regra: Regra) {
    await fetch(`/api/crm/followup/regras/${regra.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !regra.ativo }),
    });
    loadRegras();
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir esta regra de follow up? Todos os dados serão perdidos.')) return;
    await fetch(`/api/crm/followup/regras/${id}`, { method: 'DELETE' });
    if (selectedId === id) setSelectedId(null);
    loadRegras();
  }

  async function handleProcessNow() {
    setProcessing(true);
    await fetch('/api/crm/followup/processar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    }).catch(() => null);
    setProcessing(false);
    loadExecSummary();
  }

  async function handleCreate() {
    if (!newNome.trim() || !newGatilho.trim()) return;
    setCreating(true);
    const res = await fetch('/api/crm/followup/regras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, nome: newNome.trim(), status_gatilho: newGatilho.trim() }),
    });
    if (res.ok) {
      const regra = await res.json() as Regra;
      setNewNome('');
      setNewGatilho('');
      setShowNew(false);
      loadRegras();
      setSelectedId(regra.id);
    }
    setCreating(false);
  }

  const selectedRegra = regras.find(r => r.id === selectedId) ?? null;
  const regrasAtivas = regras.filter(regra => regra.ativo).length;
  const mensagensConfiguradas = regras.reduce((sum, regra) => sum + regra.total_mensagens, 0);
  const mensagensEnviadas = execSummary.filter(execucao => !!execucao.enviado_em).length;
  const leadsImpactados = new Set(execSummary.map(execucao => execucao.lead_id).filter(Boolean)).size;
  const taxaEngajamento = execSummary.length
    ? Math.round((execSummary.filter(execucao => execucao.status === 'respondido').length / execSummary.length) * 100)
    : 0;
  const kpis = [
    {
      label: 'Total de regras',
      value: regras.length.toLocaleString('pt-BR'),
      sub: `${regrasAtivas} ativa${regrasAtivas !== 1 ? 's' : ''} · ${mensagensConfiguradas} mensagens`,
      Icon: Users,
      color: '#55f52f',
      bg: 'bg-primary/10',
      border: 'border-primary/20',
      values: [2, 2, 3, 3, 4, regrasAtivas, regras.length, regrasAtivas + 1, regras.length],
    },
    {
      label: 'Mensagens enviadas',
      value: mensagensEnviadas.toLocaleString('pt-BR'),
      sub: 'histórico de execuções',
      Icon: MessageSquare,
      color: '#60a5fa',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
      values: [0, 1, 1, 2, 3, mensagensEnviadas * 0.4, mensagensEnviadas * 0.7, mensagensEnviadas],
    },
    {
      label: 'Leads impactados',
      value: leadsImpactados.toLocaleString('pt-BR'),
      sub: 'por regras de follow up',
      Icon: Users,
      color: '#a855f7',
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/20',
      values: [0, 1, 2, leadsImpactados * 0.35, leadsImpactados * 0.5, leadsImpactados * 0.8, leadsImpactados],
    },
    {
      label: 'Taxa de engajamento',
      value: `${taxaEngajamento}%`,
      sub: 'respostas nas execuções',
      Icon: CalendarDays,
      color: '#eab308',
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500/20',
      values: [8, 12, 10, 18, 16, 24, taxaEngajamento],
    },
  ];

  if (selectedRegra) {
    return (
      <RegraDetail
        regra={selectedRegra}
        clientId={clientId}
        statusOptions={statusOptions}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ label, value, sub, Icon, color, bg, border, values }) => (
          <div key={label} className={cn('overflow-hidden rounded-[var(--radius)] border bg-card p-4', border)}>
            <div className="flex items-start gap-3">
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] border', bg, border)}>
                <Icon className="h-5 w-5" style={{ color }} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className="mt-1 font-heading text-xl font-normal leading-none">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
              </div>
            </div>
            <MiniSparkline color={color} values={values} />
          </div>
        ))}
      </div>

      <div className="flex items-end justify-between gap-3 border-b border-border">
        <div className="flex items-center gap-1">
          {([['regras', 'Regras'], ['execucoes', 'Monitoramento']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={cn('px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors',
                view === v ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
        {view === 'regras' && (
          <button onClick={() => setShowNew(v => !v)}
            className="mb-2 flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="h-3.5 w-3.5" /> Nova regra
          </button>
        )}
      </div>

      {view === 'execucoes' ? (
        <ExecucoesView clientId={clientId} onProcess={handleProcessNow} processing={processing} />
      ) : (
        <>
          {showNew && (
            <div className="rounded-[var(--radius)] border border-primary/30 bg-primary/5 p-4 space-y-3">
              <p className="text-xs font-bold text-primary">Nova regra de follow up</p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nome da regra</span>
                  <input value={newNome} onChange={e => setNewNome(e.target.value)} placeholder="Ex: Follow up proposta"
                    className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status gatilho</span>
                  <select value={newGatilho} onChange={e => setNewGatilho(e.target.value)}
                    className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary appearance-none">
                    <option value="">— Selecionar —</option>
                    {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowNew(false)} className="rounded-[var(--radius)] border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">Cancelar</button>
                <button onClick={handleCreate} disabled={creating || !newNome.trim() || !newGatilho.trim()}
                  className="rounded-[var(--radius)] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {creating ? 'Criando…' : 'Criar regra'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="rounded-[var(--radius)] border border-border bg-card py-12 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : regras.length === 0 ? (
            <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-10 text-center">
              <Zap className="h-9 w-9 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-semibold text-muted-foreground">Nenhuma regra ainda</p>
              <p className="text-xs text-muted-foreground mt-1">Crie uma regra para disparar mensagens automáticas quando um lead muda de status.</p>
            </div>
          ) : (
            <div className="rounded-[var(--radius)] border border-border bg-card p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Regras configuradas</p>
                <p className="text-xs text-muted-foreground">
                  {regras.length} regra{regras.length !== 1 ? 's' : ''} configurada{regras.length !== 1 ? 's' : ''}
                </p>
              </div>

              <div className="overflow-hidden rounded-[var(--radius)] border border-border">
                <div className="hidden grid-cols-[56px_minmax(180px,1fr)_minmax(150px,0.7fr)_minmax(130px,0.6fr)_120px] border-b border-border bg-muted/20 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground md:grid">
                  <span>Ordem</span>
                  <span>Nome da regra</span>
                  <span>Disparo</span>
                  <span>Status</span>
                  <span className="text-right">Ações</span>
                </div>

                {regras.map((regra, index) => (
                  <div key={regra.id}
                    className={cn('group grid gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 md:grid-cols-[56px_minmax(180px,1fr)_minmax(150px,0.7fr)_minmax(130px,0.6fr)_120px] md:items-center', regra.ativo ? '' : 'opacity-60')}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-bold text-primary">
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <div className="min-w-0 md:hidden">
                        <p className="text-sm font-bold truncate">{regra.nome}</p>
                        <p className="text-xs text-muted-foreground">{regra.status_gatilho}</p>
                      </div>
                    </div>

                    <button type="button" onClick={() => setSelectedId(regra.id)} className="hidden min-w-0 text-left md:block">
                      <p className="text-sm font-bold truncate">{regra.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {regra.total_mensagens} mensagem{regra.total_mensagens !== 1 ? 's' : ''} configurada{regra.total_mensagens !== 1 ? 's' : ''}
                      </p>
                    </button>

                    <div className="flex items-center gap-2 text-sm">
                      <Zap className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{regra.status_gatilho}</p>
                        <p className="text-xs text-muted-foreground">Após mudança de status</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                      <span className={cn('h-1.5 w-1.5 rounded-full', regra.ativo ? 'bg-primary' : 'bg-muted-foreground')} />
                      <div>
                        <p className={cn('font-semibold', regra.ativo ? 'text-primary' : 'text-muted-foreground')}>{regra.ativo ? 'Ativa' : 'Inativa'}</p>
                        <p className="text-xs text-muted-foreground">Execução automática</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleToggle(regra)} title={regra.ativo ? 'Desativar' : 'Ativar'}
                        className="shrink-0 transition-colors">
                        {regra.ativo
                          ? <ToggleRight className="h-6 w-6 text-primary" />
                          : <ToggleLeft  className="h-6 w-6 text-muted-foreground" />}
                      </button>
                      <button onClick={() => setSelectedId(regra.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] border border-border text-muted-foreground hover:text-foreground transition-colors">
                        <Paperclip className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(regra.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] border border-border text-muted-foreground hover:text-red-400 transition-colors">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-[var(--radius)] border border-primary/20 bg-primary/10 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/15">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold">Como funcionam as regras de follow up?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    As regras disparam mensagens automáticas conforme o status do lead e o tempo desde o último contato.
                  </p>
                </div>
              </div>
              <button className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-background px-4 text-xs font-semibold text-foreground hover:bg-muted">
                Ver guia completo <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Active follow-up badge (for kanban / list) ────────────────────────────────

export function useActiveFollowups(clientId: string, enabled: boolean) {
  const [activeLeadIds, setActiveLeadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!clientId || !enabled) return;
    fetch(`/api/crm/followup/execucoes?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<Execucao[]> : [])
      .then(data => {
        const ids = new Set(
          data
            .filter(e => e.status === 'aguardando_envio' || e.status === 'aguardando_resposta')
            .map(e => e.lead_id),
        );
        setActiveLeadIds(ids);
      })
      .catch(() => {});
  }, [clientId, enabled]);

  return activeLeadIds;
}

export function FollowupBadge({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold text-blue-400">
      <Send className="h-2.5 w-2.5" /> follow up
    </span>
  );
}
