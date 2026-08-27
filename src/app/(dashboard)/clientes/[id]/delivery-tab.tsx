"use client";

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2, RefreshCw, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnotaAiImportCard } from './anotaai-import-card';
import { AnotaAiConfigCard } from './anotaai-config-card';

/**
 * Configuração de delivery do cliente (Cardápio Web + Anota Aí) — SÓ o
 * encanamento: conexão, webhooks, régua de recorrência e importações.
 *
 * ⚠️ As MÉTRICAS que moravam aqui (KPIs, funil de recorrência, receita por
 * campanha, listas de risco) foram removidas de propósito (2026-08-21, pedido
 * do Matheus): o Dashboard no modo Food já mostra tudo — duas telas com os
 * mesmos números divergem no primeiro ajuste. Esta tela vive como sub-aba
 * "Delivery" da aba Integrações (ex-Rastreio).
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

/** Só os campos de configuração do painel — as métricas ficaram no Dashboard. */
type PainelConfig = {
  error?: string;
  regua?: { janelaDias: number; inatividadeDias: number };
  reguaSugerida?: { janelaDias: number; inatividadeDias: number } | null;
  sincronizacao?: { historico_concluido: boolean; ultima_sync_em: string | null; ultimo_erro: string | null; total_pedidos: number };
  lojasAnotaAi?: { id: string; nome: string; storeId: string; webhookToken?: string | null }[];
  fontes?: { provedor: string; conectado: boolean; pedidos: number; desde: string | null }[];
};

function dataBR(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return String(iso); }
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[var(--radius)] border border-border bg-card p-4', className)}>
      {children}
    </div>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{children}</span>;
}

export function ClientDeliveryTab({ clientId }: { clientId: string }) {
  const [conexao, setConexao] = useState<Conexao | null>(null);
  const [painel, setPainel] = useState<PainelConfig | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [form, setForm] = useState({ token: '', janela: 30, inatividade: 60 });
  const [copiado, setCopiado] = useState('');
  // Troca de token acontece atrás de um clique: o campo aberto por padrão num
  // card já conectado convida a colar algo por engano e derrubar a integração.
  const [trocandoToken, setTrocandoToken] = useState(false);

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
      setTrocandoToken(false);
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function desconectar() {
    if (!window.confirm(
      'Desconectar o Cardápio Web deste cliente?\n\n' +
      'Os pedidos já importados CONTINUAM no sistema — o que para é a entrada de novos. ' +
      'Para voltar, é preciso colar o token de novo.',
    )) return;
    setSalvando(true); setErro('');
    try {
      const res = await fetch(`/api/cardapioweb/config?clientId=${encodeURIComponent(clientId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) { setErro('Não foi possível desconectar.'); return; }
      setTrocandoToken(false);
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

  const temAnotaAi = (painel?.lojasAnotaAi?.length ?? 0) > 0;
  const temAlgo = Boolean(conexao) || temAnotaAi;
  const sync = painel?.sincronizacao;
  const origem = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = origem ? `${origem}/api/webhook/cardapioweb/${clientId}` : '';

  const campoCopiavel = (rotulo: string, valor: string, tag: string) => (
    <div key={tag}>
      <Rotulo>{rotulo}</Rotulo>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-[var(--radius)] border border-border bg-surface-soft px-2 py-1.5 text-xs text-foreground">
          {valor}
        </code>
        <button
          type="button" onClick={() => copiar(valor, tag)}
          className="shrink-0 rounded-[var(--radius)] border border-border px-2 py-1.5 text-muted-foreground hover:text-foreground"
        >
          {copiado === tag ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl space-y-4 p-1">
      {temAlgo && (
        <p className="text-xs text-muted-foreground">
          Configuração das fontes de delivery. As <strong>métricas</strong> (receita, pedidos, funil de
          recorrência) moram no <strong>Dashboard</strong> — selecione este cliente lá com o modo Food.
        </p>
      )}

      {/* ───────────────────────────── Cardápio Web ───────────────────────── */}
      {conexao ? (
        <Card>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-primary" />
              <span className="font-heading text-lg uppercase leading-none">
                {conexao.merchant_name ?? 'Cardápio Web'}
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
            {sync?.ultimo_erro && <span className="text-xs text-destructive">{sync.ultimo_erro}</span>}
          </div>

          <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
            <p className="text-sm text-muted-foreground">
              <strong>Tempo real (opcional):</strong> sem isso os pedidos entram pelo sincronismo
              periódico; com isso, em segundos. Cadastre no painel do lojista, em
              Configurações → Integrações → API.
            </p>
            {campoCopiavel('URL do webhook', webhookUrl, 'url')}
            {campoCopiavel('Token do webhook', conexao.webhook_token ?? '—', 'tok')}
          </div>

          {/* ── Configuração da API: trocar token e desconectar ──────────────
              O servidor já sabia fazer as duas coisas (o POST é upsert e o
              DELETE existe) — só a tela não oferecia, e sem isso não havia
              como girar um token vazado nem corrigir um token errado sem
              mexer no banco. */}
          <div className="mt-4 border-t border-border/60 pt-3">
            {!trocandoToken ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setErro(''); setTrocandoToken(true); }}
                  className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-foreground hover:border-primary"
                >
                  Trocar token da API
                </button>
                <button
                  type="button"
                  disabled={salvando}
                  onClick={() => void desconectar()}
                  className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-40"
                >
                  Desconectar loja
                </button>
                <span className="text-[11px] text-muted-foreground">
                  Código da loja e nome vêm do próprio Cardápio Web quando o token é validado.
                </span>
              </div>
            ) : (
              <div>
                <div className="mb-3 flex items-start gap-2 rounded-[var(--radius)] border border-yellow-400/30 bg-yellow-400/10 p-3 text-yellow-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-xs">
                    O token é <strong>um só por loja</strong>. Se a loja usa a API em outro sistema
                    (PDV, robô de WhatsApp), gerar um token novo no painel <strong>derruba
                    esses sistemas</strong>. Confirme com o lojista antes.
                  </p>
                </div>
                <label className="block">
                  <Rotulo>Novo token da API</Rotulo>
                  <input
                    type="password"
                    value={form.token}
                    onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
                    placeholder="Cole o token gerado em Configurações → Integrações → API"
                    className="mt-1 w-full rounded-[var(--radius)] border border-border bg-surface-soft px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={salvando || !form.token.trim()}
                    onClick={() => void conectar()}
                    className="rounded-[var(--radius)] bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-40"
                  >
                    {salvando ? 'Validando token…' : 'Salvar novo token'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTrocandoToken(false); setForm(f => ({ ...f, token: '' })); setErro(''); }}
                    className="rounded-[var(--radius)] border border-border px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    Cancelar
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  O token é testado no Cardápio Web antes de substituir o atual — se estiver
                  errado, nada muda.
                </p>
              </div>
            )}
            {erro && <p className="mt-3 text-sm text-destructive">{erro}</p>}
          </div>
        </Card>
      ) : (
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
      )}

      {/* ───────────────────────────── Anota Aí ───────────────────────────── */}
      <AnotaAiConfigCard clientId={clientId} onChanged={() => void carregar()} />

      {temAnotaAi && (
        <Card>
          <h3 className="font-heading text-xl uppercase leading-none">Webhook do Anota AI</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            No Portal de Integração, ligue <strong>Status</strong> e preencha os campos abaixo.
            Aqui o webhook não é opcional: a API do Anota AI não guarda histórico, então pedido que
            não chegar na hora <strong>não pode ser buscado depois</strong>.
          </p>
          <div className="mt-3 space-y-2">
            {campoCopiavel('Root', origem, 'aa-root')}
            {campoCopiavel('Pedidos Realizados · Atualizados · Cancelados (os três iguais, método POST)',
              `/api/webhook/anotaai/${clientId}`, 'aa-url')}
            {campoCopiavel('Token Externo', painel?.lojasAnotaAi?.[0]?.webhookToken ?? '—', 'aa-tok')}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Os três eventos apontam para o mesmo endereço de propósito: o pedido é relido na fonte a
            cada aviso, então a ordem de chegada não importa.
          </p>
        </Card>
      )}

      {temAnotaAi && <AnotaAiImportCard clientId={clientId} onImportado={() => void carregar()} />}

      {/* ───────────────────────────── Régua ──────────────────────────────── */}
      {temAlgo && (
        <Card>
          <h3 className="font-heading text-xl uppercase leading-none">Régua de recorrência</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Comprou dentro da janela = ativo. Passou da inatividade = perdido. Alimenta o funil do
            Dashboard e as campanhas de Fidelidade.
          </p>
          {painel?.reguaSugerida && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">
              Pelo ritmo real desta loja, a janela sugerida é {painel.reguaSugerida.janelaDias}d
              (inatividade {painel.reguaSugerida.inatividadeDias}d).
              <button
                type="button"
                className="font-bold uppercase underline"
                onClick={() => setForm(f => ({
                  ...f,
                  janela: painel.reguaSugerida!.janelaDias,
                  inatividade: painel.reguaSugerida!.inatividadeDias,
                }))}
              >
                Usar
              </button>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label>
              <Rotulo>Janela (dias)</Rotulo>
              <input
                type="number" min={1} value={form.janela}
                onChange={e => setForm(f => ({ ...f, janela: Number(e.target.value) }))}
                className="mt-1 w-28 rounded-[var(--radius)] border border-border bg-surface-soft px-3 py-2 text-sm"
              />
            </label>
            <label>
              <Rotulo>Inatividade (dias)</Rotulo>
              <input
                type="number" min={1} value={form.inatividade}
                onChange={e => setForm(f => ({ ...f, inatividade: Number(e.target.value) }))}
                className="mt-1 w-28 rounded-[var(--radius)] border border-border bg-surface-soft px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button" disabled={salvando} onClick={() => void salvarRegua()}
              className="rounded-[var(--radius)] border border-border px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-muted/40 disabled:opacity-40"
            >
              {salvando ? 'Salvando…' : 'Aplicar régua'}
            </button>
          </div>
        </Card>
      )}

      {/* ───────────────────────────── Fontes ─────────────────────────────── */}
      {(painel?.fontes?.length ?? 0) > 0 && (
        <Card>
          <h3 className="font-heading text-lg uppercase leading-none">Fontes de pedidos</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {painel!.fontes!.map(f => (
              <li key={f.provedor} className="flex flex-wrap items-center gap-2">
                <span className={cn('h-2 w-2 rounded-full', f.conectado ? 'bg-primary' : 'bg-muted-foreground')} />
                <span>{f.provedor === 'anotaai' ? 'Anota AI' : 'Cardápio Web'}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {f.pedidos} pedidos{f.desde ? ` · desde ${dataBR(f.desde)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
