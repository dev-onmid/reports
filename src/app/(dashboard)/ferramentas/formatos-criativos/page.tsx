"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Link2, Loader2, Trash2, X } from 'lucide-react';
import dados from '@/lib/formatos-criativos.json';
import { BibliotecaFormatos, type ApiFormatos, type Formato } from '@/components/formatos-criativos/biblioteca';

// Página de apoio para reuniões: os 50 formatos de criativo da biblioteca
// "50 Formatos que escalam" (Serraglio), com vídeo, fichas e briefing para IA.
// A grade e a janela moram em @/components/formatos-criativos/biblioteca, que
// também serve o link público (/formatos/[token]). Aqui ficam só as rotas
// internas (atrás do login) e o compartilhamento.

const FORMATOS = (dados as { formatos: Formato[] }).formatos;
const num = (n: number) => String(n).padStart(2, '0');

type Link = { token: string; escopo: string; criado_por_nome: string | null; criado_em: string; acessos: number; ultimo_acesso: string | null };

export default function FormatosCriativosPage() {
  const [compartilhar, setCompartilhar] = useState<string | null>(null); // escopo aberto no modal

  const api = useMemo<ApiFormatos>(() => ({
    midia: (a) => `/api/formatos-criativos/midia?f=${encodeURIComponent(a)}`,
    fichas: (n) => `/api/formatos-criativos/fichas?numero=${n}`,
    compartilhar: (n) => setCompartilhar(String(n)),
  }), []);

  return (
    <>
      <BibliotecaFormatos
        formatos={FORMATOS}
        api={api}
        acoes={
          <button
            type="button"
            onClick={() => setCompartilhar('todos')}
            className="flex h-9 items-center gap-2 border border-white/15 px-3 text-[10px] font-bold uppercase tracking-widest text-white/80 hover:border-primary hover:text-primary"
          >
            <Link2 className="h-4 w-4" /> Compartilhar
          </button>
        }
      />
      {compartilhar && <CompartilharModal escopoInicial={compartilhar} onClose={() => setCompartilhar(null)} />}
    </>
  );
}

function rotuloEscopo(escopo: string) {
  if (escopo === 'todos') return 'Biblioteca inteira';
  const f = FORMATOS.find((x) => String(x.numero) === escopo);
  return f ? `${num(f.numero)} · ${f.titulo}` : `Formato ${escopo}`;
}

function CompartilharModal({ escopoInicial, onClose }: { escopoInicial: string; onClose: () => void }) {
  const [escopo, setEscopo] = useState(escopoInicial);
  const [gerando, setGerando] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [links, setLinks] = useState<Link[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const origem = typeof window !== 'undefined' ? window.location.origin : '';

  const carregar = useCallback(() => {
    fetch('/api/formatos-criativos/links')
      .then((r) => r.json())
      .then((d: { links?: Link[] }) => setLinks(d.links ?? []))
      .catch(() => setLinks([]));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const gerar = async () => {
    setGerando(true); setErro(null); setUrl(null);
    try {
      const r = await fetch('/api/formatos-criativos/links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escopo }),
      });
      const d = (await r.json()) as { path?: string; error?: string };
      if (!r.ok || !d.path) throw new Error(d.error ?? 'Erro ao gerar link');
      setUrl(origem + d.path);
      carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar link');
    } finally {
      setGerando(false);
    }
  };

  const copiar = async (texto: string) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(texto); setTimeout(() => setCopiado(null), 2000); } catch { /* sem permissão */ }
  };

  const desativar = async (token: string) => {
    if (!confirm('Desativar este link? Quem tiver o endereço deixa de conseguir abrir na hora.')) return;
    await fetch(`/api/formatos-criativos/links?token=${token}`, { method: 'DELETE' }).catch(() => {});
    if (url?.endsWith(token)) setUrl(null);
    carregar();
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative w-full max-w-xl border border-white/10 bg-[#0e0f14]" onClick={(e) => e.stopPropagation()}>
        <div className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
        <button type="button" onClick={onClose} aria-label="Fechar" className="absolute right-3 top-3 p-1.5 text-white/60 hover:text-white">
          <X className="h-4 w-4" />
        </button>
        <div className="space-y-5 p-6">
          <div>
            <h2 className="font-heading text-2xl uppercase tracking-wide text-white">Compartilhar</h2>
            <p className="mt-1 text-sm text-white/60">
              Gera um link público. Quem abrir vê só este conteúdo (vídeos, estrutura e briefing), sem login e sem acesso ao resto do sistema.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50">O que compartilhar</label>
            <select
              value={escopo}
              onChange={(e) => { setEscopo(e.target.value); setUrl(null); }}
              className="h-10 w-full border border-white/15 bg-black/30 px-3 text-sm text-white focus:border-primary/60 focus:outline-none"
            >
              <option value="todos">Biblioteca inteira (50 formatos)</option>
              {FORMATOS.map((f) => (
                <option key={f.numero} value={String(f.numero)}>{num(f.numero)} · {f.titulo}</option>
              ))}
            </select>
          </div>

          {url ? (
            <div className="flex items-center gap-2">
              <input readOnly value={url} className="h-10 min-w-0 flex-1 border border-white/15 bg-black/30 px-3 text-sm text-white" onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => copiar(url)} className="flex h-10 items-center gap-2 bg-primary px-4 text-xs font-bold uppercase tracking-widest text-black">
                {copiado === url ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copiado === url ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={gerar}
              disabled={gerando}
              className="flex h-10 items-center gap-2 bg-primary px-4 text-xs font-bold uppercase tracking-widest text-black disabled:opacity-50"
            >
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Gerar link
            </button>
          )}
          {erro && <p className="text-sm text-red-400">{erro}</p>}

          <div className="space-y-2 border-t border-white/10 pt-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Links ativos</div>
            {links === null ? (
              <p className="text-sm text-white/40">Carregando…</p>
            ) : links.length === 0 ? (
              <p className="text-sm text-white/40">Nenhum link ativo.</p>
            ) : (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                {links.map((l) => {
                  const u = `${origem}/formatos/${l.token}`;
                  return (
                    <li key={l.token} className="flex items-center gap-2 border border-white/10 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-white">{rotuloEscopo(l.escopo)}</div>
                        <div className="text-[11px] text-white/40">
                          {l.acessos} acesso{l.acessos === 1 ? '' : 's'}
                          {l.criado_por_nome ? ` · criado por ${l.criado_por_nome}` : ''}
                          {' · '}{new Date(l.criado_em).toLocaleDateString('pt-BR')}
                        </div>
                      </div>
                      <button type="button" onClick={() => copiar(u)} title="Copiar link" className="p-1.5 text-white/60 hover:text-white">
                        {copiado === u ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                      </button>
                      <button type="button" onClick={() => desativar(l.token)} title="Desativar link" className="p-1.5 text-white/60 hover:text-red-400">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
