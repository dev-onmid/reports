import { createRoot } from 'react-dom/client';
import { Tag, Users, Eye } from 'lucide-react';
import { CustoMetaCard, BulletMetaCard } from '@/components/dashboard/bullet-meta';
import { IndicadorCard } from '@/components/dashboard/indicador-card';
import { formatCurrencyBRL } from '@/lib/utils';
const f = (n: number) => formatCurrencyBRL(n);
function App() {
  return (
    <div style={{ padding: 24, maxWidth: 1300 }} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <BulletMetaCard titulo="Leads" icon={Users} fonte="Meta + Google (plataformas)" metaMes={400} esperado={380} realizado={352} formatar={n => Math.round(n).toLocaleString('pt-BR')} projecao={371} />
        <CustoMetaCard titulo="CPL" icon={Tag} fonte="Meta + Google (plataformas)" meta={18} realizado={15.42} anterior={17.1} formatar={f} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <CustoMetaCard titulo="CPL (acima)" icon={Tag} fonte="Meta + Google" meta={18} realizado={23.9} anterior={19.4} formatar={f} />
        <CustoMetaCard titulo="CPL (pouco acima)" icon={Tag} fonte="Meta + Google" meta={18} realizado={19.8} formatar={f} />
        <CustoMetaCard titulo="CPL (sem meta)" icon={Tag} fonte="Meta + Google" meta={0} realizado={19.8} anterior={21} formatar={f} />
      </div>
      <div className="grid gap-4 xl:grid-cols-4">
        <IndicadorCard rotulo="Seguidores" icone={Users} cor="#e1306c" valor="14.374" destaque={{ texto: '+610 no período', bom: true }} nota="sem comparativo: o Instagram só informa ganho dos últimos 30 dias" />
        <IndicadorCard rotulo="Alcance" icone={Eye} cor="#e1306c" valor="85.540" variacao={-4.3} comparacao="vs 1–29/ago" nota="contas alcançadas" />
        <IndicadorCard rotulo="Seguidores (com base)" icone={Users} cor="#e1306c" valor="14.374" variacao={12.5} comparacao="ganho vs período anterior" nota="+180 no período" />
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
