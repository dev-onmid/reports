"use client";

/**
 * O que o GESTOR do cliente vê a mais no CRM (2026-10-10): os resultados do
 * próprio negócio e a própria equipe. Superfície mínima de propósito — a
 * dashboard da agência fala com ~25 rotas e carrega saldo de conta, modelo
 * editável e termos de mídia; aqui são 4 rotas, todas presas ao cliente.
 */
import { useEffect, useState } from 'react';
import { KeyRound, Plus, UserCheck, UserX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { notificar } from '@/components/ui/toast';

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
