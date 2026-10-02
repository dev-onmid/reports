// Responde sempre "mude para Fechado, confiança 95" — é o cenário que dispara
// follow-up e conversão no caminho normal, e portanto o que o teste precisa.
export default class Anthropic {
  constructor() {
    this.messages = {
      create: async () => ({
        content: [{ type: 'text', text: JSON.stringify({
          status: 'Fechado', status_confianca: 95, status_deve_mudar: true,
          temperatura: 'quente', temperatura_confianca: 95, temperatura_deve_mudar: true,
          motivo: 'teste',
        }) }],
        usage: { input_tokens: 1000, output_tokens: 200 },
      }),
    };
  }
}
