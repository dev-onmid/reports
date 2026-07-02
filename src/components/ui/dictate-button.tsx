'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any;

// Botão de ditado por voz — mesma engine (Web Speech API) usada na Luna, extraída aqui
// pra poder ser colada em qualquer textarea do sistema, não só no chat da Luna.
// Só funciona em navegadores com suporte (Chrome/Edge); some sozinho nos demais.
export function DictateButton({
  onTranscript,
  className,
  title,
}: {
  onTranscript: (text: string) => void;
  className?: string;
  title?: string;
}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<AnySR>(null);

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

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      title={title ?? (listening ? 'Parar ditado' : 'Ditar por voz')}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-primary',
        listening && 'animate-pulse border-red-400/50 bg-red-500/10 text-red-400',
        className,
      )}
    >
      {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
    </button>
  );
}
