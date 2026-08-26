/**
 * Atribuição de resultado das campanhas de Fidelidade (pura, client-safe).
 *
 * A pergunta é "quanto essa campanha trouxe de volta?", e a resposta sai do
 * cruzamento entre QUEM RECEBEU e QUEM PEDIU depois — pelo telefone, que é a
 * mesma chave que o funil de recorrência já usa.
 *
 * ⚠️ Duas regras de atribuição, nesta ordem:
 *  1. CUPOM — o pedido veio com o código daquela campanha. É prova, não
 *     indício: vale mesmo fora da janela de dias.
 *  2. JANELA — a pessoa recebeu e pediu dentro de N dias. É o que permite
 *     medir campanha SEM cupom, coisa que o painel do Cardápio Web não faz
 *     (lá, sem cupom o investimento aparece zerado).
 *
 * ⚠️ Um pedido conta UMA vez: para a campanha do envio MAIS RECENTE antes
 * dele. Sem isso, duas campanhas que falaram com a mesma pessoa somariam a
 * mesma receita cada uma, e o total da tela passaria do faturamento real.
 */

export type EnvioAtribuivel = {
  campanhaId: string;
  /** Telefone normalizado — a mesma chave usada no cooldown. */
  chave: string;
  /** ISO. Só envios efetivamente entregues entram. */
  enviadoEm: string;
  cupom?: string | null;
};

export type PedidoAtribuivel = {
  /** Telefone normalizado. */
  chave: string;
  criadoEm: string;
  total: number;
  /** Código do cupom usado no pedido, quando houver. */
  cupom?: string | null;
  cancelado?: boolean;
};

export type ResultadoCampanha = {
  campanhaId: string;
  enviadas: number;
  pedidos: number;
  receita: number;
  /** Pedidos ÷ enviadas. null sem envio — 0% seria uma afirmação falsa. */
  conversao: number | null;
  /** Receita ÷ pedidos. null sem pedido. */
  ticketMedio: number | null;
  /** Quantos dos pedidos vieram com o cupom da campanha. */
  porCupom: number;
};

const DIA_MS = 86_400_000;

export function atribuirResultados(
  envios: EnvioAtribuivel[],
  pedidos: PedidoAtribuivel[],
  janelaDias = 7,
): Map<string, ResultadoCampanha> {
  const porCampanha = new Map<string, ResultadoCampanha>();
  const zere = (id: string) => {
    if (!porCampanha.has(id)) {
      porCampanha.set(id, {
        campanhaId: id, enviadas: 0, pedidos: 0, receita: 0,
        conversao: null, ticketMedio: null, porCupom: 0,
      });
    }
    return porCampanha.get(id)!;
  };

  // Envios por pessoa, do mais recente para o mais antigo.
  const porChave = new Map<string, EnvioAtribuivel[]>();
  for (const e of envios) {
    zere(e.campanhaId).enviadas += 1;
    const lista = porChave.get(e.chave);
    if (lista) lista.push(e); else porChave.set(e.chave, [e]);
  }
  for (const lista of porChave.values()) {
    lista.sort((a, b) => b.enviadoEm.localeCompare(a.enviadoEm));
  }

  for (const p of pedidos) {
    if (p.cancelado) continue;
    const lista = porChave.get(p.chave);
    if (!lista) continue;

    const cupomPedido = (p.cupom ?? '').trim().toUpperCase();
    const quando = new Date(p.criadoEm).getTime();
    if (!Number.isFinite(quando)) continue;

    let escolhido: EnvioAtribuivel | null = null;
    let viaCupom = false;

    for (const e of lista) {
      const enviado = new Date(e.enviadoEm).getTime();
      if (!Number.isFinite(enviado) || enviado > quando) continue; // pedido veio ANTES do envio

      // Cupom é prova: fecha na primeira coincidência, sem olhar a janela.
      if (cupomPedido && (e.cupom ?? '').trim().toUpperCase() === cupomPedido) {
        escolhido = e; viaCupom = true; break;
      }
      // Janela: o envio mais recente que alcança o pedido leva o crédito.
      if (!escolhido && quando - enviado <= janelaDias * DIA_MS) escolhido = e;
    }

    if (!escolhido) continue;
    const r = zere(escolhido.campanhaId);
    r.pedidos += 1;
    r.receita += Number(p.total) || 0;
    if (viaCupom) r.porCupom += 1;
  }

  for (const r of porCampanha.values()) {
    r.conversao = r.enviadas > 0 ? r.pedidos / r.enviadas : null;
    r.ticketMedio = r.pedidos > 0 ? r.receita / r.pedidos : null;
  }
  return porCampanha;
}
