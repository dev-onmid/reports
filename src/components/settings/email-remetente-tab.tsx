"use client";

/**
 * De qual endereço saem os e-mails do sistema — avisos de lead e alertas.
 *
 * Nasceu quando o token OAuth do Gmail foi revogado em silêncio e TODO aviso
 * por e-mail ficou mudo por meses, com a tela dizendo "conectado". Aqui a
 * pergunta "quem está enviando agora?" tem resposta visível, e o teste manda
 * uma mensagem de verdade em vez de checar configuração no papel.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Mail, Send, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

type Estado = {
  smtp: {
    host: string; port: number; secure: boolean; user: string;
    fromNome: string | null; fromEmail: string | null; temSenha: boolean;
  } | null;
  gmail: string | null;
  valendo: 'smtp' | 'gmail' | 'nenhum';
};

// Hostinger/Titan é onde ficam as caixas da agência — poupa procurar na ajuda deles.
const PRESET_TITAN = { host: 'smtp.titan.email', port: 465, secure: true };

const campo = 'h-9 w-full rounded-md border border-border bg-background px-3 text-sm';
const rotulo = 'text-[10px] font-bold uppercase tracking-widest text-muted-foreground';

export default function EmailRemetenteTab() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [host, setHost] = useState(PRESET_TITAN.host);
  const [porta, setPorta] = useState(String(PRESET_TITAN.port));
  const [user, setUser] = useState('');
  const [senha, setSenha] = useState('');
  const [fromNome, setFromNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [testePara, setTestePara] = useState('');
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch('/api/settings/email');
      const d: Estado = await r.json();
      setEstado(d);
      if (d.smtp) {
        setHost(d.smtp.host); setPorta(String(d.smtp.port)); setUser(d.smtp.user);
        setFromNome(d.smtp.fromNome ?? '');
      }
      if (!testePara) setTestePara(d.gmail ?? '');
    } catch { /* deixa a tela como está */ }
    setCarregando(false);
  }, [testePara]);

  useEffect(() => { void carregar(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function salvar(tambemTestar: boolean) {
    if (tambemTestar) setTestando(true); else setSalvando(true);
    setResultado(null);
    const corpo: Record<string, unknown> = {
      host, port: Number(porta) || 465, secure: Number(porta) === 465,
      user, fromNome, fromEmail: user,
    };
    // senha em branco = manter a que já está guardada (o GET nunca a devolve)
    if (senha) corpo.senha = senha;
    if (tambemTestar) { corpo.testar = true; corpo.para = testePara; }

    const r = await fetch('/api/settings/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }).catch(() => null);
    const d = await r?.json().catch(() => ({}));

    if (!r?.ok) {
      setResultado({ ok: false, texto: d?.error ?? 'Não foi possível salvar' });
    } else if (tambemTestar) {
      setResultado(d?.ok
        ? { ok: true, texto: `Mensagem enviada para ${testePara} — confira a caixa (inclusive o spam).` }
        : { ok: false, texto: `Não enviou: ${d?.erro ?? 'motivo não informado'}` });
    } else {
      setSalvo(true); setTimeout(() => setSalvo(false), 2500);
    }
    setSenha('');
    setSalvando(false); setTestando(false);
    await carregar();
  }

  async function remover() {
    if (!confirm('Remover o remetente próprio?\n\nOs e-mails voltam a sair pela conta do Gmail conectada.')) return;
    await fetch('/api/settings/email', { method: 'DELETE' }).catch(() => {});
    setUser(''); setSenha(''); setFromNome('');
    await carregar();
  }

  const valendo = estado?.valendo ?? 'nenhum';

  return (
    <div className="space-y-4">
      {/* quem está enviando agora */}
      <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3',
        valendo === 'nenhum' ? 'border-red-500/40 bg-red-500/5' : 'border-border bg-card')}>
        {valendo === 'nenhum'
          ? <TriangleAlert className="h-4 w-4 shrink-0 text-red-400" />
          : <Mail className="h-4 w-4 shrink-0 text-primary" />}
        <div className="min-w-0 flex-1">
          <p className={rotulo}>Enviando agora</p>
          <p className="text-sm font-semibold">
            {carregando ? 'verificando…'
              : valendo === 'smtp' ? `${estado?.smtp?.fromEmail || estado?.smtp?.user} (servidor próprio)`
              : valendo === 'gmail' ? `${estado?.gmail} (Gmail conectado)`
              : 'Ninguém — nenhum e-mail está saindo'}
          </p>
        </div>
        {estado?.smtp && (
          <button onClick={() => void remover()}
                  className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-red-400">
            <Trash2 className="h-3.5 w-3.5" /> Remover
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Remetente próprio (servidor de e-mail)</h3>
          <p className="text-xs text-muted-foreground">
            Uma caixa da agência — ex.: leads@onmid.com.br. Diferente da conexão do Google, a senha
            não vence sozinha.
          </p>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className={rotulo}>E-mail (usuário)</label>
              <input value={user} onChange={e => setUser(e.target.value)}
                     placeholder="leads@onmid.com.br" className={campo} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <label className={rotulo}>
                Senha {estado?.smtp?.temSenha && <span className="font-normal normal-case tracking-normal text-emerald-400">· já guardada</span>}
              </label>
              <input type="password" value={senha} onChange={e => setSenha(e.target.value)}
                     placeholder={estado?.smtp?.temSenha ? 'deixe em branco para manter' : 'senha da caixa de e-mail'}
                     className={campo} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <label className={rotulo}>Nome que aparece</label>
              <input value={fromNome} onChange={e => setFromNome(e.target.value)}
                     placeholder="ONMID" className={campo} />
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <div className="space-y-1.5">
                <label className={rotulo}>Servidor</label>
                <input value={host} onChange={e => setHost(e.target.value)} className={campo} />
              </div>
              <div className="space-y-1.5">
                <label className={rotulo}>Porta</label>
                <input value={porta} onChange={e => setPorta(e.target.value)} className={campo} inputMode="numeric" />
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Servidor e porta já vêm preenchidos para caixas da Hostinger/Titan. Só troque se o seu
            provedor for outro.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void salvar(false)} disabled={salvando || !user}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : salvo ? <Check className="h-4 w-4" /> : null}
              {salvo ? 'Salvo' : 'Salvar'}
            </button>
            <span className="text-xs text-muted-foreground">Testar enviando para</span>
            <input value={testePara} onChange={e => setTestePara(e.target.value)}
                   placeholder="seu@email.com" className={cn(campo, 'h-9 w-auto min-w-[200px] flex-1')} />
            <button onClick={() => void salvar(true)} disabled={testando || !user || !testePara}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium disabled:opacity-50">
              {testando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Salvar e testar
            </button>
          </div>

          {resultado && (
            <p className={cn('rounded-md px-3 py-2 text-xs',
              resultado.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
              {resultado.texto}
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Vale para todos os e-mails do sistema: aviso de lead novo de landing page, alerta de saldo
        baixo, Webshare e instância de WhatsApp desconectada. Sem remetente próprio, o envio usa a
        conta do Google conectada em Integrações.
      </p>
    </div>
  );
}
