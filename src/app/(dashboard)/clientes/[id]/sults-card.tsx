"use client";

/**
 * Card de configuração da integração SULTS — sub-aba da aba Rastreio.
 *
 * Fluxo igual ao do Agendor: cola o token do cliente e o sistema resolve o
 * resto. A diferença é que a API do SULTS não publica endpoint para listar
 * funis, etapas, responsáveis ou origens — a doc manda copiar os ids na tela de
 * Parâmetros. Aqui o catálogo é DEDUZIDO de uma amostra de negócios, então
 * quem configura escolhe em menu em vez de copiar número.
 *
 * ⚠️ O menu é conveniência, não gaiola: etapa recém-criada e ainda sem negócio
 * nenhum não aparece na amostra, por isso todo campo aceita id digitado.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Loader2, Plug, RefreshCw, Trash2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Item = { id: number; nome: string; qtd: number };
type ValorCanal = { valor: string; qtd: string };
type Canais = { canal: ValorCanal[]; origin: ValorCanal[] };
type Funil = Item & { etapas: Item[] };
type Catalogo = {
  funis: Funil[]; responsaveis: Item[]; origens: Item[]; campanhas: Item[]; amostra: number;
};

type Config = {
  conectado: boolean;
  enabled?: boolean;
  sync_ativo?: boolean;
  ingerir_crm?: boolean;
  api_token_masked?: string | null;
  responsavel_id?: number | null;
  etapa_id?: number | null;
  funil_id?: number | null;
  origem_id?: number | null;
  mapa_origem?: Record<string, number> | null;
  desde?: string | null;
  ultima_varredura_em?: string | null;
  ultimo_erro?: string | null;
  ultima_volta_em?: string | null;
  ultimo_erro_volta?: string | null;
  stats?: Record<string, string>;
  canais?: Canais;
  erro?: string;
};

function fmt(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  try {
    return new Date(iso).toLocaleString('pt-BR',
      { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

const CAMPO = 'h-9 w-full rounded-none border border-border bg-surface-elevated px-2 text-sm';

/** Espelha o checklist do próprio SULTS: o que falta para a integração funcionar. */
function Prontidao({ cfg }: { cfg: Config }) {
  const itens = [
    { ok: !!cfg.api_token_masked, label: 'Token', falta: 'conecte o token v1' },
    { ok: !!cfg.responsavel_id, label: 'Responsável', falta: 'escolha quem recebe os leads' },
    { ok: !!cfg.etapa_id, label: 'Etapa de entrada', falta: 'escolha onde o lead cai' },
    {
      ok: !!(cfg.mapa_origem && Object.keys(cfg.mapa_origem).length) || !!cfg.origem_id,
      aviso: true,
      label: 'Origem',
      falta: 'sem mapa, o negócio nasce sem origem no SULTS',
    },
  ];
  return (
    <div className="space-y-1">
      {itens.map(i => (
        <div key={i.label} className="flex items-start gap-2 text-xs">
          {i.ok
            ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            : i.aviso
              ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />}
          <span className={i.ok ? 'text-foreground' : 'text-muted-foreground'}>
            {i.label}
            {!i.ok && <span className="text-muted-foreground"> — {i.falta}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

type Linha = { canal: string; origemId: number; livre?: boolean };

const OUTRO = '__outro__';

/**
 * canal do nosso CRM → origemId do SULTS.
 *
 * ⚠️ O estado é LOCAL e só sobe ao servidor no blur (ou ao trocar o menu, que
 * já é uma decisão fechada). A primeira versão gravava a cada tecla — digitar
 * "landing page" disparava 12 PATCHes — e descartava a linha enquanto o nome
 * estivesse vazio, então ela sumia na cara de quem acabou de criá-la.
 */
function MapaOrigem({ valor, origens, canais, aoMudar }: {
  valor: Record<string, number> | null | undefined;
  origens: Item[];
  canais: Canais | undefined;
  aoMudar: (v: Record<string, number>) => void;
}) {
  const doCliente = [...(canais?.canal ?? []), ...(canais?.origin ?? [])].map(c => c.valor);
  const [linhas, setLinhas] = useState<Linha[]>(
    () => Object.entries(valor ?? {}).map(([canal, origemId]) => ({
      canal,
      origemId: Number(origemId),
      // Mapeamento gravado para um canal que não aparece mais na base do
      // cliente continua editável como texto — some do menu, não do mapa.
      livre: !doCliente.includes(canal),
    })),
  );

  const salvar = (ls: Linha[]) => {
    // Minúsculas na gravação: é assim que `origemSults` compara. Guardar
    // "Landing Page" e comparar com "landing page" nunca casaria.
    const limpo = ls.filter(l => l.canal.trim() && l.origemId > 0);
    aoMudar(Object.fromEntries(limpo.map(l => [l.canal.trim().toLowerCase(), l.origemId])));
  };

  const mexer = (i: number, campo: Partial<Linha>, salvarAgora: boolean) => {
    const novo = linhas.map((l, j) => (j === i ? { ...l, ...campo } : l));
    setLinhas(novo);
    if (salvarAgora) salvar(novo);
  };

  return (
    <div className="space-y-1.5">
      {linhas.map((l, i) => (
        <div key={i} className="flex gap-1.5">
          {l.livre ? (
            <input
              className={CAMPO} value={l.canal} autoFocus
              placeholder="nome do canal"
              onChange={e => mexer(i, { canal: e.target.value }, false)}
              onBlur={() => salvar(linhas)}
            />
          ) : (
            <select
              className={CAMPO} value={l.canal}
              onChange={e => e.target.value === OUTRO
                ? mexer(i, { canal: '', livre: true }, false)
                : mexer(i, { canal: e.target.value }, true)}
            >
              <option value="">— escolha o canal —</option>
              {!!canais?.canal.length && (
                <optgroup label="Canal do lead">
                  {canais.canal.map(c => (
                    <option key={`c-${c.valor}`} value={c.valor}>{c.valor} ({c.qtd})</option>
                  ))}
                </optgroup>
              )}
              {!!canais?.origin.length && (
                <optgroup label="Origem do lead">
                  {canais.origin.map(c => (
                    <option key={`o-${c.valor}`} value={c.valor}>{c.valor} ({c.qtd})</option>
                  ))}
                </optgroup>
              )}
              <option value={OUTRO}>Outro (digitar)…</option>
            </select>
          )}
          <select
            className={CAMPO} value={String(l.origemId)}
            onChange={e => mexer(i, { origemId: Number(e.target.value) }, true)}
          >
            {origens.map(o => <option key={o.id} value={o.id}>{o.nome} ({o.id})</option>)}
          </select>
          <button
            type="button" title="remover"
            className="px-2 text-muted-foreground hover:text-red-400"
            onClick={() => { const novo = linhas.filter((_, j) => j !== i); setLinhas(novo); salvar(novo); }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <button
        type="button"
        className="text-[11px] font-bold uppercase tracking-widest text-primary hover:underline disabled:opacity-40"
        onClick={() => setLinhas([...linhas, { canal: '', origemId: origens[0]?.id ?? 0, livre: false }])}
        disabled={!origens.length}
      >
        + adicionar canal
      </button>

      <p className="text-[11px] text-muted-foreground">
        À esquerda, os canais que <strong>já existem nos leads deste cliente</strong>, com a
        quantidade de cada um. À direita, a origem correspondente <strong>no SULTS</strong>.
        O envio testa o <code>canal</code> do lead e, se não casar, o <code>origin</code> —
        por isso os dois aparecem separados no menu. Canal que não casar entra
        <strong>sem origem</strong>, que é melhor que um rótulo chutado.
      </p>
    </div>
  );
}

export default function SultsCard({ clientId }: { clientId: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [token, setToken] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/sults`);
      setCfg(await r.json());
    } catch { setCfg({ conectado: false, erro: 'falha ao carregar' }); }
    setCarregando(false);
  }, [clientId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const buscarCatalogo = useCallback(async () => {
    setOcupado(true); setMsg('Lendo o funil do cliente…');
    try {
      const r = await fetch(`/api/clients/${clientId}/sults?catalogo=1`);
      const d = await r.json();
      if (d.erro) setMsg(d.erro); else { setCat(d); setMsg(`Catálogo lido de ${d.amostra} negócios.`); }
    } catch { setMsg('Falha ao ler o catálogo.'); }
    setOcupado(false);
  }, [clientId]);

  const conectar = async () => {
    setOcupado(true); setMsg('');
    const r = await fetch(`/api/clients/${clientId}/sults`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiToken: token.trim() }),
    });
    const d = await r.json();
    setOcupado(false);
    if (d.erro) { setMsg(d.erro); return; }
    setCfg(d); setToken(''); setMsg('Token validado.');
    void buscarCatalogo();
  };

  const patch = async (campos: Record<string, unknown>) => {
    setOcupado(true);
    const r = await fetch(`/api/clients/${clientId}/sults`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campos),
    });
    const d = await r.json();
    setOcupado(false);
    if (d.erro) setMsg(d.erro); else { setCfg(d); setMsg('Salvo.'); }
  };

  /** Roda agora, sem esperar o cron — é o "quando quisermos". */
  const rodarAgora = async (acao: 'sincronizar' | 'enviar') => {
    setOcupado(true);
    setMsg(acao === 'sincronizar' ? 'Lendo o funil no SULTS…' : 'Enviando a fila…');
    try {
      const r = await fetch(`/api/clients/${clientId}/sults`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      });
      const d = await r.json();
      if (d.erro) { setMsg(d.erro); } else {
        setCfg(d);
        const res = d.resultado;
        if (!res) {
          // Sem resultado = a conexão não entrou na varredura. Antes isso
          // aparecia como "0 negócios lidos", indistinguível de funil vazio.
          setMsg(acao === 'sincronizar'
            ? 'A conexão não entrou na varredura — confira se a Volta está Ativa e o token salvo.'
            : 'A conexão não entrou na fila — a Ida precisa estar Ativa, com responsável e etapa escolhidos.');
          setOcupado(false);
          return;
        }
        const crm = (res.leadsCriados || res.leadsAtualizados || res.errosCrm)
          ? ` · CRM: ${res.leadsCriados ?? 0} leads criados, ${res.leadsAtualizados ?? 0} atualizados${res.errosCrm ? `, ${res.errosCrm} com erro` : ''}`
          : '';
        setMsg(acao === 'sincronizar'
          ? `${res.lidos ?? 0} negócios lidos · ${res.movimentos ?? 0} movimentações novas${crm}`
            + `${res.varreduraCompleta === false ? ' — parcial, o cron continua de onde parou' : ''}`
          : `${res.enviados ?? 0} enviados · ${res.descartados ?? 0} descartados · ${res.erros ?? 0} com erro`);
      }
    } catch { setMsg('Falhou.'); }
    setOcupado(false);
  };

  const desconectar = async () => {
    if (!confirm('Desconectar o SULTS deste cliente?\n\nO histórico já enviado é preservado — isso evita que reconectar recrie negócios que já existem no CRM do cliente.')) return;
    setOcupado(true);
    await fetch(`/api/clients/${clientId}/sults`, { method: 'DELETE' });
    setOcupado(false); setCat(null); void carregar();
  };

  if (carregando) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
    </div>;
  }

  if (!cfg?.conectado) {
    return (
      <div className="max-w-xl space-y-3 border border-border bg-card p-4">
        <h3 className="font-heading text-sm font-black uppercase tracking-widest">Conectar SULTS</h3>
        <p className="text-xs text-muted-foreground">
          Cole o token da API do SULTS deste cliente. ⚠️ Precisa ser <strong>v1</strong> — o
          token v2 não funciona nos endpoints de Expansão, e o erro aparece como
          &ldquo;token recusado&rdquo;.
        </p>
        <div className="flex gap-2">
          <input
            className={CAMPO} value={token} placeholder="token do SULTS"
            onChange={e => setToken(e.target.value)}
          />
          <button
            type="button" disabled={!token.trim() || ocupado}
            onClick={conectar}
            className="flex h-9 shrink-0 items-center gap-1.5 bg-primary px-3 text-xs font-bold uppercase tracking-widest text-black disabled:opacity-40"
          >
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
            Conectar
          </button>
        </div>
        {msg && <p className="text-xs text-amber-400">{msg}</p>}
      </div>
    );
  }

  const funilSel = cat?.funis.find(f => f.id === cfg.funil_id);
  const etapas = funilSel?.etapas ?? cat?.funis.flatMap(f => f.etapas) ?? [];
  const pronto = !!cfg.responsavel_id && !!cfg.etapa_id;
  const s = cfg.stats ?? {};

  return (
    <div className="max-w-3xl space-y-4">
      <div className="border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading text-sm font-black uppercase tracking-widest">
            SULTS <span className="text-muted-foreground">· {cfg.api_token_masked}</span>
          </h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={buscarCatalogo} disabled={ocupado}
              className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
              <RefreshCw className={cn('h-3 w-3', ocupado && 'animate-spin')} /> Reler funil
            </button>
            <button type="button" onClick={desconectar}
              className="text-[11px] font-bold uppercase tracking-widest text-red-400 hover:underline">
              Desconectar
            </button>
          </div>
        </div>

        <Prontidao cfg={cfg} />

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Funil</span>
            <select className={CAMPO} value={String(cfg.funil_id ?? '')}
              onChange={e => patch({ funil_id: e.target.value || null, etapa_id: null })}>
              <option value="">Todos os funis</option>
              {(cat?.funis ?? []).map(f => (
                <option key={f.id} value={f.id} title={`id ${f.id}`}>
                  {f.nome} — {f.qtd} negócios
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapa de entrada</span>
            <select className={CAMPO} value={String(cfg.etapa_id ?? '')}
              onChange={e => patch({ etapa_id: e.target.value || null })}>
              <option value="">— escolha —</option>
              {etapas.map(e => (
                <option key={e.id} value={e.id} title={`id ${e.id}`}>
                  {e.nome} — {e.qtd} negócios
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Responsável</span>
            <select className={CAMPO} value={String(cfg.responsavel_id ?? '')}
              onChange={e => patch({ responsavel_id: e.target.value || null })}>
              <option value="">— escolha —</option>
              {(cat?.responsaveis ?? []).map(r => (
                <option key={r.id} value={r.id} title={`id ${r.id}`}>
                  {r.nome} — {r.qtd} negócios
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Enviar leads a partir de
            </span>
            <input type="date" className={CAMPO}
              value={(cfg.desde ?? '').slice(0, 10)}
              onChange={e => e.target.value && patch({ desde: e.target.value })} />
          </label>
        </div>

        <p className="mt-2 text-[11px] text-amber-400">
          ⚠️ Recuar a data despeja o histórico de leads no CRM do cliente. A API do SULTS
          não deixa apagar negócio — a limpeza seria manual, um por um. Recue um dia por vez.
        </p>

        <div className="mt-4 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Origem por canal
          </span>
          <MapaOrigem
            valor={cfg.mapa_origem} origens={cat?.origens ?? []} canais={cfg.canais}
            aoMudar={v => patch({ mapa_origem: v })}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-heading text-xs font-black uppercase tracking-widest">
              Ida — leads para o SULTS
            </span>
            <button type="button" disabled={!pronto || ocupado}
              onClick={() => patch({ enabled: !cfg.enabled })}
              className={cn('px-2 py-1 text-[10px] font-bold uppercase tracking-widest',
                cfg.enabled ? 'bg-primary text-black' : 'bg-muted text-muted-foreground',
                !pronto && 'cursor-not-allowed opacity-40')}>
              {cfg.enabled ? 'Ativa' : 'Desativada'}
            </button>
          </div>
          {!pronto && (
            <p className="mb-2 text-[11px] text-amber-400">
              Escolha responsável e etapa antes de ligar — sem eles o SULTS recusa o
              negócio e a fila entraria em retry até desistir.
            </p>
          )}
          <dl className="space-y-0.5 text-xs text-muted-foreground">
            <div>na fila: <strong className="text-foreground">{s.fila ?? '0'}</strong></div>
            <div>enviados: <strong className="text-foreground">{s.enviados ?? '0'}</strong></div>
            <div>descartados: {s.descartados ?? '0'} · falhas: {s.falhas ?? '0'}</div>
            {Number(s.presos ?? 0) > 0 && (
              <div className="text-amber-400">presos em envio: {s.presos} — exigem conferência manual</div>
            )}
            <div>última rodada: {fmt(cfg.ultima_varredura_em)}</div>
          </dl>
          {cfg.ultimo_erro && <p className="mt-2 text-[11px] text-red-400">{cfg.ultimo_erro}</p>}
          <button type="button" disabled={!cfg.enabled || ocupado}
            onClick={() => rodarAgora('enviar')}
            className="mt-3 flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-primary hover:underline disabled:opacity-40">
            <RefreshCw className={cn('h-3 w-3', ocupado && 'animate-spin')} /> Enviar agora
          </button>
        </div>

        <div className="border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-heading text-xs font-black uppercase tracking-widest">
              Volta — etapas para o reports
            </span>
            <button type="button" disabled={ocupado}
              onClick={() => patch({ sync_ativo: !cfg.sync_ativo })}
              className={cn('px-2 py-1 text-[10px] font-bold uppercase tracking-widest',
                cfg.sync_ativo ? 'bg-primary text-black' : 'bg-muted text-muted-foreground')}>
              {cfg.sync_ativo ? 'Ativa' : 'Desativada'}
            </button>
          </div>
          <dl className="space-y-0.5 text-xs text-muted-foreground">
            <div>negócios espelhados: <strong className="text-foreground">{s.negocios ?? '0'}</strong></div>
            <div>movimentações registradas: <strong className="text-foreground">{s.movimentos ?? '0'}</strong></div>
            <div>última varredura: {fmt(cfg.ultima_volta_em)}</div>
          </dl>
          {cfg.ultimo_erro_volta && <p className="mt-2 text-[11px] text-red-400">{cfg.ultimo_erro_volta}</p>}
          <button type="button" disabled={!cfg.sync_ativo || ocupado}
            onClick={() => rodarAgora('sincronizar')}
            className="mt-3 flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-primary hover:underline disabled:opacity-40">
            <RefreshCw className={cn('h-3 w-3', ocupado && 'animate-spin')} /> Sincronizar agora
          </button>
          <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-border pt-3">
            <input
              type="checkbox" className="mt-0.5" checked={!!cfg.ingerir_crm} disabled={ocupado}
              onChange={e => patch({ ingerir_crm: e.target.checked })}
            />
            <span className="text-[11px] leading-snug">
              <strong className="text-foreground">Alimentar o CRM e a dashboard daqui</strong>
              <span className="block text-muted-foreground">
                Cada negócio do SULTS vira lead no CRM deste cliente, e a etapa de lá
                passa a mandar no status daqui. Funil, dashboard e Performance Comercial
                passam a mostrar a operação do cliente.
              </span>
            </span>
          </label>
          {cfg.ingerir_crm ? (
            <p className="mt-2 text-[11px] text-amber-400">
              ⚠️ A etapa do SULTS <strong>sobrescreve</strong> o status do lead aqui. Ligue
              só para cliente que qualifica dentro do SULTS — senão o Kanban e o
              follow-up daqui vão brigar com ele.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Desligado, o espelho fica isolado: nada toca o status do lead no CRM daqui.
            </p>
          )}
        </div>
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
