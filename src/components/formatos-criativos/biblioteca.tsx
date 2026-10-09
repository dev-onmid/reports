"use client";

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Check, ChevronLeft, ChevronRight, Clapperboard, Copy, Download, FileText, Image as ImageIcon, Link2, Loader2, Play, Search, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  montarBriefing, ROTULOS_GRAVACAO, type Arquetipo, type FichaExemplo,
} from '@/lib/formatos-criativos-briefing';

// Biblioteca dos 50 formatos de criativo (grade + janela com vídeo, fichas e
// briefing para IA). Um componente só para as duas portas:
//  - a tela interna (/ferramentas/formatos-criativos), que lê as rotas
//    autenticadas e oferece "Compartilhar";
//  - o link público (/formatos/[token]), que lê as rotas públicas presas ao
//    token e não oferece nada além de ver, baixar e copiar o briefing.
// As URLs de mídia/fichas chegam por contexto (ApiFormatos), então o mesmo
// código nunca consegue chamar a rota do outro lado por engano.

export type Exemplo = { nome: string; tipo: string; arquivo: string };
export type Formato = {
  numero: number;
  titulo: string;
  descricao: string;
  grupo: string;
  exemplos: Exemplo[];
};

export type ApiFormatos = {
  midia: (arquivo: string) => string;
  fichas: (numero: number) => string;
  /** Só na tela interna: abre o compartilhamento de UM formato. */
  compartilhar?: (numero: number) => void;
};

const ApiCtx = createContext<ApiFormatos>({
  midia: (a) => `/api/formatos-criativos/midia?f=${encodeURIComponent(a)}`,
  fichas: (n) => `/api/formatos-criativos/fichas?numero=${n}`,
});
function useMidiaUrl() {
  const api = useContext(ApiCtx);
  return (e: Exemplo) => api.midia(e.arquivo);
}

function semAcento(s: string) {
  // ⚠️ range de diacríticos SEMPRE escapado — ver lição no CLAUDE.md.
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const num = (n: number) => String(n).padStart(2, '0');
const slug = (s: string) => semAcento(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nomeArquivo = (f: Formato, i: number) => `${num(f.numero)}-${slug(f.titulo)}-exemplo-${i + 1}`;

export function BibliotecaFormatos({
  formatos,
  api,
  titulo = 'Formatos de Criativos',
  subtitulo = `${formatos.length} formatos de anúncio com explicação e exemplos para levar ideias às reuniões.`,
  acoes,
  abrirInicial = null,
}: {
  formatos: Formato[];
  api: ApiFormatos;
  titulo?: string;
  subtitulo?: string;
  acoes?: React.ReactNode;
  abrirInicial?: number | null;
}) {
  const FORMATOS = formatos;
  const GRUPOS = useMemo(() => Array.from(new Set(formatos.map((f) => f.grupo))), [formatos]);
  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState<string | null>(null);
  const [aberto, setAberto] = useState<number | null>(abrirInicial);

  const lista = useMemo(() => {
    const q = semAcento(busca.trim());
    return FORMATOS.filter(
      (f) =>
        (!grupo || f.grupo === grupo) &&
        (!q || semAcento(`${f.numero} ${f.titulo} ${f.descricao}`).includes(q)),
    );
  }, [busca, grupo, FORMATOS]);

  const idx = aberto === null ? -1 : lista.findIndex((f) => f.numero === aberto);
  const atual = idx >= 0 ? lista[idx] : null;

  return (
    <ApiCtx.Provider value={api}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl uppercase tracking-wide text-white">{titulo}</h1>
          <p className="mt-1 text-sm text-white/60">{subtitulo}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        {acoes}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar formato…"
            className="pl-9"
          />
        </div>
        </div>
      </div>

      {FORMATOS.length > 1 && (
      <div className="flex flex-wrap gap-2">
        <Chip ativo={grupo === null} onClick={() => setGrupo(null)}>
          Todos ({FORMATOS.length})
        </Chip>
        {GRUPOS.map((g) => (
          <Chip key={g} ativo={grupo === g} onClick={() => setGrupo(g)}>
            {g.replace('FORMATOS ', '')}
          </Chip>
        ))}
      </div>
      )}

      {lista.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/50">Nenhum formato encontrado.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {lista.map((f) => (
            <button
              key={f.numero}
              type="button"
              onClick={() => setAberto(f.numero)}
              className="group overflow-hidden rounded-[14px] border border-white/10 bg-[#0d1519]/92 text-left transition hover:border-primary/60"
            >
              <div className="relative aspect-[9/16] max-h-72 w-full overflow-hidden bg-black">
                {f.exemplos[0] && <Capa exemplo={f.exemplos[0]} />}
                <span className="absolute left-2 top-2 bg-primary px-1.5 py-0.5 font-heading text-lg leading-none text-black">
                  {num(f.numero)}
                </span>
                <span className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/80">
                  <Play className="h-3 w-3" /> {f.exemplos.length}
                </span>
              </div>
              <div className="p-3">
                <h3 className="text-sm font-bold leading-snug text-white">{f.titulo}</h3>
                <p className="mt-1 line-clamp-2 text-xs text-white/50">{f.descricao}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {atual && (
        <FormatoModal
          key={atual.numero}
          formato={atual}
          onClose={() => setAberto(null)}
          onAnterior={idx > 0 ? () => setAberto(lista[idx - 1].numero) : undefined}
          onProximo={idx < lista.length - 1 ? () => setAberto(lista[idx + 1].numero) : undefined}
        />
      )}
    </div>
    </ApiCtx.Provider>
  );
}

// Capa do card: o primeiro frame do próprio exemplo. A miniatura do Drive
// (drive.google.com/thumbnail) falha sem sessão do Google e com volume.
function Capa({ exemplo }: { exemplo: Exemplo }) {
  const midiaUrl = useMidiaUrl();
  const cls = 'h-full w-full object-cover opacity-80 transition group-hover:scale-105 group-hover:opacity-100';
  if (exemplo.tipo !== 'video') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={midiaUrl(exemplo)} alt="" loading="lazy" className={cls} />;
  }
  return <video src={`${midiaUrl(exemplo)}#t=0.5`} preload="metadata" muted playsInline className={cls} />;
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition',
        ativo ? 'border-primary bg-primary text-black' : 'border-white/15 text-white/70 hover:border-white/40',
      )}
    >
      {children}
    </button>
  );
}

function FormatoModal({
  formato,
  onClose,
  onAnterior,
  onProximo,
}: {
  formato: Formato;
  onClose: () => void;
  onAnterior?: () => void;
  onProximo?: () => void;
}) {
  const api = useContext(ApiCtx);
  const midiaUrl = useMidiaUrl();
  const [ex, setEx] = useState(0);
  const [aba, setAba] = useState<'formato' | 'exemplo'>('formato');
  const [fichas, setFichas] = useState<{ arquetipo: Arquetipo | null; exemplos: Record<string, FichaExemplo | null> } | null>(null);
  const [erro, setErro] = useState(false);
  const [cliente, setCliente] = useState(() => {
    try { return sessionStorage.getItem('formatos:cliente') ?? ''; } catch { return ''; }
  });
  const [copiado, setCopiado] = useState(false);
  const exemplo = formato.exemplos[ex];
  const ficha = fichas?.exemplos[exemplo?.arquivo] ?? null;

  useEffect(() => {
    let vivo = true;
    fetch(api.fichas(formato.numero))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (vivo) setFichas(d); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [formato.numero, api]);

  useEffect(() => {
    try { sessionStorage.setItem('formatos:cliente', cliente); } catch { /* sem storage */ }
  }, [cliente]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onAnterior) onAnterior();
      if (e.key === 'ArrowRight' && onProximo) onProximo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onAnterior, onProximo]);

  const briefing = () =>
    montarBriefing({
      numero: formato.numero,
      titulo: formato.titulo,
      descricao: formato.descricao,
      arquetipo: fichas?.arquetipo ?? null,
      exemplo: ficha,
      exemploIndice: ex,
      cliente,
    });

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(briefing());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch { /* navegador sem permissão de área de transferência */ }
  };

  const baixarMd = () => {
    const url = URL.createObjectURL(new Blob([briefing()], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `briefing-${num(formato.numero)}-${slug(formato.titulo)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-0 sm:p-6" onClick={onClose}>
      <div
        className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden border border-white/10 bg-[#0e0f14] sm:h-[92vh] sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-3 top-3 z-10 bg-black/60 p-1.5 text-white/70 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Coluna do vídeo */}
        <div className="flex min-h-0 flex-col bg-black sm:w-[38%] sm:flex-none">
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {exemplo?.tipo === 'video' ? (
              <video
                key={exemplo.arquivo}
                src={midiaUrl(exemplo)}
                controls
                playsInline
                autoPlay
                className="h-full max-h-[50vh] w-full object-contain sm:max-h-none"
              />
            ) : exemplo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={exemplo.arquivo} src={midiaUrl(exemplo)} alt={exemplo.nome} className="h-full max-h-[50vh] w-full object-contain sm:max-h-none" />
            ) : null}
          </div>
          <div className="space-y-2 border-t border-white/10 bg-[#0e0f14] p-3">
            <div className="flex flex-wrap gap-1.5">
              {formato.exemplos.map((e, i) => (
                <button
                  key={e.arquivo}
                  type="button"
                  onClick={() => setEx(i)}
                  className={cn(
                    'flex items-center gap-1 border px-2.5 py-1.5 text-[11px] font-bold transition',
                    i === ex ? 'border-primary bg-primary/10 text-primary' : 'border-white/15 text-white/70 hover:border-white/40',
                  )}
                >
                  {e.tipo === 'video' ? <Clapperboard className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                  Exemplo {i + 1}
                </button>
              ))}
            </div>
            {exemplo && (
              <a
                href={`${midiaUrl(exemplo)}&baixar=${encodeURIComponent(nomeArquivo(formato, ex))}`}
                className="flex w-full items-center justify-center gap-2 border border-white/15 py-2 text-xs font-bold uppercase tracking-widest text-white/80 hover:border-primary hover:text-primary"
              >
                <Download className="h-3.5 w-3.5" /> Baixar {exemplo.tipo === 'video' ? 'vídeo' : 'imagem'}
              </a>
            )}
          </div>
        </div>

        {/* Coluna da ficha */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="space-y-3 border-b border-white/10 p-5 pr-12">
            <div className="flex items-center gap-3">
              <span className="bg-primary px-2 py-1 font-heading text-2xl leading-none text-black">{num(formato.numero)}</span>
              <h2 className="font-heading text-3xl uppercase leading-none tracking-wide text-white">{formato.titulo}</h2>
            </div>
            <p className="text-sm leading-relaxed text-white/70">{formato.descricao}</p>
            <div className="flex gap-1">
              {(['formato', 'exemplo'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAba(k)}
                  className={cn(
                    'border-b-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest',
                    aba === k ? 'border-primary text-white' : 'border-transparent text-white/50 hover:text-white/80',
                  )}
                >
                  {k === 'formato' ? 'Estrutura do formato' : `Exemplo ${ex + 1} desmontado`}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {erro ? (
              <p className="text-sm text-red-400">Não foi possível carregar a ficha.</p>
            ) : !fichas ? (
              <p className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
            ) : aba === 'formato' ? (
              fichas.arquetipo ? <VisaoArquetipo a={fichas.arquetipo} /> : <SemFicha />
            ) : ficha ? (
              <VisaoExemplo f={ficha} />
            ) : (
              <SemFicha />
            )}
          </div>

          <div className="space-y-2 border-t border-white/10 bg-[#0b0c10] p-4">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50">
              Para qual cliente? (opcional, entra no briefing)
            </label>
            <textarea
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              rows={2}
              placeholder="Ex.: Sorrifácil Cambé, clínica odontológica em Cambé-PR. Público 35-60 anos que perdeu dentes. Oferta: avaliação gratuita de implante. Objetivo: conversa no WhatsApp."
              className="w-full resize-none border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-primary/60 focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copiar}
                disabled={!fichas}
                className="flex items-center gap-2 bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-black disabled:opacity-40"
              >
                {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiado ? 'Copiado!' : 'Copiar briefing para a IA'}
              </button>
              <button
                type="button"
                onClick={baixarMd}
                disabled={!fichas}
                className="flex items-center gap-2 border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/80 hover:border-white/40 disabled:opacity-40"
              >
                <FileText className="h-4 w-4" /> Baixar .md
              </button>
              {api.compartilhar && (
                <button
                  type="button"
                  onClick={() => api.compartilhar?.(formato.numero)}
                  className="flex items-center gap-2 border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/80 hover:border-white/40"
                >
                  <Link2 className="h-4 w-4" /> Compartilhar
                </button>
              )}
              <span className="ml-auto flex items-center gap-3">
                <button type="button" onClick={onAnterior} disabled={!onAnterior} aria-label="Formato anterior" className="text-white/60 hover:text-white disabled:opacity-25">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" onClick={onProximo} disabled={!onProximo} aria-label="Próximo formato" className="text-white/60 hover:text-white disabled:opacity-25">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </span>
            </div>
            <p className="text-[11px] text-white/40">
              O briefing leva a estrutura do formato, o exemplo selecionado desmontado e a transcrição. Cole na Maya (ou outra IA) e peça os roteiros.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SemFicha() {
  return <p className="text-sm text-white/50">Ficha ainda não gerada para este item.</p>;
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-primary">{titulo}</h3>
      <div className="text-sm leading-relaxed text-white/80">{children}</div>
    </section>
  );
}

function Lista({ itens }: { itens?: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {(itens ?? []).map((x, i) => <li key={i}>{x}</li>)}
    </ul>
  );
}

function Campos({ dados }: { dados?: Record<string, string> }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {Object.entries(dados ?? {}).filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="border border-white/10 bg-white/[0.02] p-2.5">
          <dt className="text-[10px] font-bold uppercase tracking-widest text-white/40">{ROTULOS_GRAVACAO[k] ?? k}</dt>
          <dd className="mt-0.5 text-[13px] text-white/80">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Roteiro({ texto }: { texto: string }) {
  return <pre className="whitespace-pre-wrap border-l-2 border-primary bg-white/[0.03] p-3 font-sans text-[13px] leading-relaxed text-white/85">{texto}</pre>;
}

function VisaoArquetipo({ a }: { a: Arquetipo }) {
  return (
    <div className="space-y-6">
      <Bloco titulo="Essência">{a.essencia}</Bloco>
      <div className="grid gap-6 sm:grid-cols-2">
        <Bloco titulo="Quando usar"><Lista itens={a.quando_usar} /></Bloco>
        <Bloco titulo="Quando evitar"><Lista itens={a.quando_evitar} /></Bloco>
      </div>
      <Bloco titulo="Estrutura padrão">
        <ol className="space-y-2">
          {a.estrutura_padrao.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 font-heading text-xl leading-none text-primary">{i + 1}</span>
              <span><b className="text-white">{s.etapa}</b> <span className="text-white/40">({s.duracao})</span><br />{s.o_que_fazer}</span>
            </li>
          ))}
        </ol>
      </Bloco>
      <Bloco titulo="Ganchos modelo"><Lista itens={a.ganchos_modelo} /></Bloco>
      <Bloco titulo="Como gravar"><Campos dados={a.como_gravar} /></Bloco>
      <Bloco titulo="Roteiro modelo"><Roteiro texto={a.roteiro_modelo} /></Bloco>
      <div className="grid gap-6 sm:grid-cols-2">
        <Bloco titulo="Dicas"><Lista itens={a.dicas} /></Bloco>
        <Bloco titulo="Erros comuns"><Lista itens={a.erros_comuns} /></Bloco>
      </div>
      {a.variacoes?.length ? <Bloco titulo="Variações"><Lista itens={a.variacoes} /></Bloco> : null}
    </div>
  );
}

function VisaoExemplo({ f }: { f: FichaExemplo }) {
  return (
    <div className="space-y-6">
      <Bloco titulo={`Resumo · ${f.nicho_do_exemplo}`}>{f.resumo}</Bloco>
      <Bloco titulo={`Gancho (${f.gancho.tempo})`}>
        <p className="text-base font-semibold text-white">“{f.gancho.fala}”</p>
        <p className="mt-2"><b className="text-white/90">Visual:</b> {f.gancho.visual}</p>
        {f.gancho.texto_na_tela && <p><b className="text-white/90">Texto na tela:</b> {f.gancho.texto_na_tela}</p>}
        <p><b className="text-white/90">Por que prende:</b> {f.gancho.por_que_prende}</p>
      </Bloco>
      <Bloco titulo="Estrutura com tempos">
        <ol className="space-y-2">
          {f.estrutura.map((s, i) => (
            <li key={i} className="grid grid-cols-[70px_1fr] gap-3">
              <span className="text-xs tabular-nums text-white/40">{s.ate > 0 ? `${s.de}s a ${s.ate}s` : `${i + 1}º`}</span>
              <span><b className="text-white">{s.etapa}</b><br />{s.o_que_acontece}</span>
            </li>
          ))}
        </ol>
      </Bloco>
      <Bloco titulo="Como foi gravado"><Campos dados={f.gravacao} /></Bloco>
      <Bloco titulo="CTA"><p>“{f.cta.fala}”</p><p className="text-white/60">{f.cta.como_aparece}</p></Bloco>
      <Bloco titulo="Roteiro modelo (com lacunas)"><Roteiro texto={f.roteiro_modelo} /></Bloco>
      <div className="grid gap-6 sm:grid-cols-2">
        <Bloco titulo="Dicas de gravação"><Lista itens={f.dicas} /></Bloco>
        <Bloco titulo="Erros comuns"><Lista itens={f.erros_comuns} /></Bloco>
      </div>
      <Bloco titulo="Ideias de adaptação">
        <div className="space-y-2">
          {f.ideias_de_adaptacao.map((x, i) => (
            <div key={i} className="border border-white/10 p-2.5"><b className="text-white">{x.nicho}:</b> {x.ideia}</div>
          ))}
        </div>
      </Bloco>
      {f.transcricao?.length ? (
        <Bloco titulo="Transcrição">
          <div className="space-y-1 text-[13px]">
            {f.transcricao.map((s, i) => (
              <p key={i}><span className="mr-2 tabular-nums text-white/35">{s.t}s</span>{s.texto}</p>
            ))}
          </div>
        </Bloco>
      ) : null}
    </div>
  );
}
