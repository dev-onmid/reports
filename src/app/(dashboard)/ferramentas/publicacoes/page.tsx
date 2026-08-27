"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { prepararImagem, avisoProporcao, type ImagemPreparada } from '@/lib/post-imagem';
import {
  LEGENDA_MAX, STORY_SEM_SUPORTE, montarAlvos, proximasOcorrencias, resumoAgendamento,
  validarPublicacao, type Agendamento, type ContaCliente, type TipoPublicacao,
} from '@/lib/post-agendamento';
import {
  AlertTriangle, AtSign, CalendarClock, CheckCircle2, ChevronLeft, Clock, ImagePlus,
  Loader2, Plus, RefreshCw, Search, Send, Trash2, XCircle,
} from 'lucide-react';

/**
 * Planejador de Publicações — agenda post e story em vários clientes de uma vez.
 *
 * ⚠️ Publicar é IRREVERSÍVEL. Por isso a criação termina numa tela de
 * CONFIRMAÇÃO que lista conta por conta: o erro caro aqui é o post sair na conta
 * errada, e o único momento em que dá para corrigir é antes de agendar.
 */

type Publicacao = {
  id: string; tipo: TipoPublicacao; legenda: string; modo: string;
  proxima_execucao: string | null; dias_semana: string | null; hora: string | null;
  repetir_ate: string | null; status: string; midia_token: string | null;
  total: number; publicados: number; erros: number; pendentes: number;
};

type AlvoDetalhe = {
  id: string; client_id: string; client_name: string | null; ig_username: string | null; ig_id: string;
  status: string; erro: string | null; permalink: string | null;
  publicado_em: string | null; ocorrencia: string;
};

const DIAS = [
  { v: 0, l: 'Dom' }, { v: 1, l: 'Seg' }, { v: 2, l: 'Ter' }, { v: 3, l: 'Qua' },
  { v: 4, l: 'Qui' }, { v: 5, l: 'Sex' }, { v: 6, l: 'Sáb' },
];

const STATUS_COR: Record<string, string> = {
  publicado: 'text-[#55f52f]',
  erro: 'text-red-400',
  publicando: 'text-sky-400',
  pendente: 'text-muted-foreground',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

/** Valor para <input type="datetime-local"> em BRT, daqui a `minutos`. */
function localInput(minutos: number): string {
  const d = new Date(Date.now() + minutos * 60_000);
  const brt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${brt.getFullYear()}-${p(brt.getMonth() + 1)}-${p(brt.getDate())}T${p(brt.getHours())}:${p(brt.getMinutes())}`;
}

/** O <input datetime-local> devolve hora LOCAL do navegador — converte para ISO em BRT. */
function inputParaIso(v: string): string {
  return v ? new Date(`${v}:00-03:00`).toISOString() : '';
}

export default function PublicacoesPage() {
  const [publicacoes, setPublicacoes] = useState<Publicacao[]>([]);
  const [contas, setContas] = useState<ContaCliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'agendadas' | 'publicadas'>('todas');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [p, c] = await Promise.all([
        fetch('/api/publicacoes').then(r => r.json()).catch(() => ({ publicacoes: [] })),
        fetch('/api/publicacoes/contas').then(r => r.json()).catch(() => ({ contas: [] })),
      ]);
      setPublicacoes(p.publicacoes ?? []);
      setContas(c.contas ?? []);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const visiveis = useMemo(() => publicacoes.filter(p => {
    if (filtro === 'agendadas') return p.status === 'agendado';
    if (filtro === 'publicadas') return p.publicados > 0;
    return true;
  }), [publicacoes, filtro]);

  const comConta = contas.filter(c => c.igId).length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-bebas text-3xl uppercase tracking-wide">Publicações</h1>
          <p className="text-sm text-muted-foreground">
            Agende post e story no Instagram de vários clientes de uma vez.
            {' '}<span className="text-foreground">{comConta} contas</span> disponíveis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw className={cn('w-4 h-4', carregando && 'animate-spin')} />
          </Button>
          <Button size="sm" onClick={() => setCriando(true)}>
            <Plus className="w-4 h-4 mr-1" /> Nova publicação
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        {([['todas', 'Todas'], ['agendadas', 'Agendadas'], ['publicadas', 'Publicadas']] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFiltro(k)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-bold uppercase transition-colors',
              filtro === k ? 'border-[#55f52f] text-[#55f52f]' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {carregando && publicacoes.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : visiveis.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <CalendarClock className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <div className="font-bebas text-xl uppercase">Nenhuma publicação ainda</div>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Suba uma imagem, escolha os clientes e marque o horário.
          </p>
          <Button size="sm" onClick={() => setCriando(true)}>
            <Plus className="w-4 h-4 mr-1" /> Nova publicação
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visiveis.map(p => (
            <CardPublicacao key={p.id} p={p} onAbrir={() => setDetalhe(p.id)} />
          ))}
        </div>
      )}

      {criando && (
        <ModalCriar
          contas={contas}
          onFechar={() => setCriando(false)}
          onCriado={() => { setCriando(false); void carregar(); }}
        />
      )}
      {detalhe && (
        <ModalDetalhe id={detalhe} onFechar={() => { setDetalhe(null); void carregar(); }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Card

function CardPublicacao({ p, onAbrir }: { p: Publicacao; onAbrir: () => void }) {
  const ag: Agendamento = p.modo === 'recorrente'
    ? {
        modo: 'recorrente',
        dias: (p.dias_semana ?? '').split(',').map(Number).filter(Number.isInteger),
        hora: p.hora ?? '09:00',
        ate: p.repetir_ate ? String(p.repetir_ate).slice(0, 10) : null,
      }
    : { modo: 'unico', quando: p.proxima_execucao ?? '' };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={e => { if (e.key === 'Enter') onAbrir(); }}
      className="cursor-pointer rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-muted-foreground/40"
    >
      <div className="flex gap-3">
        {p.midia_token ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/midia/${p.midia_token}`} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />
        ) : (
          <div className="h-20 w-20 shrink-0 rounded bg-muted/30" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
              p.tipo === 'story' ? 'bg-[#7b2cff]/20 text-[#c9a2ff]' : 'bg-[#55f52f]/15 text-[#55f52f]',
            )}>
              {p.tipo === 'story' ? 'Story' : 'Feed'}
            </span>
            {p.status === 'cancelado' && (
              <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] font-bold uppercase">Cancelada</span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-foreground/90">
            {p.legenda.trim() || <span className="text-muted-foreground">sem legenda</span>}
          </p>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="truncate">{resumoAgendamento(ag)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-2 text-xs">
        <span className="text-muted-foreground">{p.total} conta{p.total === 1 ? '' : 's'}</span>
        {p.publicados > 0 && (
          <span className="flex items-center gap-1 text-[#55f52f]">
            <CheckCircle2 className="w-3 h-3" /> {p.publicados}
          </span>
        )}
        {p.pendentes > 0 && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" /> {p.pendentes}
          </span>
        )}
        {p.erros > 0 && (
          <span className="flex items-center gap-1 text-red-400">
            <XCircle className="w-3 h-3" /> {p.erros}
          </span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Modal criar

function ModalCriar({
  contas, onFechar, onCriado,
}: { contas: ContaCliente[]; onFechar: () => void; onCriado: () => void }) {
  const [passo, setPasso] = useState<'montar' | 'confirmar'>('montar');
  const [tipo, setTipo] = useState<TipoPublicacao>('feed');
  const [legenda, setLegenda] = useState('');
  const [imagem, setImagem] = useState<ImagemPreparada | null>(null);
  const [erroImagem, setErroImagem] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const [modo, setModo] = useState<'unico' | 'recorrente'>('unico');
  const [quando, setQuando] = useState(() => localInput(30));
  const [dias, setDias] = useState<number[]>([1, 3, 5]);
  const [hora, setHora] = useState('09:00');
  const [ate, setAte] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const inputFile = useRef<HTMLInputElement>(null);

  const disponiveis = useMemo(
    () => contas.filter(c => c.igId).filter(c => {
      const q = busca.trim().toLowerCase();
      if (!q) return true;
      return c.clientName.toLowerCase().includes(q) || (c.username ?? '').toLowerCase().includes(q);
    }),
    [contas, busca],
  );

  const agendamento: Agendamento = modo === 'unico'
    ? { modo: 'unico', quando: inputParaIso(quando) }
    : { modo: 'recorrente', dias, hora, ate: ate || null };

  const { alvos, descartados } = useMemo(
    () => montarAlvos(selecionados, contas), [selecionados, contas],
  );

  const erros = useMemo(
    () => validarPublicacao(
      { tipo, legenda, midiaId: imagem ? 'ok' : '', clientIds: selecionados, agendamento },
      alvos, new Date(),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tipo, legenda, imagem, selecionados, alvos, modo, quando, dias, hora, ate],
  );

  const aviso = imagem ? avisoProporcao(imagem.largura, imagem.altura, tipo) : null;
  const proximas = proximasOcorrencias(agendamento, new Date(), 3);

  async function escolherArquivo(file: File | undefined) {
    if (!file) return;
    setErroImagem('');
    try {
      setImagem(await prepararImagem(file));
    } catch (e) {
      setImagem(null);
      setErroImagem(e instanceof Error ? e.message : 'Falha ao ler a imagem.');
    }
  }

  async function agendar() {
    setSalvando(true);
    setErro('');
    try {
      const res = await fetch('/api/publicacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo, legenda, clientIds: alvos.map(a => a.clientId), agendamento,
          imagem: imagem ? { dataUrl: imagem.dataUrl, largura: imagem.largura, altura: imagem.altura } : undefined,
        }),
      });
      const j = await res.json();
      if (!j.ok) { setErro(j.error ?? 'Não consegui agendar.'); return; }
      onCriado();
    } catch {
      setErro('Erro de conexão.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onFechar(); }}>
      {/* ⚠️ O prefixo `sm:` é obrigatório: DialogContent traz `sm:max-w-sm` embutido
          e o twMerge não deduplica classe base contra classe com prefixo. */}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-bebas text-2xl uppercase tracking-wide">
            {passo === 'montar' ? 'Nova publicação' : 'Confirme antes de agendar'}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {passo === 'montar' ? (
            <>
              {/* Imagem */}
              <div>
                <div className="mb-1.5 text-xs font-bold uppercase text-muted-foreground">Imagem</div>
                <button
                  onClick={() => inputFile.current?.click()}
                  className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border p-3 text-left hover:border-muted-foreground/50"
                >
                  {imagem ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imagem.dataUrl} alt="" className="h-20 w-20 rounded object-cover" />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded bg-muted/30">
                      <ImagePlus className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 text-sm">
                    {imagem ? (
                      <>
                        <div className="font-medium">{imagem.largura}×{imagem.altura} · {imagem.kb} KB</div>
                        <div className="text-xs text-muted-foreground">Convertida para JPEG. Clique para trocar.</div>
                      </>
                    ) : (
                      <>
                        <div className="font-medium">Escolher imagem</div>
                        <div className="text-xs text-muted-foreground">JPG, PNG ou WebP — convertemos para JPEG.</div>
                      </>
                    )}
                  </div>
                </button>
                <input
                  ref={inputFile} type="file" accept="image/*" className="hidden"
                  onChange={e => void escolherArquivo(e.target.files?.[0])}
                />
                {erroImagem && <p className="mt-1 text-xs text-red-400">{erroImagem}</p>}
                {aviso && (
                  <p className="mt-1 flex items-start gap-1 text-xs text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {aviso}
                  </p>
                )}
              </div>

              {/* Tipo */}
              <div>
                <div className="mb-1.5 text-xs font-bold uppercase text-muted-foreground">Onde publicar</div>
                <div className="flex gap-2">
                  {([['feed', 'Feed'], ['story', 'Story']] as const).map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setTipo(k)}
                      className={cn(
                        'rounded-md border px-4 py-2 text-sm font-bold uppercase',
                        tipo === k ? 'border-[#55f52f] text-[#55f52f]' : 'border-border text-muted-foreground',
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {tipo === 'story' && (
                  <p className="mt-1.5 flex items-start gap-1 text-xs text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {STORY_SEM_SUPORTE}
                  </p>
                )}
              </div>

              {/* Legenda (feed) */}
              {tipo === 'feed' && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-muted-foreground">Legenda</span>
                    <span className={cn('text-xs', legenda.length > LEGENDA_MAX ? 'text-red-400' : 'text-muted-foreground')}>
                      {legenda.length}/{LEGENDA_MAX}
                    </span>
                  </div>
                  <textarea
                    value={legenda}
                    onChange={e => setLegenda(e.target.value)}
                    rows={4}
                    placeholder="O texto que vai junto com o post…"
                    className="w-full rounded-md border border-border bg-background p-3 text-sm"
                  />
                </div>
              )}

              {/* Contas */}
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase text-muted-foreground">
                    Contas ({alvos.length} selecionada{alvos.length === 1 ? '' : 's'})
                  </span>
                  <div className="flex gap-2">
                    <button
                      className="text-xs text-[#55f52f] hover:underline"
                      onClick={() => setSelecionados(disponiveis.map(c => c.clientId))}
                    >
                      Selecionar visíveis
                    </button>
                    <button className="text-xs text-muted-foreground hover:underline" onClick={() => setSelecionados([])}>
                      Limpar
                    </button>
                  </div>
                </div>
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={busca} onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar cliente ou @" className="h-9 pl-8"
                  />
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {disponiveis.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">
                      Nenhuma conta de Instagram disponível. Vincule a conta do cliente em Clientes → Configurar.
                    </p>
                  )}
                  {disponiveis.map(c => {
                    const on = selecionados.includes(c.clientId);
                    return (
                      <label
                        key={c.clientId}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/20"
                      >
                        <input
                          type="checkbox" checked={on}
                          onChange={() => setSelecionados(s =>
                            on ? s.filter(x => x !== c.clientId) : [...s, c.clientId])}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{c.clientName}</span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <AtSign className="h-3 w-3" />{c.username ?? c.igId}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {descartados.length > 0 && (
                  <p className="mt-1 text-xs text-amber-400">
                    {descartados.length} fora: {descartados.map(d => `${d.clientName} (${d.motivo})`).join('; ')}
                  </p>
                )}
              </div>

              {/* Quando */}
              <div>
                <div className="mb-1.5 text-xs font-bold uppercase text-muted-foreground">Quando</div>
                <div className="mb-2 flex gap-2">
                  {([['unico', 'Uma vez'], ['recorrente', 'Repetir']] as const).map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setModo(k)}
                      className={cn(
                        'rounded-md border px-4 py-2 text-sm font-bold uppercase',
                        modo === k ? 'border-[#55f52f] text-[#55f52f]' : 'border-border text-muted-foreground',
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {modo === 'unico' ? (
                  <input
                    type="datetime-local" value={quando} min={localInput(2)}
                    onChange={e => setQuando(e.target.value)}
                    className="h-11 rounded-md border border-border bg-background px-3 text-sm [color-scheme:dark]"
                  />
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {DIAS.map(d => (
                        <button
                          key={d.v}
                          onClick={() => setDias(s => s.includes(d.v) ? s.filter(x => x !== d.v) : [...s, d.v])}
                          className={cn(
                            'rounded-md border px-3 py-1.5 text-xs font-bold uppercase',
                            dias.includes(d.v) ? 'border-[#55f52f] text-[#55f52f]' : 'border-border text-muted-foreground',
                          )}
                        >
                          {d.l}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Hora
                        <input
                          type="time" value={hora} onChange={e => setHora(e.target.value)}
                          className="h-10 rounded-md border border-border bg-background px-2 text-sm [color-scheme:dark]"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Até (opcional)
                        <input
                          type="date" value={ate} onChange={e => setAte(e.target.value)}
                          className="h-10 rounded-md border border-border bg-background px-2 text-sm [color-scheme:dark]"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {proximas.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {proximas.map((d, i) => (
                      <span key={i} className="rounded bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">
                        {fmt(d.toISOString())}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ---------------------------- Confirmação ---------------------------- */
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <span>
                    Publicação no Instagram <strong>não tem como ser desfeita</strong>. Confira as contas abaixo.
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                {imagem && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagem.dataUrl} alt="" className="h-24 w-24 rounded object-cover" />
                )}
                <div className="min-w-0 text-sm">
                  <div className="font-bold uppercase">{tipo === 'story' ? 'Story' : 'Post no feed'}</div>
                  <p className="mt-0.5 line-clamp-3 text-muted-foreground">{legenda.trim() || 'sem legenda'}</p>
                  <div className="mt-1 text-xs">{resumoAgendamento(agendamento)}</div>
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-bold uppercase text-muted-foreground">
                  Vai publicar em {alvos.length} conta{alvos.length === 1 ? '' : 's'}
                </div>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {alvos.map(a => (
                    <div key={a.clientId} className="flex items-center justify-between px-1 py-1 text-sm">
                      <span className="truncate">{a.clientName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">@{a.username || a.igId}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {erros.length > 0 && passo === 'montar' && (
            <p className="text-xs text-red-400">{erros[0]}</p>
          )}
          {erro && <p className="text-xs text-red-400">{erro}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          {passo === 'confirmar' ? (
            <Button variant="ghost" size="sm" onClick={() => setPasso('montar')}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onFechar}>Cancelar</Button>
            {passo === 'montar' ? (
              <Button size="sm" disabled={erros.length > 0} onClick={() => setPasso('confirmar')}>
                Revisar
              </Button>
            ) : (
              <Button size="sm" disabled={salvando} onClick={() => void agendar()}>
                {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                Agendar
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------- Modal detalhe

function ModalDetalhe({ id, onFechar }: { id: string; onFechar: () => void }) {
  const [alvos, setAlvos] = useState<AlvoDetalhe[]>([]);
  const [pub, setPub] = useState<Publicacao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const j = await fetch(`/api/publicacoes/${id}`).then(r => r.json());
      setPub(j.publicacao ?? null);
      setAlvos(j.alvos ?? []);
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function acao(body: Record<string, unknown>) {
    setOcupado(true);
    try {
      await fetch(`/api/publicacoes/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      await carregar();
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar() {
    if (!confirm('Cancelar os envios que ainda não saíram? O que já foi publicado continua no ar.')) return;
    setOcupado(true);
    try {
      await fetch(`/api/publicacoes/${id}`, { method: 'DELETE' });
      onFechar();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onFechar(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-bebas text-2xl uppercase tracking-wide">Publicação</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          {carregando ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <>
              {pub && (
                <p className="text-sm text-muted-foreground">
                  {pub.tipo === 'story' ? 'Story' : 'Post no feed'} · {alvos.length} conta{alvos.length === 1 ? '' : 's'}
                </p>
              )}
              <div className="space-y-1">
                {alvos.map(a => (
                  <div key={a.id} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-medium">{a.client_name || a.client_id}</span>
                        <span className="text-xs text-muted-foreground">@{a.ig_username ?? a.ig_id}</span>
                      </div>
                      <div className={cn('text-xs', STATUS_COR[a.status] ?? 'text-muted-foreground')}>
                        {a.status === 'publicado'
                          ? `publicado em ${fmt(a.publicado_em)}`
                          : a.status === 'erro' ? `falhou: ${a.erro}` : a.status}
                      </div>
                    </div>
                    {a.permalink && (
                      <a
                        href={a.permalink} target="_blank" rel="noreferrer"
                        className="shrink-0 text-xs text-[#55f52f] hover:underline"
                      >
                        ver post
                      </a>
                    )}
                    {a.status === 'erro' && (
                      <Button
                        size="sm" variant="outline" disabled={ocupado}
                        onClick={() => void acao({ acao: 'reenviar', alvoId: a.id })}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" className="text-red-400" disabled={ocupado} onClick={() => void cancelar()}>
            <Trash2 className="mr-1 h-4 w-4" /> Cancelar pendentes
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onFechar}>Fechar</Button>
            <Button size="sm" disabled={ocupado} onClick={() => void acao({ acao: 'publicar_agora' })}>
              {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Publicar agora
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
