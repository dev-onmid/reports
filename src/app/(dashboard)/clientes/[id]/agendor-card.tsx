"use client";

/**
 * Card de configuração da integração Agendor — aba Integrações.
 *
 * Diferente do Datalytics (onde o usuário cola NOSSA URL no painel deles),
 * aqui o fluxo é invertido: o usuário cola o TOKEN DO AGENDOR do cliente e o
 * sistema faz o resto por API — valida, cria as assinaturas de webhook e o
 * sync-cron importa o histórico. Zero configuração no painel do Agendor.
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

type LogEntry = {
  id: string;
  resultado: string;
  detalhe: string | null;
  lead_id: string | null;
  raw: unknown;
  created_at: string;
};

type Config = {
  enabled: boolean;
  conectado: boolean;
  api_token_masked: string | null;
  account_name: string | null;
  backfill_concluido: boolean;
  backfill_pagina: number;
  ultima_sync_em: string | null;
  last_received_at: string | null;
  ultimo_erro: string | null;
  filtro_funis: string[] | null;
  filtro_origens: string[] | null;
  logs: LogEntry[];
};

type Opcao = { id: string; nome: string };

const RESULTADO_BADGE: Record<string, string> = {
  criado: 'bg-emerald-500/15 text-emerald-400',
  atualizado: 'bg-sky-500/15 text-sky-400',
  backfill: 'bg-violet-500/15 text-violet-400',
  teste_get: 'bg-violet-500/15 text-violet-400',
  ignorado: 'bg-yellow-500/15 text-yellow-400',
  filtrado: 'bg-orange-500/15 text-orange-400',
  sem_telefone: 'bg-yellow-500/15 text-yellow-400',
  desativado: 'bg-muted text-muted-foreground',
  erro: 'bg-red-500/15 text-red-400',
};

const RESULTADO_LABEL: Record<string, string> = {
  criado: 'Lead criado',
  atualizado: 'Lead atualizado',
  backfill: 'Importado (histórico)',
  teste_get: 'Teste de conexão',
  ignorado: 'Ignorado',
  filtrado: 'Fora do filtro',
  sem_telefone: 'Sem telefone',
  desativado: 'Desativada',
  erro: 'Erro',
};

function fmtData(iso: string | null): string {
  if (!iso) return 'nunca';
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

/**
 * Filtros de importação: quais funis do Agendor e quais origens de lead
 * entram. Vazio = tudo (o estado natural — lista com todos os ids
 * envelheceria mal quando o cliente criasse funil novo lá).
 */
function FiltrosImportacao({ clientId, cfg, aoSalvar }: {
  clientId: string;
  cfg: Config;
  aoSalvar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [opcoes, setOpcoes] = useState<{ funis: Opcao[]; origens: Opcao[] } | null>(null);
  const [funis, setFunis] = useState<string[]>(cfg.filtro_funis ?? []);
  const [origens, setOrigens] = useState<string[]>(cfg.filtro_origens ?? []);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!aberto || opcoes) return;
    fetch(`/api/clients/${clientId}/agendor/opcoes`)
      .then(r => r.ok ? r.json() as Promise<{ funis: Opcao[]; origens: Opcao[] }> : Promise.reject())
      .then(setOpcoes)
      .catch(() => setOpcoes({ funis: [], origens: [] }));
  }, [aberto, opcoes, clientId]);

  function alternarId(lista: string[], setLista: (v: string[]) => void, id: string) {
    setLista(lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id]);
  }

  async function salvar() {
    setSalvando(true);
    setMsg('');
    try {
      const res = await fetch(`/api/clients/${clientId}/agendor`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filtro_funis: funis, filtro_origens: origens }),
      });
      if (!res.ok) throw new Error();
      setMsg('✓ Filtros salvos — valem para as próximas entradas e sincronizações.');
      aoSalvar();
    } catch {
      setMsg('Erro ao salvar os filtros.');
    } finally {
      setSalvando(false);
    }
  }

  const resumo = [
    (cfg.filtro_funis?.length ?? 0) > 0 ? `${cfg.filtro_funis!.length} funil(is)` : 'todos os funis',
    (cfg.filtro_origens?.length ?? 0) > 0 ? `${cfg.filtro_origens!.length} origem(ns)` : 'todas as origens',
  ].join(' · ');

  function bloco(titulo: string, todasLabel: string, lista: Opcao[], marcados: string[], setLista: (v: string[]) => void) {
    return (
      <div>
        <p className="text-xs font-semibold mb-1.5">{titulo}</p>
        <label className="flex items-center gap-2 text-xs mb-1 cursor-pointer">
          <input type="checkbox" checked={marcados.length === 0} onChange={() => setLista([])} />
          <span className={marcados.length === 0 ? 'text-primary font-semibold' : 'text-muted-foreground'}>{todasLabel}</span>
        </label>
        <div className="max-h-36 overflow-y-auto space-y-1 pl-1">
          {lista.map(o => (
            <label key={o.id} className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={marcados.includes(o.id)}
                onChange={() => alternarId(marcados, setLista, o.id)}
              />
              <span className="truncate">{o.nome}</span>
            </label>
          ))}
          {lista.length === 0 && <p className="text-xs text-muted-foreground">nenhuma opção encontrada</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-background/40">
      <button
        onClick={() => setAberto(a => !a)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold"
      >
        {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Filtros de importação
        <span className="ml-auto font-normal text-muted-foreground">{resumo}</span>
      </button>
      {aberto && (
        <div className="border-t border-border/60 px-3 py-3 space-y-3">
          {!opcoes ? (
            <p className="text-xs text-muted-foreground">Carregando funis e origens do Agendor…</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {bloco('Funis do Agendor', 'Todos os funis', opcoes.funis, funis, setFunis)}
                {bloco('Origens de lead', 'Todas as origens', opcoes.origens, origens, setOrigens)}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void salvar()}
                  disabled={salvando}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50"
                >
                  {salvando ? 'Salvando…' : 'Salvar filtros'}
                </button>
                {msg && <span className="text-xs">{msg}</span>}
              </div>
              <p className="text-[11px] text-muted-foreground">
                O filtro vale daqui pra frente (webhook e sincronizações). O que já foi importado permanece
                — negócio barrado aparece no log como “Fora do filtro”.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AgendorCard({ clientId }: { clientId: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [conectando, setConectando] = useState(false);
  const [msgConexao, setMsgConexao] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/agendor`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCfg(await res.json() as Config);
      setErro('');
    } catch {
      setErro('Não foi possível carregar a integração.');
    } finally {
      setCarregando(false);
    }
  }, [clientId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function conectar() {
    if (!tokenInput.trim() || conectando) return;
    setConectando(true);
    setMsgConexao('');
    try {
      const res = await fetch(`/api/clients/${clientId}/agendor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_token: tokenInput.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; account_name?: string | null; aviso?: string | null };
      if (!res.ok || !data.ok) {
        setMsgConexao(data.error ?? 'Falha ao conectar.');
      } else {
        setMsgConexao(`✓ Conectado${data.account_name ? ` à conta "${data.account_name}"` : ''}. ${data.aviso ?? 'A importação do histórico começa na próxima sincronização (até 10 min).'}`);
        setTokenInput('');
        await carregar();
      }
    } catch {
      setMsgConexao('Erro de rede ao conectar.');
    } finally {
      setConectando(false);
    }
  }

  async function alternar() {
    if (!cfg) return;
    const novo = !cfg.enabled;
    setCfg({ ...cfg, enabled: novo });
    await fetch(`/api/clients/${clientId}/agendor`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: novo }),
    }).catch(() => setCfg(c => c ? { ...c, enabled: !novo } : c));
  }

  if (carregando) {
    return <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (erro || !cfg) {
    return <div className="rounded-xl border border-border bg-card p-6 text-sm text-red-400">{erro || 'Erro ao carregar.'}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Integração Agendor</h3>
              <p className="text-xs text-muted-foreground">
                Negócios e etapas do Agendor entram no CRM e no Funil de Performance.
              </p>
            </div>
          </div>
          {cfg.conectado && (
            <button
              onClick={() => void alternar()}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold border',
                cfg.enabled
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              {cfg.enabled ? 'Ativa' : 'Desativada'}
            </button>
          )}
        </div>

        {cfg.conectado ? (
          <div className="mt-4 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Conectado{cfg.account_name ? <> à conta <b>{cfg.account_name}</b></> : null}
              <span className="text-muted-foreground">· token {cfg.api_token_masked}</span>
            </div>
            <div className="text-muted-foreground">
              Histórico: {cfg.backfill_concluido
                ? 'importado ✓'
                : `importando (página ${cfg.backfill_pagina}) — anda a cada sincronização`}
              {' · '}Última sincronização: {fmtData(cfg.ultima_sync_em)}
              {' · '}Último webhook: {fmtData(cfg.last_received_at)}
            </div>
            {cfg.ultimo_erro && (
              <div className="text-red-400">Último erro: {cfg.ultimo_erro}</div>
            )}
            <p className="text-muted-foreground pt-1">
              Pra trocar o token (ex.: cliente gerou um novo), cole o novo abaixo e conecte de novo.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">
            Cole o token da API do Agendor <b>do cliente</b>. Ele encontra em{' '}
            <a
              href="https://web.agendor.com.br/sistema/integracoes"
              target="_blank" rel="noreferrer"
              className="text-primary inline-flex items-center gap-0.5"
            >
              Agendor → Menu → Integrações <ExternalLink className="h-3 w-3" />
            </a>
            . O sistema valida, liga os webhooks por API e importa o histórico — nada a configurar lá.
          </p>
        )}

        <div className="mt-3 flex gap-2 flex-wrap">
          <input
            type="password"
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            placeholder="Token da API do Agendor"
            className="flex-1 min-w-[220px] rounded-lg border border-border bg-background px-3 py-2 text-xs"
          />
          <button
            onClick={() => void conectar()}
            disabled={!tokenInput.trim() || conectando}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-black disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {conectando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {cfg.conectado ? 'Reconectar' : 'Conectar'}
          </button>
        </div>
        {msgConexao && <p className="mt-2 text-xs">{msgConexao}</p>}

        {cfg.conectado && (
          <FiltrosImportacao clientId={clientId} cfg={cfg} aoSalvar={() => void carregar()} />
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase text-muted-foreground">Últimas recepções</h4>
          <button onClick={() => void carregar()} className="text-muted-foreground hover:text-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        {cfg.logs.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Nada recebido ainda. Depois de conectar, crie ou mova um negócio no Agendor pra testar.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {cfg.logs.map(log => (
              <li key={log.id} className="rounded-lg border border-border/60 bg-background/40">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setAberto(a => a === log.id ? null : log.id)}
                  className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer"
                >
                  {aberto === log.id
                    ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  <span className={cn('rounded px-1.5 py-0.5 font-semibold shrink-0', RESULTADO_BADGE[log.resultado] ?? 'bg-muted')}>
                    {RESULTADO_LABEL[log.resultado] ?? log.resultado}
                  </span>
                  <span className="truncate text-muted-foreground">{log.detalhe ?? '—'}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{fmtData(log.created_at)}</span>
                </div>
                {aberto === log.id && (
                  <div className="border-t border-border/60 px-3 py-2 space-y-2">
                    {log.lead_id && (
                      <a
                        href={`/crm?clientId=${clientId}&lead=${log.lead_id}`}
                        className="inline-flex items-center gap-1 text-xs text-primary"
                      >
                        Abrir lead no CRM <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <pre className="max-h-56 overflow-auto rounded bg-background p-2 text-[10px] leading-relaxed">
                      {JSON.stringify(log.raw, null, 2)}
                    </pre>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
