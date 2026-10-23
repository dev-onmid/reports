/**
 * Faturamento por CANAL de quem vende em cardápio digital (Anota Aí, Cardápio
 * Web) — pedido do Matheus, 2026-10-23: o card "Faturamento por canal" lia só o
 * CRM e ficava vazio no delivery, onde o dinheiro está nos pedidos.
 *
 * Três fontes que se completam, sem uma anular a outra:
 *  • PEDIDOS do cardápio, pelo canal de venda (iFood × cardápio próprio) — o total.
 *  • COMPRAS que a Meta atribuiu aos anúncios, por plataforma (Instagram,
 *    Facebook…) — a parte do cardápio que veio de anúncio. O resto do cardápio é
 *    "sem anúncio" (orgânico, direto, recompra).
 *  • Vendas ganhas no CRM (WhatsApp, planilha…), cada uma pela fonte.
 *
 * ⚠️ A parte da Meta é a atribuição DELA (clique e visualização, janela de dias),
 * não rastreio pedido a pedido — o "como conheceu" do Anota Aí vem vazio. Por
 * isso ela é recortada do cardápio e nunca passa dele.
 *
 * Pura: a rota /api/delivery/faturamento-canal busca, aqui só se monta.
 */

export type CanalDelivery = { label: string; receita: number; vendas: number; ticket: number | null };

/** Canal de venda do pedido → rótulo. iFood é marketplace; o resto é o cardápio próprio. */
export function canalDoPedido(salesChannel: string | null | undefined): 'ifood' | 'cardapio' | string {
  const c = String(salesChannel ?? '').trim().toLowerCase();
  if (c === 'ifood') return 'ifood';
  if (!c || ['anotaai', 'anota_ai', 'catalog', 'app', 'site', 'web', 'delivery', 'digital_menu'].includes(c)) return 'cardapio';
  return c;
}

const ROTULO_PLATAFORMA: Record<string, string> = {
  instagram: 'Instagram · anúncio',
  facebook: 'Facebook · anúncio',
  messenger: 'Messenger · anúncio',
  audience_network: 'Audience Network · anúncio',
  whatsapp: 'WhatsApp · anúncio',
  threads: 'Threads · anúncio',
};

export type EntradaFaturamentoDelivery = {
  /** Pedidos válidos do período por canal de venda (`canalDoPedido`). */
  pedidos: Record<string, { receita: number; pedidos: number }>;
  /** Compras atribuídas pela Meta por `publisher_platform`. */
  meta: Record<string, { receita: number; compras: number }>;
  /** Vendas ganhas no CRM por rótulo de fonte (ex.: "WhatsApp · CRM"). */
  crm: Record<string, { receita: number; vendas: number }>;
};

const linha = (label: string, receita: number, vendas: number): CanalDelivery =>
  ({ label, receita, vendas, ticket: vendas > 0 && receita > 0 ? receita / vendas : null });

export function montarFaturamentoDelivery(e: EntradaFaturamentoDelivery): { origens: CanalDelivery[]; total: number } {
  const origens: CanalDelivery[] = [];
  const cardapio = e.pedidos.cardapio ?? { receita: 0, pedidos: 0 };

  // A Meta só pode ter tirado do cardápio o que o cardápio tem: se a atribuição
  // passar do total (janela de 7 dias pegando pedido de fora do período), as
  // fatias da Meta encolhem na proporção e o "sem anúncio" fica em zero.
  const metaTotal = Object.values(e.meta).reduce((s, m) => s + m.receita, 0);
  const escala = metaTotal > cardapio.receita && metaTotal > 0 ? cardapio.receita / metaTotal : 1;
  let metaReceita = 0;
  let metaCompras = 0;
  for (const [plat, m] of Object.entries(e.meta)) {
    if (m.receita <= 0 && m.compras <= 0) continue;
    const receita = m.receita * escala;
    metaReceita += receita;
    metaCompras += m.compras;
    origens.push(linha(ROTULO_PLATAFORMA[plat] ?? 'Meta · plataforma não informada', receita, m.compras));
  }
  const semAnuncio = cardapio.receita - metaReceita;
  if (semAnuncio > 0.005) {
    origens.push(linha('Cardápio digital · sem anúncio', semAnuncio, Math.max(0, cardapio.pedidos - metaCompras)));
  }
  for (const [canal, p] of Object.entries(e.pedidos)) {
    if (canal === 'cardapio' || p.receita <= 0) continue;
    origens.push(linha(canal === 'ifood' ? 'iFood' : canal.charAt(0).toUpperCase() + canal.slice(1), p.receita, p.pedidos));
  }
  for (const [label, v] of Object.entries(e.crm)) {
    if (v.receita <= 0 && v.vendas <= 0) continue;
    origens.push(linha(label, v.receita, v.vendas));
  }

  // Rótulos iguais (duas plataformas sem nome) viram uma linha só.
  const porLabel = new Map<string, CanalDelivery>();
  for (const o of origens) {
    const a = porLabel.get(o.label);
    if (!a) { porLabel.set(o.label, { ...o }); continue; }
    a.receita += o.receita;
    a.vendas += o.vendas;
    a.ticket = a.vendas > 0 && a.receita > 0 ? a.receita / a.vendas : null;
  }
  const finais = [...porLabel.values()].filter((o) => o.receita > 0 || o.vendas > 0).sort((a, b) => b.receita - a.receita);
  return { origens: finais, total: finais.reduce((s, o) => s + o.receita, 0) };
}

/**
 * Conta de anúncio compartilhada entre lojas (PicoLocos Guanabara e Prochet
 * usam a mesma): campanha com o nome da OUTRA loja ("[PROCHET]") não é desta.
 * Devolve as palavras do nome das outras lojas que não aparecem no nome desta.
 */
export function palavrasDeOutrasLojas(nomeCliente: string, outros: string[]): string[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const minhas = new Set(norm(nomeCliente).split(/[^a-z0-9]+/).filter(Boolean));
  const out = new Set<string>();
  for (const o of outros) {
    for (const w of norm(o).split(/[^a-z0-9]+/)) if (w.length >= 4 && !minhas.has(w)) out.add(w);
  }
  return [...out];
}

export function campanhaDeOutraLoja(nomeCampanha: string, palavras: string[]): boolean {
  if (palavras.length === 0) return false;
  const n = nomeCampanha.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return palavras.some((w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(n));
}
