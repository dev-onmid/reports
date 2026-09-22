"use client";

/**
 * Webhooks de entrada de lead — aba Integrações do cliente.
 *
 * Um cliente pode ter vários. Cada um tem um NOME, que existe só aqui: serve
 * para o gestor saber qual URL é de quê ("Datalytics", "Formulário do site")
 * e para o log dizer qual webhook recebeu cada payload. O lead que entra não
 * carrega esse nome — o canal dele continua saindo do rastreio do payload.
 *
 * O log mostra o payload CRU de cada recepção: é assim que se descobre o shape
 * real de uma origem nova depois do primeiro disparo de teste (os aliases de
 * extração moram em src/lib/datalytics.ts).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Check, ChevronDown, ChevronRight, Copy, ExternalLink, Pencil,
  Plus, RefreshCw, Trash2, Webhook, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type LogEntry = {
  id: string;
  resultado: string;
  detalhe: string | null;
  lead_id: string | null;
  conexao_id: string | null;
  webhook_nome: string | null;
  raw: unknown;
  created_at: string;
};

type WebhookItem = {
  id: string;
  nome: string;
  enabled: boolean;
  last_received_at: string | null;
  url: string;
};

type Dados = { webhooks: WebhookItem[]; logs: LogEntry[] };

const RESULTADO_BADGE: Record<string, string> = {
  criado: 'bg-emerald-500/15 text-emerald-400',
  atualizado: 'bg-sky-500/15 text-sky-400',
  teste_get: 'bg-violet-500/15 text-violet-400',
  sem_telefone: 'bg-yellow-500/15 text-yellow-400',
  etapa_opaca: 'bg-yellow-500/15 text-yellow-400',
  desativado: 'bg-muted text-muted-foreground',
  erro: 'bg-red-500/15 text-red-400',
};

const RESULTADO_LABEL: Record<string, string> = {
  criado: 'Lead criado',
  atualizado: 'Lead atualizado',
  teste_get: 'Teste de conexão',
  sem_telefone: 'Sem telefone',
  etapa_opaca: 'Etapa sem nome',
  desativado: 'Desativada',
  erro: 'Erro',
};

function fmtData(iso: string | null): string {
  if (!iso) return 'nunca';
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export function WebhooksCard({ clientId }: { clientId: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState<string | null>(null);
  const [logAberto, setLogAberto] = useState<string | null>(null);
  const [guiaAberto, setGuiaAberto] = useState(false);
  const [criando, setCriando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState('');

  const url = `/api/clients/${clientId}/webhooks`;

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDados(await res.json() as Dados);
      setErro('');
    } catch {
      setErro('Não foi possível carregar os webhooks.');
    } finally {
      setCarregando(false);
    }
  }, [url]);

  useEffect(() => { void carregar(); }, [carregar]);

  function copiar(w: WebhookItem) {
    void navigator.clipboard.writeText(w.url).then(() => {
      setCopiado(w.id);
      setTimeout(() => setCopiado(c => (c === w.id ? null : c)), 2000);
    });
  }

  async function criar() {
    const nome = nomeNovo.trim();
    if (!nome) return;
    setCriando(false);
    setNomeNovo('');
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome }),
    }).catch(() => {});
    await carregar();
  }

  /** Otimista: a lista é a fonte do que está na tela; falha volta ao valor anterior. */
  async function patch(id: string, campos: { nome?: string; enabled?: boolean }) {
    const antes = dados;
    setDados(d => d && ({
      ...d,
      webhooks: d.webhooks.map(w => (w.id === id ? { ...w, ...campos } : w)),
    }));
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...campos }),
    }).catch(() => null);
    if (!res?.ok) setDados(antes);
  }

  async function excluir(w: WebhookItem) {
    const aviso = w.last_received_at
      ? `"${w.nome}" já recebeu leads. Excluir faz a URL parar de responder — se ela ainda estiver colada em algum sistema, os leads param de entrar. Continuar?`
      : `Excluir o webhook "${w.nome}"?`;
    if (!confirm(aviso)) return;
    await fetch(`${url}?webhookId=${w.id}`, { method: 'DELETE' }).catch(() => {});
    await carregar();
  }

  if (carregando) return <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/30" />;
  if (erro || !dados) return <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">{erro || 'Sem dados.'}</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Webhook className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">Webhooks — receber leads e etapas</p>
              <p className="text-xs text-muted-foreground">
                Uma URL por origem. O nome serve para você identificar qual é qual.
              </p>
            </div>
          </div>
          <button
            onClick={() => { setCriando(true); setNomeNovo(''); }}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-black transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Novo webhook
          </button>
        </div>

        {criando && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
            <input
              autoFocus
              value={nomeNovo}
              onChange={e => setNomeNovo(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void criar();
                if (e.key === 'Escape') setCriando(false);
              }}
              placeholder="Nome do webhook (ex.: Datalytics, Formulário do site)"
              className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
            />
            <button
              onClick={() => void criar()}
              disabled={!nomeNovo.trim()}
              className="rounded-md bg-primary px-3 py-2 text-xs font-bold text-black disabled:opacity-40"
            >
              Criar
            </button>
            <button onClick={() => setCriando(false)} className="rounded-md border border-border px-2 py-2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {dados.webhooks.length === 0 && !criando ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nenhum webhook ainda. Crie um, dê um nome e cole a URL gerada no sistema de origem.
          </p>
        ) : (
          <div className="space-y-2">
            {dados.webhooks.map(w => (
              <div key={w.id} className="rounded-lg border border-border/60 bg-background/60 p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {editando === w.id ? (
                    <>
                      <input
                        autoFocus
                        value={nomeEditado}
                        onChange={e => setNomeEditado(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { void patch(w.id, { nome: nomeEditado.trim() || w.nome }); setEditando(null); }
                          if (e.key === 'Escape') setEditando(null);
                        }}
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm font-bold outline-none focus:border-primary"
                      />
                      <button
                        onClick={() => { void patch(w.id, { nome: nomeEditado.trim() || w.nome }); setEditando(null); }}
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted"
                      >
                        Salvar
                      </button>
                      <button onClick={() => setEditando(null)} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold">{w.nome}</p>
                      <button
                        onClick={() => { setEditando(w.id); setNomeEditado(w.nome); }}
                        title="Renomear"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <span className="text-[11px] text-muted-foreground">
                        · última recepção: {fmtData(w.last_received_at)}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={() => void patch(w.id, { enabled: !w.enabled })}
                          className={cn(
                            'rounded-full px-3 py-1 text-xs font-bold transition-colors',
                            w.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
                          )}
                        >
                          {w.enabled ? 'Ativo' : 'Desativado'}
                        </button>
                        <button
                          onClick={() => void excluir(w)}
                          title="Excluir webhook"
                          className="text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-background px-3 py-2 text-xs">{w.url}</code>
                  <button onClick={() => copiar(w)} className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs font-semibold transition-colors hover:bg-muted">
                    {copiado === w.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copiado === w.id ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => setGuiaAberto(v => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
        >
          {guiaAberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Como configurar na origem
        </button>
        {guiaAberto && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
            <div>
              <p className="font-semibold text-foreground">Qualquer sistema</p>
              <ol className="mt-1 space-y-1 list-decimal pl-5">
                <li>Crie um webhook aqui e dê um nome que diga de onde vem o lead.</li>
                <li>Copie a URL e cole no campo de webhook do sistema de origem.</li>
                <li>Dispare o teste de lá e confira abaixo, no log, se a recepção apareceu com o payload.</li>
                <li>Leads e mudanças de etapa entram sozinhos no CRM e no Funil de Performance. Etapa que só existe lá (ex.: &quot;Follow 2&quot;) cria a coluna automaticamente no Kanban.</li>
              </ol>
            </div>
            <div>
              <p className="font-semibold text-foreground">Datalytics</p>
              <ol className="mt-1 space-y-1 list-decimal pl-5">
                <li>Abra <span className="font-semibold text-foreground">Integrações → Nova integração</span>.</li>
                <li>Crie UMA integração com o Evento <span className="font-semibold text-foreground">&quot;Lead criado&quot;</span>, colando a URL em &quot;URL do Webhook&quot;.</li>
                <li>Crie UMA integração <span className="font-semibold text-foreground">POR ETAPA</span> com o Evento &quot;Etapa do lead atualizada&quot; — <span className="font-semibold text-foreground">todas com a MESMA URL</span> (o Datalytics exige escolher uma etapa por integração; do nosso lado é um endpoint só).</li>
                <li>Use o <span className="font-semibold text-foreground">&quot;Testar requisição&quot;</span> de cada uma.</li>
              </ol>
            </div>
            <p className="border-t border-border pt-2">
              ⚠️ URL que você já tinha colado antes desta tela existir continua funcionando — o token é o mesmo.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">Últimas recepções</p>
          <button onClick={() => void carregar()} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="h-3 w-3" /> Atualizar
          </button>
        </div>
        {dados.logs.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nada recebido ainda — cole a URL na origem e dispare um teste.
          </p>
        ) : (
          <div className="space-y-1">
            {dados.logs.map(log => (
              <div key={log.id} className="rounded-lg border border-border/60 bg-background/60">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setLogAberto(a => a === log.id ? null : log.id)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2"
                >
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', RESULTADO_BADGE[log.resultado] ?? 'bg-muted text-muted-foreground')}>
                    {RESULTADO_LABEL[log.resultado] ?? log.resultado}
                  </span>
                  {log.webhook_nome && (
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {log.webhook_nome}
                    </span>
                  )}
                  <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{log.detalhe ?? '—'}</span>
                  {log.lead_id && (
                    <a
                      href={`/crm?clientId=${clientId}&lead=${log.lead_id}`}
                      onClick={e => e.stopPropagation()}
                      className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                      title="Abrir no CRM"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <span className="shrink-0 text-[10px] text-muted-foreground">{fmtData(log.created_at)}</span>
                </div>
                {logAberto === log.id && (
                  <pre className="max-h-64 overflow-auto border-t border-border/60 bg-background px-3 py-2 text-[10px] text-muted-foreground">
                    {JSON.stringify(log.raw, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
