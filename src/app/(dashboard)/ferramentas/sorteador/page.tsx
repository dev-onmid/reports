"use client";

import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useClients } from '@/lib/client-store';
import {
  aplicarRegras, sortear, REGRAS_PADRAO, MOTIVO_LABEL,
  type ComentarioSorteio, type Ganhador, type MotivoExclusao, type RedeSorteio, type RegrasSorteio,
} from '@/lib/sorteio';
import {
  carregarAvatar, carregarLogo, runSorteioShow, renderVencedorImagem, baixarBlob,
  type ArteOpts, type ShowResultado,
} from '@/lib/sorteio-arte';
import {
  Copy, Dices, Download, ExternalLink, Gift, Heart, History, Image as ImageIcon, Loader2,
  MessageCircle, RefreshCw, Search, Trash2, Trophy, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Sorteador de comentários IG/FB — regras no padrão do mercado (AppSorteos,
// Comment Picker, Easypromos): duplicados, menções mínimas, palavra
// obrigatória, bloqueio, período, chances extras, ganhadores + suplentes.
// Comentários vêm da Graph API pela conexão Meta do cliente (rotas
// /api/sorteios/*); regras + sorteio rodam AQUI no navegador (lib pura
// src/lib/sorteio.ts) — importou uma vez, re-sorteia à vontade sem rede.

type PostSorteio = {
  rede: RedeSorteio; id: string; legenda: string; permalink: string;
  thumb?: string; timestamp?: string; comentarios: number; curtidas?: number; mediaType?: string;
};

type ContaInfo = { username: string; picture?: string; pageName?: string };

type RegistroHistorico = {
  id: number; client_id: string; user_name: string | null; rede: string;
  post_permalink: string | null; post_legenda: string | null;
  total_participantes: number; ganhadores: Ganhador[]; suplentes: Ganhador[];
  created_at: string;
};

function fmtData(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

const fmtNum = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

function tipoPost(mediaType?: string): string {
  if (mediaType === 'REELS') return 'Reel';
  if (mediaType === 'VIDEO') return 'Vídeo';
  if (mediaType === 'CAROUSEL_ALBUM') return 'Carrossel';
  return 'Post';
}

function RedeBadge({ rede }: { rede: RedeSorteio }) {
  return (
    <span className={cn(
      'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
      rede === 'instagram' ? 'bg-fuchsia-500/15 text-fuchsia-400' : 'bg-blue-500/15 text-blue-400',
    )}>
      {rede === 'instagram' ? 'Instagram' : 'Facebook'}
    </span>
  );
}

export default function SorteadorPage() {
  const { clients } = useClients();
  const [clientId, setClientId] = useState('');

  const [loadingPosts, setLoadingPosts] = useState(false);
  const [conta, setConta] = useState<ContaInfo | null>(null);
  const [posts, setPosts] = useState<PostSorteio[]>([]);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [buscaPost, setBuscaPost] = useState('');
  const [filtroRede, setFiltroRede] = useState<'todas' | RedeSorteio>('todas');
  const [post, setPost] = useState<PostSorteio | null>(null);

  const [importando, setImportando] = useState(false);
  const [comentarios, setComentarios] = useState<ComentarioSorteio[] | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Spread raso basta: os arrays do default nunca são mutados (palavras e
  // bloqueio entram por regrasCompletas, derivadas dos inputs de texto).
  const [regras, setRegras] = useState<RegrasSorteio>({ ...REGRAS_PADRAO });
  const [palavrasStr, setPalavrasStr] = useState('');
  const [bloquearStr, setBloquearStr] = useState('');

  const [sorteando, setSorteando] = useState(false);
  const [showAberto, setShowAberto] = useState(false);
  const [resultado, setResultado] = useState<{ ganhadores: Ganhador[]; suplentes: Ganhador[]; em: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoExt, setVideoExt] = useState('mp4');
  const [registroId, setRegistroId] = useState<string | null>(null);
  const [gerandoImagem, setGerandoImagem] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const arteRef = useRef<ArteOpts | null>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);

  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [historico, setHistorico] = useState<RegistroHistorico[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);

  async function carregarPosts(id: string) {
    setClientId(id);
    setConta(null); setPosts([]); setPost(null); setPostsError(null);
    setComentarios(null); setResultado(null); setBuscaPost(''); setFiltroRede('todas');
    if (!id) return;
    setLoadingPosts(true);
    try {
      const res = await fetch(`/api/sorteios/posts?clientId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setPostsError(data.error ?? `Falha ao buscar posts (HTTP ${res.status}).`);
        return;
      }
      setConta(data.conta ?? null);
      setPosts(Array.isArray(data.posts) ? data.posts : []);
      // Pré-bloqueia a própria conta do cliente (padrão de mercado: o dono não concorre).
      if (data.conta?.username) setBloquearStr((prev) => prev || `@${data.conta.username}`);
    } catch {
      setPostsError('Não foi possível falar com o servidor — tente de novo.');
    } finally {
      setLoadingPosts(false);
    }
  }

  const postsVisiveis = useMemo(() => {
    const q = buscaPost.trim().toLowerCase();
    // Cole o link do post: casa por shortcode do IG (/p/, /reel/) ou pelo path.
    const shortcode = /(?:\/p\/|\/reel(?:s)?\/|\/tv\/)([A-Za-z0-9_-]+)/.exec(q)?.[1];
    return posts.filter((p) => {
      if (filtroRede !== 'todas' && p.rede !== filtroRede) return false;
      if (!q) return true;
      if (shortcode) return p.permalink.toLowerCase().includes(`/${shortcode.toLowerCase()}`);
      if (q.startsWith('http')) {
        try {
          const path = new URL(q).pathname.replace(/\/$/, '');
          return path.length > 1 && p.permalink.toLowerCase().includes(path);
        } catch { return true; }
      }
      return p.legenda.toLowerCase().includes(q);
    });
  }, [posts, buscaPost, filtroRede]);

  async function importar(p: PostSorteio) {
    setPost(p);
    setComentarios(null); setResultado(null); setImportError(null); setTruncado(false);
    setImportando(true);
    try {
      const res = await fetch('/api/sorteios/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, rede: p.rede, postId: p.id }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setImportError(data.error ?? `Falha ao importar (HTTP ${res.status}).`);
        return;
      }
      setComentarios(Array.isArray(data.comentarios) ? data.comentarios : []);
      setTruncado(Boolean(data.truncado));
    } catch {
      setImportError('Não foi possível falar com o servidor — tente de novo.');
    } finally {
      setImportando(false);
    }
  }

  const regrasCompletas: RegrasSorteio = useMemo(() => ({
    ...regras,
    palavrasObrigatorias: palavrasStr.split(',').map((s) => s.trim()).filter(Boolean),
    bloquearPerfis: bloquearStr.split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean),
  }), [regras, palavrasStr, bloquearStr]);

  const filtro = useMemo(
    () => (comentarios ? aplicarRegras(comentarios, regrasCompletas) : null),
    [comentarios, regrasCompletas],
  );

  async function rodarSorteio() {
    if (!filtro || filtro.participantes.length === 0 || sorteando) return;
    setResultado(null);
    setCopiado(false);
    setVideoBlob(null);
    setRegistroId(null);
    setSorteando(true);
    setShowAberto(true);

    const r = sortear(filtro, regrasCompletas);
    // Foto do vencedor (unavatar via image-proxy — sem CORS o canvas ficaria
    // tainted e a gravação quebraria) + logo, em paralelo. FB usa a inicial.
    const [logo, ganhadoresArte] = await Promise.all([
      logoRef.current ? Promise.resolve(logoRef.current) : carregarLogo(),
      Promise.all(r.ganhadores.map(async (g) => ({
        username: g.username,
        avatar: post?.rede === 'instagram' ? await carregarAvatar(g.username) : null,
      }))),
    ]);
    logoRef.current = logo;
    const arte: ArteOpts = { conta: conta?.username ?? '', ganhadores: ganhadoresArte };
    arteRef.current = arte;

    // Espera o canvas do overlay montar antes de gravar.
    await new Promise((res) => setTimeout(res, 80));
    let video: ShowResultado = { blob: null, ext: 'webm' };
    const cv = canvasRef.current;
    if (cv) {
      try { video = await runSorteioShow(cv, arte, logo); } catch { /* show falhou — resultado segue valendo */ }
    }
    setVideoBlob(video.blob);
    setVideoExt(video.ext);

    const em = new Date().toISOString();
    setResultado({ ...r, em });
    setSorteando(false);
    setShowAberto(false);

    // Histórico — best-effort; o id do registro vira o "Nº" do card baixável.
    fetch('/api/sorteios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        rede: post?.rede,
        post_id: post?.id,
        post_permalink: post?.permalink,
        post_legenda: post?.legenda?.slice(0, 300),
        total_comentarios: filtro.totalComentarios,
        total_participantes: filtro.participantes.length,
        total_chances: filtro.totalChances,
        regras: regrasCompletas,
        ganhadores: r.ganhadores,
        suplentes: r.suplentes,
        excluidos: filtro.excluidos,
      }),
    })
      .then((res) => res.json())
      .then((data) => { if (data?.registro?.id) setRegistroId(String(data.registro.id)); })
      .catch(() => {});
  }

  function baixarVideo() {
    if (!videoBlob || !resultado) return;
    baixarBlob(videoBlob, `sorteio-${resultado.ganhadores[0]?.username ?? 'resultado'}.${videoExt}`);
  }

  async function baixarImagem() {
    if (!arteRef.current || gerandoImagem) return;
    setGerandoImagem(true);
    try {
      const blob = await renderVencedorImagem({ ...arteRef.current, codigo: registroId }, logoRef.current);
      if (blob) baixarBlob(blob, `vencedor-${resultado?.ganhadores[0]?.username ?? 'sorteio'}.png`);
    } finally {
      setGerandoImagem(false);
    }
  }

  function copiarResultado() {
    if (!resultado || !post) return;
    const linhas = [
      `🎉 Resultado do sorteio — ${conta?.username ? '@' + conta.username : ''}`.trim(),
      `Post: ${post.permalink}`,
      ...resultado.ganhadores.map((g) =>
        resultado.ganhadores.length === 1 ? `🏆 Ganhador: @${g.username}` : `🏆 ${g.posicao}º ganhador: @${g.username}`),
      ...(resultado.suplentes.length > 0
        ? [`Suplentes: ${resultado.suplentes.map((s) => '@' + s.username).join(', ')}`] : []),
      `Sorteado em ${fmtDataHora(resultado.em)} · ${filtro?.participantes.length ?? 0} participantes válidos`,
    ];
    navigator.clipboard.writeText(linhas.join('\n')).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }).catch(() => {});
  }

  async function abrirHistorico() {
    setHistoricoAberto(true);
    setLoadingHistorico(true);
    try {
      const res = await fetch(`/api/sorteios${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`);
      const data = await res.json();
      setHistorico(Array.isArray(data.registros) ? data.registros : []);
    } catch {
      setHistorico([]);
    } finally {
      setLoadingHistorico(false);
    }
  }

  async function excluirRegistro(id: number) {
    if (!confirm('Excluir este registro do histórico?')) return;
    const res = await fetch(`/api/sorteios?id=${id}`, { method: 'DELETE' });
    if (res.ok) setHistorico((prev) => prev.filter((r) => r.id !== id));
  }

  const clienteNome = (id: string) => clients.find((c) => c.id === id)?.name ?? id;

  const excluidosList = useMemo(() => {
    if (!filtro) return [] as Array<[MotivoExclusao, number]>;
    return (Object.entries(filtro.excluidos) as Array<[MotivoExclusao, number]>).filter(([, n]) => n > 0);
  }, [filtro]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-bebas text-3xl uppercase tracking-wide">Sorteador de Comentários</h1>
          <p className="text-sm text-muted-foreground">
            Sorteie comentários de posts do Instagram e do Facebook com regras — duplicados, menções,
            palavra obrigatória, suplentes e mais.
          </p>
        </div>
        <Button variant="outline" onClick={abrirHistorico}>
          <History className="mr-2 h-4 w-4" /> Histórico
        </Button>
      </div>

      {/* Passo 1 — cliente + post */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="font-bebas text-lg uppercase tracking-wide">1 · Escolha o cliente e o post</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={clientId}
            onChange={(e) => carregarPosts(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm sm:max-w-xs"
          >
            <option value="">Selecione o cliente…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {conta && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {conta.picture && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={conta.picture} alt="" className="h-6 w-6 rounded-full" />
              )}
              <span>@{conta.username}{conta.pageName ? ` · ${conta.pageName}` : ''}</span>
            </div>
          )}
        </div>

        {loadingPosts && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Buscando os posts recentes…
          </div>
        )}
        {postsError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {postsError}
          </div>
        )}

        {posts.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={buscaPost}
                  onChange={(e) => setBuscaPost(e.target.value)}
                  placeholder="Busque pela legenda ou cole o link do post…"
                  className="pl-8"
                />
              </div>
              {(['todas', 'instagram', 'facebook'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setFiltroRede(r)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                    filtroRede === r
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {r === 'todas' ? 'Todas' : r === 'instagram' ? 'Instagram' : 'Facebook'}
                </button>
              ))}
            </div>
            <div className="max-h-[640px] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {postsVisiveis.map((p) => (
                  <button
                    key={`${p.rede}-${p.id}`}
                    onClick={() => importar(p)}
                    className={cn(
                      'group flex flex-col overflow-hidden rounded-lg border text-left transition-colors',
                      post?.id === p.id
                        ? 'border-primary ring-1 ring-primary'
                        : 'border-border hover:border-muted-foreground/40',
                    )}
                  >
                    <div className="relative aspect-square w-full bg-black/40">
                      {p.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Gift className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute left-1.5 top-1.5 flex gap-1">
                        <RedeBadge rede={p.rede} />
                        {p.mediaType && tipoPost(p.mediaType) !== 'Post' && (
                          <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                            {tipoPost(p.mediaType)}
                          </span>
                        )}
                      </div>
                      {/* Métricas em overlay, estilo feed */}
                      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-xs font-semibold text-white">
                        <span className="flex items-center gap-1">
                          <Heart className="h-3.5 w-3.5" /> {fmtNum.format(p.curtidas ?? 0)}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="h-3.5 w-3.5" /> {fmtNum.format(p.comentarios)}
                        </span>
                        <span className="ml-auto font-normal text-white/80">{fmtData(p.timestamp)}</span>
                      </div>
                    </div>
                    {/* Padding no wrapper, não no <p> clampado: overflow:hidden corta na
                        borda do padding e a 3ª linha vazava pintada dentro do py. */}
                    <div className="px-2 py-1.5">
                      <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
                        {p.legenda || '(sem legenda)'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              {postsVisiveis.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum post bate com essa busca (a lista traz os ~30 mais recentes de cada rede).
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Passo 2 — comentários */}
      {(importando || comentarios || importError) && post && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bebas text-lg uppercase tracking-wide">2 · Comentários importados</div>
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" /> Abrir post
            </a>
          </div>
          {importando && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Importando os comentários — posts grandes podem levar até 2 minutos…
            </div>
          )}
          {importError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {importError}
            </div>
          )}
          {comentarios && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{comentarios.length} comentários importados</span>
              <Button size="sm" variant="ghost" onClick={() => importar(post)} className="h-7 px-2 text-xs">
                <RefreshCw className="mr-1 h-3 w-3" /> Reimportar
              </Button>
              {truncado && (
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                  Post muito grande — importação parou no limite; parte dos comentários pode ter ficado de fora.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Passo 3 — regras */}
      {comentarios && filtro && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="font-bebas text-lg uppercase tracking-wide">3 · Regras do sorteio</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Ganhadores</span>
              <Input
                type="number" min={1} max={20} value={regras.numGanhadores}
                onChange={(e) => setRegras({ ...regras, numGanhadores: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Suplentes (reservas)</span>
              <Input
                type="number" min={0} max={10} value={regras.numSuplentes}
                onChange={(e) => setRegras({ ...regras, numSuplentes: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Mínimo de @menções no comentário</span>
              <Input
                type="number" min={0} max={10} value={regras.minMencoes}
                onChange={(e) => setRegras({ ...regras, minMencoes: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
              />
            </label>

            <div className="space-y-1.5 text-sm sm:col-span-2 lg:col-span-1">
              <span className="text-muted-foreground">Comentários repetidos do mesmo perfil</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setRegras({ ...regras, umaChancePorPerfil: true })}
                  className={cn('flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold',
                    regras.umaChancePorPerfil ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                >
                  1 chance por perfil
                </button>
                <button
                  onClick={() => setRegras({ ...regras, umaChancePorPerfil: false })}
                  className={cn('flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold',
                    !regras.umaChancePorPerfil ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                >
                  Cada comentário vale 1 chance
                </button>
              </div>
              {!regras.umaChancePorPerfil && (
                <Input
                  type="number" min={0} placeholder="Teto de chances por perfil (vazio = sem teto)"
                  value={regras.maxChancesPorPerfil ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setRegras({ ...regras, maxChancesPorPerfil: e.target.value === '' || n <= 0 ? null : Math.floor(n) });
                  }}
                />
              )}
            </div>

            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Palavra obrigatória (vírgula = qualquer uma)</span>
              <Input
                value={palavrasStr}
                onChange={(e) => setPalavrasStr(e.target.value)}
                placeholder="ex.: eu quero, participando, #sorteio"
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Bloquear perfis (vírgula separa)</span>
              <Input
                value={bloquearStr}
                onChange={(e) => setBloquearStr(e.target.value)}
                placeholder="@conta_do_cliente, @socio"
              />
            </label>

            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Aceitar comentários até</span>
              <Input
                type="datetime-local" value={regras.ate ?? ''}
                onChange={(e) => setRegras({ ...regras, ate: e.target.value || null })}
              />
            </label>

            <div className="flex flex-col gap-2 text-sm sm:col-span-2 lg:col-span-3 lg:flex-row lg:items-center lg:gap-6">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox" checked={regras.mencoesUnicas}
                  onChange={(e) => setRegras({ ...regras, mencoesUnicas: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
                <span>Menções repetidas no mesmo comentário contam 1 vez só</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox" checked={regras.incluirRespostas}
                  onChange={(e) => setRegras({ ...regras, incluirRespostas: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
                <span>Incluir respostas a comentários</span>
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5 font-semibold">
                <Trophy className="h-4 w-4 text-primary" />
                {filtro.participantes.length} perfis concorrendo
              </span>
              <span className="text-muted-foreground">{filtro.totalChances} chances no total</span>
              <span className="text-muted-foreground">{filtro.totalComentarios} comentários lidos</span>
            </div>
            {excluidosList.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {excluidosList.map(([motivo, n]) => (
                  <span key={motivo} className="rounded bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                    {MOTIVO_LABEL[motivo]}: {n}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              ⚠️ &quot;Seguir o perfil&quot; não dá pra verificar automaticamente (a API do Meta não expõe seguidores) —
              nenhuma ferramenta do mercado consegue. Confira o follow dos ganhadores manualmente antes de anunciar.
            </p>
          </div>

          <Button
            onClick={rodarSorteio}
            disabled={sorteando || filtro.participantes.length === 0}
            className="h-12 w-full text-base font-bold sm:w-auto sm:px-10"
          >
            {sorteando ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Dices className="mr-2 h-5 w-5" />}
            {sorteando ? 'Sorteando…' : 'Sortear agora'}
          </Button>
        </div>
      )}

      {/* Show do sorteio — contagem 5→0 + revelação, gravado em vídeo */}
      {showAberto && (
        <div className="fixed inset-0 z-[210] flex flex-col items-center justify-center gap-3 bg-black/85 p-4">
          <canvas
            ref={canvasRef}
            className="max-h-[82vh] w-auto max-w-full rounded-xl border border-white/15 shadow-2xl"
          />
          <div className="flex items-center gap-2 text-xs text-white/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sorteando e gravando o vídeo…
          </div>
        </div>
      )}

      {/* Resultado */}
      {resultado && post && (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bebas text-xl uppercase tracking-wide">🎉 Resultado do sorteio</div>
            <div className="flex flex-wrap gap-2">
              {videoBlob && (
                <Button size="sm" onClick={baixarVideo}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Baixar vídeo (.{videoExt})
                </Button>
              )}
              <Button size="sm" onClick={baixarImagem} disabled={gerandoImagem}>
                {gerandoImagem
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <ImageIcon className="mr-1.5 h-3.5 w-3.5" />}
                Baixar imagem
              </Button>
              <Button size="sm" variant="outline" onClick={copiarResultado}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> {copiado ? 'Copiado!' : 'Copiar resultado'}
              </Button>
              <Button size="sm" variant="outline" onClick={rodarSorteio}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Sortear de novo
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {resultado.ganhadores.map((g) => (
              <div key={g.posicao} className="rounded-lg border border-primary/60 bg-primary/5 p-4">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-primary" />
                  <span className="text-xs font-bold uppercase text-primary">
                    {resultado.ganhadores.length === 1 ? 'Ganhador' : `${g.posicao}º ganhador`}
                  </span>
                </div>
                {post.rede === 'instagram' ? (
                  <a
                    href={`https://instagram.com/${g.username}`}
                    target="_blank" rel="noopener noreferrer"
                    className="mt-1 block font-bebas text-2xl uppercase tracking-wide hover:text-primary"
                  >
                    @{g.username}
                  </a>
                ) : (
                  <div className="mt-1 font-bebas text-2xl uppercase tracking-wide">{g.username}</div>
                )}
                <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">“{g.comentario.texto}”</p>
                <div className="mt-2 text-xs text-muted-foreground">
                  {fmtDataHora(g.comentario.timestamp ?? '')} · {g.chances} chance{g.chances === 1 ? '' : 's'}
                </div>
              </div>
            ))}
          </div>

          {resultado.suplentes.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                Suplentes (na ordem — usa se o ganhador não cumprir as regras)
              </div>
              <div className="flex flex-wrap gap-2">
                {resultado.suplentes.map((s) => (
                  <span key={s.posicao} className="rounded-md border border-border bg-background/40 px-2.5 py-1 text-sm">
                    {s.posicao}º · @{s.username}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Sorteado em {fmtDataHora(resultado.em)} · {filtro?.participantes.length ?? 0} participantes ·
            registrado no histórico.
          </p>
        </div>
      )}

      {/* Modal de histórico */}
      {historicoAberto && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setHistoricoAberto(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="font-bebas text-xl uppercase tracking-wide">Histórico de sorteios</div>
              <button onClick={() => setHistoricoAberto(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            {loadingHistorico && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            )}
            {!loadingHistorico && historico.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Nenhum sorteio registrado{clientId ? ' para este cliente' : ''} ainda.
              </div>
            )}
            <div className="space-y-2">
              {historico.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <RedeBadge rede={r.rede === 'facebook' ? 'facebook' : 'instagram'} />
                    <span>{clienteNome(r.client_id)}</span>
                    <span>· {fmtDataHora(r.created_at)}</span>
                    {r.user_name && <span>· por {r.user_name}</span>}
                    <span>· {r.total_participantes} participantes</span>
                    <span className="ml-auto flex items-center gap-2">
                      {r.post_permalink && (
                        <a href={r.post_permalink} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button onClick={() => excluirRegistro(r.id)} className="hover:text-red-400" title="Excluir registro">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                  <div className="mt-1.5 text-sm">
                    🏆 {(r.ganhadores ?? []).map((g) => '@' + g.username).join(', ')}
                    {(r.suplentes ?? []).length > 0 && (
                      <span className="text-muted-foreground">
                        {' '}· suplentes: {(r.suplentes ?? []).map((s) => '@' + s.username).join(', ')}
                      </span>
                    )}
                  </div>
                  {r.post_legenda && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{r.post_legenda}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
