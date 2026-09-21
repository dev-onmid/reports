// Harness visual do bloco Landing page (GA4) com dados fictícios.
//   ?json=arquivo.json carrega um Ga4Consolidado real salvo ao lado do harness (não versionar).
//   npx esbuild scratchpad/harness-ga4.tsx --bundle --format=iife --outfile=scratchpad/build-ga4/harness.js --tsconfig=tsconfig.json --jsx=automatic --define:process.env.NODE_ENV='"development"'
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Ga4LandingPanel } from '../src/components/dashboard/ga4-landing-panel';
import type { Ga4Consolidado, Ga4Seg } from '../src/lib/ga4-landing';

const t = (sessoes: number, whatsapp: number, telefone: number, cta: number) => ({ sessoes, usuarios: Math.round(sessoes * 0.85), novos: Math.round(sessoes * 0.7), pageviews: sessoes * 2, engajadas: Math.round(sessoes * 0.6), tempo: sessoes * 42, whatsapp, telefone, cta, leadForm: 0, video: 0, contatos: whatsapp + telefone, taxaContato: sessoes ? (whatsapp + telefone) / sessoes : 0 });
const seg = (valor: string, sessoes: number, conversoes: number, extra: Partial<Ga4Seg> = {}): Ga4Seg => ({ valor, sessoes, engajadas: Math.round(sessoes * 0.6), tempo: sessoes * 40, conversoes, sessoesConv: Math.round(conversoes * 0.8), ...extra });
const dados: Ga4Consolidado = {
  atual: t(1240, 96, 31, 210), anterior: t(980, 70, 40, 150),
  origens: [
    { origem: 'google', midia: 'cpc', sessoes: 812, contatos: 88 },
    { origem: 'instagram', midia: 'social', sessoes: 240, contatos: 22 },
    { origem: '(direto)', midia: '(nenhuma)', sessoes: 188, contatos: 17 },
  ],
  posicoes: [{ valor: 'modal-orcamento', n: 52 }, { valor: 'nav', n: 30 }, { valor: 'catalogo-item', n: 25 }, { valor: 'rodape', n: 12 }, { valor: 'flutuante', n: 8 }],
  detalhes: [
    { param: 'peca', rotulo: 'Peças mais pedidas', linhas: [{ valor: 'Caçamba Chevrolet 3100', n: 14 }, { valor: 'Tampa Tipo Militar CJ5', n: 9 }, { valor: 'Assoalho CJ5', n: 6 }] },
    { param: 'veiculo', rotulo: 'Veículos', linhas: [{ valor: 'Willys', n: 41 }, { valor: 'Chevrolet', n: 18 }, { valor: 'Engesa', n: 7 }] },
    { param: 'material', rotulo: 'Materiais', linhas: [{ valor: 'Aço carbono', n: 38 }, { valor: 'Inox', n: 11 }] },
  ],
  diario: [],
  pago: {
    canais: [seg('Paid Search', 812, 88), seg('Paid Social', 240, 22), seg('Direct', 188, 17)],
    campanhas: [seg('[ON] Pesquisa Peças', 600, 70, { sub: 'google / cpc' }), seg('lp-pecas-maio', 240, 22, { sub: 'instagram / paid' })],
    googleAds: [seg('[ON] Pesquisa Peças', 600, 70, { custo: 1840.5, cliques: 690 }), seg('[ON] PMax', 212, 18, { custo: 610, cliques: 260 })],
    palavras: [seg('caçamba chevrolet 3100', 120, 18), seg('peças willys', 90, 9)],
    termos: [seg('caçamba 3100 preço', 40, 7), seg('willys cj5 lataria', 31, 0)],
  },
  audiencia: {
    dispositivos: [seg('mobile', 980, 101), seg('desktop', 260, 26)], cidades: [seg('Londrina', 300, 40), seg('São Paulo', 180, 12)],
    novosRecorrentes: [seg('new', 1010, 90), seg('returning', 230, 37)], idades: [], generos: [],
    semanaHora: Array.from({ length: 7 * 24 }, (_, i) => ({ dia: Math.floor(i / 24), hora: i % 24, sessoes: (i % 24 > 7 && i % 24 < 22) ? 5 + ((i * 7) % 13) : 0, conversoes: (i % 24 > 9 && i % 24 < 19) ? (i % 3) : 0 })),
  },
  comportamento: {
    paginasEntrada: [seg('/', 1100, 120)], rolagem: [{ valor: '25', n: 800 }, { valor: '50', n: 520 }, { valor: '75', n: 300 }, { valor: '90', n: 210 }],
    secoes: [{ valor: 'catalogo', n: 700 }, { valor: 'contato', n: 240 }],
    funil: { visitantes: 1054, formInicio: 60, formErro: 4, leadForm: 41, leadConfirmado: 40 }, videos: [],
  },
  propriedades: [
    { propertyId: '552899534', nome: 'Cinfel - LP Peças de Lataria', atual: t(700, 60, 20, 120) },
    { propertyId: '552910041', nome: 'Cinfel - LP Corte a Laser', atual: t(540, 36, 11, 90) },
  ],
};
const vazio: Ga4Consolidado = { ...dados, atual: t(0, 0, 0, 0), origens: [], posicoes: [], detalhes: [], propriedades: [] };

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 shadow-[0_18px_60px_rgba(0,0,0,0.28)] border-[#F9AB00]/24 mb-6">{children}</section>;
}
function App() {
  const q = new URLSearchParams(location.search);
  const cenario = q.get('c') ?? 'cheio';
  const [real, setReal] = useState<Ga4Consolidado | null>(null);
  useEffect(() => { const j = q.get('json'); if (j) fetch(j).then(r => r.json()).then(setReal); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="p-6 bg-[#070c0f] min-h-screen text-white" style={{ maxWidth: 1200 }}>
      <Panel>
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#F9AB00]" /> Landing page</h3>
          <span className="text-[10px] text-[#7c868c]">Google Analytics 4</span>
        </div>
        {cenario === 'cheio' && <Ga4LandingPanel dados={q.get('json') ? real : dados} loading={!!q.get('json') && !real} />}
        {cenario === 'vazio' && <Ga4LandingPanel dados={vazio} loading={false} />}
        {cenario === 'loading' && <Ga4LandingPanel dados={null} loading={true} />}
        {cenario === 'aviso' && <Ga4LandingPanel dados={null} loading={false} aviso="Token do Google Analytics expirado — reconecte a conta em Integrações." />}
      </Panel>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
