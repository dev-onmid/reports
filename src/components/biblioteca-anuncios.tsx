"use client";

// Biblioteca de Anúncios — galeria do que RODOU no Meta (todas as contas ou um
// cliente): capa do criativo, campanha, gasto, leads, status, link de prévia e
// o alerta de cidade (criativo que cita uma cidade diferente da que a campanha
// mira). Nasceu da auditoria da CondoStore em 30/09/2026.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, ImageOff, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  ROTULO_STATUS, ROTULO_TIPO, filtrarEOrdenar, fmtBRL, fmtDataBR, resumoBiblioteca,
  type AnuncioRow, type BibliotecaResposta, type ContaResumo, type FiltrosBiblioteca,
  type OrdemBiblioteca, type StatusAnuncio, type TipoAnuncio,
} from '@/lib/biblioteca-anuncios-ui';

const PERIODOS = [
  { label: '30d', days: 30 },
  { label: '60d', days: 60 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
];

const STATUS_CLASSE: Record<StatusAnuncio, string> = {
  ativo: 'bg-primary/15 text-primary',
  pausado: 'bg-muted text-muted-foreground',
  problema: 'bg-destructive/15 text-destructive',
  revisao: 'bg-amber-500/15 text-amber-400',
  arquivado: 'bg-muted text-muted-foreground',
};

function Capa({ row }: { row: AnuncioRow }) {
  const [falhou, setFalhou] = useState(false);
  const semImagem = !row.thumb_url || falhou;
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden bg-surface-elevated">
      {semImagem ? (
        <div className="flex h-full w-full items-center justify-center">
          <ImageOff className="h-8 w-8 text-muted-foreground/40" />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.thumb_url!}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFalhou(true)}
          className="h-full w-full object-cover"
        />
      )}
      <span className="absolute left-2 top-2 rounded-[var(--radius)] bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
        {ROTULO_TIPO[row.tipo]}{row.duracao_seg ? ` · ${row.duracao_seg}s` : ''}
      </span>
      {row.alerta && (
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 px-3 py-2 text-xs font-bold leading-snug',
            row.alerta === 'cidade' ? 'bg-destructive text-white' : 'bg-amber-500/90 text-black',
          )}
        >
          {row.alerta === 'cidade'
            ? `Cita ${row.cidades_citadas.join(', ')}, mas a campanha mira ${row.cidades_alvo.join(', ')}`
            : `Cita ${row.cidades_citadas.join(', ')} numa campanha sem cidade definida`}
        </div>
      )}
    </div>
  );
}

function Kpi({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div>
      <p className="font-heading text-2xl leading-none tabular-nums">{valor}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{rotulo}</p>
    </div>
  );
}

export function BibliotecaAnuncios({ clientId }: { clientId?: string }) {
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<AnuncioRow[]>([]);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [pendentes, setPendentes] = useState(0);
  const [totalContas, setTotalContas] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosBiblioteca>({
    busca: '', clientId: clientId ?? '', cidade: '', status: '', tipo: '', soAlerta: false, ordem: 'gasto',
  });
  // `pedido` é o gatilho do fetch: muda no botão Atualizar e a cada rodada da
  // coleta da carteira. Pedido novo cancela o anterior (trocar o período no meio
  // de uma coleta não pode empilhar chamadas nem ficar preso na rodada velha).
  // `loading` é ligado por quem dispara e desligado quando a resposta chega —
  // nenhum setState roda síncrono dentro do efeito.
  const [pedido, setPedido] = useState(0);
  const refreshRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const qs = new URLSearchParams({ days: String(days) });
    if (clientId) qs.set('clientId', clientId);
    if (refreshRef.current) { qs.set('refresh', '1'); refreshRef.current = false; }
    fetch(`/api/biblioteca-anuncios?${qs}`, { signal: ctrl.signal })
      .then(async res => {
        const json = res.ok ? await res.json().catch(() => null) as BibliotecaResposta | null : null;
        if (!json?.ok) { setErro(true); return; }
        setErro(false);
        setRows(json.anuncios);
        setContas(json.contas);
        setPendentes(json.pendentes);
        setTotalContas(json.total_contas);
      })
      .catch(err => { if ((err as { name?: string })?.name !== 'AbortError') setErro(true); })
      .finally(() => { if (abortRef.current === ctrl) setLoading(false); });
    return () => ctrl.abort();
  }, [days, clientId, pedido]);

  // Enquanto houver contas pendentes, continua a coleta em rodadas.
  useEffect(() => {
    if (pendentes <= 0) return;
    const t = setTimeout(() => setPedido(p => p + 1), 1500);
    return () => clearTimeout(t);
  }, [pendentes]);

  const lista = useMemo(() => filtrarEOrdenar(rows, filtros), [rows, filtros]);
  const resumo = useMemo(() => resumoBiblioteca(rows), [rows]);
  const clientes = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.client_id, r.client_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const cidades = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) for (const c of r.cidades_alvo) s.add(c);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);
  const contasComErro = useMemo(() => contas.filter(c => c.erro), [contas]);
  const set = <K extends keyof FiltrosBiblioteca>(k: K, v: FiltrosBiblioteca[K]) => setFiltros(f => ({ ...f, [k]: v }));
  const carregadas = totalContas - pendentes;

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="relative overflow-hidden rounded-[var(--radius)] border border-border bg-card p-5">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <Kpi valor={String(resumo.anuncios)} rotulo="Anúncios" />
            <Kpi valor={fmtBRL(resumo.gasto)} rotulo="Investidos" />
            <Kpi valor={String(resumo.leads)} rotulo="Leads" />
            <Kpi valor={`${resumo.videos} / ${resumo.imagens}`} rotulo="Vídeos / imagens" />
            {!clientId && <Kpi valor={`${carregadas} / ${totalContas}`} rotulo="Contas" />}
          </div>
          <div className="flex items-center gap-1">
            {PERIODOS.map(p => (
              <button
                key={p.days}
                onClick={() => { if (p.days !== days) { setLoading(true); setDays(p.days); } }}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-bold transition-colors',
                  days === p.days ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => { setLoading(true); refreshRef.current = true; setPedido(p => p + 1); }}
              disabled={loading || pendentes > 0}
              title="Coletar de novo na Meta"
              className="ml-2 rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw className={cn('h-4 w-4', (loading || pendentes > 0) && 'animate-spin')} />
            </button>
          </div>
        </div>
        {pendentes > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Coletando na Meta: {carregadas} de {totalContas} contas prontas. A galeria vai crescendo.
          </p>
        )}
      </div>

      {/* Alertas */}
      {resumo.alertas > 0 && (
        <div className="flex items-start gap-3 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-bold text-destructive">
              {resumo.alertas} {resumo.alertas === 1 ? 'anúncio cita' : 'anúncios citam'} uma cidade diferente da que a campanha mira.
            </p>
            <p className="mt-1 text-muted-foreground">
              A checagem lê o texto do anúncio (legenda, título, nome). Cidade falada no áudio ou escrita
              dentro do vídeo não é detectada — confira esses à mão.{' '}
              <button className="font-bold text-foreground underline underline-offset-2" onClick={() => set('soAlerta', true)}>
                Ver só os alertas
              </button>
            </p>
          </div>
        </div>
      )}
      {contasComErro.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Sem coleta em {contasComErro.length} {contasComErro.length === 1 ? 'conta' : 'contas'}:{' '}
          {contasComErro.map(c => `${c.client_name} (${c.erro})`).join(' · ')}
        </p>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtros.busca}
            onChange={e => set('busca', e.target.value)}
            placeholder="Buscar por anúncio, campanha, cliente ou cidade"
            className="h-9 pl-9"
          />
        </div>
        {!clientId && (
          <select value={filtros.clientId} onChange={e => set('clientId', e.target.value)} className="h-9 rounded-[var(--radius)] border border-border bg-transparent px-2 text-sm">
            <option value="">Todas as contas</option>
            {clientes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        )}
        <select value={filtros.cidade} onChange={e => set('cidade', e.target.value)} className="h-9 rounded-[var(--radius)] border border-border bg-transparent px-2 text-sm">
          <option value="">Todas as cidades</option>
          {cidades.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filtros.status} onChange={e => set('status', e.target.value as StatusAnuncio | '')} className="h-9 rounded-[var(--radius)] border border-border bg-transparent px-2 text-sm">
          <option value="">Qualquer status</option>
          {(Object.keys(ROTULO_STATUS) as StatusAnuncio[]).map(s => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
        </select>
        <select value={filtros.tipo} onChange={e => set('tipo', e.target.value as TipoAnuncio | '')} className="h-9 rounded-[var(--radius)] border border-border bg-transparent px-2 text-sm">
          <option value="">Vídeo e imagem</option>
          {(Object.keys(ROTULO_TIPO) as TipoAnuncio[]).map(t => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
        </select>
        <select value={filtros.ordem} onChange={e => set('ordem', e.target.value as OrdemBiblioteca)} className="h-9 rounded-[var(--radius)] border border-border bg-transparent px-2 text-sm">
          <option value="gasto">Maior gasto</option>
          <option value="leads">Mais leads</option>
          <option value="recentes">Mais recentes</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={filtros.soAlerta} onChange={e => set('soAlerta', e.target.checked)} className="accent-[var(--primary)]" />
          Só com alerta
        </label>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{lista.length} de {rows.length}</span>
      </div>

      {/* Grade */}
      {erro ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Não foi possível carregar a biblioteca. Tente de novo em instantes.</p>
      ) : loading && rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando anúncios…</p>
      ) : lista.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? 'Nenhum anúncio entregou no período.' : 'Nenhum anúncio com esses filtros.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {lista.map(r => (
            <article
              key={`${r.account_id}-${r.ad_id}`}
              className={cn(
                'flex min-w-0 flex-col overflow-hidden rounded-[var(--radius)] border bg-card',
                r.alerta === 'cidade' ? 'border-destructive' : 'border-border',
              )}
            >
              <Capa row={r} />
              <div className="flex flex-1 flex-col gap-1.5 p-3">
                <p className="text-[13px] font-semibold leading-snug break-words" title={r.ad_name}>{r.ad_name}</p>
                <p className="text-xs leading-snug text-muted-foreground break-words">
                  {r.campaign_name}{r.adset_name ? ` · ${r.adset_name}` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', STATUS_CLASSE[r.status])}>
                    {ROTULO_STATUS[r.status]}
                  </span>
                  <span className="font-bold">{fmtBRL(r.spend)}</span>
                  <span className="text-muted-foreground">{r.leads} leads</span>
                  {r.conversas > 0 && <span className="text-muted-foreground">{r.conversas} conversas</span>}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {r.client_name} · criado em {fmtDataBR(r.created_time)}
                </p>
                {r.preview_url ? (
                  <a
                    href={r.preview_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius)] bg-primary px-4 text-sm font-bold text-primary-foreground transition-colors hover:bg-[var(--primary-dark)]"
                  >
                    Ver anúncio <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span className="mt-auto inline-flex h-9 items-center justify-center rounded-[var(--radius)] bg-muted text-sm font-bold text-muted-foreground">
                    Sem prévia
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Só entram anúncios que entregaram no período; gasto e leads são do período inteiro, por anúncio. A mesma
        peça aparece mais de uma vez quando foi reenviada para outra campanha. A prévia abre no site da Meta e
        pode pedir login no Facebook.
      </p>
    </div>
  );
}
