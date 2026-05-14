"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Pencil, Trash2, Search, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
  created_at: string; updated_at: string;
};

const STATUS_OPTIONS = ['Em Atendimento', 'Agendado', 'Reagendado', 'Não Retorna', 'Distante', 'Sem Interesse', 'Desqualificado'];
const CANAL_OPTIONS = ['Facebook', 'Instagram', 'Google', 'WHATS PRINCIPAL', 'FACHADA', 'Outro'];
const PAGAMENTO_OPTIONS = ['Boleto', 'Cartão', 'PIX', 'Dinheiro', 'Financiamento'];

const STATUS_STYLE: Record<string, string> = {
  'Em Atendimento': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Agendado': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Reagendado': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'Não Retorna': 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  'Distante': 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  'Sem Interesse': 'bg-red-500/20 text-red-400 border-red-500/30',
  'Desqualificado': 'bg-red-500/20 text-red-400 border-red-500/30',
};

const EMPTY: Omit<CrmLead, 'id' | 'client_id' | 'created_at' | 'updated_at'> = {
  mes: null, data: null, link_criativo: null, nome: null, numero: null,
  canal: null, emoji: null, dia1: false, dia2: false, dia3: false, dia4: false,
  status: 'Em Atendimento', data_agendada: null, video_dra: false, compareceu: false,
  observacao: null, orcamento: null, fechou: false, valor_rs: null,
  pagamento: null, analise_credito: false, data_nasc: null, bairro: null,
  motivacoes: null, dores: null,
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const s = String(d).split('T')[0];
  const [y, m, day] = s.split('-');
  return `${day}/${m}/${y}`;
}

function toInputDate(d: string | null | undefined): string {
  if (!d) return '';
  return String(d).split('T')[0];
}

export default function CrmPage() {
  const { clients } = useClients();
  const activeClients = useMemo(() => clients.filter(c => c.status === 'Ativo'), [clients]);

  const [selectedClientId, setSelectedClientId] = useState('');
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editingLead, setEditingLead] = useState<Partial<CrmLead> & { _new?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedClientId) { setLeads([]); return; }
    setLoading(true);
    fetch(`/api/crm?clientId=${selectedClientId}`)
      .then(r => r.ok ? r.json() as Promise<CrmLead[]> : [])
      .then(setLeads)
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, [selectedClientId]);

  const filtered = useMemo(() => leads.filter(l => {
    if (statusFilter && l.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (l.nome?.toLowerCase().includes(q) || l.numero?.includes(q) || l.observacao?.toLowerCase().includes(q)) ?? false;
    }
    return true;
  }), [leads, search, statusFilter]);

  const stats = useMemo(() => ({
    total: filtered.length,
    agendados: filtered.filter(l => l.status === 'Agendado' || l.status === 'Reagendado').length,
    compareceram: filtered.filter(l => l.compareceu).length,
    fechamentos: filtered.filter(l => l.fechou).length,
    faturamento: filtered.filter(l => l.fechou).reduce((s, l) => s + (l.valor_rs ?? 0), 0),
  }), [filtered]);

  const openNew = useCallback(() => {
    setEditingLead({ ...EMPTY, _new: true, data: new Date().toISOString().split('T')[0] });
  }, []);

  const openEdit = useCallback((lead: CrmLead) => setEditingLead({ ...lead }), []);

  async function saveLead() {
    if (!editingLead || !selectedClientId) return;
    setSaving(true);
    try {
      const isNew = !!editingLead._new;
      const { _new, ...body } = editingLead;
      const url = isNew ? '/api/crm' : `/api/crm/${editingLead.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const payload = isNew ? { clientId: selectedClientId, ...body } : body;
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        const saved = await res.json() as CrmLead;
        setLeads(prev => isNew ? [saved, ...prev] : prev.map(l => l.id === saved.id ? saved : l));
        setEditingLead(null);
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteLead(id: string) {
    if (!window.confirm('Excluir este lead?')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/crm/${id}`, { method: 'DELETE' });
      if (res.ok) setLeads(prev => prev.filter(l => l.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  function setField<K extends keyof CrmLead>(key: K, value: CrmLead[K]) {
    setEditingLead(prev => prev ? { ...prev, [key]: value } : prev);
  }

  return (
    <div className="space-y-6 px-4 py-6 md:px-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-black uppercase tracking-tight">CRM</h1>
        <p className="text-sm text-muted-foreground">Gestão de leads e funil de vendas por cliente.</p>
      </div>

      {/* Controls */}
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
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Todos os status</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar nome, número..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
            <Button onClick={openNew} size="sm" className="ml-auto gap-1.5">
              <Plus className="h-4 w-4" /> Novo Lead
            </Button>
          </>
        )}
      </div>

      {/* Stats */}
      {selectedClientId && !loading && leads.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: 'Total de Leads', value: stats.total, format: 'n' },
            { label: 'Agendados', value: stats.agendados, format: 'n' },
            { label: 'Compareceram', value: stats.compareceram, format: 'n' },
            { label: 'Fechamentos', value: stats.fechamentos, format: 'n' },
            { label: 'Faturamento', value: stats.faturamento, format: 'c' },
          ].map(({ label, value, format }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-bold">{format === 'c' ? formatCurrencyBRL(value) : value.toLocaleString('pt-BR')}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {!selectedClientId && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Selecione um cliente para ver seus leads.
        </div>
      )}

      {selectedClientId && loading && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Carregando leads...
        </div>
      )}

      {selectedClientId && !loading && filtered.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Nenhum lead encontrado.</p>
          {leads.length === 0 && <Button onClick={openNew} size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Adicionar primeiro lead</Button>}
        </div>
      )}

      {selectedClientId && !loading && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Data', 'Nome', 'Número', 'Canal', 'Status', 'Ag.', 'Comp.', 'Observação', 'Orçamento', 'Fechou', 'Valor R$', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(lead => (
                <tr key={lead.id} className="group hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{fmtDate(lead.data)}</td>
                  <td className="px-3 py-2.5 font-medium whitespace-nowrap max-w-[140px] truncate">{lead.nome ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{lead.numero ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{lead.canal ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap', STATUS_STYLE[lead.status ?? ''] ?? 'bg-muted/20 text-muted-foreground border-border')}>
                      {lead.status ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(lead.data_agendada)}</td>
                  <td className="px-3 py-2.5 text-center">{lead.compareceu ? <Check className="h-4 w-4 text-emerald-400 mx-auto" /> : <span className="text-muted-foreground/30">—</span>}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">{lead.observacao ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{lead.orcamento ? formatCurrencyBRL(lead.orcamento) : '—'}</td>
                  <td className="px-3 py-2.5 text-center">{lead.fechou ? <Check className="h-4 w-4 text-emerald-400 mx-auto" /> : <span className="text-muted-foreground/30">—</span>}</td>
                  <td className="px-3 py-2.5 text-xs font-semibold whitespace-nowrap text-emerald-400">{lead.valor_rs ? formatCurrencyBRL(lead.valor_rs) : '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => openEdit(lead)} className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => deleteLead(lead.id)} disabled={deleting === lead.id} className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Dialog open={!!editingLead} onOpenChange={open => { if (!open) setEditingLead(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLead?._new ? 'Novo Lead' : 'Editar Lead'}</DialogTitle>
          </DialogHeader>

          {editingLead && (
            <div className="space-y-5 py-2">
              {/* Dados Básicos */}
              <Section label="Dados Básicos">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Data">
                    <input type="date" value={toInputDate(editingLead.data)} onChange={e => setField('data', e.target.value || null)} className={inputCls} />
                  </Field>
                  <Field label="Mês">
                    <input type="text" placeholder="Ex: maio" value={editingLead.mes ?? ''} onChange={e => setField('mes', e.target.value || null)} className={inputCls} />
                  </Field>
                  <Field label="Nome">
                    <input type="text" value={editingLead.nome ?? ''} onChange={e => setField('nome', e.target.value || null)} className={inputCls} />
                  </Field>
                  <Field label="Número">
                    <input type="text" value={editingLead.numero ?? ''} onChange={e => setField('numero', e.target.value || null)} className={inputCls} />
                  </Field>
                  <Field label="Canal">
                    <select value={editingLead.canal ?? ''} onChange={e => setField('canal', e.target.value || null)} className={selectCls}>
                      <option value="">Selecionar...</option>
                      {CANAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                  <Field label="Emoji">
                    <input type="text" placeholder="😊" value={editingLead.emoji ?? ''} onChange={e => setField('emoji', e.target.value || null)} className={inputCls} />
                  </Field>
                  <Field label="Link de Criativo" className="col-span-2">
                    <input type="text" value={editingLead.link_criativo ?? ''} onChange={e => setField('link_criativo', e.target.value || null)} className={inputCls} />
                  </Field>
                </div>
              </Section>

              {/* Atendimento */}
              <Section label="Atendimento">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Status">
                    <select value={editingLead.status ?? ''} onChange={e => setField('status', e.target.value || null)} className={selectCls}>
                      {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                  <Field label="Observação" className="col-span-2">
                    <textarea rows={2} value={editingLead.observacao ?? ''} onChange={e => setField('observacao', e.target.value || null)} className={cn(inputCls, 'resize-none')} />
                  </Field>
                  <div className="col-span-2 flex gap-6 flex-wrap">
                    {(['dia1', 'dia2', 'dia3', 'dia4'] as const).map((d, i) => (
                      <CheckField key={d} label={`${i + 1}º DIA`} checked={!!editingLead[d]} onChange={v => setField(d, v)} />
                    ))}
                  </div>
                </div>
              </Section>

              {/* Agendamento */}
              <Section label="Agendamento">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Data Agendada">
                    <input type="date" value={toInputDate(editingLead.data_agendada)} onChange={e => setField('data_agendada', e.target.value || null)} className={inputCls} />
                  </Field>
                  <div className="flex items-end gap-6 pb-1">
                    <CheckField label="Vídeo Dra." checked={!!editingLead.video_dra} onChange={v => setField('video_dra', v)} />
                    <CheckField label="Compareceu" checked={!!editingLead.compareceu} onChange={v => setField('compareceu', v)} />
                  </div>
                </div>
              </Section>

              {/* Fechamento */}
              <Section label="Fechamento">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Orçamento (R$)">
                    <input type="number" step="0.01" value={editingLead.orcamento ?? ''} onChange={e => setField('orcamento', e.target.value ? parseFloat(e.target.value) : null)} className={inputCls} />
                  </Field>
                  <Field label="Valor R$">
                    <input type="number" step="0.01" value={editingLead.valor_rs ?? ''} onChange={e => setField('valor_rs', e.target.value ? parseFloat(e.target.value) : null)} className={inputCls} />
                  </Field>
                  <Field label="Pagamento">
                    <select value={editingLead.pagamento ?? ''} onChange={e => setField('pagamento', e.target.value || null)} className={selectCls}>
                      <option value="">Selecionar...</option>
                      {PAGAMENTO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                  <div className="flex items-end gap-6 pb-1">
                    <CheckField label="Fechou?" checked={!!editingLead.fechou} onChange={v => setField('fechou', v)} />
                    <CheckField label="Análise de Crédito" checked={!!editingLead.analise_credito} onChange={v => setField('analise_credito', v)} />
                  </div>
                </div>
              </Section>

              {/* Dados do Lead */}
              <Section label="Dados do Lead">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Data de Nascimento">
                    <input type="date" value={toInputDate(editingLead.data_nasc)} onChange={e => setField('data_nasc', e.target.value || null)} className={inputCls} />
                  </Field>
                  <Field label="Bairro">
                    <input type="text" value={editingLead.bairro ?? ''} onChange={e => setField('bairro', e.target.value || null)} className={inputCls} />
                  </Field>
                  <Field label="Motivações" className="col-span-2">
                    <textarea rows={2} value={editingLead.motivacoes ?? ''} onChange={e => setField('motivacoes', e.target.value || null)} className={cn(inputCls, 'resize-none')} />
                  </Field>
                  <Field label="Dores / Incômodos" className="col-span-2">
                    <textarea rows={2} value={editingLead.dores ?? ''} onChange={e => setField('dores', e.target.value || null)} className={cn(inputCls, 'resize-none')} />
                  </Field>
                </div>
              </Section>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLead(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={saveLead} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary';
const selectCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary';

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-1">{label}</p>
      {children}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 rounded accent-primary" />
      <span className="text-xs font-medium">{label}</span>
    </label>
  );
}
