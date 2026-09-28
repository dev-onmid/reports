import React, { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ExternalLink, ImageIcon, Play } from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { T } from '@/lib/dashboard-tipografia';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';
import { VendasPorAnuncioPanel, MetricasVenda } from '@/components/dashboard/vendas-por-anuncio';
import type { VendasPorAnuncio } from '@/app/api/crm/vendas-por-anuncio/route';
void React;
type PremiumMetricFormat = 'currency' | 'number' | 'percent' | 'times';

function premiumValue(value: number | null | undefined, format: PremiumMetricFormat = 'number', digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (format === 'currency') return formatCurrencyBRL(value);
  if (format === 'percent') return `${value.toFixed(digits).replace('.', ',')}%`;
  if (format === 'times') return `${value.toFixed(2).replace('.', ',')}x`;
  // ⚠️ Arredonda: o formato 'number' desta tela é sempre CONTAGEM (leads,
  // cliques, impressões, alcance, pedidos) e contagem não tem casa decimal.
  //
  // O Google Ads devolve `metrics.conversions` como DOUBLE de propósito —
  // atribuição não-último-clique divide o crédito de uma conversão entre os
  // pontos de contato, então uma campanha fica com uma fração dela. Medido em
  // produção na Londrigifts: 253,998318 + 139,166666 + 6 + 26,331404 + 2 =
  // 427,496388. Somado ao Meta, o card de Leads mostrava "376,998" como se
  // fosse gente. O número é REAL; o que não fazia sentido era exibi-lo assim.
  // A precisão continua inteira em tudo que é conta (CPL, taxas, séries).
  return Math.round(value).toLocaleString('pt-BR');
}

function creativeStatusInfo(status?: string): { label: string; dot: string; pill: string; titulo: string } | null {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return { label: 'Ativo', dot: 'bg-emerald-400', pill: 'border-emerald-400/30 bg-emerald-400/15 text-emerald-300', titulo: 'Anúncio ativo' };
  if (s === 'PAUSED' || s === 'ADSET_PAUSED' || s === 'CAMPAIGN_PAUSED')
    return { label: 'Pausado', dot: 'bg-amber-400', pill: 'border-amber-400/30 bg-amber-400/15 text-amber-300', titulo: `Pausado (${s})` };
  if (s === 'DISAPPROVED' || s === 'WITH_ISSUES')
    return { label: 'Com restrição', dot: 'bg-red-400', pill: 'border-red-400/30 bg-red-400/15 text-red-300', titulo: `Com restrição no Meta (${s})` };
  if (s === 'PENDING_REVIEW' || s === 'IN_PROCESS' || s === 'PENDING_BILLING_INFO' || s === 'PREAPPROVED')
    return { label: 'Em análise', dot: 'bg-sky-400', pill: 'border-sky-400/30 bg-sky-400/15 text-sky-300', titulo: `Em análise (${s})` };
  return { label: 'Inativo', dot: 'bg-[#9aa4aa]', pill: 'border-white/15 bg-white/[0.08] text-[#c3ccd1]', titulo: `Inativo (${s})` };
}

function creativeObjectiveMetrics(c: TopCreative): Array<{ label: string; value: string }> {
  if (c.leads > 0) {
    return [
      { label: 'Leads', value: premiumValue(c.leads) },
      { label: 'CPL', value: c.cpl > 0 ? premiumValue(c.cpl, 'currency') : '—' },
      { label: 'CTR', value: `${c.ctr.toFixed(2)}%` },
    ];
  }
  return [
    { label: 'Cliques', value: premiumValue(c.clicks) },
    { label: 'CTR', value: `${c.ctr.toFixed(2)}%` },
    { label: 'Invest.', value: premiumValue(c.spend, 'currency') },
  ];
}

function HorizontalCreativeCard({ creative, index, onPreview, fluido = false, metricas, selo }: {
  /** Ocupa a largura da célula da grade (em vez dos 220px fixos da faixa). */
  fluido?: boolean;
  /** Troca as métricas de plataforma por outras (ex.: vendas e faturamento do CRM). */
  metricas?: ReactNode;
  /** Troca o selo de investimento no canto da imagem (ex.: faturamento). */
  selo?: string;
  creative: TopCreative;
  index: number;
  onPreview: (c: TopCreative) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [imgStage, setImgStage] = useState<'primary' | 'thumb' | 'error'>('primary');

  const primaryUrl = creative.imageUrl;
  const thumbUrl = creative.thumbnailUrl;
  const imgUrl = imgStage === 'primary' ? (primaryUrl ?? thumbUrl) : imgStage === 'thumb' ? thumbUrl : undefined;
  const hasVideo = !!creative.videoUrl;
  const metrics = creativeObjectiveMetrics(creative);
  const st = creativeStatusInfo(creative.status);

  function handleImgError() {
    if (imgStage === 'primary' && primaryUrl && thumbUrl && thumbUrl !== primaryUrl) {
      setImgStage('thumb');
    } else {
      setImgStage('error');
    }
  }

  const showImage = !!imgUrl && imgStage !== 'error' && !imgFailed;

  return (
    <button
      type="button"
      onClick={() => onPreview(creative)}
      className={cn('group overflow-hidden rounded-xl bg-white/[0.03] text-left ring-1 ring-white/[0.05] transition hover:ring-[#6cff2f]/40', fluido ? 'w-full' : 'w-[220px] shrink-0')}
    >
      <div className="relative overflow-hidden bg-[#071014]" style={{ aspectRatio: '4/5' }}>
        {showImage ? (
          <img
            src={imgUrl}
            alt={creative.adName}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={handleImgError}
          />
        ) : creative.permalink ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 bg-black/30">
            <ExternalLink className="h-5 w-5 text-white/40" />
            <span className="text-[9px] text-white/30">Ver publicação</span>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-6 w-6 text-[#9aa4aa]/40" />
          </div>
        )}
        {/* Play centralizado — só quando há vídeo (confirma que toca no modal) */}
        {hasVideo && showImage && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 ring-1 ring-white/30 backdrop-blur-sm">
              <Play className="h-3.5 w-3.5 fill-white text-white" />
            </span>
          </span>
        )}
        {/* Selo Ativo/Pausado — leitura instantânea do status do anúncio */}
        {st && (
          <span className={cn('absolute left-2 top-2 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide backdrop-blur-sm', st.pill)} title={st.titulo}>
            <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} /> {st.label}
          </span>
        )}
        <span className="absolute bottom-2 left-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/85 text-[10px] font-black text-white">{index + 1}</span>
        <span className="absolute right-2 top-2 rounded bg-[#6cff2f] px-1.5 py-0.5 text-[9px] font-black text-black">
          {selo ?? premiumValue(creative.spend, 'currency')}
        </span>
      </div>
      <div className="p-2.5">
        {creative.campaignName && (
          <p className="mb-1 truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-[#6cff2f]/70" title={creative.campaignName}>
            {creative.campaignName}
          </p>
        )}
        <p className={cn('mb-2 truncate', T.listaRotulo)} title={creative.adName}>{creative.adName}</p>
        {/* Rótulo/valor em LINHAS: três caixinhas lado a lado em 170px
            cortavam o CPL em "R$ 4…". */}
        {metricas ?? <dl className="space-y-1 text-[11px]">
          {metrics.map(m => (
            <div key={m.label} className="flex items-baseline justify-between gap-2">
              <dt className="font-black uppercase tracking-[0.06em] text-[#9aa4aa]">{m.label}</dt>
              <dd className="whitespace-nowrap font-black tabular-nums text-[#f4f7f8]">{m.value}</dd>
            </div>
          ))}
        </dl>}
      </div>
    </button>
  );
}


function App() {
  const [d, setD] = useState<{ vendas: VendasPorAnuncio; previews: TopCreative[] } | null>(null);
  const vazio = new URLSearchParams(location.search).has('vazio');
  useEffect(() => { fetch('vendas-cambe.json').then(r => r.json()).then(setD); }, []);
  const prev = Object.fromEntries((d?.previews ?? []).map(c => [c.adId, c]));
  return (
    <div style={{ padding: 24, maxWidth: 1500 }}>
      <VendasPorAnuncioPanel
        dados={vazio ? { ...d!.vendas, criativos: [], campanhas: [], conjuntos: [] } : d?.vendas ?? null}
        loading={!d}
        investimentoDaCampanha={n => n.includes('AMPLO') ? 1830.4 : null}
        renderCriativo={(c, i) => {
          const p = c.adId ? prev[c.adId] : undefined;
          if (!p || i === 3) return null;
          return <HorizontalCreativeCard key={c.chave} creative={p} index={i} onPreview={x => alert(x.adName)} selo={c.receita > 0 ? formatCurrencyBRL(c.receita) : 'sem valor'} metricas={<MetricasVenda c={c} investimento={p.spend} />} />;
        }}
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
