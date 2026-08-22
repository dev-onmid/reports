"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, Clock, Info, Loader2, PowerOff, Save, ShieldCheck, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MODELOS_FIDELIDADE, ORDEM_MODELOS, VARIAVEIS, DIAS_SEMANA_LABEL, PISO_INTERVALO_SEG,
  aplicarVars, capacidadeDaJanela, diasParaVarrer, moedaBR, varsDoCliente,
  variaveisDesconhecidas, type ModeloId, type ParamsRegua, type Travas,
} from '@/lib/fidelidade';

/**
 * Aba Fidelidade — campanhas de recompra por comportamento de consumo.
 *
 * ⚠️ FASE 1: esta tela CALCULA e CONFIGURA. Nenhuma mensagem é enviada — o
 * motor de disparo é a fase seguinte. O banner do topo diz isso ao usuário em
 * vez de exibir um botão "Ativar" que não faz nada.
 *
 * Os públicos vêm do servidor a cada carga: mudar a régua exige salvar e
 * recalcular, de propósito. Recalcular no browser exigiria trazer a base
 * inteira de clientes finais pra cá só para exibir um número.
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
  modelo: ModeloId; params: ParamsRegua; mensagens: string[]; imagemUrl: string | null;
  diasSemana: number[]; hora: string; tetoPublico: number | null; ativa: boolean; salva: boolean;
};

type Painel = {
  /** Interruptor por cliente (`clients.fidelidade_ativa`). Ausente = desligada. */
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
  segmentos?: Segmento[];
};

const COR_MODELO: Record<ModeloId, string> = {
  primeira_recompra: 'var(--primary)',
  em_risco: '#facc15',
  inativo: 'var(--destructive)',
  vip: 'var(--secondary)',
  reconquistado: '#22c55e',
};

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-[var(--radius)] border border-border bg-card p-4', className)}>{children}</div>;
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
      className={cn(
        'h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm',
        className,
      )}
    />
  );
}

export function ClientFidelidadeTab({ clientId }: { clientId: string }) {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<ModeloId | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, Campanha>>({});
  const [travasDraft, setTravasDraft] = useState<Travas | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade`);
      const data = await r.json() as Painel;
      setPainel(data);
      if (data.campanhas) {
        setRascunhos(Object.fromEntries(data.campanhas.map(c => [c.modelo, c])));
      }
      if (data.travas) setTravasDraft(data.travas);
    } catch {
      setPainel({ conectado: false, error: 'Falha ao carregar' });
    } finally {
      setCarregando(false);
    }
  }, [clientId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvarCampanha = useCallback(async (modelo: ModeloId) => {
    const c = rascunhos[modelo];
    if (!c) return;
    setSalvando(modelo);
    try {
      await fetch(`/api/clients/${clientId}/fidelidade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c),
      });
      // Recarrega tudo: mexer na régua muda o público, e o número novo só o
      // servidor sabe calcular.
      await carregar();
    } finally {
      setSalvando(null);
    }
  }, [clientId, rascunhos, carregar]);

  const salvarTravas = useCallback(async () => {
    if (!travasDraft) return;
    setSalvando('travas');
    try {
      await fetch(`/api/clients/${clientId}/fidelidade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ travas: travasDraft }),
      });
      await carregar();
    } finally {
      setSalvando(null);
    }
  }, [clientId, travasDraft, carregar]);

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

  // Desligada tem de aparecer como desligada mesmo aqui dentro: a aba some da
  // barra, mas link direto e aba já aberta continuam alcançando esta tela.
  if (painel && painel.ativo === false) {
    return (
      <Card className="mt-4">
        <div className="flex items-start gap-3">
          <PowerOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <h3 className="font-heading text-lg uppercase leading-none">Fidelidade desativada</h3>
            <p className="text-sm text-muted-foreground">
              Este cliente está fora das campanhas de recompra — nenhum segmento é calculado
              e nada pode ser configurado. Para ligar, use o botão
              <strong className="text-foreground"> Fidelidade</strong> na faixa
              <strong className="text-foreground"> Configurações do cliente</strong>, no topo da página.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (!painel?.conectado) {
    return (
      <Card className="mt-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#facc15]" />
          <div className="space-y-1">
            <h3 className="font-heading text-lg uppercase leading-none">Sem base de consumo</h3>
            <p className="text-sm text-muted-foreground">
              As campanhas de fidelidade falam com quem já comprou — o público sai dos
              pedidos do Cardápio Web ou do Anota AI. Conecte uma das plataformas na aba
              <strong className="text-foreground"> Integrações → Delivery</strong> e volte aqui.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const travas = travasDraft;

  return (
    <div className="mt-4 space-y-4">
      {/* Fase 1: a tela não pode sugerir que já dispara. */}
      <div className="flex items-start gap-3 rounded-[var(--radius)] border border-[#facc15]/40 bg-[#facc15]/[0.07] p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#facc15]" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Nada é enviado ainda.</strong> Esta etapa monta
          os segmentos e guarda régua, textos e travas. O disparo automático entra depois,
          usando exatamente o que estiver configurado aqui.
        </p>
      </div>

      {/* Linha de contexto: base, loja e número que enviaria. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <Rotulo>Base de clientes</Rotulo>
          <p className="mt-1 font-heading text-2xl leading-none">{painel.base?.comTelefone ?? 0}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            com telefone, de {painel.base?.clientes ?? 0} que já compraram
          </p>
        </Card>
        <Card>
          <Rotulo>Ticket médio da loja</Rotulo>
          <p className="mt-1 font-heading text-2xl leading-none">{moedaBR(painel.ticketMedioLoja ?? 0)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            régua de recompra: {painel.regua?.janelaDias}d · inativo: {painel.regua?.inatividadeDias}d
          </p>
        </Card>
        <Card>
          <Rotulo>Número de envio</Rotulo>
          {painel.instancia ? (
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
              Nenhuma instância vinculada — sem ela nada poderá ser enviado. Vincule em Integrações → WhatsApp.
            </p>
          )}
        </Card>
      </div>

      {/* Travas — por cliente, porque a reputação é do chip. */}
      {travas && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h3 className="font-heading text-xl uppercase leading-none">Travas de segurança</h3>
            </div>
            <button
              onClick={() => void salvarTravas()}
              disabled={salvando === 'travas'}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 text-xs font-bold uppercase text-primary-foreground disabled:opacity-60"
            >
              {salvando === 'travas'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Save className="h-3.5 w-3.5" />}
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
              <NumeroInput
                valor={travas.tetoDiario}
                onChange={(v) => setTravasDraft({ ...travas, tetoDiario: v ?? 50 })}
              />
              <p className="text-[10px] text-muted-foreground">Soma todas as campanhas do número</p>
            </div>
            <div className="space-y-1">
              <Rotulo>Só entre</Rotulo>
              <div className="flex items-center gap-1">
                <input
                  type="time" value={travas.janelaInicio}
                  onChange={(e) => setTravasDraft({ ...travas, janelaInicio: e.target.value })}
                  className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm"
                />
                <span className="text-xs text-muted-foreground">e</span>
                <input
                  type="time" value={travas.janelaFim}
                  onChange={(e) => setTravasDraft({ ...travas, janelaFim: e.target.value })}
                  className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Rotulo>Mesma pessoa a cada</Rotulo>
              <div className="flex items-center gap-2">
                <NumeroInput
                  valor={travas.cooldownDias}
                  onChange={(v) => setTravasDraft({ ...travas, cooldownDias: v ?? 7 })}
                />
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
                    <button
                      key={dia}
                      onClick={() => setTravasDraft({
                        ...travas,
                        diasSemana: on
                          ? travas.diasSemana.filter(d => d !== dia)
                          : [...travas.diasSemana, dia].sort(),
                      })}
                      className={cn(
                        'h-7 rounded-[var(--radius)] border px-2 text-[10px] font-bold uppercase',
                        on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox" checked={travas.optoutAtivo}
                onChange={(e) => setTravasDraft({ ...travas, optoutAtivo: e.target.checked })}
                className="h-3.5 w-3.5 accent-[var(--primary)]"
              />
              <span className="text-muted-foreground">
                Tirar da lista quem responder pedindo para não receber
              </span>
            </label>

            <p className="ml-auto text-[11px] text-muted-foreground">
              Entrega real: <strong className="text-foreground">{capacidade} mensagens/dia</strong>
              {capacidade < travas.tetoDiario && ' (a janela de horário não comporta o teto)'}
            </p>
          </div>
        </Card>
      )}

      {/* Segmentos */}
      <div className="space-y-3">
        {ORDEM_MODELOS.map((modelo) => {
          const seg = painel.segmentos?.find(s => s.modelo === modelo);
          const camp = rascunhos[modelo];
          const meta = MODELOS_FIDELIDADE[modelo];
          if (!seg || !camp) return null;
          const expandido = aberto === modelo;
          const dias = travas ? diasParaVarrer(seg.resumo.pessoas, travas) : 0;

          return (
            <Card key={modelo} className="p-0">
              <button
                onClick={() => setAberto(expandido ? null : modelo)}
                className="flex w-full items-start gap-3 p-4 text-left"
              >
                <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ background: COR_MODELO[modelo] }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-heading text-xl uppercase leading-none">{meta.nome}</h3>
                    {camp.salva && (
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase text-primary">
                        configurada
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{meta.objetivo}</p>

                  <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                    <span className="flex items-baseline gap-1.5">
                      <Users className="h-3.5 w-3.5 self-center text-muted-foreground" />
                      <strong className="font-heading text-2xl leading-none">{seg.resumo.pessoas}</strong>
                      <span className="text-[11px] text-muted-foreground">pessoas</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      já gastaram <strong className="text-foreground">{moedaBR(seg.resumo.receitaHistorica)}</strong>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      ticket <strong className="text-foreground">{moedaBR(seg.resumo.ticketMedio)}</strong>
                    </span>
                    {seg.resumo.diasParadoMediano !== null && (
                      <span className="text-[11px] text-muted-foreground">
                        parados há <strong className="text-foreground">{seg.resumo.diasParadoMediano}d</strong> (mediana)
                      </span>
                    )}
                    {dias > 1 && (
                      <span className="flex items-center gap-1 text-[11px] text-[#facc15]">
                        <Clock className="h-3 w-3" /> {dias} dias para falar com todos
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', expandido && 'rotate-180')} />
              </button>

              {expandido && (
                <EditorCampanha
                  modelo={modelo}
                  campanha={camp}
                  segmento={seg}
                  loja={painel.loja ?? 'nossa loja'}
                  ticketMedioLoja={painel.ticketMedioLoja ?? 0}
                  salvando={salvando === modelo}
                  onChange={(c) => setRascunhos(r => ({ ...r, [modelo]: c }))}
                  onSalvar={() => void salvarCampanha(modelo)}
                />
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function EditorCampanha({
  modelo, campanha, segmento, loja, ticketMedioLoja, salvando, onChange, onSalvar,
}: {
  modelo: ModeloId; campanha: Campanha; segmento: Segmento; loja: string;
  ticketMedioLoja: number; salvando: boolean;
  onChange: (c: Campanha) => void; onSalvar: () => void;
}) {
  const meta = MODELOS_FIDELIDADE[modelo];
  const [verPessoas, setVerPessoas] = useState(false);

  // A prévia usa uma pessoa REAL do segmento — texto de exemplo com nome
  // inventado esconde o caso do cliente sem nome cadastrado.
  const exemplo = segmento.amostra[0];
  const vars = varsDoCliente(
    exemplo ?? { nome: 'Maria Souza', pedidos: 3, ticketMedio: ticketMedioLoja, diasDesdeUltima: 42 },
    loja,
  );

  return (
    <div className="space-y-4 border-t border-border p-4">
      {/* Régua */}
      <div>
        <Rotulo>Quem entra</Rotulo>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {meta.campos.map((campo) => (
            <div key={campo.chave} className="space-y-1">
              <label className="text-xs font-medium">
                {campo.rotulo}
                <span className="ml-1 text-muted-foreground">({campo.sufixo})</span>
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

      {/* Cadência */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Rotulo>Roda nos dias</Rotulo>
          <div className="flex flex-wrap gap-1">
            {DIAS_SEMANA_LABEL.map((label, dia) => {
              const on = campanha.diasSemana.includes(dia);
              return (
                <button
                  key={dia}
                  onClick={() => onChange({
                    ...campanha,
                    diasSemana: on
                      ? campanha.diasSemana.filter(d => d !== dia)
                      : [...campanha.diasSemana, dia].sort(),
                  })}
                  className={cn(
                    'h-7 rounded-[var(--radius)] border px-2 text-[10px] font-bold uppercase',
                    on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Rotulo>Começa às</Rotulo>
            <input
              type="time" value={campanha.hora}
              onChange={(e) => onChange({ ...campanha, hora: e.target.value })}
              className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Rotulo>Máx. por rodada</Rotulo>
            <NumeroInput
              valor={campanha.tetoPublico}
              placeholder="sem limite"
              onChange={(v) => onChange({ ...campanha, tetoPublico: v })}
            />
          </div>
        </div>
      </div>

      {/* Mensagens */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Rotulo>Mensagens (rodízio entre as três)</Rotulo>
          <p className="text-[10px] text-muted-foreground">
            Variáveis: {VARIAVEIS.map(v => `{{${v.chave}}}`).join('  ')}
          </p>
        </div>
        <div className="mt-2 grid gap-3 lg:grid-cols-3">
          {[0, 1, 2].map((i) => {
            const texto = campanha.mensagens[i] ?? '';
            const desconhecidas = variaveisDesconhecidas(texto);
            return (
              <div key={i} className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Variação {i + 1}
                </label>
                <textarea
                  value={texto}
                  rows={4}
                  onChange={(e) => {
                    const novas = [...campanha.mensagens];
                    novas[i] = e.target.value;
                    onChange({ ...campanha, mensagens: novas });
                  }}
                  className="w-full rounded-[var(--radius)] border border-border bg-background p-2 text-xs leading-relaxed"
                />
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">{texto.length} caracteres</span>
                  {desconhecidas.length > 0 && (
                    <span className="text-[10px] text-[#facc15]">
                      {desconhecidas.map(d => `{{${d}}}`).join(', ')} não existe — vai como texto
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Prévia com gente de verdade */}
      <div>
        <Rotulo>Como chega no WhatsApp {exemplo ? `de ${exemplo.nome ?? 'um cliente sem nome cadastrado'}` : '(exemplo)'}</Rotulo>
        <div className="mt-2 space-y-2">
          {campanha.mensagens.filter(Boolean).map((m, i) => (
            <p key={i} className="max-w-md rounded-[var(--radius)] bg-[#075E54]/15 px-3 py-2 text-xs leading-relaxed">
              {aplicarVars(m, vars)}
            </p>
          ))}
        </div>
      </div>

      {/* Amostra do público */}
      <div>
        <button
          onClick={() => setVerPessoas(v => !v)}
          className="text-xs font-bold uppercase tracking-wide text-primary"
        >
          {verPessoas ? 'Esconder' : `Ver ${Math.min(segmento.amostra.length, 25)} de ${segmento.resumo.pessoas} pessoas`}
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
                {segmento.amostra.map((p) => (
                  <tr key={p.telefone ?? p.nome} className="border-b border-border/50">
                    <td className="py-1.5 pr-3">{p.nome ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{p.telefone ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right">{p.pedidos}</td>
                    <td className="py-1.5 pr-3 text-right">{moedaBR(p.receita)}</td>
                    <td className="py-1.5 text-right">{p.diasDesdeUltima}d</td>
                  </tr>
                ))}
                {segmento.amostra.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">
                    Ninguém se encaixa nesta régua hoje.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-border pt-3">
        <button
          onClick={onSalvar}
          disabled={salvando}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-4 text-xs font-bold uppercase text-primary-foreground disabled:opacity-60"
        >
          {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar e recalcular
        </button>
      </div>
    </div>
  );
}
