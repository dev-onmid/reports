'use client';

// ── Portal do cliente (read-only) ────────────────────────────────────────────
// Página PÚBLICA por token — o cliente final acompanha o próprio funil: KPIs,
// etapas, leads com origem de campanha (rastreio) e conversas somente-leitura.
// Nenhuma ação de escrita existe aqui; as rotas /api/portal/[token]/* são
// SELECT-only e filtradas pelo client_id do token (ver src/lib/crm-portal.ts).

import { use, useEffect, useState, useCallback } from 'react';
import {
  MessageCircle, TrendingUp, CheckCircle2, BadgeDollarSign, Crosshair,
  ChevronLeft, RefreshCw, FileText, MapPin, X,
} from 'lucide-react';

type PortalLead = {
  id: string;
  nome: string | null;
  numero: string | null;
  status: string | null;
  origin: string | null;
  canal: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  utm_campaign: string | null;
  keyword: string | null;
  placement: string | null;
  regiao_uf: string | null;
  regiao_cidade: string | null;
  fechou: boolean;
  valor_rs: number | null;
  whatsapp_last_message_at: string | null;
  created_at: string;
};

type PortalData = {
  clientName: string;
  days: number;
  kpis: { total: number; fechados: number; valor: number; comOrigem: number };
  funil: { label: string; color: string; count: number }[];
  leads: PortalLead[];
};

type PortalMessage = {
  id: string;
  direction: 'in' | 'out';
  text: string;
  tipo: string;
  created_at: string;
};

const ORIGIN_LABELS: Record<string, string> = {
  meta: 'Meta Ads', google: 'Google', instagram: 'Instagram', tiktok: 'TikTok',
  youtube: 'YouTube', indicacao: 'Indicação', organic: 'Orgânico', anuncio: 'Anúncio',
  formulario: 'Formulário', cliente: 'Atendimento',
};

function brl(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function isMediaUrl(text: string) {
  return /^https?:\/\/\S+$/.test(text.trim());
}

function PortalBubble({ msg }: { msg: PortalMessage }) {
  const isOut = msg.direction === 'out';
  const t = msg.tipo ?? 'texto';
  const content = (() => {
    if (t === 'imagem' && isMediaUrl(msg.text)) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={msg.text} alt="Imagem" className="max-w-full rounded-lg max-h-60 object-cover" />;
    }
    if (t === 'audio' && isMediaUrl(msg.text)) {
      return <audio controls src={msg.text} className="max-w-full" />;
    }
    if (t === 'video' && isMediaUrl(msg.text)) {
      return <video controls src={msg.text} className="max-w-full max-h-52 rounded-lg" />;
    }
    if (t === 'documento' && isMediaUrl(msg.text)) {
      return (
        <a href={msg.text} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs underline">
          <FileText className="h-4 w-4 shrink-0" /> Documento
        </a>
      );
    }
    return <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>;
  })();
  return (
    <div className={`flex px-3 ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-xl px-3 py-2 ${isOut ? 'bg-[#1d3320] border border-[#55f52f]/20' : 'bg-[#1a1a1a] border border-[#2a2c33]'}`}>
        {content}
        <p className="mt-1 text-right text-[10px] text-[#8a9188]">
          {new Date(msg.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

export default function PortalClientePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [days, setDays] = useState(30);
  const [openLead, setOpenLead] = useState<PortalLead | null>(null);
  const [messages, setMessages] = useState<PortalMessage[] | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/portal/${token}?days=${days}`)
      .then(async r => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.ok ? r.json() as Promise<PortalData> : null;
      })
      .then(d => { if (d) setData(d); })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [token, days]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!openLead) { setMessages(null); return; }
    let active = true;
    fetch(`/api/portal/${token}/messages/${openLead.id}`)
      .then(r => r.ok ? r.json() as Promise<{ messages: PortalMessage[] }> : null)
      .then(d => { if (active) setMessages(d?.messages ?? []); })
      .catch(() => { if (active) setMessages([]); });
    return () => { active = false; };
  }, [openLead, token]);

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0e0f14] px-6 text-center">
        <div>
          <p className="mb-3 text-5xl">🔒</p>
          <p className="text-lg font-bold text-white">Link inválido ou revogado</p>
          <p className="mt-2 text-sm text-[#9aa1a6]">Peça um novo link de acesso para a equipe ONMID.</p>
        </div>
      </div>
    );
  }

  const maxFunil = Math.max(1, ...(data?.funil.map(f => f.count) ?? [1]));

  return (
    <div className="min-h-screen bg-[#0e0f14] pb-16 text-white" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <header className="border-b border-[#22242a] bg-[#121319]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#55f52f]">Onmid · Acompanhamento</p>
            <h1 className="truncate text-lg font-bold">{data?.clientName ?? 'Carregando…'}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#2a2c33] bg-[#17181d] p-0.5">
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${days === d ? 'bg-[#55f52f] text-black' : 'text-[#9aa1a6]'}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-6">
        {loading && !data ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-[#17181d]" />)}
          </div>
        ) : data && (
          <>
            {/* KPIs */}
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Leads no período', value: String(data.kpis.total), icon: MessageCircle, color: '#55f52f' },
                { label: 'Com origem de anúncio', value: data.kpis.total > 0 ? `${Math.round((data.kpis.comOrigem / data.kpis.total) * 100)}%` : '—', icon: Crosshair, color: '#3ba9f2' },
                { label: 'Negócios fechados', value: String(data.kpis.fechados), icon: CheckCircle2, color: '#a855f7' },
                { label: 'Valor fechado', value: data.kpis.valor > 0 ? brl(data.kpis.valor) : '—', icon: BadgeDollarSign, color: '#f2a93c' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="rounded-xl border border-[#22242a] bg-[#17181d] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9.5px] font-bold uppercase tracking-wider text-[#8a9188]">{label}</p>
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                  </div>
                  <p className="mt-1.5 truncate text-lg font-bold tabular-nums" style={{ color }}>{value}</p>
                </div>
              ))}
            </section>

            {/* Funil */}
            {data.funil.length > 0 && (
              <section className="rounded-xl border border-[#22242a] bg-[#17181d] p-4">
                <p className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#8a9188]">
                  <TrendingUp className="h-3.5 w-3.5 text-[#55f52f]" /> Funil de atendimento
                </p>
                <div className="space-y-2">
                  {data.funil.map(stage => (
                    <div key={stage.label} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 truncate text-xs font-semibold text-[#c9cec7]" title={stage.label}>{stage.label}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#22242a]">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${Math.max(3, Math.round((stage.count / maxFunil) * 100))}%`, background: stage.color || '#55f52f', opacity: stage.count === 0 ? 0.25 : 1 }} />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums">{stage.count}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Leads */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#8a9188]">
                  {data.leads.length} contato{data.leads.length !== 1 ? 's' : ''} · últimos {data.days} dias
                </p>
                <button onClick={load} className="rounded-lg border border-[#2a2c33] p-1.5 text-[#9aa1a6] transition-colors hover:text-white">
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              {data.leads.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#2a2c33] p-10 text-center text-sm text-[#8a9188]">
                  Nenhum contato no período.
                </div>
              ) : (
                <div className="space-y-2">
                  {data.leads.map(lead => {
                    const campanha = [lead.campaign_name, lead.ad_name].filter(Boolean).join(' · ')
                      || lead.utm_campaign || lead.keyword || null;
                    const regiao = lead.regiao_cidade ?? lead.regiao_uf;
                    return (
                      <button key={lead.id} onClick={() => setOpenLead(lead)}
                        className="w-full rounded-xl border border-[#22242a] bg-[#17181d] p-3.5 text-left transition-colors hover:border-[#55f52f]/40">
                        <div className="flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-sm font-bold">{lead.nome ?? lead.numero ?? 'Contato'}</p>
                          <span className="shrink-0 text-[10px] text-[#8a9188] tabular-nums">{fmtDate(lead.whatsapp_last_message_at ?? lead.created_at)}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {lead.status && (
                            <span className="rounded-full border border-[#2a2c33] bg-[#1d1f25] px-2 py-0.5 text-[10px] font-bold text-[#c9cec7]">{lead.status}</span>
                          )}
                          {lead.origin && (
                            <span className="rounded-full bg-[#3ba9f2]/15 px-2 py-0.5 text-[10px] font-bold text-[#3ba9f2]">{ORIGIN_LABELS[lead.origin] ?? lead.origin}</span>
                          )}
                          {lead.fechou && (
                            <span className="rounded-full bg-[#55f52f]/15 px-2 py-0.5 text-[10px] font-bold text-[#55f52f]">
                              Fechado{lead.valor_rs ? ` · ${brl(Number(lead.valor_rs))}` : ''}
                            </span>
                          )}
                          {regiao && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-[#8a9188]"><MapPin className="h-3 w-3" />{regiao}</span>
                          )}
                        </div>
                        {campanha && (
                          <p className="mt-1.5 truncate text-[11px] text-[#8a9188]" title={campanha}>
                            <span className="text-[#55f52f]">▸</span> {campanha}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Conversa read-only */}
      {openLead && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#0e0f14]">
          <header className="flex items-center gap-3 border-b border-[#22242a] bg-[#121319] px-4 py-3">
            <button onClick={() => setOpenLead(null)} className="rounded-lg p-1.5 text-[#9aa1a6] hover:text-white">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{openLead.nome ?? openLead.numero ?? 'Contato'}</p>
              <p className="text-[10px] text-[#8a9188]">Conversa · somente leitura</p>
            </div>
            <button onClick={() => setOpenLead(null)} className="rounded-lg p-1.5 text-[#9aa1a6] hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-2 overflow-y-auto py-4">
            {messages === null ? (
              <p className="pt-10 text-center text-xs text-[#8a9188]">Carregando conversa…</p>
            ) : messages.length === 0 ? (
              <p className="pt-10 text-center text-xs text-[#8a9188]">Nenhuma mensagem registrada.</p>
            ) : (
              messages.map(m => <PortalBubble key={m.id} msg={m} />)
            )}
          </div>
        </div>
      )}

      <footer className="mx-auto mt-10 max-w-3xl px-4 text-center text-[10px] text-[#5a5f5d]">
        Painel de acompanhamento gerado pela ONMID · atualizado em tempo real
      </footer>
    </div>
  );
}
