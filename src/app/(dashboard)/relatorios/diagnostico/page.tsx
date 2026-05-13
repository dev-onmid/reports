"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClients } from '@/lib/client-store';
import { Sparkles, AlertCircle, ChevronDown, X, Upload } from 'lucide-react';

const THEMES = [
  { id: 'dark-purple', color: '#1A0A2E', label: 'Dark Purple' },
  { id: 'midnight',    color: '#0D0D0F', label: 'Midnight' },
  { id: 'navy',        color: '#0A1628', label: 'Navy' },
  { id: 'forest',      color: '#0A1F14', label: 'Forest' },
  { id: 'white',       color: '#FFFFFF', label: 'Branco' },
  { id: 'light',       color: '#F4F4F5', label: 'Cinza Claro' },
];

async function fileToBase64(file: File, maxW = 600, maxH = 300): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no ctx'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function LogoUpload({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value?: string;
  onChange: (v: string | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    try {
      const b64 = await fileToBase64(file);
      onChange(b64);
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <p className="text-[11px] text-muted-foreground/60">{hint}</p>
      {value ? (
        <div className="relative inline-flex">
          <img
            src={value}
            alt=""
            className="h-10 max-w-[160px] object-contain rounded-lg border border-border bg-background p-1.5"
          />
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-700 text-white flex items-center justify-center hover:bg-gray-600"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-background px-4 py-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          Fazer upload
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export default function NovoDiagnosticoPage() {
  const router = useRouter();
  const { clients } = useClients();

  const [clientId, setClientId]       = useState('');
  const [dateFrom, setDateFrom]       = useState('');
  const [dateTo, setDateTo]           = useState('');
  const [theme, setTheme]             = useState(THEMES[0].color);
  const [customColor, setCustomColor] = useState('');
  const [primaryLogo, setPrimaryLogo] = useState<string | undefined>();
  const [clientLogo, setClientLogo]   = useState<string | undefined>();
  const [generating, setGenerating]   = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to   = new Date(now.getFullYear(), now.getMonth(), 0);
    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(to.toISOString().split('T')[0]);
  }, []);

  async function handleGenerate() {
    if (!clientId || !dateFrom || !dateTo) {
      setError('Selecione o cliente e o período.');
      return;
    }
    const clientName = clients.find(c => c.id === clientId)?.name ?? clientId;
    setGenerating(true);
    setError('');

    const res = await fetch('/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId, clientName, dateFrom, dateTo,
        theme: customColor || theme,
        primaryLogo,
        clientLogo,
      }),
    });

    const d = await res.json() as { id?: string; error?: string };
    setGenerating(false);

    if (!res.ok || d.error) {
      setError(d.error ?? 'Erro ao gerar relatório.');
    } else {
      router.push(`/relatorios/${d.id}`);
    }
  }

  const activeTheme = customColor || theme;

  return (
    <div className="max-w-lg mx-auto space-y-5 pt-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Novo Diagnóstico</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Selecione o cliente e o período. O Claude analisa os dados da dashboard e monta o relatório automaticamente.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Client + Period */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Cliente</label>
          <div className="relative">
            <select
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm pr-8"
            >
              <option value="">Selecione o cliente...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1 space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Data início</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
            />
          </div>
          <div className="flex-1 space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Data fim</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Aparência</p>

        {/* Theme */}
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground">Fundo do relatório</label>
          <div className="flex items-center gap-2 flex-wrap">
            {THEMES.map(t => (
              <button
                key={t.id}
                type="button"
                title={t.label}
                onClick={() => { setTheme(t.color); setCustomColor(''); }}
                className="relative rounded-full transition-transform hover:scale-110"
                style={{
                  width: 28, height: 28,
                  background: t.color,
                  border: theme === t.color && !customColor
                    ? '3px solid #7B21D0'
                    : '2px solid rgba(255,255,255,0.15)',
                }}
              >
                {t.color === '#FFFFFF' || t.color === '#F4F4F5' ? (
                  <span className="absolute inset-0 rounded-full border border-gray-300" />
                ) : null}
              </button>
            ))}
            {/* Custom */}
            <div className="relative">
              <input
                type="color"
                value={customColor || theme}
                onChange={e => setCustomColor(e.target.value)}
                className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                title="Cor personalizada"
              />
              <div
                className="rounded-full flex items-center justify-center text-[10px] font-bold transition-transform hover:scale-110"
                style={{
                  width: 28, height: 28,
                  background: customColor || '#333',
                  border: customColor ? '3px solid #7B21D0' : '2px dashed rgba(255,255,255,0.25)',
                  color: customColor ? 'white' : '#888',
                }}
              >
                +
              </div>
            </div>
          </div>
          {/* Preview */}
          <div
            className="h-8 rounded-lg border border-border"
            style={{ background: activeTheme }}
          />
        </div>

        {/* Logos */}
        <div className="grid grid-cols-2 gap-5 pt-1 border-t border-border">
          <LogoUpload
            label="Logo da agência"
            hint="Aparece no canto superior direito de todos os slides"
            value={primaryLogo}
            onChange={setPrimaryLogo}
          />
          <LogoUpload
            label="Logo do cliente"
            hint="Aparece na capa do relatório (opcional)"
            value={clientLogo}
            onChange={setClientLogo}
          />
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={generating || !clientId || !dateFrom || !dateTo}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        style={{ background: '#7B21D0' }}
      >
        {generating ? (
          <>
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            Gerando com IA...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Gerar Diagnóstico
          </>
        )}
      </button>
    </div>
  );
}
