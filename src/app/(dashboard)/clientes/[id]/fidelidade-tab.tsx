"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, Clock, Info, ListPlus, Loader2, PowerOff, RefreshCw, Save,
  Send, ShieldCheck, Ticket, Trash2, Upload, Users, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { lerArquivoContatos } from '@/lib/contatos-arquivo';
import {
  MODELOS_FIDELIDADE, ORDEM_MODELOS, VARIAVEIS, DIAS_SEMANA_LABEL, PISO_INTERVALO_SEG,
  STATUS_ENVIO_LABEL, aplicarVars, capacidadeDaJanela, diasParaTerminar, moedaBR,
  progressoDaExecucao, rotuloMotivo, varsDoDestinatario, variaveisDesconhecidas,
  variaveisIndisponiveis, validarCampanha,
  type FonteCampanha, type ModeloId, type ParamsRegua, type Travas,
} from '@/lib/fidelidade';

/**
 * Aba Fidelidade — duas telas, de propósito.
 *
 * CAMPANHAS é onde se MONTA (régua, texto, cupom, cadência, listas).
 * ACOMPANHAMENTO é onde se OPERA: progresso, quem recebeu, com que texto, quem
 * ficou de fora e por quê.
 *
 * ⚠️ A versão anterior misturava as duas coisas numa página só, com as travas
 * — que se ajustam uma vez — ocupando o topo e a operação virando quatro
 * números no rodapé. Ficava impossível saber o que estava acontecendo.
 */

// ────────────────────────────────────────────────────────────────────── Tipos

type PessoaAmostra = {
  nome: string | null; telefone: string | null; pedidos: number;
  receita: number; ticketMedio: number; diasDesdeUltima: number; ultimaCompra: string;
};

type Segmento = {
  modelo: ModeloId;
  resumo: { pessoas: number; receitaHistorica: number; ticketMedio: number; diasParadoMediano: number | null };
  amostra: PessoaAmostra[];
};

type Campanha = {
  id: string | null;
  fonte: FonteCampanha;
  modelo: ModeloId | null;
  listaId: string | null;
  nome: string;
  params: ParamsRegua;
  mensagens: string[];
  cupom: string | null;
  imagemUrl: string | null;
  diasSemana: number[];
  hora: string;
  tetoPublico: number | null;
  ativa: boolean;
  salva: boolean;
  ultimaExecucao: string | null;
};

type Lista = { id: string; nome: string; contatos: number; criadoEm: string };

type Execucao = {
  id: string; campanha_id: string; campanha: string | null; ativa: boolean | null;
  status: string; iniciada_em: string; concluida_em: string | null;
  publico: number; enviadas: number; puladas: number; falhas: number;
};

type Envio = {
  id: string; campanha_id: string; campanha: string | null; nome: string | null;
  telefone: string; status: string; motivo: string | null; erro: string | null;
  texto: string | null; cupom: string | null; criado_em: string; enviado_em: string | null;
};

type Painel = {
  ativo?: boolean;
  conectado: boolean;
  error?: string;
  loja?: string | null;
  regua?: { janelaDias: number; inatividadeDias: number };
  ticketMedioLoja?: number;
  base?: { clientes: number; comTelefone: number };
  instancia?: { provider: string; id: string } | null;
  travas?: Travas;
  campanhas?: Campanha[];
  listas?: Lista[];
  segmentos?: Segmento[];
};

type Acompanhamento = {
  travas?: Travas;
  enviadasHoje: number;
  porStatus: Record<string, number>;
  execucoes: Execucao[];
  envios: Envio[];
  temMais: boolean;
};

const COR_MODELO: Record<ModeloId, string> = {
  primeira_recompra: 'var(--primary)',
  em_risco: '#facc15',
  inativo: 'var(--destructive)',
  vip: 'var(--secondary)',
  reconquistado: '#22c55e',
};

const COR_STATUS: Record<string, string> = {
  enviada: 'text-primary',
  pulada: 'text-muted-foreground',
  falha: 'text-destructive',
  pendente: 'text-[#facc15]',
};

// ─────────────────────────────────────────────────────────────────── Pedaços

function Card({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <div id={id} className={cn('rounded-[var(--radius)] border border-border bg-card p-4', className)}>{children}</div>;
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

function NumeroInput({
  valor, onChange, placeholder,
}: { valor: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  return (
    <input
      type="number" value={valor ?? ''} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm"
    />
  );
}

function Barra({ pct, cor = 'var(--primary)' }: { pct: number; cor?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-background">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cor }} />
    </div>
  );
}

function hora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Chave estável de rascunho: modelo para segmento, id para lista. */
function chaveCampanha(c: Campanha): string {
  return c.fonte === 'segmento' ? (c.modelo ?? 'sem-modelo') : (c.id ?? 'nova');
}

function focarCampanha(chave: string) {
  requestAnimationFrame(() => {
    document.getElementById(`campanha-${chave}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ──────────────────────────────────────────────────────────────── Componente

export function ClientFidelidadeTab({ clientId }: { clientId: string }) {
  const [vista, setVista] = useState<'campanhas' | 'acompanhamento'>('campanhas');
  const [painel, setPainel] = useState<Painel | null>(null);
  const [acomp, setAcomp] = useState<Acompanhamento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, Campanha>>({});
  const [travasDraft, setTravasDraft] = useState<Travas | null>(null);
  const [travasAbertas, setTravasAbertas] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<string>('');
  const [filtroCampanha, setFiltroCampanha] = useState<string>('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade`);
      const data = await r.json() as Painel;
      setPainel(data);
      if (data.campanhas) setRascunhos(Object.fromEntries(data.campanhas.map(c => [chaveCampanha(c), c])));
      if (data.travas) setTravasDraft(data.travas);
    } catch {
      setPainel({ conectado: false, error: 'Falha ao carregar' });
    } finally {
      setCarregando(false);
    }
  }, [clientId]);

  const carregarAcomp = useCallback(async () => {
    const q = new URLSearchParams();
    if (filtroStatus) q.set('status', filtroStatus);
    if (filtroCampanha) q.set('campanhaId', filtroCampanha);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade/acompanhamento?${q}`);
      setAcomp(await r.json() as Acompanhamento);
    } catch { /* a tela mostra o estado anterior; recarregar resolve */ }
  }, [clientId, filtroStatus, filtroCampanha]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { if (painel?.ativo !== false) void carregarAcomp(); }, [carregarAcomp, painel?.ativo]);

  const patch = useCallback(async (corpo: unknown, tag: string) => {
    setSalvando(tag); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        setErro(d.error ?? 'Não foi possível salvar.');
        return false;
      }
      await carregar();
      return true;
    } finally { setSalvando(null); }
  }, [clientId, carregar]);

  /** Traduz o relatório do motor. Quando NADA acontece é que precisa explicar. */
  const disparar = useCallback(async (campanhaId: string, tag: string) => {
    setSalvando(tag); setErro(null); setResultado(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade/disparar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campanhaId }),
      });
      const d = await r.json().catch(() => ({})) as { error?: string; resultado?: Record<string, unknown> };
      if (!r.ok) { setErro(d.error ?? 'Não foi possível disparar.'); return; }
      const res = d.resultado ?? {};
      if (res.enviada === true) setResultado(`Mensagem enviada para ${res.telefone}. Veja em Acompanhamento.`);
      else if (res.enviada === false) setResultado(`O envio para ${res.telefone} falhou — o erro está em Acompanhamento.`);
      else if (res.pulou === 'teto_diario') setResultado(`Teto diário já atingido (${res.enviadas_hoje} hoje). Nada foi enviado.`);
      else if (res.pulou === 'instancia') setResultado('O WhatsApp deste cliente não está conectado agora. Nada foi enviado.');
      else if (res.concluida) setResultado('A fila desta campanha acabou — todo mundo já recebeu nesta rodada.');
      else if (res.publico === 0) setResultado('Ninguém entrou na fila: público vazio, ou todos em cooldown/opt-out.');
      else setResultado('Nada foi enviado nesta chamada.');
      await Promise.all([carregar(), carregarAcomp()]);
    } finally { setSalvando(null); }
  }, [clientId, carregar, carregarAcomp]);

  const reenviar = useCallback(async (envioId: string) => {
    setSalvando(envioId); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade/acompanhamento`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reenviar: envioId }),
      });
      if (!r.ok) { setErro('Não foi possível reenfileirar.'); return; }
      setResultado('Pessoa devolvida para a fila. Use "Disparar 1 agora" na campanha, ou espere o automático.');
      await carregarAcomp();
    } finally { setSalvando(null); }
  }, [clientId, carregarAcomp]);

  const criarCampanhaDaLista = useCallback(async (lista: Lista) => {
    const existente = Object.values(rascunhos).find(c => c.fonte === 'lista' && c.listaId === lista.id);
    if (existente?.id) {
      setVista('campanhas'); setAberto(existente.id);
      setResultado(`A lista "${lista.nome}" já tem uma campanha — abri ela para você.`);
      focarCampanha(existente.id);
      return;
    }
    setSalvando('lista'); setErro(null); setResultado(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fonte: 'lista', listaId: lista.id, nome: `Oferta — ${lista.nome}`,
          mensagens: [], diasSemana: [1, 2, 3, 4, 5, 6], hora: '18:00', ativa: false,
        }),
      });
      const d = await r.json().catch(() => ({})) as { error?: string; campanha?: Campanha };
      if (!r.ok || !d.campanha?.id) { setErro(d.error ?? 'Não foi possível criar a campanha.'); return; }
      await carregar();
      setAberto(d.campanha.id);
      setResultado(`Campanha criada para a lista "${lista.nome}". Ela está logo abaixo, já aberta.`);
      focarCampanha(d.campanha.id);
    } finally { setSalvando(null); }
  }, [clientId, carregar, rascunhos]);

  const capacidade = useMemo(() => (travasDraft ? capacidadeDaJanela(travasDraft) : 0), [travasDraft]);

  if (carregando && !painel) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (painel && painel.ativo === false) {
    return (
      <Card className="mt-4">
        <div className="flex items-start gap-3">
          <PowerOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <h3 className="font-heading text-lg uppercase leading-none">Fidelidade desativada</h3>
            <p className="text-sm text-muted-foreground">
              Este cliente está fora das campanhas de recompra. Para ligar, use o botão
              <strong className="text-foreground"> Fidelidade</strong> na faixa
              <strong className="text-foreground"> Configurações do cliente</strong>, no topo da página.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const travas = travasDraft;
  const campanhas = Object.values(rascunhos);
  const campanhasLista = campanhas.filter(c => c.fonte === 'lista');
  const ativas = campanhas.filter(c => c.ativa).length;
  const naFila = acomp?.porStatus.pendente ?? 0;

  return (
    <div className="mt-4 space-y-4">
      {/* Duas telas: montar × operar. */}
      <div className="flex flex-wrap items-center gap-2">
        {([['campanhas', 'Campanhas'], ['acompanhamento', 'Acompanhamento']] as const).map(([v, label]) => (
          <button
            key={v} onClick={() => setVista(v)}
            className={cn(
              'h-9 rounded-[var(--radius)] px-4 text-xs font-bold uppercase tracking-wider transition-colors',
              vista === v ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {v === 'acompanhamento' && naFila > 0 && (
              <span className="ml-1.5 rounded-full bg-[#facc15]/20 px-1.5 py-0.5 text-[9px] text-[#facc15]">
                {naFila} na fila
              </span>
            )}
          </button>
        ))}
        <button
          onClick={() => { void carregar(); void carregarAcomp(); }}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 text-xs font-bold uppercase text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', carregando && 'animate-spin')} /> Atualizar
        </button>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-destructive/40 bg-destructive/[0.08] p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-xs text-destructive">{erro}</p>
        </div>
      )}
      {resultado && (
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-primary/40 bg-primary/[0.06] p-3">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs text-foreground">{resultado}</p>
        </div>
      )}

      {vista === 'acompanhamento' ? (
        <Acompanhar
          acomp={acomp} travas={travas} campanhas={campanhas}
          filtroStatus={filtroStatus} setFiltroStatus={setFiltroStatus}
          filtroCampanha={filtroCampanha} setFiltroCampanha={setFiltroCampanha}
          salvando={salvando} onReenviar={reenviar}
        />
      ) : (
        <>
          {/* Contexto enxuto: só o que muda a decisão. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <Rotulo>Campanhas ativas</Rotulo>
              <p className="mt-1 font-heading text-2xl leading-none">{ativas}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {ativas > 0 ? 'disparando sozinhas, dentro das travas' : 'nenhuma disparando agora'}
              </p>
            </Card>
            <Card>
              <Rotulo>Enviadas hoje</Rotulo>
              <p className="mt-1 font-heading text-2xl leading-none">
                {acomp?.enviadasHoje ?? 0}
                <span className="ml-1 text-sm text-muted-foreground">/ {travas?.tetoDiario ?? 0}</span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">teto do número, somando tudo</p>
            </Card>
            <Card>
              <Rotulo>Número de envio</Rotulo>
              {painel?.instancia ? (
                <>
                  <p className="mt-1 truncate font-heading text-lg leading-none" title={painel.instancia.id}>
                    {painel.instancia.id}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">WhatsApp do próprio cliente</p>
                </>
              ) : (
                <p className="mt-1 text-xs text-[#facc15]">
                  Nenhuma instância vinculada — nada será enviado. Vincule na aba Rastreio.
                </p>
              )}
            </Card>
          </div>

          {/* Travas: fora do caminho, mas a um clique. */}
          {travas && (
            <Card>
              <button
                onClick={() => setTravasAbertas(a => !a)}
                className="flex w-full items-center gap-2 text-left"
              >
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h3 className="font-heading text-lg uppercase leading-none">Travas de segurança</h3>
                <span className="text-[11px] text-muted-foreground">
                  1 a cada {travas.intervaloMinSeg}s · até {travas.tetoDiario}/dia ·
                  {' '}{travas.janelaInicio}–{travas.janelaFim} · mesma pessoa a cada {travas.cooldownDias}d
                </span>
                <ChevronDown className={cn('ml-auto h-4 w-4 text-muted-foreground transition-transform', travasAbertas && 'rotate-180')} />
              </button>

              {travasAbertas && (
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1">
                      <Rotulo>1 mensagem a cada (seg)</Rotulo>
                      <NumeroInput valor={travas.intervaloMinSeg}
                        onChange={(v) => setTravasDraft({ ...travas, intervaloMinSeg: Math.max(PISO_INTERVALO_SEG, v ?? 120) })} />
                      <p className="text-[10px] text-muted-foreground">Mínimo {PISO_INTERVALO_SEG}s</p>
                    </div>
                    <div className="space-y-1">
                      <Rotulo>Máximo por dia</Rotulo>
                      <NumeroInput valor={travas.tetoDiario} onChange={(v) => setTravasDraft({ ...travas, tetoDiario: v ?? 50 })} />
                    </div>
                    <div className="space-y-1">
                      <Rotulo>Só entre</Rotulo>
                      <div className="flex items-center gap-1">
                        <input type="time" value={travas.janelaInicio}
                          onChange={(e) => setTravasDraft({ ...travas, janelaInicio: e.target.value })}
                          className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
                        <input type="time" value={travas.janelaFim}
                          onChange={(e) => setTravasDraft({ ...travas, janelaFim: e.target.value })}
                          className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Rotulo>Mesma pessoa a cada (dias)</Rotulo>
                      <NumeroInput valor={travas.cooldownDias} onChange={(v) => setTravasDraft({ ...travas, cooldownDias: v ?? 7 })} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap gap-1">
                      {DIAS_SEMANA_LABEL.map((label, dia) => {
                        const on = travas.diasSemana.includes(dia);
                        return (
                          <button key={dia}
                            onClick={() => setTravasDraft({
                              ...travas,
                              diasSemana: on ? travas.diasSemana.filter(d => d !== dia) : [...travas.diasSemana, dia].sort(),
                            })}
                            className={cn('h-7 rounded-[var(--radius)] border px-2 text-[10px] font-bold uppercase',
                              on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <input type="checkbox" checked={travas.optoutAtivo}
                        onChange={(e) => setTravasDraft({ ...travas, optoutAtivo: e.target.checked })}
                        className="h-3.5 w-3.5 accent-[var(--primary)]" />
                      <span className="text-muted-foreground">Tirar quem pedir para não receber</span>
                    </label>
                    <span className="text-[11px] text-muted-foreground">
                      Entrega real: <strong className="text-foreground">{capacidade}/dia</strong>
                    </span>
                    <button
                      onClick={() => void patch({ travas: travasDraft }, 'travas')}
                      disabled={salvando === 'travas'}
                      className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 text-xs font-bold uppercase text-primary-foreground disabled:opacity-60"
                    >
                      {salvando === 'travas' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Salvar travas
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}

          <ListasCard
            listas={painel?.listas ?? []} salvando={salvando}
            onSalvar={(lista) => patch({ lista }, 'lista')}
            onExcluir={(id) => patch({ excluirLista: id }, 'lista')}
            onNovaCampanha={(lista) => void criarCampanhaDaLista(lista)}
          />

          {campanhasLista.length > 0 && (
            <div className="space-y-3">
              <Rotulo>Campanhas por lista</Rotulo>
              {campanhasLista.map((camp) => {
                const chave = chaveCampanha(camp);
                const lista = painel?.listas?.find(l => l.id === camp.listaId);
                return (
                  <CampanhaCard
                    key={chave} campanha={camp}
                    titulo={camp.nome}
                    subtitulo={lista ? `Lista "${lista.nome}" — ${lista.contatos} contatos` : 'Lista removida — sem público'}
                    cor="var(--secondary)" pessoas={lista?.contatos ?? 0}
                    travas={travas} execucao={acomp?.execucoes.find(e => e.campanha_id === camp.id)}
                    aberto={aberto === chave} onToggle={() => setAberto(aberto === chave ? null : chave)}
                    amostra={[]} loja={painel?.loja ?? 'nossa loja'} ticketMedioLoja={painel?.ticketMedioLoja ?? 0}
                    salvando={salvando === chave}
                    onChange={(c) => setRascunhos(r => ({ ...r, [chave]: c }))}
                    onSalvar={(c) => patch(c, chave)}
                    onExcluir={camp.id ? () => patch({ excluirCampanha: camp.id }, chave) : undefined}
                    onDisparar={camp.id ? () => disparar(camp.id!, chave) : undefined}
                    onVerEnvios={camp.id ? () => { setFiltroCampanha(camp.id!); setVista('acompanhamento'); } : undefined}
                  />
                );
              })}
            </div>
          )}

          {painel?.conectado ? (
            <div className="space-y-3">
              <Rotulo>Campanhas por consumo</Rotulo>
              {ORDEM_MODELOS.map((modelo) => {
                const seg = painel.segmentos?.find(s => s.modelo === modelo);
                const camp = rascunhos[modelo];
                if (!seg || !camp) return null;
                return (
                  <CampanhaCard
                    key={modelo} campanha={camp}
                    titulo={MODELOS_FIDELIDADE[modelo].nome}
                    subtitulo={MODELOS_FIDELIDADE[modelo].objetivo}
                    cor={COR_MODELO[modelo]} pessoas={seg.resumo.pessoas}
                    extras={
                      <>
                        <span className="text-[11px] text-muted-foreground">
                          já gastaram <strong className="text-foreground">{moedaBR(seg.resumo.receitaHistorica)}</strong>
                        </span>
                        {seg.resumo.diasParadoMediano !== null && (
                          <span className="text-[11px] text-muted-foreground">
                            parados há <strong className="text-foreground">{seg.resumo.diasParadoMediano}d</strong>
                          </span>
                        )}
                      </>
                    }
                    travas={travas} execucao={acomp?.execucoes.find(e => e.campanha_id === camp.id)}
                    aberto={aberto === modelo} onToggle={() => setAberto(aberto === modelo ? null : modelo)}
                    amostra={seg.amostra} loja={painel.loja ?? 'nossa loja'}
                    ticketMedioLoja={painel.ticketMedioLoja ?? 0} salvando={salvando === modelo}
                    onChange={(c) => setRascunhos(r => ({ ...r, [modelo]: c }))}
                    onSalvar={(c) => patch(c, modelo)}
                    onDisparar={camp.id ? () => disparar(camp.id!, modelo) : undefined}
                    onVerEnvios={camp.id ? () => { setFiltroCampanha(camp.id!); setVista('acompanhamento'); } : undefined}
                  />
                );
              })}
            </div>
          ) : (
            <Card>
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  As <strong className="text-foreground">campanhas por consumo</strong> (comprou uma vez só,
                  em risco, inativo, VIP) precisam do Cardápio Web ou do Anota AI conectado — é de lá que
                  vem o histórico de pedidos. Sem integração, use as listas acima.
                </p>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────── Acompanhamento

function Acompanhar({
  acomp, travas, campanhas, filtroStatus, setFiltroStatus, filtroCampanha, setFiltroCampanha,
  salvando, onReenviar,
}: {
  acomp: Acompanhamento | null; travas: Travas | null; campanhas: Campanha[];
  filtroStatus: string; setFiltroStatus: (v: string) => void;
  filtroCampanha: string; setFiltroCampanha: (v: string) => void;
  salvando: string | null; onReenviar: (id: string) => void;
}) {
  const [expandido, setExpandido] = useState<string | null>(null);

  if (!acomp) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando o acompanhamento…
      </div>
    );
  }

  const rodando = acomp.execucoes.filter(e => e.status === 'rodando');
  const contadores = [
    { chave: '', label: 'Tudo', n: Object.values(acomp.porStatus).reduce((s, v) => s + v, 0) },
    { chave: 'enviada', label: 'Enviadas', n: acomp.porStatus.enviada ?? 0 },
    { chave: 'pendente', label: 'Na fila', n: acomp.porStatus.pendente ?? 0 },
    { chave: 'pulada', label: 'Puladas', n: acomp.porStatus.pulada ?? 0 },
    { chave: 'falha', label: 'Falhas', n: acomp.porStatus.falha ?? 0 },
  ];

  return (
    <div className="space-y-4">
      {/* Rodadas em andamento — o "como está indo". */}
      {rodando.length > 0 ? (
        <div className="space-y-3">
          {rodando.map((e) => {
            const p = progressoDaExecucao(e);
            const dias = travas ? diasParaTerminar(p.pendentes, travas, acomp.enviadasHoje, new Date()) : 0;
            return (
              <Card key={e.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-heading text-xl uppercase leading-none">{e.campanha ?? 'Campanha'}</h3>
                  <span className="text-[11px] text-muted-foreground">começou {hora(e.iniciada_em)}</span>
                </div>
                <div className="mt-3">
                  <Barra pct={p.pct} />
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span>
                      <strong className="font-heading text-lg text-foreground">{p.enviadas}</strong> de{' '}
                      {p.enviadas + p.pendentes + p.falhas} enviadas
                    </span>
                    <span><strong className="text-foreground">{p.pendentes}</strong> na fila</span>
                    {p.puladas > 0 && <span>{p.puladas} puladas</span>}
                    {p.falhas > 0 && <span className="text-destructive">{p.falhas} falharam</span>}
                    {dias > 0 && (
                      <span className="flex items-center gap-1 text-[#facc15]">
                        <Clock className="h-3 w-3" />
                        {dias === 1 ? 'termina hoje' : `termina em ~${dias} dias`}
                      </span>
                    )}
                    {dias < 0 && (
                      <span className="text-destructive">sem dia liberado nas travas — não termina</span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <p className="text-xs text-muted-foreground">
            Nenhuma rodada em andamento. Uma campanha ativa abre a rodada no dia e hora marcados —
            ou você pode usar <strong className="text-foreground">Disparar 1 agora</strong> na aba Campanhas.
          </p>
        </Card>
      )}

      {/* Filtros */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {contadores.map(c => (
            <button
              key={c.chave || 'tudo'} onClick={() => setFiltroStatus(c.chave)}
              className={cn(
                'h-8 rounded-[var(--radius)] border px-3 text-[11px] font-bold uppercase',
                filtroStatus === c.chave
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label} <span className="ml-1 opacity-70">{c.n}</span>
            </button>
          ))}
          <select
            value={filtroCampanha} onChange={(e) => setFiltroCampanha(e.target.value)}
            className="ml-auto h-8 rounded-[var(--radius)] border border-border bg-background px-2 text-xs"
          >
            <option value="">Todas as campanhas</option>
            {campanhas.filter(c => c.id).map(c => (
              <option key={c.id} value={c.id!}>{c.nome}</option>
            ))}
          </select>
        </div>
      </Card>

      {/* Registro pessoa a pessoa */}
      <Card>
        <h3 className="mb-3 font-heading text-xl uppercase leading-none">Quem recebeu</h3>
        {acomp.envios.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum envio registrado ainda com esse filtro.
          </p>
        ) : (
          <div className="space-y-1.5">
            {acomp.envios.map((e) => {
              const aberto = expandido === e.id;
              return (
                <div key={e.id} className="rounded-[var(--radius)] border border-border">
                  <button
                    onClick={() => setExpandido(aberto ? null : e.id)}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {e.nome ?? <span className="text-muted-foreground">sem nome</span>}
                      <span className="ml-2 text-[11px] text-muted-foreground">{e.telefone}</span>
                    </span>
                    <span className={cn('text-[10px] font-bold uppercase', COR_STATUS[e.status] ?? '')}>
                      {STATUS_ENVIO_LABEL[e.status] ?? e.status}
                    </span>
                    <span className="w-24 text-right text-[11px] text-muted-foreground">
                      {hora(e.enviado_em ?? e.criado_em)}
                    </span>
                    <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', aberto && 'rotate-180')} />
                  </button>

                  {aberto && (
                    <div className="space-y-2 border-t border-border p-2.5">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {e.campanha ?? 'Campanha'}{e.cupom ? ` · cupom ${e.cupom}` : ''}
                      </p>

                      {/* O texto EXATO que a pessoa recebeu. */}
                      {e.texto ? (
                        <p className="max-w-lg rounded-[var(--radius)] bg-[#075E54]/15 px-3 py-2 text-xs leading-relaxed">
                          {e.texto}
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          {e.status === 'pendente'
                            ? 'Ainda não foi enviada — o texto é sorteado entre as variações na hora do envio.'
                            : 'Sem texto registrado (envio anterior a este registro).'}
                        </p>
                      )}

                      {e.status === 'pulada' && (
                        <p className="text-[11px] text-muted-foreground">
                          Motivo: <strong className="text-foreground">{rotuloMotivo(e.motivo, travas ?? undefined)}</strong>
                        </p>
                      )}
                      {e.status === 'falha' && (
                        <p className="text-[11px] text-destructive">Erro: {e.erro ?? 'desconhecido'}</p>
                      )}

                      {(e.status === 'falha' || e.status === 'pulada') && (
                        <button
                          onClick={() => onReenviar(e.id)}
                          disabled={salvando === e.id}
                          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 text-[11px] font-bold uppercase text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          {salvando === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          Colocar de volta na fila
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {acomp.temMais && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Mostrando os 100 mais recentes. Use os filtros acima para achar o resto.
          </p>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────── Listas

function ListasCard({
  listas, salvando, onSalvar, onExcluir, onNovaCampanha,
}: {
  listas: Lista[];
  salvando: string | null;
  onSalvar: (lista: { id?: string; nome: string; texto: string }) => Promise<boolean>;
  onExcluir: (id: string) => void;
  onNovaCampanha: (lista: Lista) => void;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [nome, setNome] = useState('');
  const [texto, setTexto] = useState('');
  const [lendo, setLendo] = useState(false);
  const [avisoArquivo, setAvisoArquivo] = useState<string | null>(null);

  const linhas = texto.split('\n').filter(l => l.trim()).length;

  async function importar(file: File) {
    setLendo(true); setAvisoArquivo(null);
    try {
      const conteudo = await lerArquivoContatos(file);
      const n = conteudo.split('\n').filter(Boolean).length;
      setTexto(t => (t.trim() ? `${t.trim()}\n${conteudo}` : conteudo));
      setAvisoArquivo(n > 0
        ? `${n} contato(s) lidos de ${file.name}. Confira abaixo antes de salvar.`
        : `Nenhum telefone encontrado em ${file.name}.`);
      if (!nome.trim()) setNome(file.name.replace(/\.[^.]+$/, ''));
    } catch {
      setAvisoArquivo('Não consegui ler esse arquivo. Tente CSV ou Excel (.xlsx).');
    } finally { setLendo(false); }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListPlus className="h-4 w-4 text-primary" />
          <h3 className="font-heading text-xl uppercase leading-none">Listas</h3>
          <span className="text-[11px] text-muted-foreground">telefones que você mesmo sobe</span>
        </div>
        <button
          onClick={() => { setAbrindo(a => !a); setNome(''); setTexto(''); setAvisoArquivo(null); }}
          className="h-8 rounded-[var(--radius)] border border-border px-3 text-xs font-bold uppercase text-muted-foreground hover:text-foreground"
        >
          {abrindo ? 'Cancelar' : 'Nova lista'}
        </button>
      </div>

      {abrindo && (
        <div className="mb-3 space-y-2 rounded-[var(--radius)] border border-border bg-background/40 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={nome} onChange={(e) => setNome(e.target.value)}
              placeholder="Nome da lista (ex: Clientes do salão)"
              className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm"
            />
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border border-primary/50 bg-primary/10 px-3 text-xs font-bold uppercase text-primary">
              {lendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Excel ou CSV
              <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importar(f); e.target.value = ''; }} />
            </label>
          </div>

          {avisoArquivo && <p className="text-[11px] text-primary">{avisoArquivo}</p>}

          <textarea
            value={texto} onChange={(e) => setTexto(e.target.value)} rows={6}
            placeholder={'Ou cole aqui:\n5543999990000,Maria\n5511988887777,João'}
            className="w-full rounded-[var(--radius)] border border-border bg-background p-2 font-mono text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            Uma linha por pessoa: <code className="rounded bg-background px-1">telefone</code> ou{' '}
            <code className="rounded bg-background px-1">telefone,nome</code>. Na planilha, o sistema
            acha sozinho a coluna do telefone e a do nome. Repetidos são descartados.
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{linhas} linha(s)</span>
            <button
              disabled={!nome.trim() || linhas === 0 || salvando === 'lista'}
              onClick={async () => {
                const ok = await onSalvar({ nome, texto });
                if (ok) { setAbrindo(false); setNome(''); setTexto(''); setAvisoArquivo(null); }
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 text-xs font-bold uppercase text-primary-foreground disabled:opacity-50"
            >
              {salvando === 'lista' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar lista
            </button>
          </div>
        </div>
      )}

      {listas.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma lista ainda.</p>
      ) : (
        <div className="space-y-1.5">
          {listas.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-2">
              <span className="text-sm font-medium">{l.nome}</span>
              <span className="text-[11px] text-muted-foreground">{l.contatos} contatos</span>
              <div className="ml-auto flex items-center gap-3">
                <button onClick={() => onNovaCampanha(l)} className="text-[10px] font-bold uppercase tracking-wide text-primary">
                  Criar campanha
                </button>
                <button
                  onClick={() => { if (confirm(`Excluir a lista "${l.nome}"? As campanhas que usam ela são desativadas.`)) onExcluir(l.id); }}
                  className="text-muted-foreground hover:text-destructive" title="Excluir lista">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────── Campanha

function CampanhaCard({
  campanha, titulo, subtitulo, cor, pessoas, extras, travas, execucao, aberto, onToggle,
  amostra, loja, ticketMedioLoja, salvando, onChange, onSalvar, onExcluir, onDisparar, onVerEnvios,
}: {
  campanha: Campanha; titulo: string; subtitulo: string; cor: string; pessoas: number;
  extras?: React.ReactNode; travas: Travas | null; execucao?: Execucao; aberto: boolean;
  onToggle: () => void; amostra: PessoaAmostra[]; loja: string; ticketMedioLoja: number;
  salvando: boolean; onChange: (c: Campanha) => void; onSalvar: (c: Campanha) => void;
  onExcluir?: () => void; onDisparar?: () => void; onVerEnvios?: () => void;
}) {
  const p = execucao ? progressoDaExecucao(execucao) : null;

  return (
    <Card className="p-0" id={`campanha-${campanha.id ?? campanha.modelo ?? ''}`}>
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-4 text-left">
        <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ background: cor }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-xl uppercase leading-none">{titulo}</h3>
            {campanha.ativa ? (
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase text-primary">
                disparando
              </span>
            ) : campanha.salva ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                pausada
              </span>
            ) : null}
            {campanha.cupom && (
              <span className="inline-flex items-center gap-1 rounded-full border border-secondary/40 bg-secondary/10 px-2 py-0.5 text-[9px] font-bold uppercase text-secondary">
                <Ticket className="h-2.5 w-2.5" /> {campanha.cupom}
              </span>
            )}
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{subtitulo}</p>

          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span className="flex items-baseline gap-1.5">
              <Users className="h-3.5 w-3.5 self-center text-muted-foreground" />
              <strong className="font-heading text-2xl leading-none">{pessoas}</strong>
              <span className="text-[11px] text-muted-foreground">pessoas</span>
            </span>
            {extras}
          </div>

          {/* Progresso da rodada em andamento, direto no card. */}
          {p && execucao?.status === 'rodando' && (
            <div className="mt-3 max-w-md">
              <Barra pct={p.pct} cor={cor} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                <strong className="text-foreground">{p.enviadas}</strong> enviadas ·{' '}
                {p.pendentes} na fila
                {p.falhas > 0 && <span className="text-destructive"> · {p.falhas} falhas</span>}
                {travas && p.pendentes > 0 && (() => {
                  const d = diasParaTerminar(p.pendentes, travas, 0, new Date());
                  return d > 1 ? ` · ~${d} dias para terminar` : '';
                })()}
              </p>
            </div>
          )}
        </div>
        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-180')} />
      </button>

      {aberto && (
        <EditorCampanha
          campanha={campanha} amostra={amostra} loja={loja} ticketMedioLoja={ticketMedioLoja}
          salvando={salvando} onChange={onChange} onSalvar={onSalvar} onExcluir={onExcluir}
          onDisparar={onDisparar} onVerEnvios={onVerEnvios}
        />
      )}
    </Card>
  );
}

function EditorCampanha({
  campanha, amostra, loja, ticketMedioLoja, salvando, onChange, onSalvar, onExcluir,
  onDisparar, onVerEnvios,
}: {
  campanha: Campanha; amostra: PessoaAmostra[]; loja: string; ticketMedioLoja: number;
  salvando: boolean; onChange: (c: Campanha) => void; onSalvar: (c: Campanha) => void;
  onExcluir?: () => void; onDisparar?: () => void; onVerEnvios?: () => void;
}) {
  const meta = campanha.modelo ? MODELOS_FIDELIDADE[campanha.modelo] : null;
  const [verPessoas, setVerPessoas] = useState(false);

  const exemplo = amostra[0];
  const base = { chave: '', telefone: '', nome: exemplo?.nome ?? 'Maria Souza' };
  const destinatario = campanha.fonte === 'lista' ? base : {
    ...base,
    consumo: {
      pedidos: exemplo?.pedidos ?? 3,
      ticketMedio: exemplo?.ticketMedio ?? ticketMedioLoja,
      diasDesdeUltima: exemplo?.diasDesdeUltima ?? 42,
    },
  };
  const vars = varsDoDestinatario(destinatario, loja, campanha.cupom);
  const varsSemNome = varsDoDestinatario({ ...destinatario, nome: null }, loja, campanha.cupom);
  const usaNome = campanha.mensagens.some(m => m && (m.includes('{{primeiro_nome}}') || m.includes('{{nome}}')));
  const erros = validarCampanha(campanha.mensagens, campanha.fonte, campanha.cupom);

  return (
    <div className="space-y-4 border-t border-border p-4">
      {campanha.fonte === 'lista' && (
        <div className="space-y-1">
          <Rotulo>Nome da campanha</Rotulo>
          <input value={campanha.nome} onChange={(e) => onChange({ ...campanha, nome: e.target.value })}
            className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
        </div>
      )}

      {meta && (
        <div>
          <Rotulo>Quem entra</Rotulo>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {meta.campos.map((campo) => (
              <div key={campo.chave} className="space-y-1">
                <label className="text-xs font-medium">
                  {campo.rotulo}<span className="ml-1 text-muted-foreground">({campo.sufixo})</span>
                </label>
                <NumeroInput
                  valor={campanha.params[campo.chave] ?? null}
                  placeholder={campo.padrao === null ? 'automático' : String(campo.padrao)}
                  onChange={(v) => onChange({ ...campanha, params: { ...campanha.params, [campo.chave]: v } })}
                />
                <p className="text-[10px] leading-relaxed text-muted-foreground">{campo.ajuda}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Rotulo>Cupom desta oferta</Rotulo>
          <input
            value={campanha.cupom ?? ''}
            onChange={(e) => onChange({ ...campanha, cupom: e.target.value.toUpperCase() })}
            placeholder="VOLTA10"
            className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 font-mono text-sm uppercase"
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Crie o cupom no painel do cardápio (validade e limite de uso ficam lá) e cole o código aqui.
            Use <code className="rounded bg-background px-1">{'{{cupom}}'}</code> na mensagem.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Rotulo>Começa às</Rotulo>
            <input type="time" value={campanha.hora}
              onChange={(e) => onChange({ ...campanha, hora: e.target.value })}
              className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
          </div>
          <div className="space-y-1">
            <Rotulo>Máx. por rodada</Rotulo>
            <NumeroInput valor={campanha.tetoPublico} placeholder="sem limite"
              onChange={(v) => onChange({ ...campanha, tetoPublico: v })} />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Rotulo>Roda nos dias</Rotulo>
        <div className="flex flex-wrap gap-1">
          {DIAS_SEMANA_LABEL.map((label, dia) => {
            const on = campanha.diasSemana.includes(dia);
            return (
              <button key={dia}
                onClick={() => onChange({
                  ...campanha,
                  diasSemana: on ? campanha.diasSemana.filter(d => d !== dia) : [...campanha.diasSemana, dia].sort(),
                })}
                className={cn('h-7 rounded-[var(--radius)] border px-2 text-[10px] font-bold uppercase',
                  on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Rotulo>Mensagens (rodízio entre as três)</Rotulo>
          <p className="text-[10px] text-muted-foreground">
            {VARIAVEIS.filter(v => campanha.fonte !== 'lista' || !v.consumo).map(v => `{{${v.chave}}}`).join('  ')}
          </p>
        </div>
        <div className="mt-2 grid gap-3 lg:grid-cols-3">
          {[0, 1, 2].map((i) => {
            const texto = campanha.mensagens[i] ?? '';
            const desconhecidas = variaveisDesconhecidas(texto);
            const indisponiveis = variaveisIndisponiveis(texto, campanha.fonte);
            return (
              <div key={i} className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Variação {i + 1}
                </label>
                <textarea
                  value={texto} rows={4}
                  onChange={(e) => {
                    const novas = [...campanha.mensagens];
                    novas[i] = e.target.value;
                    onChange({ ...campanha, mensagens: novas });
                  }}
                  className="w-full rounded-[var(--radius)] border border-border bg-background p-2 text-xs leading-relaxed"
                />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">{texto.length} caracteres</span>
                  {desconhecidas.length > 0 && (
                    <span className="text-[10px] text-[#facc15]">{desconhecidas.map(d => `{{${d}}}`).join(', ')} não existe</span>
                  )}
                  {indisponiveis.length > 0 && (
                    <span className="text-[10px] text-destructive">
                      {indisponiveis.map(d => `{{${d}}}`).join(', ')} não existe em lista
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <Rotulo>Como chega no WhatsApp</Rotulo>
        <div className="mt-2 space-y-2">
          {campanha.mensagens.filter(Boolean).map((m, i) => (
            <p key={i} className="max-w-md rounded-[var(--radius)] bg-[#075E54]/15 px-3 py-2 text-xs leading-relaxed">
              {aplicarVars(m, vars, 'envio')}
            </p>
          ))}
        </div>
        {usaNome && (
          <div className="mt-3">
            <Rotulo>E em quem não tem nome cadastrado</Rotulo>
            <div className="mt-2 space-y-2">
              {campanha.mensagens.filter(Boolean).map((m, i) => (
                <p key={i} className="max-w-md rounded-[var(--radius)] border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {aplicarVars(m, varsSemNome, 'envio')}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      {amostra.length > 0 && (
        <div>
          <button onClick={() => setVerPessoas(v => !v)} className="text-xs font-bold uppercase tracking-wide text-primary">
            {verPessoas ? 'Esconder' : `Ver ${amostra.length} pessoas do público`}
          </button>
          {verPessoas && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="py-1.5 pr-3 font-bold">Cliente</th>
                    <th className="py-1.5 pr-3 font-bold">Telefone</th>
                    <th className="py-1.5 pr-3 text-right font-bold">Pedidos</th>
                    <th className="py-1.5 pr-3 text-right font-bold">Gastou</th>
                    <th className="py-1.5 text-right font-bold">Parado há</th>
                  </tr>
                </thead>
                <tbody>
                  {amostra.map((p) => (
                    <tr key={p.telefone ?? p.nome} className="border-b border-border/50">
                      <td className="py-1.5 pr-3">{p.nome ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{p.telefone ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-right">{p.pedidos}</td>
                      <td className="py-1.5 pr-3 text-right">{moedaBR(p.receita)}</td>
                      <td className="py-1.5 text-right">{p.diasDesdeUltima}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {erros.length > 0 && (
        <div className="space-y-1 rounded-[var(--radius)] border border-destructive/40 bg-destructive/[0.06] p-2">
          {erros.map((e, i) => <p key={i} className="text-[11px] text-destructive">{e}</p>)}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              const ligando = !campanha.ativa;
              if (ligando && !confirm(
                'Ativar faz o sistema ENVIAR mensagens de verdade pelo WhatsApp deste cliente, '
                + 'sozinho, respeitando as travas. Confirmar?')) return;
              onSalvar({ ...campanha, ativa: ligando });
            }}
            disabled={salvando || erros.length > 0}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] border px-3 text-xs font-bold uppercase disabled:opacity-50',
              campanha.ativa ? 'border-destructive/50 text-destructive' : 'border-primary bg-primary/15 text-primary',
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            {campanha.ativa ? 'Pausar disparo' : 'Ativar disparo'}
          </button>
          {onDisparar && campanha.salva && (
            <button
              onClick={() => {
                if (!confirm('Isto envia UMA mensagem AGORA, de verdade, para a próxima pessoa da fila. Continuar?')) return;
                onDisparar();
              }}
              disabled={salvando || erros.length > 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 text-xs font-bold uppercase text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> Disparar 1 agora
            </button>
          )}
          {onVerEnvios && campanha.salva && (
            <button onClick={onVerEnvios} className="text-[11px] font-bold uppercase tracking-wide text-primary">
              Ver envios
            </button>
          )}
          {onExcluir && (
            <button
              onClick={() => { if (confirm('Excluir esta campanha?')) onExcluir(); }}
              className="text-muted-foreground hover:text-destructive" title="Excluir campanha">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => onSalvar(campanha)}
          disabled={salvando || erros.length > 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-4 text-xs font-bold uppercase text-primary-foreground disabled:opacity-50"
        >
          {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar
        </button>
      </div>
    </div>
  );
}
