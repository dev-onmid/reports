// Stub de @/lib/crm-ai-analysis para o teste do lote.
// ⚠️ O estado mora em globalThis de propósito: o esbuild EMBUTE este arquivo no
// bundle, então o módulo que o teste importa e o que o lote usa são cópias
// diferentes. Sem o global, o teste leria um array sempre vazio e os asserts
// passariam/falhariam por motivo errado.
globalThis.__stubIa ??= { chamadas: [], emVoo: 0, comportamento: null };
const st = globalThis.__stubIa;

export async function analisarConversa(pool, leadId, opcoes = {}) {
  st.chamadas.push({ leadId, opcoes, emParalelo: st.emVoo });
  st.emVoo += 1;
  try {
    await new Promise(r => setTimeout(r, 5));
    return st.comportamento
      ? st.comportamento(leadId)
      : { analisou: true, moveuStatus: true, moveuTemperatura: false };
  } finally { st.emVoo -= 1; }
}
