'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "Analisar com IA" — roda a análise do CRM sob demanda nos leads que estão na
 * tela, para recuperar o retroativo que a automação desligada não fez.
 *
 * A tela é dona do ritmo: pede a prévia, confirma com o gestor e depois chama a
 * rota bloco a bloco. Isso é o que dá barra de progresso honesta e permite
 * parar no meio sem perder o que já foi analisado — cada bloco é definitivo.
 */

type Previa = {
  candidatos: string[];
  jaAnalisados: number;
  semConversa: number;
  timeInterno: number;
  blocos: number;
  leadsPorBloco: number;
  custo: { usd: number; brl: number };
};

type Resumo = { analisados: number; moveuStatus: number; moveuTemperatura: number; erros: number };

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function AnaliseIaModal({
  clientId,
  clientName,
  leadIds,
  periodoLabel,
  onClose,
  onConcluido,
}: {
  clientId: string;
  clientName: string;
  /** Os leads do recorte atual da tela (período + busca + filtros já aplicados). */
  leadIds: string[];
  periodoLabel: string;
  onClose: () => void;
  onConcluido: () => void;
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [incluirJaAnalisados, setIncluirJaAnalisados] = useState(false);
  // ⚠️ Derivado, não estado próprio: um `setCarregando(true)` no começo da
  // busca seria setState síncrono dentro do efeito. Zerar a prévia no handler
  // do checkbox (onde setState é legítimo) já devolve o estado de carregando.
  const carregando = previa === null && erro === null;
  const [rodando, setRodando] = useState(false);
  const [feitos, setFeitos] = useState(0);
  const [resumo, setResumo] = useState<Resumo>({ analisados: 0, moveuStatus: 0, moveuTemperatura: 0, erros: 0 });
  const [terminou, setTerminou] = useState(false);
  // ⚠️ Ref, não estado: o laço de blocos é assíncrono e leria um valor
  // congelado do render em que começou — com estado, "Parar" não pararia.
  const pararRef = useRef(false);

  // ⚠️ Chave de texto, não o array: `leadIds` chega de `filtered.map(...)`, um
  // array NOVO a cada render do CRM — e o CRM repinta a cada poll de 8s. Com o
  // array na dependência, a prévia seria refeita sem parar enquanto o modal
  // estivesse aberto.
  const chaveLeads = leadIds.join(',');

  useEffect(() => {
    // setState em callback de promise é o padrão que a regra de efeitos pede:
    // o fetch é o sistema externo e a resposta chega depois.
    let vivo = true;
    fetch('/api/crm/ai/analisar-lote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        leadIds: chaveLeads.split(','),
        acao: 'prever',
        incluirJaAnalisados,
      }),
    })
      .then(r => r.json())
      .then((data: Previa & { ok?: boolean; error?: string }) => {
        if (!vivo) return;
        if (!data.ok) setErro(data.error || 'Falha ao calcular.');
        else setPrevia(data);
      })
      .catch(() => { if (vivo) setErro('Falha ao calcular.'); });
    // Troca de recorte/checkbox descarta a resposta antiga em vez de deixá-la
    // sobrescrever a nova por chegar depois.
    return () => { vivo = false; };
  }, [clientId, chaveLeads, incluirJaAnalisados]);

  async function rodar() {
    if (!previa || previa.candidatos.length === 0) return;
    pararRef.current = false;
    setRodando(true);
    setTerminou(false);
    setFeitos(0);
    setResumo({ analisados: 0, moveuStatus: 0, moveuTemperatura: 0, erros: 0 });

    const blocos: string[][] = [];
    for (let i = 0; i < previa.candidatos.length; i += previa.leadsPorBloco) {
      blocos.push(previa.candidatos.slice(i, i + previa.leadsPorBloco));
    }

    for (const bloco of blocos) {
      if (pararRef.current) break;
      try {
        const r = await fetch('/api/crm/ai/analisar-lote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, leadIds: bloco, acao: 'analisar', incluirJaAnalisados }),
        });
        const data = await r.json();
        if (data.ok) {
          setResumo(a => ({
            analisados: a.analisados + Number(data.analisados ?? 0),
            moveuStatus: a.moveuStatus + Number(data.moveuStatus ?? 0),
            moveuTemperatura: a.moveuTemperatura + Number(data.moveuTemperatura ?? 0),
            erros: a.erros + Number(data.erros ?? 0),
          }));
        } else {
          // Bloco que falhou inteiro conta como erro e o laço continua: parar
          // tudo por causa de uma requisição perdida desperdiçaria o resto.
          setResumo(a => ({ ...a, erros: a.erros + bloco.length }));
        }
      } catch {
        setResumo(a => ({ ...a, erros: a.erros + bloco.length }));
      }
      setFeitos(f => f + bloco.length);
      // Atualiza o board a cada bloco — o gestor vê os cards andando enquanto roda.
      onConcluido();
    }

    setRodando(false);
    setTerminou(true);
  }

  const total = previa?.candidatos.length ?? 0;
  const pct = total === 0 ? 0 : Math.min(100, Math.round((feitos / total) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => { if (!rodando) onClose(); }}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold">Analisar com IA</h2>
          </div>
          <button type="button" onClick={onClose} disabled={rodando}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            A IA lê a conversa de cada lead de <span className="font-semibold text-foreground">{clientName}</span> no
            recorte <span className="font-semibold text-foreground">{periodoLabel}</span> e, quando tem certeza
            suficiente, move a etapa no Kanban e ajusta a temperatura.
          </p>

          {carregando && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Conferindo quais leads valem analisar…
            </div>
          )}

          {erro && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {erro}
            </div>
          )}

          {previa && !carregando && (
            <>
              <div className="rounded-xl border border-border bg-background/60 p-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-heading text-3xl leading-none text-primary">{total}</span>
                  <span className="text-xs text-muted-foreground">
                    {total === 1 ? 'conversa será analisada' : 'conversas serão analisadas'}
                  </span>
                </div>
                {total > 0 && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Custo estimado <span className="font-semibold text-foreground">{brl(previa.custo.brl)}</span> ·
                    {' '}{previa.blocos} {previa.blocos === 1 ? 'etapa' : 'etapas'} de até {previa.leadsPorBloco}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {previa.jaAnalisados > 0 && <span>{previa.jaAnalisados} já analisados (sem mensagem nova)</span>}
                  {previa.semConversa > 0 && <span>{previa.semConversa} sem conversa</span>}
                  {previa.timeInterno > 0 && <span>{previa.timeInterno} do time interno</span>}
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <input type="checkbox" checked={incluirJaAnalisados} disabled={rodando}
                  onChange={e => { setPrevia(null); setErro(null); setIncluirJaAnalisados(e.target.checked); }}
                  className="mt-0.5 h-3.5 w-3.5 accent-primary" />
                <span className="text-muted-foreground">
                  Reanalisar quem já foi analisado
                  <span className="block text-[11px] opacity-80">
                    Use depois de mudar os critérios da IA. Sem isso, conversa sem mensagem nova fica de
                    fora — reanalisar daria o mesmo resultado e cobraria de novo.
                  </span>
                </span>
              </label>

              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <p className="text-[11px] leading-relaxed text-amber-200/90">
                    Nenhuma mensagem é enviada e nenhuma conversão vai para Meta/Google nesta análise. Mover
                    uma etapa normalmente dispara follow-up e evento de conversão — em conversa antiga isso
                    mandaria WhatsApp para quem falou semanas atrás e enviaria venda velha para a campanha.
                    Aqui só o board e o histórico mudam.
                  </p>
                </div>
              </div>

              {(rodando || terminou) && (
                <div className="space-y-2">
                  <div className="h-2 w-full overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{feitos} de {total}</span>
                    <span>{resumo.moveuStatus} de etapa</span>
                    <span>{resumo.moveuTemperatura} de temperatura</span>
                    {resumo.erros > 0 && <span className="text-red-300">{resumo.erros} com erro</span>}
                  </div>
                </div>
              )}

              {terminou && (
                <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <p className="text-[11px] text-foreground">
                    {resumo.analisados === 0
                      ? 'Nenhuma conversa foi analisada.'
                      : `${resumo.analisados} ${resumo.analisados === 1 ? 'conversa analisada' : 'conversas analisadas'}. ${resumo.moveuStatus === 0 ? 'A IA não teve certeza suficiente para mover ninguém de etapa.' : `${resumo.moveuStatus} ${resumo.moveuStatus === 1 ? 'lead mudou' : 'leads mudaram'} de etapa.`}`}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3 shrink-0">
          {rodando ? (
            <>
              <button type="button" onClick={() => { pararRef.current = true; }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
                Parar
              </button>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analisando…
              </span>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
                {terminou ? 'Fechar' : 'Cancelar'}
              </button>
              {!terminou && (
                <button type="button" onClick={rodar} disabled={carregando || total === 0}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-opacity',
                    (carregando || total === 0) && 'opacity-40 cursor-not-allowed',
                  )}>
                  <Sparkles className="h-3.5 w-3.5" />
                  {total === 0 ? 'Nada para analisar' : `Analisar ${total}`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
