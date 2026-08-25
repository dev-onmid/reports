"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, Clock, Info, ListPlus, Loader2, PowerOff, Save, ShieldCheck,
  Send, Ticket, Trash2, Users, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MODELOS_FIDELIDADE, ORDEM_MODELOS, VARIAVEIS, DIAS_SEMANA_LABEL, PISO_INTERVALO_SEG,
  aplicarVars, capacidadeDaJanela, diasParaVarrer, moedaBR, varsDoDestinatario,
  variaveisDesconhecidas, variaveisIndisponiveis, validarCampanha,
  type FonteCampanha, type ModeloId, type ParamsRegua, type Travas,
} from '@/lib/fidelidade';

/**
 * Aba Fidelidade — campanhas de recompra por consumo E por lista manual.
 *
 * Duas fontes de público convivem: os 5 SEGMENTOS, derivados dos pedidos, e as
 * LISTAS manuais, que não dependem de integração nenhuma. O editor é o mesmo
 * para as duas — duplicá-lo faria as regras divergirem na primeira mudança.
 *
 * ⚠️ Campanha ATIVA dispara sozinha pelo WhatsApp do cliente. Por isso ativar
 * pede confirmação explícita, e a validação da mensagem roda aqui e de novo no
 * servidor.
 */

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
  id: string; campanha: string | null; iniciada_em: string; status: string;
  publico: number; enviadas: number; falhas: number; puladas: number;
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
  execucoes?: Execucao[];
};

const COR_MODELO: Record<ModeloId, string> = {
  primeira_recompra: 'var(--primary)',
  em_risco: '#facc15',
  inativo: 'var(--destructive)',
  vip: 'var(--secondary)',
  reconquistado: '#22c55e',
};

/**
 * Leva a tela até a campanha recém-criada. Sem isso ela aparece abaixo dos
 * cinco segmentos, fora do campo de visão de quem acabou de clicar.
 */
function focarCampanha(chave: string) {
  requestAnimationFrame(() => {
    document.getElementById(`campanha-${chave}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

/** Chave estável de rascunho: modelo para segmento, id para lista. */
function chaveCampanha(c: Campanha): string {
  return c.fonte === 'segmento' ? (c.modelo ?? 'sem-modelo') : (c.id ?? 'nova');
}

function Card({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <div id={id} className={cn('rounded-[var(--radius)] border border-border bg-card p-4', className)}>{children}</div>;
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

function NumeroInput({
  valor, onChange, placeholder, className,
}: { valor: number | null; onChange: (v: number | null) => void; placeholder?: string; className?: string }) {
  return (
    <input
      type="number"
      value={valor ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className={cn('h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm', className)}
    />
  );
}

export function ClientFidelidadeTab({ clientId }: { clientId: string }) {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, Campanha>>({});
  const [travasDraft, setTravasDraft] = useState<Travas | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade`);
      const data = await r.json() as Painel;
      setPainel(data);
      if (data.campanhas) {
        setRascunhos(Object.fromEntries(data.campanhas.map(c => [chaveCampanha(c), c])));
      }
      if (data.travas) setTravasDraft(data.travas);
    } catch {
      setPainel({ conectado: false, error: 'Falha ao carregar' });
    } finally {
      setCarregando(false);
    }
  }, [clientId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const patch = useCallback(async (corpo: unknown, tag: string) => {
    setSalvando(tag);
    setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        setErro(d.error ?? 'Não foi possível salvar.');
        return false;
      }
      await carregar();
      return true;
    } finally {
      setSalvando(null);
    }
  }, [clientId, carregar]);

  /**
   * Traduz o relatório do motor para uma frase. O gestor não tem por que ler
   * `{"pulou":"teto_diario"}` — e é justamente quando NADA acontece que ele
   * precisa entender o porquê.
   */
  const disparar = useCallback(async (campanhaId: string, tag: string) => {
    setSalvando(tag);
    setErro(null);
    setResultado(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade/disparar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campanhaId }),
      });
      const d = await r.json().catch(() => ({})) as { error?: string; resultado?: Record<string, unknown> };
      if (!r.ok) { setErro(d.error ?? 'Não foi possível disparar.'); return; }

      const res = d.resultado ?? {};
      if (res.enviada === true) setResultado(`Mensagem enviada para ${res.telefone}.`);
      else if (res.enviada === false) setResultado(`O envio para ${res.telefone} falhou — veja "Últimos disparos".`);
      else if (res.pulou === 'teto_diario') setResultado(`Teto diário já atingido (${res.enviadas_hoje} hoje). Nada foi enviado.`);
      else if (res.pulou === 'instancia') setResultado('O WhatsApp deste cliente não está conectado agora. Nada foi enviado.');
      else if (res.concluida) setResultado('A fila desta campanha acabou — todo mundo já recebeu nesta rodada.');
      else if (res.publico === 0) setResultado('Ninguém entrou na fila: público vazio, ou todos em cooldown/opt-out.');
      else setResultado('Nada foi enviado nesta chamada.');
      await carregar();
    } finally {
      setSalvando(null);
    }
  }, [clientId, carregar]);

  /**
   * "Criar campanha" na lista.
   *
   * ⚠️ Antes isto só disparava o PATCH e fechava tudo: a campanha nascia
   * FECHADA e no fim da página, depois dos 5 segmentos — de onde o gestor
   * está olhando, "não acontecia nada". E clicar de novo criava uma segunda.
   * Agora reaproveita a que já existe, abre e rola até ela.
   */
  const criarCampanhaDaLista = useCallback(async (lista: Lista) => {
    const existente = Object.values(rascunhos)
      .find(c => c.fonte === 'lista' && c.listaId === lista.id);
    if (existente?.id) {
      setAberto(existente.id);
      setResultado(`A lista "${lista.nome}" já tem uma campanha — abri ela para você.`);
      focarCampanha(existente.id);
      return;
    }

    setSalvando('lista');
    setErro(null);
    setResultado(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fonte: 'lista', listaId: lista.id, nome: `Oferta — ${lista.nome}`,
          mensagens: [], diasSemana: [1, 2, 3, 4, 5, 6], hora: '18:00', ativa: false,
        }),
      });
      const d = await r.json().catch(() => ({})) as { error?: string; campanha?: Campanha };
      if (!r.ok || !d.campanha?.id) {
        setErro(d.error ?? 'Não foi possível criar a campanha.');
        return;
      }
      await carregar();
      setAberto(d.campanha.id);
      setResultado(`Campanha criada para a lista "${lista.nome}". Ela está logo abaixo, já aberta.`);
      focarCampanha(d.campanha.id);
    } finally {
      setSalvando(null);
    }
  }, [clientId, carregar, rascunhos]);

  const capacidade = useMemo(
    () => (travasDraft ? capacidadeDaJanela(travasDraft) : 0),
    [travasDraft],
  );

  if (carregando && !painel) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando os segmentos…
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
              Este cliente está fora das campanhas de recompra — nada é calculado, nada é
              configurado e nada é enviado. Para ligar, use o botão
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

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-start gap-3 rounded-[var(--radius)] border border-primary/40 bg-primary/[0.06] p-3">
        <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Campanha ativa dispara sozinha</strong>, pelo WhatsApp
          deste cliente, respeitando as travas abaixo. Campanha desativada só calcula o público.
          {ativas > 0 && <> Hoje há <strong className="text-foreground">{ativas} ativa(s)</strong>.</>}
        </p>
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

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <Rotulo>Base de clientes</Rotulo>
          <p className="mt-1 font-heading text-2xl leading-none">{painel?.base?.comTelefone ?? 0}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {painel?.conectado
              ? `com telefone, de ${painel?.base?.clientes ?? 0} que já compraram`
              : 'sem delivery conectado — use listas manuais'}
          </p>
        </Card>
        <Card>
          <Rotulo>Ticket médio da loja</Rotulo>
          <p className="mt-1 font-heading text-2xl leading-none">{moedaBR(painel?.ticketMedioLoja ?? 0)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            recompra: {painel?.regua?.janelaDias}d · inativo: {painel?.regua?.inatividadeDias}d
          </p>
        </Card>
        <Card>
          <Rotulo>Número de envio</Rotulo>
          {painel?.instancia ? (
            <>
              <p className="mt-1 truncate font-heading text-lg leading-none" title={painel.instancia.id}>
                {painel.instancia.id}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                WhatsApp do próprio cliente ({painel.instancia.provider})
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-[#facc15]">
              Nenhuma instância vinculada — sem ela nada será enviado. Vincule na aba Rastreio.
            </p>
          )}
        </Card>
      </div>

      {travas && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h3 className="font-heading text-xl uppercase leading-none">Travas de segurança</h3>
            </div>
            <button
              onClick={() => void patch({ travas: travasDraft }, 'travas')}
              disabled={salvando === 'travas'}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 text-xs font-bold uppercase text-primary-foreground disabled:opacity-60"
            >
              {salvando === 'travas' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar travas
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Rotulo>1 mensagem a cada</Rotulo>
              <div className="flex items-center gap-2">
                <NumeroInput
                  valor={travas.intervaloMinSeg}
                  onChange={(v) => setTravasDraft({ ...travas, intervaloMinSeg: Math.max(PISO_INTERVALO_SEG, v ?? 120) })}
                />
                <span className="text-xs text-muted-foreground">seg</span>
              </div>
              <p className="text-[10px] text-muted-foreground">Mínimo permitido: {PISO_INTERVALO_SEG}s</p>
            </div>
            <div className="space-y-1">
              <Rotulo>Máximo por dia</Rotulo>
              <NumeroInput valor={travas.tetoDiario} onChange={(v) => setTravasDraft({ ...travas, tetoDiario: v ?? 50 })} />
              <p className="text-[10px] text-muted-foreground">Soma todas as campanhas do número</p>
            </div>
            <div className="space-y-1">
              <Rotulo>Só entre</Rotulo>
              <div className="flex items-center gap-1">
                <input type="time" value={travas.janelaInicio}
                  onChange={(e) => setTravasDraft({ ...travas, janelaInicio: e.target.value })}
                  className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
                <span className="text-xs text-muted-foreground">e</span>
                <input type="time" value={travas.janelaFim}
                  onChange={(e) => setTravasDraft({ ...travas, janelaFim: e.target.value })}
                  className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <Rotulo>Mesma pessoa a cada</Rotulo>
              <div className="flex items-center gap-2">
                <NumeroInput valor={travas.cooldownDias} onChange={(v) => setTravasDraft({ ...travas, cooldownDias: v ?? 7 })} />
                <span className="text-xs text-muted-foreground">dias</span>
              </div>
              <p className="text-[10px] text-muted-foreground">Vale entre TODAS as campanhas</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <div className="flex items-center gap-1.5">
              <Rotulo>Dias</Rotulo>
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
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={travas.optoutAtivo}
                onChange={(e) => setTravasDraft({ ...travas, optoutAtivo: e.target.checked })}
                className="h-3.5 w-3.5 accent-[var(--primary)]" />
              <span className="text-muted-foreground">Tirar da lista quem responder pedindo para não receber</span>
            </label>
            <p className="ml-auto text-[11px] text-muted-foreground">
              Entrega real: <strong className="text-foreground">{capacidade} mensagens/dia</strong>
              {capacidade < travas.tetoDiario && ' (a janela de horário não comporta o teto)'}
            </p>
          </div>
        </Card>
      )}

      <ListasCard
        listas={painel?.listas ?? []}
        salvando={salvando}
        onSalvar={(lista) => patch({ lista }, 'lista')}
        onExcluir={(id) => patch({ excluirLista: id }, 'lista')}
        onNovaCampanha={(lista) => void criarCampanhaDaLista(lista)}
      />

      {/* Segmentos (só com delivery conectado) */}
      {painel?.conectado ? (
        <div className="space-y-3">
          {ORDEM_MODELOS.map((modelo) => {
            const seg = painel.segmentos?.find(s => s.modelo === modelo);
            const camp = rascunhos[modelo];
            if (!seg || !camp) return null;
            return (
              <CampanhaCard
                key={modelo}
                campanha={camp}
                titulo={MODELOS_FIDELIDADE[modelo].nome}
                subtitulo={MODELOS_FIDELIDADE[modelo].objetivo}
                cor={COR_MODELO[modelo]}
                pessoas={seg.resumo.pessoas}
                extras={
                  <>
                    <span className="text-[11px] text-muted-foreground">
                      já gastaram <strong className="text-foreground">{moedaBR(seg.resumo.receitaHistorica)}</strong>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      ticket <strong className="text-foreground">{moedaBR(seg.resumo.ticketMedio)}</strong>
                    </span>
                    {seg.resumo.diasParadoMediano !== null && (
                      <span className="text-[11px] text-muted-foreground">
                        parados há <strong className="text-foreground">{seg.resumo.diasParadoMediano}d</strong>
                      </span>
                    )}
                  </>
                }
                travas={travas}
                aberto={aberto === modelo}
                onToggle={() => setAberto(aberto === modelo ? null : modelo)}
                amostra={seg.amostra}
                loja={painel.loja ?? 'nossa loja'}
                ticketMedioLoja={painel.ticketMedioLoja ?? 0}
                salvando={salvando === modelo}
                onChange={(c) => setRascunhos(r => ({ ...r, [modelo]: c }))}
                onSalvar={(c) => patch(c, modelo)}
                onDisparar={camp.id ? () => disparar(camp.id!, modelo) : undefined}
              />
            );
          })}
        </div>
      ) : (
        <Card>
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Os <strong className="text-foreground">segmentos por consumo</strong> (quem comprou uma
              vez só, em risco, inativo, VIP) precisam do Cardápio Web ou do Anota AI conectado — é de
              lá que sai o histórico de pedidos. Sem integração, use as listas manuais acima.
            </p>
          </div>
        </Card>
      )}

      {/* Campanhas de lista manual */}
      {campanhasLista.length > 0 && (
        <div className="space-y-3">
          <Rotulo>Campanhas por lista</Rotulo>
          {campanhasLista.map((camp) => {
            const chave = chaveCampanha(camp);
            const lista = painel?.listas?.find(l => l.id === camp.listaId);
            return (
              <CampanhaCard
                key={chave}
                campanha={camp}
                titulo={camp.nome}
                subtitulo={lista ? `Lista "${lista.nome}" — ${lista.contatos} contatos` : 'Lista removida — campanha sem público'}
                cor="var(--secondary)"
                pessoas={lista?.contatos ?? 0}
                travas={travas}
                aberto={aberto === chave}
                onToggle={() => setAberto(aberto === chave ? null : chave)}
                amostra={[]}
                loja={painel?.loja ?? 'nossa loja'}
                ticketMedioLoja={painel?.ticketMedioLoja ?? 0}
                salvando={salvando === chave}
                onChange={(c) => setRascunhos(r => ({ ...r, [chave]: c }))}
                onSalvar={(c) => patch(c, chave)}
                onExcluir={camp.id ? () => patch({ excluirCampanha: camp.id }, chave) : undefined}
                onDisparar={camp.id ? () => disparar(camp.id!, chave) : undefined}
              />
            );
          })}
        </div>
      )}

      {(painel?.execucoes?.length ?? 0) > 0 && <ExecucoesCard execucoes={painel!.execucoes!} />}
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
  const [alvo, setAlvo] = useState<string | null>(null);

  const linhas = texto.split('\n').filter(l => l.trim()).length;

  function importar(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const conteudo = (e.target?.result as string) ?? '';
      setTexto(conteudo.split(/\r?\n/).filter(l => l.trim()).join('\n'));
    };
    reader.readAsText(file);
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListPlus className="h-4 w-4 text-primary" />
          <h3 className="font-heading text-xl uppercase leading-none">Listas manuais</h3>
        </div>
        <button
          onClick={() => { setAbrindo(a => !a); setAlvo(null); setNome(''); setTexto(''); }}
          className="h-8 rounded-[var(--radius)] border border-border px-3 text-xs font-bold uppercase text-muted-foreground hover:text-foreground"
        >
          {abrindo ? 'Cancelar' : 'Nova lista'}
        </button>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Telefones cadastrados na mão — não dependem de integração nenhuma. Uma linha por pessoa,
        <code className="mx-1 rounded bg-background px-1">telefone</code> ou
        <code className="mx-1 rounded bg-background px-1">telefone,nome</code>. Números repetidos são
        descartados sozinhos.
      </p>

      {abrindo && (
        <div className="mb-3 space-y-2 rounded-[var(--radius)] border border-border bg-background/40 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={nome} onChange={(e) => setNome(e.target.value)}
              placeholder="Nome da lista (ex: Clientes do salão)"
              className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm"
            />
            <label className="inline-flex h-9 cursor-pointer items-center rounded-[var(--radius)] border border-border px-3 text-xs font-bold uppercase text-muted-foreground hover:text-foreground">
              Importar CSV
              <input type="file" accept=".csv,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); }} />
            </label>
          </div>
          <textarea
            value={texto} onChange={(e) => setTexto(e.target.value)} rows={6}
            placeholder={'5543999990000,Maria\n5511988887777,João'}
            className="w-full rounded-[var(--radius)] border border-border bg-background p-2 font-mono text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{linhas} linha(s)</span>
            <button
              disabled={!nome.trim() || linhas === 0 || salvando === 'lista'}
              onClick={async () => {
                const ok = await onSalvar({ id: alvo ?? undefined, nome, texto });
                if (ok) { setAbrindo(false); setNome(''); setTexto(''); }
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
        <p className="text-xs text-muted-foreground">Nenhuma lista cadastrada ainda.</p>
      ) : (
        <div className="space-y-1.5">
          {listas.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-2">
              <span className="text-sm font-medium">{l.nome}</span>
              <span className="text-[11px] text-muted-foreground">{l.contatos} contatos</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => onNovaCampanha(l)}
                  className="text-[10px] font-bold uppercase tracking-wide text-primary">
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
  campanha, titulo, subtitulo, cor, pessoas, extras, travas, aberto, onToggle,
  amostra, loja, ticketMedioLoja, salvando, onChange, onSalvar, onExcluir, onDisparar,
}: {
  campanha: Campanha; titulo: string; subtitulo: string; cor: string; pessoas: number;
  extras?: React.ReactNode; travas: Travas | null; aberto: boolean; onToggle: () => void;
  amostra: PessoaAmostra[]; loja: string; ticketMedioLoja: number; salvando: boolean;
  onChange: (c: Campanha) => void; onSalvar: (c: Campanha) => void; onExcluir?: () => void;
  onDisparar?: () => void;
}) {
  const dias = travas ? diasParaVarrer(pessoas, travas) : 0;

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
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{subtitulo}</p>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span className="flex items-baseline gap-1.5">
              <Users className="h-3.5 w-3.5 self-center text-muted-foreground" />
              <strong className="font-heading text-2xl leading-none">{pessoas}</strong>
              <span className="text-[11px] text-muted-foreground">pessoas</span>
            </span>
            {extras}
            {dias > 1 && (
              <span className="flex items-center gap-1 text-[11px] text-[#facc15]">
                <Clock className="h-3 w-3" /> {dias} dias para falar com todos
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-180')} />
      </button>

      {aberto && (
        <EditorCampanha
          campanha={campanha} amostra={amostra} loja={loja} ticketMedioLoja={ticketMedioLoja}
          salvando={salvando} onChange={onChange} onSalvar={onSalvar} onExcluir={onExcluir}
          onDisparar={onDisparar}
        />
      )}
    </Card>
  );
}

function EditorCampanha({
  campanha, amostra, loja, ticketMedioLoja, salvando, onChange, onSalvar, onExcluir, onDisparar,
}: {
  campanha: Campanha; amostra: PessoaAmostra[]; loja: string; ticketMedioLoja: number;
  salvando: boolean; onChange: (c: Campanha) => void; onSalvar: (c: Campanha) => void;
  onExcluir?: () => void; onDisparar?: () => void;
}) {
  const meta = campanha.modelo ? MODELOS_FIDELIDADE[campanha.modelo] : null;
  const [verPessoas, setVerPessoas] = useState(false);

  const exemplo = amostra[0];
  const destinatario = campanha.fonte === 'lista'
    // Lista manual não tem consumo — a prévia precisa mostrar exatamente isso.
    ? { chave: '', telefone: '', nome: exemplo?.nome ?? 'Maria Souza' }
    : {
      chave: '', telefone: '', nome: exemplo?.nome ?? 'Maria Souza',
      consumo: {
        pedidos: exemplo?.pedidos ?? 3,
        ticketMedio: exemplo?.ticketMedio ?? ticketMedioLoja,
        diasDesdeUltima: exemplo?.diasDesdeUltima ?? 42,
      },
    };
  const vars = varsDoDestinatario(destinatario, loja, campanha.cupom);
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

      {/* Cupom da oferta */}
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
            Crie o cupom no painel do cardápio (com validade e limite de uso) e cole o código aqui.
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
            {VARIAVEIS
              .filter(v => campanha.fonte !== 'lista' || !v.consumo)
              .map(v => `{{${v.chave}}}`).join('  ')}
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
                    <span className="text-[10px] text-[#facc15]">
                      {desconhecidas.map(d => `{{${d}}}`).join(', ')} não existe
                    </span>
                  )}
                  {indisponiveis.length > 0 && (
                    <span className="text-[10px] text-destructive">
                      {indisponiveis.map(d => `{{${d}}}`).join(', ')} não existe em lista manual
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <Rotulo>
          Como chega no WhatsApp {exemplo ? `de ${exemplo.nome ?? 'um cliente sem nome cadastrado'}` : '(exemplo)'}
        </Rotulo>
        <div className="mt-2 space-y-2">
          {campanha.mensagens.filter(Boolean).map((m, i) => (
            <p key={i} className="max-w-md rounded-[var(--radius)] bg-[#075E54]/15 px-3 py-2 text-xs leading-relaxed">
              {aplicarVars(m, vars, 'envio')}
            </p>
          ))}
        </div>
      </div>

      {amostra.length > 0 && (
        <div>
          <button onClick={() => setVerPessoas(v => !v)}
            className="text-xs font-bold uppercase tracking-wide text-primary">
            {verPessoas ? 'Esconder' : `Ver ${amostra.length} pessoas`}
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const ligando = !campanha.ativa;
              if (ligando && !confirm(
                'Ativar esta campanha faz o sistema ENVIAR mensagens de verdade pelo WhatsApp '
                + 'deste cliente, sozinho, respeitando as travas. Confirmar?')) return;
              onSalvar({ ...campanha, ativa: ligando });
            }}
            disabled={salvando || erros.length > 0}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] border px-3 text-xs font-bold uppercase disabled:opacity-50',
              campanha.ativa
                ? 'border-destructive/50 text-destructive'
                : 'border-primary bg-primary/15 text-primary',
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            {campanha.ativa ? 'Pausar disparo' : 'Ativar disparo'}
          </button>
          {/* Disparo manual: uma mensagem, com o gestor olhando. É o que
              substitui ter de chamar o cron por linha de comando. */}
          {onDisparar && campanha.salva && (
            <button
              onClick={() => {
                if (!confirm(
                  'Isto envia UMA mensagem AGORA, de verdade, para a próxima pessoa da fila. '
                  + 'Continuar?')) return;
                onDisparar();
              }}
              disabled={salvando || erros.length > 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 text-xs font-bold uppercase text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Envia uma mensagem agora, ignorando dia e horário — as demais travas continuam valendo"
            >
              <Send className="h-3.5 w-3.5" />
              Disparar 1 agora
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
          Salvar e recalcular
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────── Histórico

function ExecucoesCard({ execucoes }: { execucoes: Execucao[] }) {
  return (
    <Card>
      <h3 className="mb-3 font-heading text-xl uppercase leading-none">Últimos disparos</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="py-1.5 pr-3 font-bold">Quando</th>
              <th className="py-1.5 pr-3 font-bold">Campanha</th>
              <th className="py-1.5 pr-3 font-bold">Status</th>
              <th className="py-1.5 pr-3 text-right font-bold">Público</th>
              <th className="py-1.5 pr-3 text-right font-bold">Enviadas</th>
              <th className="py-1.5 pr-3 text-right font-bold">Puladas</th>
              <th className="py-1.5 text-right font-bold">Falhas</th>
            </tr>
          </thead>
          <tbody>
            {execucoes.map((e) => (
              <tr key={e.id} className="border-b border-border/50">
                <td className="py-1.5 pr-3">{new Date(e.iniciada_em).toLocaleString('pt-BR')}</td>
                <td className="py-1.5 pr-3">{e.campanha ?? '—'}</td>
                <td className="py-1.5 pr-3">{e.status}</td>
                <td className="py-1.5 pr-3 text-right">{e.publico}</td>
                <td className="py-1.5 pr-3 text-right text-primary">{e.enviadas}</td>
                <td className="py-1.5 pr-3 text-right text-muted-foreground">{e.puladas}</td>
                <td className="py-1.5 text-right text-destructive">{e.falhas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        &quot;Puladas&quot; são as pessoas que o motor deixou de fora na hora: opt-out, cooldown ou teto de público.
      </p>
    </Card>
  );
}
