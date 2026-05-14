"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
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

type Draft = Partial<Omit<CrmLead, 'id' | 'client_id'>>;

const STATUS_OPTIONS = ['Em Atendimento', 'Agendado', 'Reagendado', 'Não Retorna', 'Distante', 'Sem Interesse', 'Desqualificado'];
const CANAL_OPTIONS = ['Facebook', 'Instagram', 'Google', 'WHATS PRINCIPAL', 'FACHADA', 'Outro'];
const PAGAMENTO_OPTIONS = ['Boleto', 'Cartão', 'PIX', 'Dinheiro', 'Financiamento'];

const STATUS_COLOR: Record<string, string> = {
  'Em Atendimento': 'text-blue-600',
  'Agendado':       'text-amber-600',
  'Reagendado':     'text-orange-600',
  'Não Retorna':    'text-gray-500',
  'Distante':       'text-gray-500',
  'Sem Interesse':  'text-red-600',
  'Desqualificado': 'text-red-600',
};

const STATUS_BADGE: Record<string, string> = {
  'Em Atendimento': 'bg-blue-50 text-blue-700 border border-blue-200',
  'Agendado':       'bg-amber-50 text-amber-700 border border-amber-200',
  'Reagendado':     'bg-orange-50 text-orange-700 border border-orange-200',
  'Não Retorna':    'bg-gray-100 text-gray-600 border border-gray-200',
  'Distante':       'bg-gray-100 text-gray-600 border border-gray-200',
  'Sem Interesse':  'bg-red-50 text-red-700 border border-red-200',
  'Desqualificado': 'bg-red-50 text-red-700 border border-red-200',
};

function freshDraft(): Draft {
  return {
    data: new Date().toISOString().split('T')[0],
    status: 'Em Atendimento',
    dia1: false, dia2: false, dia3: false, dia4: false,
    video_dra: false, compareceu: false, fechou: false, analise_credito: false,
  };
}

function toD(v: string | null | undefined) { return v ? String(v).split('T')[0] : ''; }
function fmtD(v: string | null) {
  const s = toD(v); if (!s) return '';
  const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`;
}
function fmtN(v: number | null) { return v ? formatCurrencyBRL(v) : ''; }

const cell = 'px-2 py-0 h-9 text-xs focus:outline-none focus:bg-blue-50 bg-transparent border-0 w-full text-gray-800 placeholder:text-gray-300';
const cellSel = cn(cell, 'cursor-pointer');
const cellNew = 'px-2 py-0 h-9 text-xs focus:outline-none focus:bg-green-100 bg-transparent border-0 w-full text-gray-800 placeholder:text-gray-400';

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

  const [clientId, setClientId] = useState('');
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── NEW ROW (always at top, always editable, independent state) ──
  const [newDraft, setNewDraft] = useState<Draft>(freshDraft());
  const newDraftRef = useRef<Draft>(newDraft);
  newDraftRef.current = newDraft;
  const newRowRef = useRef<HTMLTableRowElement | null>(null);
  const newSavingRef = useRef(false);
  const newPendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── EXISTING ROW EDITING ──
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>({});
  const editDraftRef = useRef<Draft>(editDraft);
  editDraftRef.current = editDraft;
  const editPendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!clientId) { setLeads([]); return; }
    setLoading(true);
    fetch(`/api/crm?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<CrmLead[]> : [])
      .then(data => setLeads(data))
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  const filtered = useMemo(() => {
    return leads.filter(l => {
      if (statusFilter && l.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return l.nome?.toLowerCase().includes(q) || l.numero?.includes(q) || false;
      }
      return true;
    });
  }, [leads, search, statusFilter]);

  const stats = useMemo(() => ({
    total: leads.length,
    agendados: leads.filter(l => l.status === 'Agendado' || l.status === 'Reagendado').length,
    fechamentos: leads.filter(l => l.fechou).length,
    faturamento: leads.filter(l => l.fechou).reduce((s, l) => s + (l.valor_rs ?? 0), 0),
  }), [leads]);

  // ── Save new lead ──
  async function saveNew() {
    if (newSavingRef.current) return;
    const data = newDraftRef.current;
    const hasData = data.nome || data.numero || data.observacao || data.canal || data.bairro || data.valor_rs;
    if (!hasData) {
      focusNew();
      return;
    }
    newSavingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, ...data }),
      });
      if (res.ok) {
        const saved = await res.json() as CrmLead;
        setLeads(prev => [saved, ...prev]);
        setNewDraft(freshDraft());
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSaveError(body.error ?? `Erro ${res.status}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erro de rede');
    } finally {
      newSavingRef.current = false;
      setSaving(false);
      focusNew();
    }
  }

  function handleNewBlur(e: React.FocusEvent<HTMLTableRowElement>) {
    if (newPendingRef.current) clearTimeout(newPendingRef.current);
    newPendingRef.current = setTimeout(() => {
      if (e.currentTarget && !e.currentTarget.contains(document.activeElement)) {
        void saveNew();
      }
    }, 150);
  }

  function handleNewFocus() {
    if (newPendingRef.current) clearTimeout(newPendingRef.current);
  }

  function focusNew() {
    setTimeout(() => {
      const first = newRowRef.current?.querySelector<HTMLElement>('input[type="date"]');
      first?.focus();
    }, 30);
  }

  // ── Save existing lead ──
  async function saveExisting(id: string) {
    const data = editDraftRef.current;
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const saved = await res.json() as CrmLead;
        setLeads(prev => prev.map(l => l.id === id ? saved : l));
        setEditId(null);
      } else {
        console.error('CRM PUT failed', res.status);
      }
    } finally {
      setSaving(false);
    }
  }

  function startEdit(lead: CrmLead) {
    if (editId === lead.id) return;
    if (editId) void saveExisting(editId);
    setEditId(lead.id);
    setEditDraft({ ...lead } as Draft);
  }

  function handleExistingBlur(e: React.FocusEvent<HTMLTableRowElement>, id: string) {
    if (editPendingRef.current) clearTimeout(editPendingRef.current);
    editPendingRef.current = setTimeout(() => {
      if (e.currentTarget && !e.currentTarget.contains(document.activeElement)) {
        void saveExisting(id);
      }
    }, 150);
  }

  function handleExistingFocus() {
    if (editPendingRef.current) clearTimeout(editPendingRef.current);
  }

  async function deleteRow(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const res = await fetch(`/api/crm/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setLeads(prev => prev.filter(l => l.id !== id));
      if (editId === id) setEditId(null);
    }
  }

  function setN<K extends keyof Draft>(k: K, v: Draft[K]) {
    setNewDraft(prev => ({ ...prev, [k]: v }));
  }

  function setE<K extends keyof Draft>(k: K, v: Draft[K]) {
    setEditDraft(prev => ({ ...prev, [k]: v }));
  }

  // Handler: Tab or Enter on last field of new row
  function onNewBairroKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      void saveNew();
    }
  }

  // Handler: Enter on any input of new row
  function onNewRowKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      void saveNew();
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-6 md:px-8 h-full">
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-black uppercase tracking-tight">CRM</h1>
          <p className="text-sm text-muted-foreground">Gestão de leads e funil de vendas por cliente.</p>
        </div>
        {saving && <span className="text-xs font-medium text-amber-600 animate-pulse">Salvando…</span>}
        {saveError && <span className="text-xs font-medium text-red-600">Erro: {saveError}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={clientId} onChange={e => setClientId(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary min-w-[180px]"
        >
          <option value="">Selecionar cliente...</option>
          {activeClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {clientId && (
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
            <button onClick={() => void saveNew()}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> Novo Lead
            </button>
          </>
        )}
      </div>

      {clientId && !loading && leads.length > 0 && (
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

      {!clientId && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Selecione um cliente para ver seus leads.
        </div>
      )}
      {clientId && loading && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">Carregando...</div>
      )}

      {clientId && !loading && (
        <div className="overflow-auto rounded-xl border border-gray-200 flex-1 min-h-0 bg-white">
          <table className="w-full border-collapse text-xs" style={{ minWidth: 1300 }}>
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              <tr>
                {COLS.map(([h, w], i) => (
                  <th key={i} className={cn('border-b border-gray-200 px-1.5 py-2 text-left font-semibold uppercase tracking-wider text-gray-500 text-[10px]', w)}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* ── NEW ROW — always at top, always editable ── */}
              <tr
                ref={newRowRef}
                onKeyDown={onNewRowKey}
                onBlur={handleNewBlur}
                onFocus={handleNewFocus}
                className="border-b border-gray-200 bg-green-50 ring-1 ring-inset ring-green-300"
              >
                <Td><input type="date" value={toD(newDraft.data)} onChange={e => setN('data', e.target.value || null)} className={cellNew} /></Td>
                <Td><input type="text" value={newDraft.nome ?? ''} onChange={e => setN('nome', e.target.value || null)} placeholder="Nome" className={cellNew} /></Td>
                <Td><input type="text" value={newDraft.numero ?? ''} onChange={e => setN('numero', e.target.value || null)} placeholder="Número" className={cellNew} /></Td>
                <Td>
                  <select value={newDraft.canal ?? ''} onChange={e => setN('canal', e.target.value || null)} className={cn(cellNew, 'cursor-pointer')}>
                    <option value=""></option>
                    {CANAL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </Td>
                <Td>
                  <select value={newDraft.status ?? ''} onChange={e => setN('status', e.target.value || null)} className={cn(cellNew, 'cursor-pointer', STATUS_COLOR[newDraft.status ?? ''] ?? '')}>
                    {STATUS_OPTIONS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </Td>
                {(['dia1','dia2','dia3','dia4'] as const).map(k => (
                  <Td key={k} center>
                    <input type="checkbox" checked={!!newDraft[k]} onChange={e => setN(k, e.target.checked)} className="h-4 w-4 accent-green-600 cursor-pointer" />
                  </Td>
                ))}
                <Td><input type="date" value={toD(newDraft.data_agendada)} onChange={e => setN('data_agendada', e.target.value || null)} className={cellNew} /></Td>
                <Td center><input type="checkbox" checked={!!newDraft.fechou} onChange={e => setN('fechou', e.target.checked)} className="h-4 w-4 accent-green-600 cursor-pointer" /></Td>
                <Td><input type="number" step="0.01" value={newDraft.valor_rs ?? ''} onChange={e => setN('valor_rs', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cn(cellNew, 'text-green-700 font-semibold')} /></Td>
                <Td>
                  <select value={newDraft.pagamento ?? ''} onChange={e => setN('pagamento', e.target.value || null)} className={cn(cellNew, 'cursor-pointer')}>
                    <option value=""></option>
                    {PAGAMENTO_OPTIONS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </Td>
                <Td><input type="number" step="0.01" value={newDraft.orcamento ?? ''} onChange={e => setN('orcamento', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cellNew} /></Td>
                <Td><input type="text" value={newDraft.observacao ?? ''} onChange={e => setN('observacao', e.target.value || null)} placeholder="Observação" className={cellNew} /></Td>
                <Td>
                  <input type="text" value={newDraft.bairro ?? ''} onChange={e => setN('bairro', e.target.value || null)} placeholder="Bairro" className={cellNew}
                    onKeyDown={onNewBairroKey} />
                </Td>
                <Td center />
              </tr>

              {/* ── SAVED LEADS ── */}
              {filtered.map((lead, idx) => {
                const isEditing = editId === lead.id;
                const d = isEditing ? editDraft : lead;
                return (
                  <tr
                    key={lead.id}
                    tabIndex={-1}
                    onClick={() => !isEditing && startEdit(lead)}
                    onBlur={isEditing ? e => handleExistingBlur(e, lead.id) : undefined}
                    onFocus={isEditing ? handleExistingFocus : undefined}
                    className={cn(
                      'border-b border-gray-100 transition-colors group',
                      isEditing
                        ? 'bg-blue-50 ring-1 ring-inset ring-blue-300'
                        : idx % 2 === 0 ? 'bg-white hover:bg-blue-50/40 cursor-pointer' : 'bg-gray-50/60 hover:bg-blue-50/40 cursor-pointer'
                    )}
                  >
                    <Td>
                      {isEditing
                        ? <input type="date" value={toD(d.data)} onChange={e => setE('data', e.target.value || null)} className={cell} />
                        : <span className="px-2 text-gray-600 text-[11px]">{fmtD(lead.data)}</span>}
                    </Td>
                    <Td>
                      {isEditing
                        ? <input type="text" value={d.nome ?? ''} onChange={e => setE('nome', e.target.value || null)} placeholder="Nome" className={cell} />
                        : <span className="px-2 font-semibold text-gray-900 truncate block max-w-[160px] text-xs">{lead.nome ?? ''}</span>}
                    </Td>
                    <Td>
                      {isEditing
                        ? <input type="text" value={d.numero ?? ''} onChange={e => setE('numero', e.target.value || null)} placeholder="Número" className={cell} />
                        : <span className="px-2 text-gray-700 text-[11px] font-mono">{lead.numero ?? ''}</span>}
                    </Td>
                    <Td>
                      {isEditing
                        ? <select value={d.canal ?? ''} onChange={e => setE('canal', e.target.value || null)} className={cellSel}>
                            <option value=""></option>
                            {CANAL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                          </select>
                        : <span className="px-2 text-gray-600 text-[11px]">{lead.canal ?? ''}</span>}
                    </Td>
                    <Td>
                      {isEditing
                        ? <select value={d.status ?? ''} onChange={e => setE('status', e.target.value || null)} className={cn(cellSel, STATUS_COLOR[d.status ?? ''] ?? '')}>
                            {STATUS_OPTIONS.map(o => <option key={o}>{o}</option>)}
                          </select>
                        : lead.status
                          ? <span className={cn('mx-1.5 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap', STATUS_BADGE[lead.status] ?? 'bg-gray-100 text-gray-600')}>{lead.status}</span>
                          : null}
                    </Td>
                    {(['dia1','dia2','dia3','dia4'] as const).map(k => (
                      <Td key={k} center>
                        {isEditing
                          ? <input type="checkbox" checked={!!d[k]} onChange={e => setE(k, e.target.checked)} className="h-4 w-4 accent-blue-600 cursor-pointer" />
                          : <span onClick={e => { e.stopPropagation(); startEdit(lead); }}
                              className={cn('inline-flex h-4 w-4 items-center justify-center rounded text-[10px] cursor-pointer', lead[k] ? 'bg-green-100 text-green-700 font-bold' : 'text-gray-300')}>
                              {lead[k] ? '✓' : '–'}
                            </span>}
                      </Td>
                    ))}
                    <Td>
                      {isEditing
                        ? <input type="date" value={toD(d.data_agendada)} onChange={e => setE('data_agendada', e.target.value || null)} className={cell} />
                        : <span className="px-2 text-gray-600 text-[11px]">{fmtD(lead.data_agendada)}</span>}
                    </Td>
                    <Td center>
                      {isEditing
                        ? <input type="checkbox" checked={!!d.fechou} onChange={e => setE('fechou', e.target.checked)} className="h-4 w-4 accent-blue-600 cursor-pointer" />
                        : <span onClick={e => { e.stopPropagation(); startEdit(lead); }}
                            className={cn('inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] cursor-pointer font-bold', lead.fechou ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400')}>
                            {lead.fechou ? '✓' : ''}
                          </span>}
                    </Td>
                    <Td>
                      {isEditing
                        ? <input type="number" step="0.01" value={d.valor_rs ?? ''} onChange={e => setE('valor_rs', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cn(cell, 'text-green-700 font-semibold')} />
                        : lead.valor_rs ? <span className="px-2 font-bold text-green-700 text-xs">{fmtN(lead.valor_rs)}</span> : null}
                    </Td>
                    <Td>
                      {isEditing
                        ? <select value={d.pagamento ?? ''} onChange={e => setE('pagamento', e.target.value || null)} className={cellSel}>
                            <option value=""></option>
                            {PAGAMENTO_OPTIONS.map(o => <option key={o}>{o}</option>)}
                          </select>
                        : <span className="px-2 text-gray-600 text-[11px]">{lead.pagamento ?? ''}</span>}
                    </Td>
                    <Td>
                      {isEditing
                        ? <input type="number" step="0.01" value={d.orcamento ?? ''} onChange={e => setE('orcamento', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0,00" className={cell} />
                        : lead.orcamento ? <span className="px-2 text-gray-700 text-[11px]">{fmtN(lead.orcamento)}</span> : null}
                    </Td>
                    <Td>
                      {isEditing
                        ? <input type="text" value={d.observacao ?? ''} onChange={e => setE('observacao', e.target.value || null)} placeholder="Observação" className={cell} />
                        : <span className="px-2 text-gray-600 text-[11px] truncate block max-w-[220px]">{lead.observacao ?? ''}</span>}
                    </Td>
                    <Td>
                      {isEditing
                        ? <input type="text" value={d.bairro ?? ''} onChange={e => setE('bairro', e.target.value || null)} placeholder="Bairro" className={cell} />
                        : <span className="px-2 text-gray-600 text-[11px]">{lead.bairro ?? ''}</span>}
                    </Td>
                    <Td center>
                      <button onClick={e => deleteRow(lead.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md bg-red-50 text-red-400 hover:text-red-600 hover:bg-red-100 transition-all">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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

function Td({ children, center }: { children?: React.ReactNode; center?: boolean }) {
  return (
    <td className={cn('border-r border-gray-100 last:border-0 overflow-hidden', center && 'text-center')}>
      {children}
    </td>
  );
}
