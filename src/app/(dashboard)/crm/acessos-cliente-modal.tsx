"use client";

/**
 * "Acessos ao CRM" — a equipe da Onmid cria e gerencia, dentro do cliente, os
 * logins do cliente no crm.onmid.app (2026-10-10). Substituiu o "Portal do
 * cliente" por link sem senha. O gestor criado aqui pode cadastrar os
 * próprios atendentes por lá (aba Equipe).
 */
import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Plus, UserCheck, UserX, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { notificar } from '@/components/ui/toast';

type Acesso = { id: string; name: string; email: string; status: string; perfil: 'gestor' | 'atendente' };

export function AcessosClienteModal({ clientId, clientName, onClose }: { clientId: string; clientName: string; onClose: () => void }) {
  const [acessos, setAcessos] = useState<Acesso[] | null>(null);
  const [url, setUrl] = useState('https://crm.onmid.app');
  const [novo, setNovo] = useState({ name: '', email: '', password: '', perfil: 'gestor' as 'gestor' | 'atendente' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregar = () => fetch(`/api/clients/${encodeURIComponent(clientId)}/acessos`)
    .then(r => r.ok ? r.json() as Promise<{ acessos: Acesso[]; url: string }> : { acessos: [], url: 'https://crm.onmid.app' })
    .then(d => { setAcessos(d.acessos ?? []); if (d.url) setUrl(d.url); })
    .catch(() => setAcessos([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- só depende de clientId
  useEffect(() => { void carregar(); }, [clientId]);

  async function criar() {
    setErro(null); setSalvando(true);
    const r = await fetch(`/api/clients/${encodeURIComponent(clientId)}/acessos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novo),
    }).catch(() => null);
    setSalvando(false);
    const d = await r?.json().catch(() => ({})) as { error?: string } | undefined;
    if (!r?.ok) { setErro(d?.error ?? 'Não foi possível criar.'); return; }
    setNovo({ name: '', email: '', password: '', perfil: 'atendente' });
    notificar('Acesso criado. A pessoa entra em crm.onmid.app com o e-mail e a senha informados.', 'ok');
    void carregar();
  }

  async function patch(userId: string, dados: Record<string, string>) {
    const r = await fetch(`/api/clients/${encodeURIComponent(clientId)}/acessos`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, ...dados }),
    }).catch(() => null);
    const d = await r?.json().catch(() => ({})) as { error?: string } | undefined;
    if (!r?.ok) { notificar(d?.error ?? 'Não foi possível salvar.', 'erro'); return; }
    notificar('Salvo.', 'ok');
    void carregar();
  }

  const campo = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-bold">Acessos ao CRM · {clientName}</h2>
            <p className="text-xs text-muted-foreground">Quem do cliente entra no CRM pelo endereço abaixo, com login e senha.</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Endereço do cliente</span>
              <code className="text-sm font-semibold text-primary">{url}</code>
              <button type="button"
                onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopiado(true); window.setTimeout(() => setCopiado(false), 1500); }); }}
                className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
                {copiado ? <><Check className="h-3.5 w-3.5" /> Copiado</> : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
              </button>
            </div>

            <section className="rounded-xl border border-border bg-background/40 p-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pessoas com acesso</h3>
              {acessos === null && <p className="mt-3 text-xs text-muted-foreground">Carregando…</p>}
              {acessos?.length === 0 && <p className="mt-3 text-xs text-muted-foreground">Ninguém ainda. Crie o primeiro acesso ao lado — normalmente o dono ou gerente, como Gestor.</p>}
              <ul className="mt-2 divide-y divide-border">
                {acessos?.map(u => (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <select value={u.perfil} onChange={e => void patch(u.id, { perfil: e.target.value })} title="Perfil"
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                      <option value="gestor">Gestor</option>
                      <option value="atendente">Atendente</option>
                    </select>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', u.status === 'Ativo' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300')}>{u.status}</span>
                    <button type="button" title="Definir nova senha"
                      onClick={() => { const s = window.prompt(`Nova senha para ${u.name} (mínimo 8 caracteres):`); if (s) void patch(u.id, { password: s }); }}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"><KeyRound className="h-3.5 w-3.5" /></button>
                    <button type="button" title={u.status === 'Ativo' ? 'Desativar acesso' : 'Reativar acesso'}
                      onClick={() => { if (window.confirm(`${u.status === 'Ativo' ? 'Desativar' : 'Reativar'} o acesso de ${u.name}?`)) void patch(u.id, { status: u.status === 'Ativo' ? 'Inativo' : 'Ativo' }); }}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground">
                      {u.status === 'Ativo' ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <p className="text-[11px] text-muted-foreground">
              <b>Gestor</b> vê o CRM, a aba Resultados e cadastra os próprios atendentes por lá. <b>Atendente</b> vê só o CRM (leads e conversas). Desativar corta o acesso em até 30 segundos.
            </p>
          </div>

          <section className="h-fit rounded-xl border border-border bg-background/40 p-4">
            <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"><Plus className="h-3.5 w-3.5" /> Novo acesso</h3>
            <div className="mt-3 space-y-2">
              <input value={novo.name} onChange={e => setNovo({ ...novo, name: e.target.value })} placeholder="Nome" className={campo} />
              <input value={novo.email} onChange={e => setNovo({ ...novo, email: e.target.value })} placeholder="E-mail (será o login)" type="email" className={campo} />
              <input value={novo.password} onChange={e => setNovo({ ...novo, password: e.target.value })} placeholder="Senha (mínimo 8 caracteres)" type="text" autoComplete="off" className={campo} />
              <select value={novo.perfil} onChange={e => setNovo({ ...novo, perfil: e.target.value === 'gestor' ? 'gestor' : 'atendente' })} className={campo}>
                <option value="gestor">Gestor — CRM + resultados + equipe</option>
                <option value="atendente">Atendente — só o CRM</option>
              </select>
              {erro && <p className="text-xs text-red-400">{erro}</p>}
              <button type="button" onClick={() => void criar()} disabled={salvando || !novo.name || !novo.email || novo.password.length < 8}
                className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {salvando ? 'Criando…' : 'Criar acesso'}
              </button>
              <p className="text-[11px] text-muted-foreground">Anote a senha e passe para a pessoa: ela não é mostrada de novo.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
