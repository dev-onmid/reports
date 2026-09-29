'use client';

// ── Aviso de lead novo no grupo do cliente ───────────────────────────────────
// Substitui o cenário do Make. Configurado por CLIENTE: grupo de destino e de
// quais fontes avisar. Ver src/lib/lead-aviso.ts.
//
// ⚠️ O REMETENTE NÃO É ESCOLHÍVEL: todo disparo em nome da ONMID sai pela
// instância oficial (`instanciaOnmid`, em whatsapp-send). O seletor que existia
// aqui listava instâncias de CLIENTE junto com a da agência — escolher errado
// mandava recado da ONMID pelo WhatsApp de outro cliente, sem desfazer.

import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, Loader2, RefreshCw, Search, Send, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

type Fonte = 'meta_forms' | 'landing_page';
type Grupo = { jid: string; nome: string; membros: number | null };
type Envio = {
  id: string; evento_id: string; fonte: string | null; status: string;
  erro: string | null; texto: string | null; created_at: string;
  tentativas?: number; proxima_tentativa?: string | null;
};
type Fila = {
  pendentes: number; enviando: number; falhas: number; enviados: number;
  proxima: string | null;
};
type Config = {
  ativo: boolean; groupId: string | null; fontes: Fonte[]; envios: Envio[];
  remetente: { id: string; nome: string } | null;
  fila?: Fila;
};

// O status cru ('pendente') não diz nada a quem está olhando o card. E
// "desistiu" é mais honesto que "falha": a linha continua ali, com botão.
const ROTULO_STATUS: Record<string, string> = {
  pendente: 'Na fila',
  enviando: 'Enviando',
  enviado: 'Entregue',
  falha: 'Desistiu',
  erro: 'Falhou',
};

const ROTULO: Record<Fonte, string> = {
  meta_forms: 'Formulário do Meta Ads',
  landing_page: 'Landing page',
};

export function LeadAvisoCard({ clientId }: { clientId: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [buscandoGrupos, setBuscandoGrupos] = useState(false);
  const [buscaGrupo, setBuscaGrupo] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const carregar = useCallback(() => {
    fetch(`/api/clients/${clientId}/lead-aviso`)
      .then(r => r.json()).then((d: Config) => setCfg(d)).catch(() => setCfg(null));
  }, [clientId]);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (mudanca: Partial<Config> & { testar?: boolean; reenviar?: string }) => {
    setSalvando(true); setAviso(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/lead-aviso`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ativo: mudanca.ativo, groupId: mudanca.groupId,
          fontes: mudanca.fontes, testar: mudanca.testar, reenviar: mudanca.reenviar,
        }),
      });
      const d = await r.json();
      if (mudanca.testar) {
        setAviso(d?.ok
          ? { tipo: 'ok', texto: 'Mensagem de teste enviada no grupo.' }
          : { tipo: 'erro', texto: d?.error ?? 'Não foi possível enviar.' });
      } else if (!d?.ok) {
        setAviso({ tipo: 'erro', texto: d?.error ?? 'Não foi possível salvar.' });
      }
      carregar();
    } finally { setSalvando(false); }
  };

  // Os grupos listados são os da instância OFICIAL — é dela que a mensagem sai,
  // então é nela que o grupo precisa existir. Ela é Evolution.
  const carregarGrupos = async () => {
    const remetente = cfg?.remetente;
    if (!remetente) { setAviso({ tipo: 'erro', texto: 'A instância oficial da ONMID não está ativa.' }); return; }
    setBuscandoGrupos(true); setAviso(null);
    try {
      const r = await fetch(`/api/otimizador/whatsapp-groups?zapiClientId=${remetente.id}`);
      const d = await r.json();
      const lista: Grupo[] = Array.isArray(d)
        ? d.map((g: Record<string, unknown>) => ({
            jid: String(g.jid ?? g.id ?? ''),
            nome: String(g.nome ?? g.name ?? g.subject ?? 'Grupo'),
            membros: typeof g.membros === 'number' ? g.membros : null,
          })).filter(g => g.jid)
        : [];
      setGrupos(lista);
      if (!lista.length) setAviso({ tipo: 'erro', texto: d?.error ?? 'Nenhum grupo encontrado na instância da ONMID.' });
    } catch {
      setAviso({ tipo: 'erro', texto: 'Não foi possível listar os grupos.' });
    } finally { setBuscandoGrupos(false); }
  };

  if (!cfg) {
    return <div className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">Carregando…</div>;
  }

  const fila = cfg.fila;
  const proximaTentativa = fila?.proxima && new Date(fila.proxima) > new Date()
    ? new Date(fila.proxima).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;
  const grupoAtual = grupos?.find(g => g.jid === cfg.groupId);
  const prontoParaLigar = Boolean(cfg.remetente && cfg.groupId);
  const visiveis = (grupos ?? []).filter(g =>
    !buscaGrupo.trim() || g.nome.toLowerCase().includes(buscaGrupo.trim().toLowerCase()));

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h3 className="text-sm font-bold text-foreground">Avisar lead novo no grupo</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Quando entrar lead por formulário do Meta ou pela landing page, o sistema manda uma
              mensagem no grupo de WhatsApp deste cliente — com nome, telefone, campanha e região.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={salvando || (!cfg.ativo && !prontoParaLigar)}
          onClick={() => salvar({ ativo: !cfg.ativo })}
          className={cn(
            'shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40',
            cfg.ativo ? 'bg-primary text-black' : 'border border-border text-muted-foreground hover:text-foreground',
          )}
          title={!cfg.ativo && !prontoParaLigar ? 'Escolha o grupo antes de ligar' : undefined}
        >
          {cfg.ativo ? 'Ativo' : 'Desativado'}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Quem envia</span>
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm">
            {cfg.remetente ? (
              <>
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{cfg.remetente.nome}</span>
                <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Oficial</span>
              </>
            ) : (
              <span className="text-xs text-red-400">Instância oficial da ONMID inativa — reconecte em Configurações › Instâncias.</span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Todo aviso da ONMID sai por este número. Não é escolha por cliente.
          </p>
        </div>

        <div>
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Grupo de destino</span>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 text-sm">
              {grupoAtual?.nome ?? (cfg.groupId ? <span className="font-mono text-xs text-muted-foreground">{cfg.groupId}</span> : <span className="text-muted-foreground">Nenhum escolhido</span>)}
            </div>
            <button
              type="button" onClick={carregarGrupos} disabled={buscandoGrupos || !cfg.remetente}
              className="shrink-0 rounded-lg border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              {buscandoGrupos ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Escolher'}
            </button>
          </div>
        </div>
      </div>

      {grupos && (
        <div className="mt-3 rounded-lg border border-border bg-background/50 p-3">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={buscaGrupo} onChange={e => setBuscaGrupo(e.target.value)}
              placeholder="Buscar grupo…"
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {visiveis.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">Nenhum grupo com esse nome.</p>}
            {visiveis.map(g => (
              <button
                key={g.jid} type="button"
                onClick={() => { salvar({ groupId: g.jid }); setGrupos(null); setBuscaGrupo(''); }}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted"
              >
                <span className="min-w-0 truncate font-semibold text-foreground">{g.nome}</span>
                {g.membros != null && <span className="shrink-0 text-[10px] text-muted-foreground">{g.membros} membros</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Avisar quando vier de</span>
        <div className="flex flex-wrap gap-2">
          {(['meta_forms', 'landing_page'] as Fonte[]).map(f => {
            const on = cfg.fontes.includes(f);
            return (
              <button
                key={f} type="button"
                onClick={() => salvar({ fontes: on ? cfg.fontes.filter(x => x !== f) : [...cfg.fontes, f] })}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors',
                  on ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {on && <Check className="h-3.5 w-3.5" />} {ROTULO[f]}
              </button>
            );
          })}
        </div>
        {cfg.fontes.length === 0 && (
          <p className="mt-2 text-[11px] text-[#FF6B35]">Sem nenhuma fonte marcada o aviso vale para as duas.</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button" disabled={salvando || !prontoParaLigar}
          onClick={() => salvar({ testar: true })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" /> Enviar teste no grupo
        </button>
        <button
          type="button" onClick={carregar}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        {aviso && (
          <span className={cn('text-xs font-semibold', aviso.tipo === 'ok' ? 'text-primary' : 'text-[#FF6B35]')}>
            {aviso.texto}
          </span>
        )}
      </div>

      {/* ⚠️ A FILA precisa ser visível. Aviso que não saiu e não aparece em
          lugar nenhum é indistinguível de aviso que nunca existiu — foi
          exatamente o que aconteceu com os 16 clientes configurados e
          desligados. Aqui o gestor vê o que está esperando, por quê, e reenvia. */}
      {fila && (fila.pendentes > 0 || fila.enviando > 0 || fila.falhas > 0) && (
        <div className="mt-5 rounded-lg border border-[#FF6B35]/30 bg-[#FF6B35]/5 p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#FF6B35]">Fila de envios</span>
            {fila.pendentes > 0 && <span className="text-xs text-foreground"><b>{fila.pendentes}</b> na fila</span>}
            {fila.enviando > 0 && <span className="text-xs text-muted-foreground">{fila.enviando} enviando</span>}
            {fila.falhas > 0 && <span className="text-xs text-[#FF6B35]"><b>{fila.falhas}</b> desistiram</span>}
            {proximaTentativa && (
              <span className="text-[11px] text-muted-foreground">próxima tentativa {proximaTentativa}</span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Nada se perde: o sistema tenta de novo sozinho e entrega na ordem em que os leads chegaram.
            {!cfg.ativo && ' Com o aviso desligado, a fila fica parada esperando você ligar.'}
          </p>
        </div>
      )}

      {/* ⚠️ Mostra o texto EXATO que foi para o grupo — é o que permite conferir
          uma reclamação ("chegou torto") sem remontar a mensagem de hoje. */}
      {cfg.envios.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Últimos avisos ({cfg.envios.length})
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {cfg.envios.map(e => (
              <div key={e.evento_id} className="rounded-lg border border-border bg-background/50 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('text-[10px] font-bold uppercase tracking-wider',
                    e.status === 'enviado' ? 'text-primary'
                      : e.status === 'falha' ? 'text-[#FF6B35]'
                      : 'text-[#0B84FF]')}>
                    {ROTULO_STATUS[e.status] ?? e.status}
                    {e.fonte ? ` · ${ROTULO[e.fonte as Fonte] ?? e.fonte}` : ''}
                    {(e.tentativas ?? 0) > 0 && e.status !== 'enviado' ? ` · ${e.tentativas}ª tentativa` : ''}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {e.status !== 'enviado' && (
                      <button
                        type="button" disabled={salvando}
                        onClick={() => salvar({ reenviar: e.id })}
                        className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline disabled:opacity-40"
                      >
                        Tentar agora
                      </button>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(e.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                </div>
                {e.erro && <p className="mt-1 text-[11px] text-[#FF6B35]">{e.erro}</p>}
                {e.texto && <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-muted-foreground">{e.texto}</pre>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
