"use client";

/**
 * Peças da OPERAÇÃO do dia a dia no CRM (2026-10-09), pensadas para quem atende
 * — recepção de clínica, vendedor de franquia — e não para a agência:
 *
 * - CamposAtendimento: responsável, agendamento com HORA, compareceu e a
 *   próxima ação com prazo. Era o que faltava para a recepção trabalhar no CRM
 *   em vez de num caderno ao lado.
 * - HistoricoLead: quem fez o quê no lead, e quando (crm_lead_eventos + IA).
 * - NovoLeadModal: criar lead pelo Kanban (o botão antigo só funcionava na
 *   visão Lista) avisando quando o telefone já existe.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, History, X, UserRound, CalendarClock, ListTodo, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CAMPOS_ACOMPANHADOS } from '@/lib/crm-eventos';

const rotulo = 'text-[10px] font-bold uppercase tracking-widest text-muted-foreground';
const campo = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary';

/** Origens oferecidas no CRM. Valor antigo fora da lista continua aparecendo. */
export const ORIGENS = ['Whatsapp', 'Instagram', 'Facebook', 'Google', 'Site', 'Indicação', 'Fachada', 'Telefone', 'Cliente antigo', 'TikTok', 'YouTube', 'Outro'];

export function opcoesDeOrigem(atual: string | null | undefined): string[] {
  const v = (atual ?? '').trim();
  return v && !ORIGENS.some(o => o.toLowerCase() === v.toLowerCase()) ? [v, ...ORIGENS] : ORIGENS;
}

/** Nomes que podem ser responsáveis pelo lead (usuários do cliente + já usados). */
export function useEquipe(clientId: string | undefined): string[] {
  const [nomes, setNomes] = useState<string[]>([]);
  useEffect(() => {
    if (!clientId) return;
    let vivo = true;
    fetch(`/api/crm/equipe?clientId=${encodeURIComponent(clientId)}`)
      .then(r => r.ok ? r.json() as Promise<{ nomes: string[] }> : { nomes: [] })
      .then(d => { if (vivo) setNomes(d.nomes ?? []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [clientId]);
  return nomes;
}

function paraInputDataHora(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function paraInputData(v: string | null | undefined): string {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

type CamposDraft = {
  responsavel?: string | null;
  data_agendada?: string | null;
  hora_agendada?: string | null;
  compareceu?: boolean;
  proxima_acao?: string | null;
  proxima_acao_em?: string | null;
};

export function CamposAtendimento({ draft, set, clientId }: {
  draft: CamposDraft;
  set: (k: keyof CamposDraft, v: string | boolean | null) => void;
  clientId?: string;
}) {
  const equipe = useEquipe(clientId);
  const [agora] = useState(() => Date.now());
  const atrasada = !!draft.proxima_acao_em && new Date(draft.proxima_acao_em).getTime() < agora;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/50 p-3">
      <label className="block space-y-1">
        <span className={cn(rotulo, 'flex items-center gap-1.5')}><UserRound className="h-3 w-3" /> Responsável</span>
        <input
          list="crm-equipe"
          value={draft.responsavel ?? ''}
          onChange={e => set('responsavel', e.target.value || null)}
          placeholder="Quem cuida deste lead"
          className={campo}
        />
        <datalist id="crm-equipe">{equipe.map(n => <option key={n} value={n} />)}</datalist>
      </label>

      <div className="space-y-1">
        <span className={cn(rotulo, 'flex items-center gap-1.5')}><CalendarClock className="h-3 w-3" /> Agendamento</span>
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <input type="date" value={paraInputData(draft.data_agendada)} onChange={e => set('data_agendada', e.target.value || null)} className={campo} />
          <input type="time" value={draft.hora_agendada ?? ''} onChange={e => set('hora_agendada', e.target.value || null)}
            disabled={!draft.data_agendada} className={cn(campo, !draft.data_agendada && 'opacity-50')} />
        </div>
        {draft.data_agendada && (
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm">
            <input type="checkbox" checked={!!draft.compareceu} onChange={e => set('compareceu', e.target.checked)} className="h-4 w-4 accent-primary" />
            Compareceu
          </label>
        )}
      </div>

      <div className="space-y-1">
        <span className={cn(rotulo, 'flex items-center gap-1.5')}><ListTodo className="h-3 w-3" /> Próxima ação</span>
        <input value={draft.proxima_acao ?? ''} onChange={e => set('proxima_acao', e.target.value || null)}
          placeholder="Ex.: ligar para confirmar a consulta" className={campo} />
        <input type="datetime-local" value={paraInputDataHora(draft.proxima_acao_em)}
          onChange={e => set('proxima_acao_em', e.target.value ? new Date(e.target.value).toISOString() : null)}
          className={cn(campo, atrasada && 'border-red-500/50 text-red-300')} />
        {atrasada && <p className="flex items-center gap-1 text-[11px] text-red-300"><AlertTriangle className="h-3 w-3" /> Prazo vencido</p>}
      </div>
    </div>
  );
}

type Evento = { tipo: string; campo: string | null; de: string | null; para: string | null; autor_nome: string | null; created_at: string };

function descreverEvento(e: Evento): string {
  if (e.tipo === 'criado') return `criou o lead${e.para ? ` (${e.para})` : ''}`;
  if (e.tipo === 'excluido') return 'excluiu o lead';
  const nome = e.campo ? (CAMPOS_ACOMPANHADOS[e.campo] ?? e.campo) : 'campo';
  const fmt = (v: string | null) => {
    if (v === null || v === '') return 'vazio';
    if (e.campo === 'proxima_acao_em' || /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v); if (!Number.isNaN(d.getTime())) return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }
    if (e.campo === 'data_agendada' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('/');
    if (e.campo === 'valor_rs') { const n = Number(v); if (Number.isFinite(n)) return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
    return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  };
  if (e.tipo === 'etapa') return `moveu de "${fmt(e.de)}" para "${fmt(e.para)}"`;
  return `mudou ${nome.toLowerCase()}: ${fmt(e.de)} → ${fmt(e.para)}`;
}

export function HistoricoLead({ leadId }: { leadId: string }) {
  const [aberto, setAberto] = useState(false);
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  useEffect(() => {
    if (!aberto || eventos) return;
    let vivo = true;
    fetch(`/api/crm/${leadId}/eventos`)
      .then(r => r.ok ? r.json() as Promise<{ eventos: Evento[] }> : { eventos: [] })
      .then(d => { if (vivo) setEventos(d.eventos ?? []); })
      .catch(() => { if (vivo) setEventos([]); });
    return () => { vivo = false; };
  }, [aberto, eventos, leadId]);
  return (
    <div className="rounded-lg border border-border bg-background/50">
      <button type="button" onClick={() => setAberto(v => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
        <span className="flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> Histórico</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
      </button>
      {aberto && (
        <div className="max-h-56 space-y-2 overflow-y-auto border-t border-border px-3 py-2">
          {eventos === null && <p className="text-xs text-muted-foreground">Carregando…</p>}
          {eventos?.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma alteração registrada ainda.</p>}
          {eventos?.map((e, i) => (
            <div key={i} className="text-xs">
              <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · </span>
              <span className="font-semibold">{e.autor_nome || 'Sistema'}</span>{' '}
              <span className="text-muted-foreground">{descreverEvento(e)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type LeadResumo = { id: string; nome: string | null; numero: string | null; status: string | null };

const digitos = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');
/** Mesma pessoa com e sem 55 e com e sem o nono dígito: compara os 8 finais + DDD. */
function chaveFone(v: string | null | undefined): string {
  let d = digitos(v);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return '';
  return d.slice(0, 2) + d.slice(-8);
}

export function NovoLeadModal({ clientId, funnelId, statusOptions, leads, onClose, onCreated, onAbrirExistente }: {
  clientId: string;
  funnelId?: string;
  statusOptions: string[];
  leads: LeadResumo[];
  onClose: () => void;
  onCreated: (lead: Record<string, unknown>) => void;
  onAbrirExistente: (leadId: string) => void;
}) {
  const equipe = useEquipe(clientId);
  const [nome, setNome] = useState('');
  const [numero, setNumero] = useState('');
  const [canal, setCanal] = useState('');
  const [status, setStatus] = useState(statusOptions[0] ?? '');
  const [responsavel, setResponsavel] = useState('');
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const repetido = useMemo(() => {
    const k = chaveFone(numero);
    return k ? leads.find(l => chaveFone(l.numero) === k) ?? null : null;
  }, [numero, leads]);

  async function salvar() {
    if (!nome.trim() && !numero.trim()) { setErro('Informe ao menos o nome ou o telefone.'); return; }
    setSalvando(true); setErro(null);
    try {
      const res = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId, nome: nome.trim() || null, numero: numero.trim() || null, canal: canal || null,
          status: status || undefined, funnel_id: funnelId || undefined,
          observacao: observacao.trim() || null, responsavel: responsavel.trim() || null,
          data: new Date().toISOString().slice(0, 10),
        }),
      });
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok || !data) { setErro(String(data?.error ?? 'Não foi possível criar o lead.')); return; }
      onCreated(data);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-bold">Novo lead</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block space-y-1"><span className={rotulo}>Nome</span>
            <input autoFocus value={nome} onChange={e => setNome(e.target.value)} className={campo} /></label>
          <label className="block space-y-1"><span className={rotulo}>Telefone (WhatsApp)</span>
            <input value={numero} onChange={e => setNumero(e.target.value)} inputMode="tel" placeholder="(43) 99999-8888" className={campo} /></label>
          {repetido && (
            <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              Este telefone já é do lead <b>{repetido.nome || repetido.numero}</b>{repetido.status ? ` (${repetido.status})` : ''}.
              <button type="button" onClick={() => onAbrirExistente(repetido.id)} className="ml-1 font-bold underline">Abrir lead existente</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1"><span className={rotulo}>Origem</span>
              <select value={canal} onChange={e => setCanal(e.target.value)} className={campo}>
                <option value="">Escolha…</option>
                {ORIGENS.map(o => <option key={o}>{o}</option>)}
              </select></label>
            <label className="block space-y-1"><span className={rotulo}>Etapa</span>
              <select value={status} onChange={e => setStatus(e.target.value)} className={campo}>
                {statusOptions.map(o => <option key={o}>{o}</option>)}
              </select></label>
          </div>
          <label className="block space-y-1"><span className={rotulo}>Responsável</span>
            <input list="crm-equipe-novo" value={responsavel} onChange={e => setResponsavel(e.target.value)} className={campo} />
            <datalist id="crm-equipe-novo">{equipe.map(n => <option key={n} value={n} />)}</datalist></label>
          <label className="block space-y-1"><span className={rotulo}>Observação</span>
            <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={2} className={cn(campo, 'resize-none')} /></label>
          {erro && <p className="text-xs text-red-400">{erro}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancelar</button>
          {/* ⚠️ Telefone repetido NÃO cria: a lista do CRM junta leads do mesmo
              número, então o duplicado "sumiria" logo depois de criado. */}
          <button onClick={() => void salvar()} disabled={salvando || !!repetido}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {salvando ? 'Criando…' : 'Criar lead'}
          </button>
        </div>
      </div>
    </div>
  );
}
