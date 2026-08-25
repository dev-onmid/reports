// Harness dos painéis "Quem vendeu mais" e "Categorias mais vendidas".
//
// A página do dashboard não monta em bundle isolado (usa next/link e exige
// DATABASE_URL), então os dois painéis são montados sozinhos com números
// reais da conta do Agendor.
import { createRoot } from 'react-dom/client';
import { VendedoresCard, CategoriasCard, type LinhaVendedor, type LinhaCategoria }
  from '@/components/dashboard/desempenho-comercial';

const VENDEDORES: LinhaVendedor[] = [
  { responsavel: 'Bruna Stersa', ganhos: 66, ganhos_valor: 115131.22, perdidos: 37, perdidos_valor: 1171839.5, novos: 114, novos_valor: 1336592.22 },
  { responsavel: 'Jessica', ganhos: 49, ganhos_valor: 77675.65, perdidos: 44, perdidos_valor: 22116.5, novos: 116, novos_valor: 163657.25 },
  { responsavel: 'Junio', ganhos: 4, ganhos_valor: 13004, perdidos: 0, perdidos_valor: 0, novos: 5, novos_valor: 22404 },
  { responsavel: 'Andréa Mendes', ganhos: 8, ganhos_valor: 7918.14, perdidos: 14, perdidos_valor: 62245.3, novos: 22, novos_valor: 70163.44 },
  { responsavel: 'Nayara Artur', ganhos: 5, ganhos_valor: 3291, perdidos: 14, perdidos_valor: 178083.8, novos: 19, novos_valor: 181374.8 },
];

const CATEGORIAS: LinhaCategoria[] = [
  { categoria: 'Diversos', negocios: 24, itens: 2787, valor: 21656.46 },
  { categoria: 'Canetas de Plástico', negocios: 4, itens: 2500, valor: 6495 },
  { categoria: 'Canetas de Metal', negocios: 17, itens: 2251, valor: 12669 },
  { categoria: 'Blocos e Cadernetas', negocios: 13, itens: 1560, valor: 15436 },
  { categoria: 'Chaveiros de Metal', negocios: 7, itens: 1010, valor: 3482.5 },
  { categoria: 'Canecas de Metal', negocios: 13, itens: 909, valor: 16399.4 },
  { categoria: 'Copos Térmicos', negocios: 26, itens: 718, valor: 21879.4 },
  { categoria: 'Mochilas e Bolsas', negocios: 9, itens: 687, valor: 3903.4 },
  { categoria: 'Squeezes e Garrafas Térmicas', negocios: 8, itens: 520, valor: 6153.9 },
  { categoria: 'Kits de Churrasco', negocios: 9, itens: 310, valor: 31021.44 },
  { categoria: 'Necessaires', negocios: 4, itens: 240, valor: 3100 },
  { categoria: 'Sem categoria', negocios: 6, itens: 180, valor: 1200 },
];

function Painel({ rotulo, vend, cat, loading }: {
  rotulo: string; vend: LinhaVendedor[]; cat: LinhaCategoria[]; loading: boolean;
}) {
  return (
    <section className="mb-6 rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 p-4">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-[#6cff2f]">{rotulo}</p>
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-sm font-bold uppercase tracking-[0.07em] text-[#F1F4F5]">Performance comercial</h3>
        <span className="rounded-[4px] bg-[#172027] px-1.5 py-0.5 text-[10px] font-semibold text-[#87929B]">CRM</span>
      </div>
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <VendedoresCard linhas={vend} loading={loading} />
        <CategoriasCard linhas={cat} loading={loading} />
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
