'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Search, ChevronDown, ChevronUp, MessageCircle, RefreshCw } from 'lucide-react';

type CrmContact = {
  id: string;
  phone: string;
  name: string | null;
  origin: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  status: string;
  created_at: string;
  message_count: number;
  last_message_at: string | null;
};

type CrmMessage = {
  id: string;
  direction: 'in' | 'out';
  text: string;
  created_at: string;
};

type OriginStat = { origin: string; count: number };

const ORIGIN_STYLES: Record<string, string> = {
  meta:       'bg-blue-500/20 text-blue-300 border-blue-400/30',
  google:     'bg-red-500/20 text-red-300 border-red-400/30',
  instagram:  'bg-purple-500/20 text-purple-300 border-purple-400/30',
  tiktok:     'bg-foreground/10 text-foreground border-border',
  youtube:    'bg-red-600/20 text-red-400 border-red-500/30',
  anuncio:    'bg-yellow-500/20 text-yellow-300 border-yellow-400/30',
  indicacao:  'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
  cliente:    'bg-primary/20 text-primary border-primary/30',
  organic:    'bg-muted/40 text-muted-foreground border-border/50',
};

const STATUS_STYLES: Record<string, string> = {
  novo:            'bg-blue-500/20 text-blue-300 border-blue-400/30',
  em_atendimento:  'bg-yellow-500/20 text-yellow-300 border-yellow-400/30',
  convertido:      'bg-primary/20 text-primary border-primary/30',
  perdido:         'bg-red-500/20 text-red-300 border-red-400/30',
};

const STATUS_LABELS: Record<string, string> = {
  novo:           'Novo',
  em_atendimento: 'Em atendimento',
  convertido:     'Convertido',
  perdido:        'Perdido',
};

const ORIGIN_LABELS: Record<string, string> = {
  meta:      'Meta',
  google:    'Google',
  instagram: 'Instagram',
  tiktok:    'TikTok',
  youtube:   'YouTube',
  anuncio:   'Anúncio',
  indicacao: 'Indicação',
  cliente:   'Já é cliente',
  organic:   'Orgânico',
};

function originStyle(origin: string) {
  return ORIGIN_STYLES[origin] ?? 'bg-muted/40 text-muted-foreground border-border/50';
}

function originLabel(origin: string) {
  return ORIGIN_LABELS[origin] ?? origin;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function StatusDropdown({ contactId, clientId, value, onChange }: {
  contactId: string;
  clientId: string;
  value: string;
  onChange: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const statuses = Object.keys(STATUS_LABELS);

  async function pick(s: string) {
    setOpen(false);
    onChange(s);
    await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: s }),
    });
  }

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={cn(
          'h-6 rounded-md border px-2 text-[10px] font-bold whitespace-nowrap transition-colors',
          STATUS_STYLES[value] ?? 'bg-muted text-muted-foreground border-border',
        )}
      >
        {STATUS_LABELS[value] ?? value}
      </button>
      {open && (
        <div
          className="absolute left-0 top-7 z-20 min-w-[140px] rounded-lg border border-border bg-card shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {statuses.filter(s => s !== value).map(s => (
            <button
              key={s}
              onClick={() => pick(s)}
              className="w-full px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors first:rounded-t-lg last:rounded-b-lg"
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessagePanel({ contactId, clientId }: { contactId: string; clientId: string }) {
  const [messages, setMessages] = useState<CrmMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/clients/${clientId}/crm/contacts/${contactId}`)
      .then(r => r.json())
      .then((d: { messages: CrmMessage[] }) => setMessages(d.messages ?? []))
      .finally(() => setLoading(false));
  }, [contactId, clientId]);

  if (loading) return <div className="px-4 py-3 text-xs text-muted-foreground">Carregando...</div>;
  if (!messages.length) return <div className="px-4 py-3 text-xs text-muted-foreground">Nenhuma mensagem registrada.</div>;

  return (
    <div className="max-h-64 overflow-y-auto px-4 py-3 space-y-2 bg-background/40">
      {messages.map(m => (
        <div key={m.id} className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
          <div className={cn(
            'max-w-[75%] rounded-lg px-3 py-2 text-xs leading-relaxed',
            m.direction === 'out'
              ? 'bg-primary/20 text-primary rounded-br-none'
              : 'bg-muted text-foreground rounded-bl-none',
          )}>
            <p>{m.text}</p>
            <p className="mt-1 text-[10px] opacity-60 text-right">{formatDate(m.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ClientCrmTab({ clientId }: { clientId: string }) {
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [origins, setOrigins] = useState<OriginStat[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterOrigin, setFilterOrigin] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback((p = 1) => {
    setLoading(true);
    const q = new URLSearchParams({ page: String(p) });
    if (filterOrigin) q.set('origin', filterOrigin);
    if (filterStatus) q.set('status', filterStatus);
    if (search) q.set('search', search);
    fetch(`/api/clients/${clientId}/crm/contacts?${q}`)
      .then(r => r.json())
      .then((d: { contacts: CrmContact[]; total: number; origins: OriginStat[] }) => {
        setContacts(d.contacts ?? []);
        setTotal(d.total ?? 0);
        if (p === 1) setOrigins(d.origins ?? []);
      })
      .finally(() => setLoading(false));
  }, [clientId, filterOrigin, filterStatus, search]);

  useEffect(() => { setPage(1); load(1); }, [load]);

  function updateStatus(contactId: string, status: string) {
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, status } : c));
  }

  const totalByStatus = (s: string) => contacts.filter(c => c.status === s).length;
  const pages = Math.ceil(total / 50);

  return (
    <div className="space-y-4 pt-1">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: total, style: 'text-foreground' },
          { label: 'Novos', value: totalByStatus('novo'), style: 'text-blue-300' },
          { label: 'Convertidos', value: totalByStatus('convertido'), style: 'text-primary' },
          { label: 'Perdidos', value: totalByStatus('perdido'), style: 'text-red-300' },
        ].map(({ label, value, style }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className={cn('font-heading font-normal text-xl leading-none mt-2', style)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar telefone ou nome..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <select
          value={filterOrigin}
          onChange={e => setFilterOrigin(e.target.value)}
          className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Todas as origens</option>
          {origins.map(o => (
            <option key={o.origin} value={o.origin}>
              {originLabel(o.origin)} ({o.count})
            </option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <button
          onClick={() => load(page)}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : contacts.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhum contato encontrado.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">As mensagens recebidas via WhatsApp aparecerão aqui automaticamente.</p>
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Contato</span>
              <span>Origem</span>
              <span>Status</span>
              <span>Msgs</span>
              <span>Data</span>
            </div>

            {contacts.map(contact => (
              <div key={contact.id} className="border-b border-border/50 last:border-0">
                <button
                  onClick={() => setExpanded(expanded === contact.id ? null : contact.id)}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 w-full px-4 py-3 items-center text-left hover:bg-muted/20 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{contact.name ?? contact.phone}</p>
                    {contact.name && (
                      <p className="text-[11px] text-muted-foreground">{contact.phone}</p>
                    )}
                    {contact.utm_campaign && (
                      <p className="text-[10px] text-muted-foreground/60 truncate">Camp: {contact.utm_campaign}</p>
                    )}
                  </div>

                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap', originStyle(contact.origin))}>
                    {originLabel(contact.origin)}
                  </span>

                  <div onClick={e => e.stopPropagation()}>
                    <StatusDropdown
                      contactId={contact.id}
                      clientId={clientId}
                      value={contact.status}
                      onChange={s => updateStatus(contact.id, s)}
                    />
                  </div>

                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>{contact.message_count}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {formatDate(contact.last_message_at ?? contact.created_at)}
                    </span>
                    {expanded === contact.id
                      ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                      : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    }
                  </div>
                </button>

                {expanded === contact.id && (
                  <MessagePanel contactId={contact.id} clientId={clientId} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => { setPage(p => p - 1); load(page - 1); }}
            className="h-8 px-3 rounded-lg border border-border bg-card text-xs font-semibold disabled:opacity-40 hover:bg-muted transition-colors"
          >
            Anterior
          </button>
          <span className="text-xs text-muted-foreground">{page} / {pages}</span>
          <button
            disabled={page >= pages}
            onClick={() => { setPage(p => p + 1); load(page + 1); }}
            className="h-8 px-3 rounded-lg border border-border bg-card text-xs font-semibold disabled:opacity-40 hover:bg-muted transition-colors"
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
