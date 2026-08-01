"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Check, Copy, Loader2, RefreshCw, Store, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ETAPAS, ETAPA_LABEL, type Etapa, type ClienteDelivery } from '@/lib/cardapioweb-recorrencia';

/**
 * Dashboard de delivery (Cardápio Web) na tela do cliente.
 *
 * As colunas do funil são de LEITURA: as etapas são calculadas do
 * comportamento, não arrastadas. Um kanban manual mentiria justamente em quem
 * parou de comprar — que é o que este painel existe para mostrar.
 */

type Conexao = {
  client_id: string;
  merchant_id: string | null;
  merchant_name: string | null;
  token_masked: string;
  webhook_token: string | null;
  janela_dias: number;
  inatividade_dias: number;
  historico_concluido: boolean;
  ultima_sync_em: string | null;
  ultimo_erro: string | null;
};

type Painel = {
  conectado: boolean;
  merchant?: { id: string | null; nome: string | null };
  regua?: { janelaDias: number; inatividadeDias: number };
  reguaSugerida?: { janelaDias: number; inatividadeDias: number } | null;
  sincronizacao?: { historico_concluido: boolean; ultima_sync_em: string | null; ultimo_erro: string | null; total_pedidos: number };
  kpis?: { receita30d: number; pedidos30d: number; ticketMedio30d: number; clientesAtivos: number; totalClientes: number };
  funil?: { etapas: Record<Etapa, { clientes: number; receita: number }>; totalClientes: number };
  canais?: { canal: string; marketplace: boolean; receita: number; pedidos: number }[];
  emRisco?: ClienteDelivery[];
  inativos?: ClienteDelivery[];
  atribuicao?: {
    casados: number; total: number; taxa: number;
    campanhas: { campanha: string; clientes: number; receita: number; pedidos: number; ticketMedio: number }[];
  };
};

const COR_ETAPA: Record<Etapa, string> = {
  novo: 'var(--primary)',
  recorrente: '#22c55e',
  reconquistado: 'var(--secondary)',
  em_risco: '#facc15',
  inativo: 'var(--destructive)',
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function dataBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[var(--radius)] border border-border bg-card p-4', className)}>{children}</div>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

export function ClientDeliveryTab({ clientId }: { clientId: string }) {
  const [conexao, setConexao] = useState<Conexao | null>(null);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [form, setForm] = useState({ token: '', janela: 30, inatividade: 60 });
  const [copiado, setCopiado] = useState('');

  const carregar = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        fetch(`/api/cardapioweb/config?clientId=${encodeURIComponent(clientId)}`).then(r => r.json()),
        fetch(`/api/clients/${encodeURIComponent(clientId)}/cardapioweb`).then(r => r.json()),
      ]);
      setConexao(c?.conexao ?? null);
      setPainel(p ?? null);
      if (c?.conexao) {
        setForm(f => ({ ...f, janela: c.conexao.janela_dias, inatividade: c.conexao.inatividade_dias }));
      }
    } catch {
      setErro('Não foi possível carregar a integração.');
    } finally {
      setCarregando(false);
    }
  }, [clientId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function conectar() {
    if (!form.token.trim()) return;
    setSalvando(true); setErro('');
    try {
      const res = await fetch('/api/cardapioweb/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId, token: form.token.trim(),
          janelaDias: form.janela, inatividadeDias: form.inatividade,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setErro(json?.error ?? 'Falha ao conectar.'); return; }
      setForm(f => ({ ...f, token: '' })); // o token some do formulário após salvar
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function salvarRegua() {
    setSalvando(true);
    try {
      await fetch('/api/cardapioweb/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, janelaDias: form.janela, inatividadeDias: form.inatividade }),
      });
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  function copiar(texto: string, tag: string) {
    void navigator.clipboard?.writeText(texto);
    setCopiado(tag);
    setTimeout(() => setCopiado(''), 1500);
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando delivery…
      </div>
    );
  }

  // ---------------------------------------------------------- sem conexão
  if (!conexao) {
    return (
      <div className="max-w-2xl space-y-4 p-1">
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Store className="h-4 w-4 text-primary" />
            <h3 className="font-heading text-xl uppercase leading-none">Conectar Cardápio Web</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            O lojista gera o token em <strong>Configurações → Integrações → API</strong> no painel dele.
            É o mesmo lugar onde aparece o &quot;Código da loja&quot;.
          </p>
          <div className="mt-3 flex items-start gap-2 rounded-[var(--radius)] border border-yellow-400/30 bg-yellow-400/10 p-3 text-yellow-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs">
              Se a loja já usa a API (PDV, robô de WhatsApp), <strong>gerar um token novo pode
              desconectar esses sistemas</strong> — o token é um só por loja. Confirme antes com o lojista.
            </p>
          </div>

          <label className="mt-4 block">
            <Rotulo>Token da API</Rotulo>
            <input
              type="password"
              value={form.token}
              onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
              placeholder="Cole o token gerado no painel do lojista"
              className="mt-1 w-full rounded-[var(--radius)] border border-border bg-surface-soft px-3 py-2 text-sm text-foreground"
            />
          </label>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label>
              <Rotulo>Janela de recorrência (dias)</Rotulo>
              <input
                type="number" min={1} value={form.janela}
                onChange={e => setForm(f => ({ ...f, janela: Number(e.target.value) }))}
                className="mt-1 w-full rounded-[var(--radius)] border border-border bg-surface-soft px-3 py-2 text-sm"
              />
            </label>
            <label>
              <Rotulo>Inatividade (dias)</Rotulo>
              <input
                type="number" min={1} value={form.inatividade}
                onChange={e => setForm(f => ({ ...f, inatividade: Number(e.target.value) }))}
                className="mt-1 w-full rounded-[var(--radius)] border border-border bg-surface-soft px-3 py-2 text-sm"
              />
            </label>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Comprou dentro da janela = ativo. Passou da inatividade = perdido. Dá pra ajustar depois —
            e o sistema sugere a régua com base no ritmo real da loja.
          </p>

          {erro && <p className="mt-3 text-sm text-destructive">{erro}</p>}

          <button
            type="button" disabled={salvando || !form.token.trim()} onClick={() => void conectar()}
            className="mt-4 w-full rounded-[var(--radius)] bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-40"
          >
            {salvando ? 'Validando token…' : 'Conectar loja'}
          </button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            O token é testado no Cardápio Web antes de ser salvo — se estiver errado, nada é gravado.
          </p>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------- conectado
  const k = painel?.kpis;
  const sync = painel?.sincronizacao;
  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhook/cardapioweb/${clientId}` : '';

  return (
    <div className="space-y-4 p-1">
      {/* estado da conexão */}
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-primary" />
          <span className="font-heading text-lg uppercase leading-none">
            {conexao.merchant_name ?? 'Loja conectada'}
          </span>
          {conexao.merchant_id && (
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              loja {conexao.merchant_id}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">token {conexao.token_masked}</span>
        <span className="text-xs text-muted-foreground">
          {sync?.total_pedidos ?? 0} pedidos · última sync {dataBR(sync?.ultima_sync_em)}
        </span>
        {sync && !sync.historico_concluido && (
          <span className="flex items-center gap-1 text-xs text-yellow-400">
            <RefreshCw className="h-3 w-3 animate-spin" /> importando histórico…
          </span>
        )}
      </Card>

      {sync?.ultimo_erro && (
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 p-3 text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-xs">Último sincronismo falhou: {sync.ultimo_erro}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icone: Wallet, rotulo: 'Receita 30d', valor: brl(k?.receita30d ?? 0) },
          { icone: TrendingUp, rotulo: 'Ticket médio 30d', valor: brl(k?.ticketMedio30d ?? 0) },
          { icone: Users, rotulo: 'Clientes ativos', valor: String(k?.clientesAtivos ?? 0) },
          { icone: Users, rotulo: 'Base total', valor: String(k?.totalClientes ?? 0) },
        ].map(m => (
          <Card key={m.rotulo}>
            <m.icone className="h-4 w-4 text-primary" />
            <p className="mt-2 font-heading text-2xl leading-none text-foreground">{m.valor}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{m.rotulo}</p>
          </Card>
        ))}
      </div>

      {/* funil calculado */}
      <Card>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-xl uppercase leading-none">Funil de recorrência</h3>
          <p className="text-[11px] text-muted-foreground">
            Calculado da última compra — ninguém arrasta card aqui. Janela {painel?.regua?.janelaDias}d ·
            inatividade {painel?.regua?.inatividadeDias}d
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {ETAPAS.map(e => {
            const dado = painel?.funil?.etapas[e] ?? { clientes: 0, receita: 0 };
            return (
              <div key={e} className="relative overflow-hidden rounded-[var(--radius)] border border-border bg-surface-soft p-3">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: COR_ETAPA[e] }} />
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: COR_ETAPA[e] }}>
                  {ETAPA_LABEL[e]}
                </p>
                <p className="mt-2 font-heading text-2xl leading-none text-foreground">{dado.clientes}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{brl(dado.receita)}</p>
              </div>
            );
          })}
        </div>

        {painel?.reguaSugerida && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-secondary/30 bg-secondary/10 p-2 text-xs text-secondary">
            <span>
              Pelo ritmo real desta loja, a janela sugerida é {painel.reguaSugerida.janelaDias}d
              (inatividade {painel.reguaSugerida.inatividadeDias}d).
            </span>
            <button
              type="button"
              onClick={() => { setForm(f => ({ ...f, janela: painel.reguaSugerida!.janelaDias, inatividade: painel.reguaSugerida!.inatividadeDias })); }}
              className="font-bold uppercase tracking-wider underline"
            >
              usar
            </button>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label>
            <Rotulo>Janela (dias)</Rotulo>
            <input
              type="number" min={1} value={form.janela}
              onChange={e => setForm(f => ({ ...f, janela: Number(e.target.value) }))}
              className="mt-1 w-24 rounded-[var(--radius)] border border-border bg-surface-soft px-2 py-1.5 text-sm"
            />
          </label>
          <label>
            <Rotulo>Inatividade (dias)</Rotulo>
            <input
              type="number" min={1} value={form.inatividade}
              onChange={e => setForm(f => ({ ...f, inatividade: Number(e.target.value) }))}
              className="mt-1 w-24 rounded-[var(--radius)] border border-border bg-surface-soft px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button" disabled={salvando} onClick={() => void salvarRegua()}
            className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-foreground disabled:opacity-40"
          >
            {salvando ? 'Salvando…' : 'Aplicar régua'}
          </button>
        </div>
      </Card>

      {/* receita por canal */}
      {painel?.canais && painel.canais.length > 0 && (
        <Card>
          <h3 className="font-heading text-xl uppercase leading-none">Receita por canal</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Marketplace não é resultado da mídia — somar tudo infla o retorno.
          </p>
          <ul className="mt-3 space-y-2">
            {painel.canais.map(c => (
              <li key={c.canal} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-foreground">{c.canal}</span>
                {c.marketplace && (
                  <span className="rounded bg-yellow-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-400">
                    marketplace
                  </span>
                )}
                <span className="ml-auto font-heading text-lg leading-none">{brl(c.receita)}</span>
                <span className="text-[11px] text-muted-foreground">{c.pedidos} pedidos</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* receita por campanha */}
      {painel?.atribuicao && (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-heading text-xl uppercase leading-none">Receita por campanha</h3>
            <span className="text-[11px] text-muted-foreground">
              {painel.atribuicao.casados} de {painel.atribuicao.total} clientes casados com o CRM
              ({Math.round(painel.atribuicao.taxa * 100)}%)
            </span>
          </div>
          {painel.atribuicao.campanhas.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhum cliente de delivery casou com lead do CRM ainda. A ligação é pelo telefone.
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {painel.atribuicao.campanhas.map(c => (
                  <li key={c.campanha} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-foreground">{c.campanha}</span>
                    <span className="ml-auto font-heading text-lg leading-none text-primary">{brl(c.receita)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {c.clientes} clientes · ticket {brl(c.ticketMedio)}
                    </span>
                  </li>
                ))}
              </ul>
              {painel.atribuicao.taxa < 0.9 && (
                <p className="mt-3 text-[11px] text-yellow-400">
                  ⚠️ {100 - Math.round(painel.atribuicao.taxa * 100)}% da base não casou com o CRM —
                  a receita real por campanha é maior que a mostrada aqui.
                </p>
              )}
            </>
          )}
        </Card>
      )}

      {/* quem precisa de ação */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ListaClientes titulo="Em risco" cor={COR_ETAPA.em_risco} clientes={painel?.emRisco ?? []} />
        <ListaClientes titulo="Inativos" cor={COR_ETAPA.inativo} clientes={painel?.inativos ?? []} />
      </div>

      {/* webhook */}
      <Card>
        <h3 className="font-heading text-xl uppercase leading-none">Tempo real (opcional)</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sem isso os pedidos entram pelo sincronismo periódico. Com isso, entram em segundos.
          Cadastre no painel do lojista, em Configurações → Integrações → API.
        </p>
        <div className="mt-3 space-y-2">
          {[
            { rotulo: 'URL do webhook', valor: webhookUrl, tag: 'url' },
            { rotulo: 'Token do webhook', valor: conexao.webhook_token ?? '—', tag: 'tok' },
          ].map(campo => (
            <div key={campo.tag}>
              <Rotulo>{campo.rotulo}</Rotulo>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[var(--radius)] border border-border bg-surface-soft px-2 py-1.5 text-xs text-foreground">
                  {campo.valor}
                </code>
                <button
                  type="button" onClick={() => copiar(campo.valor, campo.tag)}
                  className="shrink-0 rounded-[var(--radius)] border border-border px-2 py-1.5 text-muted-foreground hover:text-foreground"
                >
                  {copiado === campo.tag ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ListaClientes({ titulo, cor, clientes }: { titulo: string; cor: string; clientes: ClienteDelivery[] }) {
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: cor }} />
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="font-heading text-lg uppercase leading-none">{titulo}</h3>
        <span className="text-[11px] text-muted-foreground">{clientes.length}</span>
      </div>
      {clientes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguém aqui. Bom sinal.</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {clientes.map(c => (
            <li key={c.chave} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-foreground">{c.nome ?? c.telefone ?? 'Sem nome'}</span>
              {c.telefone && <span className="text-[11px] text-muted-foreground">{c.telefone}</span>}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {c.pedidos}x · {brl(c.receita)}
              </span>
              <span className="text-[11px]" style={{ color: cor }}>há {c.diasDesdeUltima}d</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
