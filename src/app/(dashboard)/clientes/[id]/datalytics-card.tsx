"use client";

/**
 * Card de configuração da integração Datalytics (CRM externo) — aba Rastreio.
 *
 * O usuário copia a URL daqui e cola no "Nova integração" do Datalytics.
 * O log mostra o payload CRU de cada recepção — é assim que se descobre o
 * shape real do webhook deles depois do "Testar requisição" (os aliases de
 * extração moram em src/lib/datalytics.ts).
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, RefreshCw, Webhook } from 'lucide-react';
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
  last_received_at: string | null;
  url: string;
  logs: LogEntry[];
};

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

export function DatalyticsCard({ clientId }: { clientId: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [guiaAberto, setGuiaAberto] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/datalytics`);
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

  function copiar() {
    if (!cfg) return;
    void navigator.clipboard.writeText(cfg.url).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  async function alternar() {
    if (!cfg) return;
    const novo = !cfg.enabled;
    setCfg({ ...cfg, enabled: novo });
    await fetch(`/api/clients/${clientId}/datalytics`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: novo }),
    }).catch(() => setCfg(c => c ? { ...c, enabled: !novo } : c));
  }

  if (carregando) return <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/30" />;
  if (erro || !cfg) return <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">{erro || 'Sem dados.'}</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Webhook className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">Datalytics — receber leads e etapas</p>
              <p className="text-xs text-muted-foreground">
                Última recepção: {fmtData(cfg.last_received_at)}
              </p>
            </div>
          </div>
          <button
            onClick={() => void alternar()}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-bold transition-colors',
              cfg.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
            )}
          >
            {cfg.enabled ? 'Ativa' : 'Desativada'}
          </button>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">URL do webhook (cole no Datalytics)</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-background px-3 py-2 text-xs">{cfg.url}</code>
            <button onClick={copiar} className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs font-semibold transition-colors hover:bg-muted">
              {copiado ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copiado ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>

        <button
          onClick={() => setGuiaAberto(v => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
        >
          {guiaAberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Como configurar no Datalytics
        </button>
        {guiaAberto && (
          <ol className="space-y-2 rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground list-decimal pl-8">
            <li>No Datalytics, abra <span className="font-semibold text-foreground">Integrações → Nova integração</span>.</li>
            <li>Crie UMA integração com o Evento <span className="font-semibold text-foreground">&quot;Lead criado&quot;</span>, colando a URL acima em &quot;URL do Webhook&quot;.</li>
            <li>Crie UMA integração <span className="font-semibold text-foreground">POR ETAPA</span> do funil com o Evento &quot;Etapa do lead atualizada&quot;, selecionando a etapa — <span className="font-semibold text-foreground">todas com esta MESMA URL</span> (o Datalytics exige escolher uma etapa por integração; do nosso lado é um endpoint só).</li>
            <li>Use o <span className="font-semibold text-foreground">&quot;Testar requisição&quot;</span> de cada uma e confira abaixo, no log, se a recepção apareceu.</li>
            <li>Pronto: leads e mudanças de etapa entram sozinhos no CRM e no Funil de Performance. Etapas que só existem no Datalytics (ex.: &quot;Follow 2&quot;) criam a coluna automaticamente no Kanban.</li>
          </ol>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">Últimas recepções</p>
          <button onClick={() => void carregar()} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="h-3 w-3" /> Atualizar
          </button>
        </div>
        {cfg.logs.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nada recebido ainda — cole a URL no Datalytics e use &quot;Testar requisição&quot;.
          </p>
        ) : (
          <div className="space-y-1">
            {cfg.logs.map(log => (
              <div key={log.id} className="rounded-lg border border-border/60 bg-background/60">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setAberto(a => a === log.id ? null : log.id)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2"
                >
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', RESULTADO_BADGE[log.resultado] ?? 'bg-muted text-muted-foreground')}>
                    {RESULTADO_LABEL[log.resultado] ?? log.resultado}
                  </span>
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
                {aberto === log.id && (
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
