// Harness da faixa "Faturamento por Criativo".
//
// A página do dashboard não monta em bundle isolado (usa next/link e exige
// DATABASE_URL), então a faixa é montada sozinha com os números REAIS de
// agosto/2026 medidos em produção.
import { createRoot } from 'react-dom/client';
import { CreativeRevenueStrip, type CriativoReceita } from '@/components/dashboard/creative-revenue-strip';

const REAIS: CriativoReceita[] = [
  { adKey: 'a', adId: '1', adName: 'DARK - FACETAS 01', campaignName: '[ON] [ENGAJAMENTO] [FACETAS]',
    clientName: 'Sorrifácil Presidente Prudente', leads: 34, vendas: 3, receita: 14188.27, thumbnail: null },
  { adKey: 'b', adId: '2', adName: 'DARK - PERDEU UM DENTE', campaignName: '[ON] [ENGAJAMENTO] [VÍDEOS_JULHO_2026]',
    clientName: 'Sorrifácil Presidente Prudente', leads: 51, vendas: 4, receita: 8950, thumbnail: null },
  { adKey: 'c', adId: '3', adName: 'AD4 ANDREIA 2', campaignName: '[ON] [FORMS] [MAIO] [PROSPECÇÃO]',
    clientName: 'Incorpast', leads: 43, vendas: 1, receita: 1330.8, thumbnail: null },
];
const total = REAIS.reduce((s, c) => s + c.receita, 0);

function Bloco({ titulo, criativos, loading }: { titulo: string; criativos: CriativoReceita[]; loading: boolean }) {
  return (
    <section className="mb-6 rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 p-4">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-[#6cff2f]">{titulo}</p>
      <div className="border-b border-white/[0.06] pb-4">
        <div className="mb-1 flex items-center gap-2 text-xs font-black uppercase tracking-[0.07em] text-[#dce4e8]">
          Faturamento por Criativo
          <span className="rounded bg-[#6cff2f]/12 px-1.5 py-0.5 text-[9px] font-black text-[#6cff2f]">CRM</span>
        </div>
        <p className="mb-3 text-[10px] text-[#9aa4aa]">
          Vendas do período que dá para rastrear até o anúncio que trouxe o lead
          {criativos.length > 0 && <> · total atribuído {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</>}
        </p>
        <CreativeRevenueStrip criativos={criativos} loading={loading} />
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-[#0e0f14] p-6">
    <Bloco titulo="com dados reais de agosto" criativos={REAIS} loading={false} />
    <Bloco titulo="carregando" criativos={[]} loading />
    <Bloco titulo="sem faturamento atribuído (a faixa some)" criativos={[]} loading={false} />
  </div>
);
