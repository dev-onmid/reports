"use client";

/**
 * Sites e landing pages que mandam lead direto para cá — aba Rastreio.
 *
 * Um cliente pode ter vários: LP de campanha, site institucional, página de
 * indicação. Cada um ganha URL própria, e o NOME viaja junto com o lead — sem
 * isso os leads das três páginas chegam indistinguíveis e não dá para saber
 * qual converte.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Globe, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Origem = {
  id: string;
  nome: string;
  url: string | null;
  token: string;
  enabled: boolean;
  last_received_at: string | null;
  total_recebidos: number;
  url_receptora: string;
};

type LogEntry = {
  id: string;
  origem_nome: string | null;
  resultado: string;
  detalhe: string | null;
  lead_id: string | null;
  created_at: string;
};

const BADGE: Record<string, string> = {
  criado: 'bg-emerald-500/15 text-emerald-400',
  atualizado: 'bg-sky-500/15 text-sky-400',
  sem_contato: 'bg-yellow-500/15 text-yellow-400',
  origem_desativada: 'bg-muted text-muted-foreground',
  erro: 'bg-red-500/15 text-red-400',
};
const LABEL: Record<string, string> = {
  criado: 'Lead criado',
  atualizado: 'Lead atualizado',
  sem_contato: 'Sem telefone/e-mail',
  origem_desativada: 'Origem desativada',
  erro: 'Erro',
};

function quando(iso: string | null) {
  if (!iso) return 'nunca';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function LpOrigensCard({ clientId }: { clientId: string }) {
  const [origens, setOrigens] = useState<Origem[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoNome, setNovoNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/lp-origens`);
      const d = await r.json();
      setOrigens(d.origens ?? []);
      setLog(d.log ?? []);
    } catch { /* deixa a tela como está */ }
    setCarregando(false);
  }, [clientId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function criar() {
    const nome = novoNome.trim();
    if (!nome) return;
    setCriando(true); setErro(null);
    const r = await fetch(`/api/clients/${clientId}/lp-origens`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome }),
    });
    const d = await r.json();
    if (!r.ok) setErro(d.erro ?? 'Não foi possível criar');
    else { setNovoNome(''); await carregar(); }
    setCriando(false);
  }

  async function alternar(o: Origem) {
    setOrigens(os => os.map(x => x.id === o.id ? { ...x, enabled: !x.enabled } : x));
    await fetch(`/api/clients/${clientId}/lp-origens`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origemId: o.id, enabled: !o.enabled }),
    }).catch(() => {});
  }

  async function remover(o: Origem) {
    if (!confirm(`Remover "${o.nome}"?\n\nA URL para de funcionar na hora. Os leads que já chegaram por ela ficam no CRM.`)) return;
    setOrigens(os => os.filter(x => x.id !== o.id));
    await fetch(`/api/clients/${clientId}/lp-origens?origemId=${o.id}`, { method: 'DELETE' }).catch(() => {});
    void carregar();
  }

  function copiar(texto: string, id: string) {
    void navigator.clipboard.writeText(texto);
    setCopiado(id);
    setTimeout(() => setCopiado(c => (c === id ? null : c)), 1800);
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Sites e landing pages</h3>
            <p className="text-xs text-muted-foreground">
              Recebem lead direto, com o rastreio completo do anúncio
            </p>
          </div>
        </div>
        <button onClick={() => void carregar()} className="text-muted-foreground hover:text-foreground"
                title="Atualizar">
          <RefreshCw className={cn('h-4 w-4', carregando && 'animate-spin')} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {/* criar */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void criar(); }}
            placeholder="Nome do site (ex.: LP Revenda)"
            className="h-9 min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 text-sm"
          />
          <button
            onClick={() => void criar()}
            disabled={criando || !novoNome.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Adicionar
          </button>
        </div>
        {erro && <p className="text-xs text-red-400">{erro}</p>}

        {/* lista */}
        {!origens.length && !carregando && (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Nenhum site cadastrado. Crie um acima e cole a URL gerada na página.
          </p>
        )}

        {origens.map(o => (
          <div key={o.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{o.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {o.total_recebidos} lead(s) · último: {quando(o.last_received_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void alternar(o)}
                  className={cn('rounded px-2 py-1 text-xs font-medium',
                    o.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground')}
                >
                  {o.enabled ? 'Ativa' : 'Desativada'}
                </button>
                <button onClick={() => void remover(o)} className="text-muted-foreground hover:text-red-400"
                        title="Remover">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted/40 px-2 py-1.5 text-[11px]">
                {o.url_receptora}
              </code>
              <button onClick={() => copiar(o.url_receptora, o.id)}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs">
                {copiado === o.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copiado === o.id ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
        ))}

        {/* log */}
        {log.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Últimas recepções</p>
            <div className="space-y-1">
              {log.slice(0, 8).map(l => (
                <div key={l.id} className="flex flex-wrap items-center gap-2 rounded bg-muted/20 px-2 py-1.5 text-xs">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium',
                    BADGE[l.resultado] ?? 'bg-muted text-muted-foreground')}>
                    {LABEL[l.resultado] ?? l.resultado}
                  </span>
                  {l.origem_nome && <span className="text-muted-foreground">{l.origem_nome}</span>}
                  <span className="min-w-0 flex-1 truncate">{l.detalhe}</span>
                  <span className="text-muted-foreground">{quando(l.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
