// Harness do modal "Analisar com IA" — confere o texto de escopo e o fluxo
// prévia → confirmação. O page.tsx não monta em bundle isolado (next/link),
// por isso só o modal entra aqui; o recorte cliente+período é coberto pelos
// asserts de escopo em scratchpad/test-crm-ai-lote.mjs.
//
// npx esbuild scratchpad/harness-analise-ia.tsx --bundle --format=iife \
//   --outfile=public/__ia_test/app.js --loader:.tsx=tsx --jsx=automatic \
//   --alias:@/lib/utils=$PWD/scratchpad/stub-cn.ts --log-level=error
import { createRoot } from 'react-dom/client';
import AnaliseIaModal from '../src/app/(dashboard)/crm/analise-ia-modal';

const ids = Array.from({ length: 412 }, (_, i) => `lead-${i}`);

const real = window.fetch;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String((input as Request).url ?? input);
  if (url.includes('analisar-lote')) {
    const body = JSON.parse(String(init?.body ?? '{}'));
    (window as unknown as { __chamadas: unknown[] }).__chamadas ??= [];
    (window as unknown as { __chamadas: unknown[] }).__chamadas.push({ acao: body.acao, qtd: body.leadIds?.length });
    if (body.acao === 'prever') {
      return new Response(JSON.stringify({
        ok: true,
        candidatos: ids.slice(0, 318), jaAnalisados: 61, semConversa: 29, timeInterno: 4,
        blocos: 13, leadsPorBloco: 25, custo: { usd: 0.0763, brl: 0.42 },
      }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ok: true,
      analisados: body.leadIds.length, moveuStatus: 7, moveuTemperatura: 11, erros: 0,
    }), { headers: { 'content-type': 'application/json' } });
  }
  return real(input as RequestInfo, init);
};

createRoot(document.getElementById('root')!).render(
  <AnaliseIaModal clientId="client-1778639563347" clientName="CondoStore"
    leadIds={ids} periodoLabel="Mês atual"
    onClose={() => console.log('fechou')} onConcluido={() => console.log('concluiu bloco')} />,
);
