import { createRoot } from 'react-dom/client';
import { DICAS_ATENDIMENTO, InfoDica } from '../src/app/(dashboard)/crm/info-dica';
function App() {
  return (
    <div className="min-h-screen bg-background p-10 text-foreground">
      <section className="rounded-2xl border border-white/[0.08] bg-[#0D1519] p-5">
        <h3 className="flex items-center gap-1.5 text-base font-bold">Classificação dos atendimentos <InfoDica texto={DICAS_ATENDIMENTO.classificacao} /></h3>
        <p className="mt-4 flex items-center gap-1.5 text-sm font-semibold" style={{ color: '#EF4444' }}>Sem resposta <InfoDica texto={`${DICAS_ATENDIMENTO.semResposta}\n\n${DICAS_ATENDIMENTO.variacao}`} /></p>
        <table className="mt-4 text-xs"><thead><tr><th className="pr-3"><span className="inline-flex items-center gap-1">Tempo de resposta <InfoDica texto="Mediana do tempo entre o cliente falar e a nossa resposta." /></span></th></tr></thead></table>
      </section>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
