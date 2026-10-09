"use client";

/**
 * Respostas rápidas do chat, por cliente (2026-10-09).
 *
 * No composer, digitar "/" abre a lista; "/endereco" filtra pelo atalho e Enter
 * (ou clique) troca o texto pela resposta. `{nome}` vira o primeiro nome do
 * lead — a mesma variável dos Disparos, para ninguém ter de aprender duas.
 */
import { useCallback, useEffect, useState } from 'react';
import { Trash2, X, Zap } from 'lucide-react';

export type RespostaRapida = { id: string; atalho: string; texto: string };

export function useRespostasRapidas(clientId: string) {
  const [lista, setLista] = useState<RespostaRapida[]>([]);
  const recarregar = useCallback(() => {
    if (!clientId) return;
    fetch(`/api/crm/respostas-rapidas?clientId=${encodeURIComponent(clientId)}`)
      .then(r => r.ok ? r.json() as Promise<{ respostas: RespostaRapida[] }> : { respostas: [] })
      .then(d => setLista(d.respostas ?? []))
      .catch(() => {});
  }, [clientId]);
  useEffect(() => { recarregar(); }, [recarregar]);
  return { lista, recarregar };
}

/** Respostas que casam com o que foi digitado depois da "/". */
export function respostasDoAtalho(texto: string, lista: RespostaRapida[]): RespostaRapida[] {
  if (!texto.startsWith('/') || texto.includes('\n')) return [];
  const q = texto.slice(1).trim().toLowerCase();
  return lista.filter(r => !q || r.atalho.includes(q) || r.texto.toLowerCase().includes(q)).slice(0, 8);
}

export function aplicarVariaveis(texto: string, nomeLead: string | null | undefined): string {
  const primeiro = (nomeLead ?? '').trim().split(/\s+/)[0] ?? '';
  // Nome com cara de telefone não é nome.
  const nome = /\d{4,}/.test(primeiro) ? '' : primeiro;
  return texto.replace(/\{nome\}/gi, nome).replace(/\s+([,!?.])/g, '$1').replace(/^[,\s]+/, '');
}

export function SugestoesResposta({ itens, onEscolher }: { itens: RespostaRapida[]; onEscolher: (r: RespostaRapida) => void }) {
  if (itens.length === 0) return null;
  return (
    <div className="max-h-52 overflow-y-auto border-b border-border bg-popover">
      {itens.map((r, i) => (
        <button key={r.id} type="button" onMouseDown={e => { e.preventDefault(); onEscolher(r); }}
          className="flex w-full items-start gap-2 px-4 py-2 text-left text-xs hover:bg-muted/60">
          <span className="shrink-0 font-mono font-bold text-primary">/{r.atalho}</span>
          <span className="line-clamp-2 text-muted-foreground">{r.texto}</span>
          {i === 0 && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">Enter</span>}
        </button>
      ))}
    </div>
  );
}

export function GerenciarRespostas({ clientId, lista, onMudou, onFechar }: {
  clientId: string; lista: RespostaRapida[]; onMudou: () => void; onFechar: () => void;
}) {
  const [atalho, setAtalho] = useState('');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    const r = await fetch('/api/crm/respostas-rapidas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, atalho, texto }),
    }).catch(() => null);
    if (!r?.ok) { setErro('Informe o atalho e o texto.'); return; }
    setAtalho(''); setTexto(''); onMudou();
  }
  async function apagar(id: string) {
    if (!window.confirm('Apagar esta resposta rápida?')) return;
    await fetch(`/api/crm/respostas-rapidas?clientId=${encodeURIComponent(clientId)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    onMudou();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onFechar}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold"><Zap className="h-4 w-4 text-primary" /> Respostas rápidas</h2>
          <button onClick={onFechar} aria-label="Fechar" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto px-5 py-4">
          {lista.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma ainda. Crie a primeira abaixo — depois é só digitar &quot;/&quot; na conversa.</p>}
          {lista.map(r => (
            <div key={r.id} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-xs">
              <span className="shrink-0 font-mono font-bold text-primary">/{r.atalho}</span>
              <span className="flex-1 whitespace-pre-wrap text-muted-foreground">{r.texto}</span>
              <button onClick={() => void apagar(r.id)} aria-label="Apagar" className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-border px-5 py-4">
          <input value={atalho} onChange={e => setAtalho(e.target.value)} placeholder="Atalho (ex.: endereco)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3}
            placeholder="Texto. Use {nome} para o primeiro nome do lead."
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          {erro && <p className="text-xs text-red-400">{erro}</p>}
          <div className="flex justify-end">
            <button onClick={() => void salvar()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Salvar resposta</button>
          </div>
        </div>
      </div>
    </div>
  );
}
