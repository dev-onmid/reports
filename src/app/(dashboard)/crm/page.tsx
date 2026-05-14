"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { useClients } from '@/lib/client-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';

type CrmLead = {
  id: string; client_id: string; mes: string | null; data: string | null;
  link_criativo: string | null; nome: string | null; numero: string | null;
  canal: string | null; emoji: string | null;
  dia1: boolean; dia2: boolean; dia3: boolean; dia4: boolean;
  status: string | null; data_agendada: string | null;
  video_dra: boolean; compareceu: boolean; observacao: string | null;
  orcamento: number | null; fechou: boolean; valor_rs: number | null;
  pagamento: string | null; analise_credito: boolean;
  data_nasc: string | null; bairro: string | null;
  motivacoes: string | null; dores: string | null;
};

const NEW_ID = '__new__';
const STATUS_OPTIONS = ['Em Atendimento', 'Agendado', 'Reagendado', 'Não Retorna', 'Distante', 'Sem Interesse', 'Desqualificado'];
const CANAL_OPTIONS = ['Facebook', 'Instagram', 'Google', 'WHATS PRINCIPAL', 'FACHADA', 'Outro'];
const PAGAMENTO_OPTIONS = ['Boleto', 'Cartão', 'PIX', 'Dinheiro', 'Financiamento'];

const STATUS_COLOR: Record<string, string> = {
  'Em Atendimento': 'text-blue-400',
  'Agendado':       'text-yellow-400',
  'Reagendado':     'text-orange-400',
  'Não Retorna':    'text-zinc-400',
  'Distante':       'text-zinc-400',
  'Sem Interesse':  'text-red-400',
  'Desqualificado': 'text-red-400',
};

const EMPTY: Omit<CrmLead, 'id' | 'client_id'> = {
  mes: null, data: new Date().toISOString().split('T')[0], link_criativo: null,
  nome: null, numero: null, canal: null, emoji: null,
  dia1: false, dia2: false, dia3: false, dia4: false,
  status: 'Em Atendimento', data_agendada: null, video_dra: false, compareceu: false,
  observacao: null, orcamento: null, fechou: false, valor_rs: null,
  pagamento: null, analise_credito: false, data_nasc: null, bairro: null,
  motivacoes: null, dores: null,
};

function makeBlank(clientId: string): CrmLead {
  return { ...EMPTY, id: NEW_ID, client_id: clientId } as CrmLead;
}

function toD(v: string | null | undefined) { return v ? String(v).split('T')[0] : ''; }
function fmtD(v: string | null) {
  const s = toD(v); if (!s) return '';
  const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`;
}
function fmtN(v: number | null) { return v ? formatCurrencyBRL(v) : ''; }

const cell = 'px-1.5 py-0 h-8 text-xs focus:outline-none focus:bg-primary/10 bg-transparent border-0 w-full';
const cellSelect = cn(cell, 'cursor-pointer');

type Draft = Partial<Omit<CrmLead, 'id' | 'client_id'>>;

// Column order: identity → status → follow-up → outcome → financial → notes
const COLS: [string, string][] = [
  ['Data','w-28'],['Nome','w-40'],['Número','w-32'],['Canal','w-28'],
  ['Status','w-36'],
  ['1D','w-8'],['2D','w-8'],['3D','w-8'],['4D','w-8'],
  ['Data Ag.','w-28'],['Fechou','w-10'],['Valor R$','w-28'],
  ['Pagamento','w-28'],['Orçamento','w-28'],['Observação','w-56'],['Bairro','w-28'],['',''],
];

export default function CrmPage() {
  const { clients } = useClients();
  const activeClients = useMemo(() => clients.filter(c => c.status === 'Ativo'), [clients]);

  const [selectedClientId, setSelectedClientId] = useState('');
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const savingRef = useRef(false);
  const pendingBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newRowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (!selectedClientId) { setLeads([]); return; }
    setLoading(true);
    fetch(`/api/crm?clientId=${selectedClientId}`)
      .then(r => r.ok ? r.json() as Promise<CrmLead[]> : [])
      .then(data => {
        setLeads([...data, makeBlank(selectedClientId)]);
        setEditId(null);
      })
      .catch(() => setLeads([makeBlank(selectedClientId)]))
      .finally(() => setLoading(false));
  }, [selectedClientId]);

  const realLeads = useMemo(() => leads.filter(l => l.id !== NEW_ID), [leads]);

  const filtered = useMemo(() => {
    const real = realLeads.filter(l => {
      if (statusFilter && l.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return l.nome?.toLowerCase().includes(q) || l.numero?.includes(q) || l.observacao?.toLowerCase().includes(q) || false;
      }
      return true;
    });
    const blank = leads.find(l => l.id === NEW_ID);
    return blank ? [...real, blank] : real;
  }, [leads, realLeads, search, statusFilter]);

  const stats = useMemo(() => ({
    total: realLeads.length,
    agendados: realLeads.filter(l => l.status === 'Agendado' || l.status === 'Reagendado').length,
    fechamentos: realLeads.filter(l => l.fechou).length,
    faturamento: realLeads.filter(l => l.fechou).reduce((s, l) => s + (l.valor_rs ?? 0), 0),
  }), [realLeads]);

  const focusNewRow = useCallback(() => {
    setTimeout(() => {
      newRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const first = newRowRef.current?.querySelector<HTMLElement>('input[type="text"], input[type="date"]');
      first?.focus();
    }, 50);
  }, []);

  const saveRow = useCallback(async (id: string, data: Draft, thenFocusNew = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      if (id === NEW_ID) {
        const hasData = data.nome || data.numero || data.observacao;
        if (!hasData) {
          if (thenFocusNew) { setEditId(NEW_ID); setDraft({ ...EMPTY }); focusNewRow(); }
          else setEditId(null);
          return;
        }
        const res = await fetch('/api/crm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: selectedClientId, ...data }),
        });
        if (res.ok) {
          const saved = await res.json() as CrmLead;
          setLeads(prev => [...prev.filter(l => l.id !== NEW_ID), saved, makeBlank(selectedClientId)]);
        }
      } else {
        const res = await fetch(`/api/crm/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (res.ok) {
          const saved = await res.json() as CrmLead;
          setLeads(prev => prev.map(l => l.id === id ? saved : l));
        }
      }
    } finally {
      savingRef.current = false;
      if (thenFocusNew) {
        setEditId(NEW_ID);
        setDraft({ ...EMPTY });
        focusNewRow();
      } else {
        setEditId(null);
      }
    }
  }, [selectedClientId, focusNewRow]);

  function startEdit(lead: CrmLead) {
    if (editId && editId !== lead.id) void saveRow(editId, draft);
    setEditId(lead.id);
    setDraft({ ...lead } as Draft);
  }

  function handleRowBlur(e: React.FocusEvent<HTMLTableRowElement>, id: string) {
    if (pendingBlurRef.current) clearTimeout(pendingBlurRef.current);
    pendingBlurRef.current = setTimeout(() => {
      if (e.currentTarget && !e.currentTarget.contains(document.activeElement)) {
        void saveRow(id, draft);
      }
    }, 100);
  }

  function handleRowFocus() {
    if (pendingBlurRef.current) clearTimeout(pendingBlurRef.current);
  }

  // Enter or Tab from last field → save + jump to blank row
  function handleLastFieldKeyDown(e: React.KeyboardEvent, id: string) {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      if (pendingBlurRef.current) clearTimeout(pendingBlurRef.current);
      void saveRow(id, draft, true);
    }
  }

  function focusNewRowBtn() {
    if (editId && editId !== NEW_ID) void saveRow(editId, draft);
    setEditId(NEW_ID);
    setDraft({ ...EMPTY });
    focusNewRow();
  }

  async function deleteRow(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (id === NEW_ID) { setEditId(null); return; }
    if (!window.confirm('Excluir este lead?')) return;
    const res = await fetch(`/api/crm/${id}`, { method: 'DELETE' });
    if (res.ok) setLeads(prev => prev.filter(l => l.id !== id));
    if (editId === id) setEditId(null);
  }

  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft(prev => ({ ...prev, [k]: v }));
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-6 md:px-8 h-full">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-black uppercase tracking-tight">CRM</h1>
        <p className="text-sm text-muted-foreground">Gestão de leads e funil de vendas por cliente.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedClientId}
          onChange={e => setSelectedClientId(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary min-w-[180px]"
        >
          <option value="">Selecionar cliente...</option>
          {activeClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selectedClientId && (
          <>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Todos status</option>
              {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..."
                className="pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary w-44" />
            </div>
            <button onClick={focusNewRowBtn}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> Novo Lead
            </button>
          </>
        )}
      </div>

      {selectedClientId && !loading && realLeads.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 shrink-0">
          {[
            { label: 'Total', value: stats.total, fmt: 'n' },
            { label: 'Agendados', value: stats.agendados, fmt: 'n' },
            { label: 'Fechamentos', value: stats.fechamentos, fmt: 'n' },
            { label: 'Faturamento', value: stats.faturamento, fmt: 'c' },
          ].map(({ label, value, fmt }) => (
            <div key={label} className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-lg font-bold">{fmt === 'c' ? formatCurrencyBRL(value) : value.toLocaleString('pt-BR')}</p>
            </div>
          ))}
        </div>
      )}

      {!selectedClientId && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Selecione um cliente para ver seus leads.
        </div>
      )}
      {selectedClientId && loading && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">Carregando...</div>
      )}

      {selectedClientId && !loading && (
        <div className="overflow-auto rounded-xl border border-border flex-1 min-h-0">
          <table className="w-full border-collapse text-xs" style={{ minWidth: 1300 }}>
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr>
                {COLS.map(([h, w], i) => (
                  <th key={i} className={cn('border-b border-border px-1.5 py-2 text-left font-semibold uppercase tracking-wider text-muted-foreground text-[10px]', w)}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => {
                const isBlank = lead.id === NEW_ID;
                const isEditing = editId === lead.id;
                const d = isEditing ? draft : lead;
                return (
                  <tr
                    key={lead.id}
                    data-id={lead.id}
                    ref={isBlank ? newRowRef : undefined}
                    tabIndex={-1}
                    onClick={() => !isEditing && startEdit(lead)}
                    onBlur={isEditing ? e => handleRowBlur(e, lead.id) : undefined}
                    onFocus={isEditing ? handleRowFocus : undefined}
                    className={cn(
                      'border-b border-border/50 transition-colors group',
                      isBlank && !isEditing && 'opacity-40 hover:opacity-80',
                      isEditing ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : 'hover:bg-muted/20 cursor-pointer'
                    )}
                  >
                    {/* Data */}
                    <Td>
                      {isEditing
                        ? <input type="date" value={toD(d.data)} onChange={e => set('data', e.target.value || null)} className={cell} />
                        : <span className="px-1.5">{fmtD(lead.data)}</span>}
                    </Td>
                    {/* Nome */}
                    <Td>
                      {isEditing
                        ? <input type="text" value={d.nome ?? ''} onChange={e => set('nome', e.target.value || null)} placeholder="Nome" className={cell} />
                        : <span className="px-1.5 font-medium truncate block max-w-[160px]">
                            {isBlank
                              ? <span className="text-muted-foreground/50 italic text-[10px]">novo lead…</span>
                              : lead.nome ?? ''}
                          </span>}
                    </Td>
                    {/* Número */}
                    <Td>
                      {isEditing
                        ? <input type="text" value={d.numero ?? ''} onChange={e => set('numero', e.target.value || null)} placeholder="Número" className={cell} />
                        : <span className="px-1.5 text-muted-foreground">{lead.numero ?? ''}</span>}
                    </Td>
                    {/* Canal */}
                    <Td>
                      {isEditing
                        ? <select value={d.canal ?? ''} onChange={e => set('canal', e.target.value || null)} className={cellSelect}>
                            <option value=""></option>
                            {CANAL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                          </select>
                        : <span className="px-1.5">{lead.canal ?? ''}</span>}
                    </Td>
                    {/* Status */}
                    <Td>
                      {isEditing
                        ? <select value={d.status ?? ''} onChange={e => set('status', e.target.value || null)} className={cn(cellSelect, STATUS_COLOR[d.status ?? ''] ?? '')}>
                            {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        : <span className={cn('px-1.5 font-medium', STATUS_COLOR[lead.status ?? ''])}>{lead.status ?? ''}</span>}
                    </Td>
                    {/* 1D 2D 3D 4D */}
                    {(['dia1','dia2','dia3','dia4'] as const).map(k => (
                      <Td key={k} center>
                        {(!isBlank || isEditing) &&
                          <input type="checkbox" checked={!!(isEditing ? d[k] : lead[k])}
                            onChange={isEditing ? e => set(k, e.target.checked) : undefined}
                            onClick={!isEditing ? e => { e.stopPropagation(); startEdit(lead); setTimeout(() => set(k, !lead[k]), 0); } : undefined}
                            className="h-3.5 w-3.5 accent-primary cursor-pointer" />
                        }
                      </Td>
                    ))}
                    {/* Data Agendada */}
                    <Td>
                      {isEditing
                        ? <input type="date" value={toD(d.data_agendada)} onChange={e => set('data_agendada', e.target.value || null)} className={cell} />
                        : <span className="px-1.5 text-muted-foreground">{fmtD(lead.data_agendada)}</span>}
                    </Td>
                    {/* Fechou */}
                    <Td center>
                      {(!isBlank || isEditing) &&
                        <input type="checkbox" checked={!!(isEditing ? d.fechou : lead.fechou)}
                          onChange={isEditing ? e => set('fechou', e.target.checked) : undefined}
                          onClick={!isEditing ? e => { e.stopPropagation(); startEdit(lead); setTimeout(() => set('fechou', !lead.fechou), 0); } : undefined}
                          className="h-3.5 w-3.5 accent-primary cursor-pointer" />
                      }
                    </Td>
                    {/* Valor R$ */}
                    <Td>
                      {isEditing
                        ? <input type="number" step="0.01" value={d.valor_rs ?? ''} onChange={e => set('valor_rs', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cn(cell, 'text-emerald-400')} />
                        : <span className="px-1.5 font-semibold text-emerald-400">{fmtN(lead.valor_rs)}</span>}
                    </Td>
                    {/* Pagamento */}
                    <Td>
                      {isEditing
                        ? <select value={d.pagamento ?? ''} onChange={e => set('pagamento', e.target.value || null)} className={cellSelect}>
                            <option value=""></option>
                            {PAGAMENTO_OPTIONS.map(o => <option key={o}>{o}</option>)}
                          </select>
                        : <span className="px-1.5 text-muted-foreground">{lead.pagamento ?? ''}</span>}
                    </Td>
                    {/* Orçamento */}
                    <Td>
                      {isEditing
                        ? <input type="number" step="0.01" value={d.orcamento ?? ''} onChange={e => set('orcamento', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cell} />
                        : <span className="px-1.5">{fmtN(lead.orcamento)}</span>}
                    </Td>
                    {/* Observação */}
                    <Td>
                      {isEditing
                        ? <input type="text" value={d.observacao ?? ''} onChange={e => set('observacao', e.target.value || null)} placeholder="Observação" className={cell} />
                        : <span className="px-1.5 text-muted-foreground truncate block max-w-[220px]">{lead.observacao ?? ''}</span>}
                    </Td>
                    {/* Bairro — last editable field */}
                    <Td>
                      {isEditing
                        ? <input type="text" value={d.bairro ?? ''} onChange={e => set('bairro', e.target.value || null)} placeholder="Bairro" className={cell}
                            onKeyDown={e => handleLastFieldKeyDown(e, lead.id)} />
                        : <span className="px-1.5 text-muted-foreground">{lead.bairro ?? ''}</span>}
                    </Td>
                    {/* Delete */}
                    <Td center>
                      {!isBlank &&
                        <button onClick={e => deleteRow(lead.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      }
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Td({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <td className={cn('border-r border-border/30 last:border-0 overflow-hidden', center && 'text-center')}>
      {children}
    </td>
  );
}
