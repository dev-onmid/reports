'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Loader2, Plug, RefreshCw, Wand2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { callerHeaders } from '@/lib/auth-store';
import { normalizeClientName } from '@/lib/client-name';

// Importação diária do CRM Sorrifácil: login do CRM + de-para clínica → cliente.
// A rotina em si roda no servidor (/api/crm/sync-cron/sorrifacil).

type Client = { id: string; name: string; status?: string };
type Mapa = { clinica: string; clientId: string; clientName: string };
type Relatorio = {
  tipo: string; mes: string; linhas: number; ok: boolean;
  resultado?: Record<string, number>; descartadas_origem?: number; erro?: string;
};
type Execucao = { ok: boolean; iniciado_em: string; duracao_ms: number; relatorios: Relatorio[]; erro?: string };
type Config = { ativo: boolean; usuario: string; tem_senha: boolean; mapa: Mapa[]; ultima: Execucao | null };

const CARD = 'rounded-[var(--radius)] border border-border bg-card p-6';
const SELECT = 'h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm font-medium text-foreground outline-none focus:border-primary/60';
const IGNORAR = new Set(['centro', 'av', 'avenida']);

/** Sugere o cliente "Sorrifácil <clínica>" — quem tem todas as palavras e menos sobra. */
function sugerirCliente(clinica: string, clients: Client[]): Client | null {
  const tokens = normalizeClientName(clinica).split(' ').filter(t => t && !IGNORAR.has(t));
  if (tokens.length === 0) return null;
  const candidatos = clients
    .map(c => ({ c, t: normalizeClientName(c.name).split(' ') }))
    .filter(x => x.t.includes('sorrifacil') && tokens.every(t => x.t.includes(t)))
    .sort((a, b) => a.t.length - b.t.length);
  return candidatos[0]?.c ?? null;
}

function fmtData(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export default function SorrifacilPage() {
  const router = useRouter();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [clinicas, setClinicas] = useState<string[]>([]);
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [ativo, setAtivo] = useState(false);
  const [busy, setBusy] = useState<'' | 'testar' | 'salvar' | 'sync'>('');
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch('/api/sorrifacil/config', { headers: callerHeaders() });
    const d = await r.json() as Config & { error?: string };
    if (!r.ok) { setBanner({ type: 'err', msg: d.error ?? 'Falha ao carregar.' }); return; }
    setCfg(d);
    setUsuario(d.usuario);
    setAtivo(d.ativo);
    setMapa(Object.fromEntries(d.mapa.map(m => [m.clinica, m.clientId])));
    setClinicas(prev => [...new Set([...prev, ...d.mapa.map(m => m.clinica)])].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  }, []);

  useEffect(() => {
    carregar().catch(() => setBanner({ type: 'err', msg: 'Falha ao carregar.' }));
    fetch('/api/clients', { headers: callerHeaders() })
      .then(r => r.json())
      .then(rows => setClients(Array.isArray(rows) ? rows.filter((c: Client) => c.status !== 'Arquivado' && c.status !== 'Inativo') : []))
      .catch(() => {});
  }, [carregar]);

  const clientesOrdenados = useMemo(() => [...clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [clients]);
  const nomeCliente = (id: string) => clients.find(c => c.id === id)?.name ?? '';
  const mapeadas = Object.values(mapa).filter(Boolean).length;

  async function testar() {
    setBusy('testar'); setBanner(null);
    try {
      const r = await fetch('/api/sorrifacil/config', {
        method: 'PUT', headers: { ...callerHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, senha: senha || undefined }),
      });
      const d = await r.json() as { ok: boolean; clinicas?: string[]; error?: string };
      if (!d.ok) { setBanner({ type: 'err', msg: d.error ?? 'Falha no login.' }); return; }
      const lista = d.clinicas ?? [];
      setClinicas(lista);
      // Primeira vez: sugere pelo nome. De-para já salvo nunca é sobrescrito.
      setMapa(prev => {
        if (Object.values(prev).some(Boolean)) return prev;
        const novo: Record<string, string> = {};
        for (const c of lista) { const s = sugerirCliente(c, clients); if (s) novo[c] = s.id; }
        return novo;
      });
      setBanner({ type: 'ok', msg: `Login OK — ${lista.length} clínicas encontradas no CRM. Confira o de-para e salve.` });
    } finally { setBusy(''); }
  }

  async function salvar(novoAtivo = ativo) {
    setBusy('salvar'); setBanner(null);
    try {
      const body = {
        usuario, senha: senha || undefined, ativo: novoAtivo,
        mapa: Object.entries(mapa).filter(([, id]) => id).map(([clinica, clientId]) => ({ clinica, clientId, clientName: nomeCliente(clientId) })),
      };
      const r = await fetch('/api/sorrifacil/config', {
        method: 'POST', headers: { ...callerHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok) { setBanner({ type: 'err', msg: d.error ?? 'Falha ao salvar.' }); return; }
      setSenha('');
      setAtivo(novoAtivo);
      await carregar();
      setBanner({ type: 'ok', msg: 'Configuração salva.' });
    } finally { setBusy(''); }
  }

  async function sincronizar() {
    setBusy('sync'); setBanner(null);
    try {
      const r = await fetch('/api/crm/sync-cron/sorrifacil', { method: 'POST', headers: callerHeaders() });
      const d = await r.json() as Execucao & { error?: string };
      await carregar();
      setBanner(d.ok
        ? { type: 'ok', msg: 'Planilhas baixadas e importadas.' }
        : { type: 'err', msg: d.erro ?? d.error ?? 'Parte da importação falhou — veja o detalhe abaixo.' });
    } finally { setBusy(''); }
  }

  const ultima = cfg?.ultima ?? null;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => router.push('/configuracoes?tab=integracoes')} aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-heading font-normal text-xl uppercase leading-none tracking-wide text-foreground">CRM Sorrifácil</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Todo dia o sistema entra no CRM, baixa as planilhas de Faturamento e Leads e importa nos clientes certos.
            </p>
          </div>
        </div>
        {cfg && (
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-bold ${
            ativo ? 'border-primary/35 bg-primary/12 text-primary' : 'border-border bg-muted/30 text-muted-foreground'
          }`}>
            {ativo ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {ativo ? 'Rotina diária ligada' : 'Rotina diária desligada'}
          </span>
        )}
      </div>

      {banner && (
        <div className={`flex items-center gap-2 rounded-[var(--radius)] border px-4 py-3 text-sm font-medium ${
          banner.type === 'ok' ? 'border-primary/35 bg-primary/10 text-primary' : 'border-red-500/30 bg-red-500/10 text-red-400'
        }`}>
          {banner.type === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          <span>{banner.msg}</span>
          <button onClick={() => setBanner(null)} className="ml-auto text-xs opacity-70 hover:opacity-100">fechar</button>
        </div>
      )}

      {/* 1. Login */}
      <section className={CARD}>
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">1 · Acesso ao CRM</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Usuário</span>
            <Input value={usuario} onChange={e => setUsuario(e.target.value)} autoComplete="off" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Senha</span>
            <Input
              type="password" value={senha} onChange={e => setSenha(e.target.value)} autoComplete="new-password"
              placeholder={cfg?.tem_senha ? '•••••••• (guardada — deixe vazio pra manter)' : ''}
            />
          </label>
          <Button className="self-end" variant="outline" onClick={testar} disabled={!!busy || !usuario || (!senha && !cfg?.tem_senha)}>
            {busy === 'testar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            Testar e buscar clínicas
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">A senha fica guardada cifrada no servidor e nunca volta para a tela.</p>
      </section>

      {/* 2. De-para */}
      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">2 · Clínica do CRM → cliente no Reports</h2>
          <span className="text-xs text-muted-foreground">{mapeadas} de {clinicas.length} clínicas importadas</span>
        </div>
        {clinicas.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Clique em “Testar e buscar clínicas” para listar as clínicas do CRM.</p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    <th className="px-2 py-2">Clínica no CRM</th>
                    <th className="px-2 py-2">Cliente no Reports</th>
                  </tr>
                </thead>
                <tbody>
                  {clinicas.map(c => (
                    <tr key={c} className="border-b border-border/50 last:border-0">
                      <td className="px-2 py-2 font-semibold text-foreground">{c}</td>
                      <td className="px-2 py-2">
                        <select className={SELECT} value={mapa[c] ?? ''} onChange={e => setMapa(m => ({ ...m, [c]: e.target.value }))}>
                          <option value="">— não importar —</option>
                          {clientesOrdenados.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              onClick={() => setMapa(Object.fromEntries(clinicas.map(c => [c, sugerirCliente(c, clients)?.id ?? ''])))}
            >
              <Wand2 className="h-3.5 w-3.5" /> Sugerir pelo nome
            </button>
          </>
        )}
      </section>

      {/* 3. Rotina */}
      <section className={CARD}>
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">3 · Rotina</h2>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          <li>• Roda todo dia às 06h (horário de Brasília) e importa o mês atual.</li>
          <li>• Nos dias 1 a 5 também reimporta o mês anterior, para fechar as vendas do fim do mês.</li>
          <li>• Faturamento pela data de faturamento; leads com a situação como etapa do funil.</li>
          <li>• Só entram os canais digitais (WhatsApp, Facebook, Instagram, Google, Site), igual à importação manual.</li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={() => salvar()} disabled={!!busy || !usuario}>
            {busy === 'salvar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Salvar
          </Button>
          <Button variant="outline" onClick={() => salvar(!ativo)} disabled={!!busy || !usuario || mapeadas === 0}>
            {ativo ? 'Desligar rotina diária' : 'Ligar rotina diária'}
          </Button>
          <Button variant="outline" onClick={sincronizar} disabled={!!busy || !cfg?.tem_senha || (cfg?.mapa.length ?? 0) === 0}>
            {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {busy === 'sync' ? 'Importando… (pode levar alguns minutos)' : 'Sincronizar agora'}
          </Button>
        </div>
      </section>

      {/* Última execução */}
      {ultima && (
        <section className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Última execução</h2>
            <span className={`text-xs font-bold ${ultima.ok ? 'text-primary' : 'text-red-400'}`}>
              {ultima.ok ? 'OK' : 'Com erro'} · {fmtData(ultima.iniciado_em)} · {Math.round(ultima.duracao_ms / 1000)}s
            </span>
          </div>
          {ultima.erro && <p className="mt-3 text-sm text-red-400">{ultima.erro}</p>}
          <div className="mt-3 space-y-3">
            {ultima.relatorios.map(r => (
              <div key={`${r.tipo}-${r.mes}`} className="rounded-[var(--radius)] border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-foreground">{r.tipo} · {r.mes}</span>
                  <span className={r.ok ? 'text-primary' : 'text-red-400'}>
                    {r.ok ? `${r.linhas} linhas lidas` : r.erro}
                  </span>
                </div>
                {r.ok && r.resultado && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {Object.entries(r.resultado).map(([clinica, n]) => `${clinica}: ${n}`).join(' · ') || 'nenhuma linha das clínicas mapeadas'}
                    {r.descartadas_origem ? ` · ${r.descartadas_origem} fora dos canais digitais` : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
