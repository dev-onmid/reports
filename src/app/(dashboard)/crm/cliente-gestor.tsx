"use client";

/**
 * O que o GESTOR do cliente vê a mais no CRM (2026-10-10): os resultados do
 * próprio negócio e a própria equipe. Superfície mínima de propósito — a
 * dashboard da agência fala com ~25 rotas e carrega saldo de conta, modelo
 * editável e termos de mídia; aqui são 4 rotas, todas presas ao cliente.
 */
import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, UserCheck, UserX } from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { notificar } from '@/components/ui/toast';

const dia = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function janela(preset: string): { from: string; to: string } {
  const hoje = new Date();
  if (preset === 'mes_passado') {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1), fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return { from: dia(ini), to: dia(fim) };
  }
  if (preset === '7d') return { from: dia(new Date(hoje.getTime() - 6 * 864e5)), to: dia(hoje) };
  if (preset === '30d') return { from: dia(new Date(hoje.getTime() - 29 * 864e5)), to: dia(hoje) };
  return { from: dia(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), to: dia(hoje) };
}

type Metricas = {
  meta?: { spend: number; leads: number; conversations?: number } | null;
  google?: { cost: number; conversions: number } | null;
  crm?: { revenue: number; sales: number; leads: number; ticket: number } | null;
};
type Funil = { contatos: number; qualificados: number; agendamentos: number; comparecimentos: number; fechamentos: number; perdidos: number; receita: number };
type Linha = Record<string, unknown>;

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const txt = (l: Linha) => String(l.label ?? l.canal ?? l.responsavel ?? l.categoria ?? '—');

export function ResultadosCliente({ clientId }: { clientId: string }) {
  const [preset, setPreset] = useState('mes_atual');
  // `chave` em vez de setState no início do efeito: carregando = a chave da
  // última resposta é diferente da atual.
  const [respondido, setRespondido] = useState('');
  const carregando = respondido !== `${clientId}|${preset}`;
  const [m, setM] = useState<Metricas | null>(null);
  const [funil, setFunil] = useState<Funil | null>(null);
  const [canais, setCanais] = useState<{ leads: Linha[]; origens: Linha[] }>({ leads: [], origens: [] });
  const [vendedores, setVendedores] = useState<Linha[]>([]);
  const { from, to } = useMemo(() => janela(preset), [preset]);

  useEffect(() => {
    let vivo = true;
    const q = `clientIds=${encodeURIComponent(clientId)}&from=${from}&to=${to}`;
    const j = <T,>(r: Response) => (r.ok ? (r.json() as Promise<T>) : Promise.resolve(null));
    Promise.all([
      fetch(`/api/clients/${encodeURIComponent(clientId)}/metrics?period=custom&dateFrom=${from}&dateTo=${to}`).then(j<Metricas>).catch(() => null),
      fetch(`/api/crm/funil?clientId=${encodeURIComponent(clientId)}&from=${from}&to=${to}`).then(j<{ funil: Funil }>).catch(() => null),
      fetch(`/api/crm/por-canal?${q}`).then(j<{ leads?: Linha[]; origens?: Linha[] }>).catch(() => null),
      fetch(`/api/crm/desempenho?${q}`).then(j<{ vendedores?: Linha[] }>).catch(() => null),
    ]).then(([met, fu, pc, de]) => {
      if (!vivo) return;
      setM(met); setFunil(fu?.funil ?? null);
      setCanais({ leads: pc?.leads ?? [], origens: pc?.origens ?? [] });
      setVendedores(de?.vendedores ?? []);
      setRespondido(`${clientId}|${preset}`);
    });
    return () => { vivo = false; };
  }, [clientId, from, to, preset]);

  const investimento = n(m?.meta?.spend) + n(m?.google?.cost);
  const leadsAnuncio = n(m?.meta?.leads) + n(m?.google?.conversions);
  const cpl = leadsAnuncio > 0 ? investimento / leadsAnuncio : null;
  const kpis = [
    { rotulo: 'Leads no período', valor: n(m?.crm?.leads).toLocaleString('pt-BR') },
    { rotulo: 'Investimento em anúncios', valor: investimento > 0 ? formatCurrencyBRL(investimento) : '—' },
    { rotulo: 'Custo por lead', valor: cpl !== null ? formatCurrencyBRL(cpl) : '—' },
    { rotulo: 'Agendamentos', valor: n(funil?.agendamentos).toLocaleString('pt-BR') },
    { rotulo: 'Vendas', valor: n(m?.crm?.sales).toLocaleString('pt-BR') },
    { rotulo: 'Faturamento', valor: formatCurrencyBRL(n(m?.crm?.revenue)) },
    { rotulo: 'Ticket médio', valor: n(m?.crm?.ticket) > 0 ? formatCurrencyBRL(n(m?.crm?.ticket)) : '—' },
  ];
  const degraus = funil ? [
    ['Contatos', funil.contatos], ['Qualificados', funil.qualificados], ['Agendamentos', funil.agendamentos],
    ['Comparecimentos', funil.comparecimentos], ['Fechamentos', funil.fechamentos],
  ] as const : [];
  const topo = Math.max(1, ...degraus.map(d => d[1]));

  return (
    <div className="space-y-5 overflow-y-auto pb-6">
      <div className="flex flex-wrap items-center gap-2">
        {([['mes_atual', 'Mês atual'], ['mes_passado', 'Mês passado'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias']] as const).map(([id, r]) => (
          <button key={id} type="button" onClick={() => setPreset(id)}
            className={cn('rounded-lg border px-3 py-1.5 text-xs font-semibold', preset === id ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
            {r}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">{from.split('-').reverse().join('/')} a {to.split('-').reverse().join('/')}</span>
        {carregando && <span className="text-xs text-muted-foreground animate-pulse">Carregando…</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {kpis.map(k => (
          <div key={k.rotulo} className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{k.rotulo}</p>
            <p className="mt-1 font-heading text-2xl leading-none">{k.valor}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Funil</h3>
          <div className="mt-3 space-y-2">
            {degraus.map(([r, v]) => (
              <div key={r} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 text-xs text-muted-foreground">{r}</span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-muted/40"><div className="h-full bg-primary/60" style={{ width: `${Math.max(2, (v / topo) * 100)}%` }} /></div>
                <span className="w-12 text-right font-semibold">{v.toLocaleString('pt-BR')}</span>
              </div>
            ))}
            {funil && funil.perdidos > 0 && <p className="pt-1 text-xs text-muted-foreground">{funil.perdidos.toLocaleString('pt-BR')} perdidos no período</p>}
            {!funil && !carregando && <p className="text-xs text-muted-foreground">Sem dados no período.</p>}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Leads por origem</h3>
          <Lista linhas={canais.leads} valor={l => n(l.leads ?? l.n ?? l.total).toLocaleString('pt-BR')} vazio={!carregando} />
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Faturamento por origem</h3>
          <Lista linhas={canais.origens} valor={l => `${formatCurrencyBRL(n(l.receita))} · ${n(l.vendas)} venda${n(l.vendas) === 1 ? '' : 's'}`} vazio={!carregando} />
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Por responsável</h3>
          <Lista linhas={vendedores} valor={l => `${n(l.ganhos)} venda${n(l.ganhos) === 1 ? '' : 's'} · ${formatCurrencyBRL(n(l.ganhos_valor))}`} vazio={!carregando} />
        </section>
      </div>
    </div>
  );
}

function Lista({ linhas, valor, vazio }: { linhas: Linha[]; valor: (l: Linha) => string; vazio: boolean }) {
  if (linhas.length === 0) return <p className="mt-3 text-xs text-muted-foreground">{vazio ? 'Sem dados no período.' : ''}</p>;
  return (
    <ul className="mt-3 divide-y divide-border text-sm">
      {linhas.slice(0, 10).map((l, i) => (
        <li key={i} className="flex items-center justify-between gap-3 py-1.5">
          <span className="truncate">{txt(l)}</span>
          <span className="shrink-0 text-xs font-semibold text-muted-foreground">{valor(l)}</span>
        </li>
      ))}
    </ul>
  );
}

type Membro = { id: string; name: string; email: string; status: string; perfil: string; souEu: boolean; editavel: boolean };

export function EquipeCliente({ clientId }: { clientId: string }) {
  const [equipe, setEquipe] = useState<Membro[] | null>(null);
  const [novo, setNovo] = useState({ name: '', email: '', password: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = () => fetch(`/api/crm/equipe-cliente?clientId=${encodeURIComponent(clientId)}`)
    .then(r => r.ok ? r.json() as Promise<{ equipe: Membro[] }> : { equipe: [] })
    .then(d => setEquipe(d.equipe ?? []))
    .catch(() => setEquipe([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `carregar` só depende de clientId
  useEffect(() => { void carregar(); }, [clientId]);

  async function criar() {
    setErro(null); setSalvando(true);
    const r = await fetch('/api/crm/equipe-cliente', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, ...novo }),
    }).catch(() => null);
    setSalvando(false);
    const d = await r?.json().catch(() => ({})) as { error?: string } | undefined;
    if (!r?.ok) { setErro(d?.error ?? 'Não foi possível criar.'); return; }
    setNovo({ name: '', email: '', password: '' });
    notificar('Atendente criado. Ele entra em crm.onmid.app com o e-mail e a senha informados.', 'ok');
    void carregar();
  }

  async function patch(userId: string, dados: Record<string, string>) {
    const r = await fetch('/api/crm/equipe-cliente', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, userId, ...dados }),
    }).catch(() => null);
    const d = await r?.json().catch(() => ({})) as { error?: string } | undefined;
    if (!r?.ok) { notificar(d?.error ?? 'Não foi possível salvar.', 'erro'); return; }
    notificar('Salvo.', 'ok');
    void carregar();
  }

  const campo = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary';
  return (
    <div className="grid gap-4 overflow-y-auto pb-6 lg:grid-cols-[1fr_360px]">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Equipe</h3>
        {equipe === null && <p className="mt-3 text-xs text-muted-foreground">Carregando…</p>}
        <ul className="mt-3 divide-y divide-border">
          {equipe?.map(u => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{u.name} {u.souEu && <span className="text-xs text-muted-foreground">(você)</span>}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
              </div>
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', u.perfil === 'gestor' ? 'bg-sky-500/15 text-sky-300' : 'bg-muted text-muted-foreground')}>{u.perfil}</span>
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', u.status === 'Ativo' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300')}>{u.status}</span>
              {u.editavel && (
                <div className="flex gap-1">
                  <button type="button" title="Definir nova senha"
                    onClick={() => { const s = window.prompt(`Nova senha para ${u.name} (mínimo 8 caracteres):`); if (s) void patch(u.id, { password: s }); }}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"><KeyRound className="h-3.5 w-3.5" /></button>
                  <button type="button" title={u.status === 'Ativo' ? 'Desativar acesso' : 'Reativar acesso'}
                    onClick={() => { if (window.confirm(`${u.status === 'Ativo' ? 'Desativar' : 'Reativar'} o acesso de ${u.name}?`)) void patch(u.id, { status: u.status === 'Ativo' ? 'Inativo' : 'Ativo' }); }}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground">
                    {u.status === 'Ativo' ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground">Atendente vê só o CRM (leads e conversas). Para mudar quem é gestor, fale com a Onmid.</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"><Plus className="h-3.5 w-3.5" /> Novo atendente</h3>
        <div className="mt-3 space-y-2">
          <input value={novo.name} onChange={e => setNovo({ ...novo, name: e.target.value })} placeholder="Nome" className={campo} />
          <input value={novo.email} onChange={e => setNovo({ ...novo, email: e.target.value })} placeholder="E-mail" type="email" className={campo} />
          <input value={novo.password} onChange={e => setNovo({ ...novo, password: e.target.value })} placeholder="Senha (mínimo 8 caracteres)" type="password" className={campo} />
          {erro && <p className="text-xs text-red-400">{erro}</p>}
          <button type="button" onClick={() => void criar()} disabled={salvando || !novo.name || !novo.email || novo.password.length < 8}
            className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {salvando ? 'Criando…' : 'Criar acesso'}
          </button>
        </div>
      </section>
    </div>
  );
}
