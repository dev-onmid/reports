"use client";

/**
 * Conectar / reconectar o WhatsApp do CRM pelo próprio cliente (2026-10-09).
 * Mesmo padrão do QR da agência (Rastreamento): fases, consulta a cada 3 s,
 * QR renovado sozinho a cada 40 s e fechamento automático ao conectar.
 * A diferença é o aviso de NÚMERO TROCADO — ver /api/crm/whatsapp-conexao.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Smartphone, X } from 'lucide-react';

type Fase = 'carregando' | 'qr' | 'sucesso' | 'numero_diferente' | 'erro';

const fmtTel = (d: string | null | undefined) => {
  const s = String(d ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (s.length === 11) return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`;
  if (s.length === 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
  return d ?? '';
};

export function ConectarWhatsappModal({ clientId, instanciaId, onFechar, onConectou }: {
  clientId: string;
  instanciaId?: string | null;
  onFechar: () => void;
  onConectou?: () => void;
}) {
  const [fase, setFase] = useState<Fase>('carregando');
  const [qr, setQr] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(40);
  const [numeros, setNumeros] = useState<{ novo: string | null; antigo: string | null }>({ novo: null, antigo: null });
  const idRef = useRef<string | null>(instanciaId ?? null);
  const [tentativa, setTentativa] = useState(0);
  // Em ref: a página-mãe recria a função a cada render (poll de 8 s) e, como
  // dependência do efeito, reiniciaria a consulta antes de ela rodar.
  const conectouRef = useRef(onConectou);
  useEffect(() => { conectouRef.current = onConectou; }, [onConectou]);

  // Gera (ou renova) o QR.
  useEffect(() => {
    let vivo = true;
    fetch('/api/crm/whatsapp-conexao', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, instanciaId: idRef.current ?? undefined }),
    })
      .then(async r => ({ ok: r.ok, d: await r.json().catch(() => ({})) as { estado?: string; qr?: string; error?: string; instanciaId?: string } }))
      .then(({ ok, d }) => {
        if (!vivo) return;
        if (d.instanciaId) idRef.current = d.instanciaId;
        if (d.estado === 'open') { setFase('sucesso'); return; }
        if (!ok || !d.qr) { setErro(d.error ?? 'Não foi possível gerar o QR Code.'); setFase('erro'); return; }
        setQr(d.qr); setSegundos(40); setFase('qr');
      })
      .catch(() => { if (vivo) { setErro('Sem conexão com o servidor.'); setFase('erro'); } });
    return () => { vivo = false; };
  }, [clientId, tentativa]);

  // Enquanto o QR está na tela: confere a conexão a cada 3 s e renova o QR em 40 s.
  useEffect(() => {
    if (fase !== 'qr') return;
    const consulta = window.setInterval(() => {
      if (!idRef.current) return;
      fetch(`/api/crm/whatsapp-conexao?clientId=${encodeURIComponent(clientId)}&instanciaId=${encodeURIComponent(idRef.current)}`)
        .then(r => r.ok ? r.json() as Promise<{ instancias: { estado: string; numero: string | null; numeroEsperado: string | null; numeroDiferente: boolean }[] }> : null)
        .then(d => {
          const i = d?.instancias?.[0];
          if (i?.estado !== 'open') return;
          setNumeros({ novo: i.numero, antigo: i.numeroEsperado });
          setFase(i.numeroDiferente ? 'numero_diferente' : 'sucesso');
          conectouRef.current?.();
        })
        .catch(() => {});
    }, 3000);
    const relogio = window.setInterval(() => {
      setSegundos(s => {
        if (s <= 1) { setTentativa(t => t + 1); return 40; }
        return s - 1;
      });
    }, 1000);
    return () => { window.clearInterval(consulta); window.clearInterval(relogio); };
  }, [fase, clientId]);

  // Conectou com o número certo: fecha sozinho.
  useEffect(() => {
    if (fase !== 'sucesso') return;
    const t = window.setTimeout(onFechar, 2500);
    return () => window.clearTimeout(t);
  }, [fase, onFechar]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onFechar}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="h-1 bg-primary" />
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="font-heading text-lg uppercase tracking-wide">Conectar WhatsApp</h2>
          <button onClick={onFechar} aria-label="Fechar" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 px-5 pb-5">
          {fase === 'carregando' && (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" /> Gerando o QR Code…
            </div>
          )}

          {fase === 'qr' && qr && (
            <>
              <div className="mx-auto w-fit rounded-xl bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR Code do WhatsApp" className="h-56 w-56" />
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                Aguardando leitura · renova em {segundos}s
              </p>
              <ol className="space-y-1.5 text-xs text-muted-foreground">
                <li><b className="text-foreground">1.</b> No celular do WhatsApp da empresa, abra o WhatsApp.</li>
                <li><b className="text-foreground">2.</b> Toque em <b className="text-foreground">⋮</b> (ou Configurações) → <b className="text-foreground">Aparelhos conectados</b> → <b className="text-foreground">Conectar aparelho</b>.</li>
                <li><b className="text-foreground">3.</b> Aponte a câmera para este código. A tela fecha sozinha.</li>
              </ol>
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
                <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Use o celular com o número que atende os clientes. Escanear com outro número troca o WhatsApp do atendimento.
              </p>
            </>
          )}

          {fase === 'sucesso' && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-primary" />
              <p className="font-heading text-xl uppercase">Conectado!</p>
              <p className="text-xs text-muted-foreground">As mensagens voltam a chegar no CRM.</p>
            </div>
          )}

          {fase === 'numero_diferente' && (
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-3 text-xs text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Conectou o número <b>{fmtTel(numeros.novo)}</b>, mas este CRM atendia pelo <b>{fmtTel(numeros.antigo)}</b>.
                  As mensagens passam a sair pelo número novo. A Onmid foi avisada.
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Se foi engano, avise a Onmid para voltar ao número certo.</p>
              <button onClick={onFechar} className="w-full rounded-lg border border-border py-2 text-sm font-semibold">Entendi</button>
            </div>
          )}

          {fase === 'erro' && (
            <div className="space-y-3 py-2">
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-3 text-xs text-red-200">{erro}</p>
              <button onClick={() => { setFase('carregando'); setErro(null); setTentativa(t => t + 1); }}
                className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground">Tentar de novo</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
