"use client";

// Detalhe de um lead, aberto a partir da lista do Funil de Performance.
//
// ⚠️ É LEITURA, não edição. O modal do CRM (`QuickEditModal`) grava status,
// valor e booleanos, e replicá-lo aqui significaria dois lugares que editam o
// mesmo lead com regras que envelheceriam em separado — sem contar que salvar
// daqui deixaria a lista e o card do funil desatualizados na tela. Para mexer,
// o botão manda para o CRM, que é onde a edição mora.
//
// Em compensação mostra o que o CRM não mostra junto: a cadeia de atribuição
// (canal, campanha, conjunto, anúncio, click id) e a região.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** O lead como o banco devolve — colunas variam por instalação, então tudo é opcional. */
type LeadBruto = Record<string, unknown>;

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s !== 'null' ? s : null;
};
const numero = (v: unknown): number => Number(v) || 0;
const dataBR = (v: unknown): string | null => {
  const s = texto(v);
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  if (iso) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? s : dt.toLocaleDateString('pt-BR');
};

function Campo({ rotulo, valor, destaque }: { rotulo: string; valor: string | null; destaque?: boolean }) {
  if (!valor) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black uppercase tracking-[0.07em] text-[#6b7478]">{rotulo}</p>
      <p className={cn('mt-0.5 break-words text-[12px]', destaque ? 'font-bold text-[#6cff2f]' : 'text-[#dce4e8]')}>
        {valor}
      </p>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/[0.06] px-5 py-3">
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#9aa4aa]">{titulo}</p>
      <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function FunilLeadDetalhe({ leadId, clientId, canal, onClose }: {
  leadId: string;
  clientId: string;
  /** Canal já derivado pela lista — a coluna crua do banco costuma ser a porta de entrada. */
  canal: string | null;
  onClose: () => void;
}) {
  const [lead, setLead] = useState<LeadBruto | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  useEffect(() => {
    let vivo = true;
    setLead(null);
    setErro(false);
    fetch(`/api/crm/${leadId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('falhou'))))
      .then((j: { lead?: LeadBruto }) => { if (vivo) setLead(j.lead ?? null); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [leadId]);

  const l = lead ?? {};
  const nome = texto(l.nome) ?? texto(l.numero) ?? 'Lead sem nome';
  const valor = numero(l.revenue) || numero(l.valor_rs);
  const regiao = [texto(l.regiao_cidade), texto(l.regiao_uf)].filter(Boolean).join(' / ') || null;
  const clickId = texto(l.ctwa_clid) ? 'CTWA (anúncio no WhatsApp)'
    : texto(l.gclid) || texto(l.wbraid) || texto(l.gbraid) ? 'gclid (Google Ads)'
    : texto(l.fbclid) ? 'fbclid (Meta)' : null;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-white/[0.10] bg-[#0b1216] shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">{nome}</h3>
            <p className="mt-0.5 truncate text-[11px] text-[#9aa4aa]">
              {[texto(l.numero), texto(l.email)].filter(Boolean).join(' · ') || 'sem contato registrado'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar"
            className="ml-auto rounded-md p-1 text-[#9aa4aa] hover:bg-white/[0.06] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {erro ? (
            <p className="py-10 text-center text-sm text-[#9aa4aa]">Não foi possível carregar este lead.</p>
          ) : lead === null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-[#9aa4aa]">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </p>
          ) : (
            <>
              <Bloco titulo="Situação">
                <Campo rotulo="Status no CRM" valor={texto(l.status)} />
                <Campo rotulo="Canal" valor={canal ?? 'não registrado'} />
                <Campo rotulo="Valor" valor={valor > 0 ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null} destaque />
                <Campo rotulo="Consulta marcada" valor={dataBR(l.data_agendada)} />
                <Campo rotulo="Entrou em" valor={dataBR(l.lead_date ?? l.data ?? l.created_at)} />
                <Campo rotulo="Fechado em" valor={dataBR(l.fechado_em)} />
              </Bloco>

              <Bloco titulo="Origem do lead">
                <Campo rotulo="Campanha" valor={texto(l.campaign_name) ?? texto(l.utm_campaign)} />
                <Campo rotulo="Conjunto" valor={texto(l.adset_name)} />
                <Campo rotulo="Anúncio" valor={texto(l.ad_name) ?? texto(l.creative_name)} />
                <Campo rotulo="Rastreio" valor={clickId} />
                <Campo rotulo="utm_source" valor={texto(l.utm_source)} />
                <Campo rotulo="Palavra-chave" valor={texto(l.keyword)} />
                <Campo rotulo="Região" valor={regiao} />
                <Campo rotulo="Como o dado entrou" valor={texto(l.origin)} />
              </Bloco>

              {texto(l.observacao) && (
                <div className="border-t border-white/[0.06] px-5 py-3">
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-[#9aa4aa]">Observação</p>
                  <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[#dce4e8]">
                    {texto(l.observacao)}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-white/[0.08] px-5 py-3">
          <p className="min-w-0 flex-1 text-[10px] leading-snug text-[#6b7478]">
            Só leitura. Para editar status, valor ou conversar, abra no CRM.
          </p>
          <Link
            href={`/crm?clientId=${encodeURIComponent(clientId)}&lead=${encodeURIComponent(leadId)}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#6cff2f] px-3 py-1.5 text-[11px] font-bold text-black"
          >
            Abrir no CRM <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
