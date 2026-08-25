// Harness dos painéis "Quem vendeu mais" e "Categorias mais vendidas".
//
// A página do dashboard não monta em bundle isolado (usa next/link e exige
// DATABASE_URL), então os dois painéis são montados sozinhos com números
// reais da conta do Agendor.
import { createRoot } from 'react-dom/client';
import { VendedoresCard, CategoriasCard, type LinhaVendedor, type LinhaCategoria }
  from '@/components/dashboard/desempenho-comercial';

const VENDEDORES: LinhaVendedor[] = [
  { responsavel: 'Bruna Stersa', ganhos: 17, ganhos_valor: 54090.05, perdidos: 4, perdidos_valor: 36958, novos: 106, novos_valor: 52263.95 },
  { responsavel: 'Jessica', ganhos: 32, ganhos_valor: 50506.20, perdidos: 3, perdidos_valor: 0, novos: 181, novos_valor: 80002.10 },
  { responsavel: 'Rodolfo Pacheco', ganhos: 8, ganhos_valor: 21453, perdidos: 0, perdidos_valor: 0, novos: 10, novos_valor: 31568 },
  { responsavel: 'Andréa Mendes', ganhos: 4, ganhos_valor: 19362.50, perdidos: 6, perdidos_valor: 63471.20, novos: 8, novos_valor: 84191.30 },
  { responsavel: 'Junio', ganhos: 3, ganhos_valor: 1679.70, perdidos: 0, perdidos_valor: 0, novos: 4, novos_valor: 12212.70 },
];

const CATEGORIAS: LinhaCategoria[] = [
  { categoria: 'Copos Térmicos', negocios: 12, valor: 18400 },
  { categoria: 'Canetas de Metal', negocios: 11, valor: 4300 },
  { categoria: 'Blocos e Cadernetas', negocios: 10, valor: 9100 },
  { categoria: 'Diversos', negocios: 9, valor: 6200 },
  { categoria: 'Canecas de Metal', negocios: 5, valor: 7300 },
  { categoria: 'Mochilas e Bolsas', negocios: 4, valor: 22800 },
  { categoria: 'Necessaires', negocios: 4, valor: 3100 },
  { categoria: 'Chaveiros de Metal', negocios: 4, valor: 900 },
  { categoria: 'Squeezes e Garrafas Térmicas', negocios: 4, valor: 5600 },
  { categoria: 'Pasta Catálogo', negocios: 3, valor: 2400 },
  { categoria: 'Agendas', negocios: 2, valor: 1800 },
  { categoria: 'Sem categoria', negocios: 6, valor: 1200 },
];

function Painel({ rotulo, vend, cat, loading }: {
  rotulo: string; vend: LinhaVendedor[]; cat: LinhaCategoria[]; loading: boolean;
}) {
  return (
    <section className="mb-6 rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 p-4">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-[#6cff2f]">{rotulo}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.07em] text-[#dce4e8]">
            Quem vendeu mais
            <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-black text-[#9aa4aa]">CRM</span>
          </div>
          <VendedoresCard linhas={vend} loading={loading} />
        </div>
        <div className="min-w-0">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.07em] text-[#dce4e8]">
            Categorias mais vendidas
          </div>
          <CategoriasCard linhas={cat} loading={loading} />
        </div>
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-[#0e0f14] p-6">
    <Painel rotulo="com dados" vend={VENDEDORES} cat={CATEGORIAS} loading={false} />
    <Painel rotulo="carregando" vend={[]} cat={[]} loading />
    <Painel rotulo="sem responsável nem produto" vend={[]} cat={[]} loading={false} />
  </div>
);
