/**
 * Cartão de campanha da Meta no dashboard — a MESMA leitura do slide
 * "Campanhas Veiculadas Meta Ads" do relatório (sMetaAdsCampanhas em
 * delivery-report-builder.ts): tipo pelo objetivo, uma frase do que aconteceu,
 * métricas do objetivo e os melhores criativos ranqueados pelo resultado dele.
 *
 * Pedido do Matheus (2026-10-23): a tabela de campanhas "está poluída"; replicar
 * o que o relatório impresso mostra. Pura e client-safe (a lib do relatório é
 * enorme e server-side — copiar a régua pequena sai mais barato que importá-la).
 *
 * ⚠️ Se mudar a régua do tipo ou do ranking aqui, mude no relatório também.
 */

export type TipoCampanha = 'mensagens' | 'leads' | 'vendas' | 'trafego' | 'alcance' | 'engajamento';

export const UNIDADE: Record<TipoCampanha, { um: string; varios: string; custo: string }> = {
  mensagens: { um: 'conversa', varios: 'conversas', custo: 'por conversa' },
  leads: { um: 'lead', varios: 'leads', custo: 'por lead' },
  vendas: { um: 'compra', varios: 'compras', custo: 'por compra' },
  trafego: { um: 'clique', varios: 'cliques', custo: 'por clique' },
  alcance: { um: 'pessoa alcançada', varios: 'pessoas alcançadas', custo: 'por mil' },
  engajamento: { um: 'engajamento', varios: 'engajamentos', custo: 'por engajamento' },
};

/**
 * Tipo pelo objetivo DECLARADO (nunca pelo que a campanha acabou entregando:
 * campanha de alcance com uma compra bônus continua sendo de alcance). Só o
 * engajamento é ambíguo — a Meta usa o mesmo objetivo para clique-para-WhatsApp
 * e para engajamento de post —, e só nele o resultado desempata.
 */
export function tipoDaCampanha(objetivoMeta: string | null | undefined, conversas: number, leadsFormulario: number): TipoCampanha {
  const o = String(objetivoMeta ?? '').toUpperCase();
  if (['OUTCOME_LEADS', 'LEAD_GENERATION'].includes(o)) return 'leads';
  if (o === 'MESSAGES') return 'mensagens';
  if (['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES'].includes(o)) return 'vendas';
  if (['OUTCOME_AWARENESS', 'BRAND_AWARENESS', 'REACH'].includes(o)) return 'alcance';
  if (['OUTCOME_TRAFFIC', 'LINK_CLICKS', 'TRAFFIC'].includes(o)) return 'trafego';
  if (conversas > 0) return 'mensagens';
  if (leadsFormulario > 0) return 'leads';
  return 'engajamento';
}

export type NumerosCampanha = {
  investimento: number;
  conversas: number;
  leads: number;
  compras: number;
  valorCompras: number;
  cliques: number;
  impressoes: number;
  alcance: number;
  frequencia: number;
};

export function resultadoDaCampanha(tipo: TipoCampanha, n: NumerosCampanha): number {
  switch (tipo) {
    case 'mensagens': return n.conversas;
    case 'leads': return n.leads;
    case 'vendas': return n.compras;
    case 'trafego': return n.cliques;
    case 'alcance': return n.alcance;
    default: return 0;
  }
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brl0 = (v: number) => (v > 0 ? brl(v) : '—');
const int = (v: number) => Math.round(v).toLocaleString('pt-BR');

/** Nome legível: sem os colchetes de nomenclatura ("[ON] [VENDAS] [ANOTA AÍ]…"). */
export function nomeLimpo(nome: string): string {
  const tags = [...nome.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim()).filter((t) => !/^(ON|OFF|OND)$/i.test(t));
  // Sobra depois dos colchetes sem o separador solto ("[AMPLO] — 2.0" → "2.0").
  const resto = nome.replace(/\[[^\]]*\]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[\s—–\-·|:]+/, '');
  const partes = [...tags, ...(resto ? [resto] : [])];
  const limpo = partes.join(' · ');
  return limpo || nome;
}

/** "O que aconteceu", na mesma redação do relatório. */
export function fraseDaCampanha(tipo: TipoCampanha, n: NumerosCampanha): string {
  const u = UNIDADE[tipo];
  if (tipo === 'alcance') {
    return `${brl0(n.investimento)} investidos alcançaram ${n.alcance > 0 ? int(n.alcance) : '—'} pessoas, com frequência de ${n.frequencia > 0 ? n.frequencia.toFixed(2).replace('.', ',') : '—'}.`;
  }
  if (tipo === 'engajamento') {
    return `${brl0(n.investimento)} investidos em engajamento, com ${n.alcance > 0 ? int(n.alcance) : '—'} pessoas alcançadas.`;
  }
  const r = resultadoDaCampanha(tipo, n);
  if (r <= 0) return `${brl0(n.investimento)} investidos sem ${u.varios} registrados no período.`;
  const custo = n.investimento > 0 ? n.investimento / r : 0;
  return `${brl0(n.investimento)} investidos geraram ${int(r)} ${r === 1 ? u.um : u.varios}, a ${brl(custo)} cada`
    + (tipo === 'vendas' && n.valorCompras > 0 ? `, somando ${brl(n.valorCompras)} em vendas` : '') + '.';
}

export type AnuncioDaCampanha = {
  id: string;
  nome: string;
  investimento: number;
  leads: number;
  compras: number;
  valorCompras: number;
  cliques: number;
  impressoes: number;
};

/** Resultado do anúncio pelo objetivo da campanha dele (alcance cai em impressões: o anúncio não traz alcance). */
export function resultadoDoAnuncio(tipo: TipoCampanha, a: AnuncioDaCampanha): number {
  if (tipo === 'mensagens' || tipo === 'leads') return a.leads;
  if (tipo === 'vendas') return a.compras;
  if (tipo === 'trafego') return a.cliques;
  return a.impressoes;
}

/**
 * Mesma régua do relatório (rankearCriativosDaCampanha): mais resultado primeiro;
 * vendas por VALOR vendido; empate pelo mais barato por resultado; sem resultado
 * vai para o fim, por investimento.
 */
export function rankearAnuncios<T extends AnuncioDaCampanha>(tipo: TipoCampanha, lista: T[]): T[] {
  const chave = (a: T) => (tipo === 'vendas' ? a.valorCompras || a.compras : resultadoDoAnuncio(tipo, a));
  return [...lista].sort((a, b) => {
    const ra = chave(a), rb = chave(b);
    if ((ra > 0) !== (rb > 0)) return ra > 0 ? -1 : 1;
    if (ra === 0) return b.investimento - a.investimento;
    if (rb !== ra) return rb - ra;
    const ca = a.investimento / (resultadoDoAnuncio(tipo, a) || 1);
    const cb = b.investimento / (resultadoDoAnuncio(tipo, b) || 1);
    return ca - cb;
  });
}

/** " O criativo que mais trouxe resultado foi "X", com N conversas." — só com 2+ anúncios. */
export function fraseDoCriativo(tipo: TipoCampanha, top: AnuncioDaCampanha | undefined, totalAnuncios: number): string {
  if (!top || totalAnuncios < 2) return '';
  const r = resultadoDoAnuncio(tipo, top);
  if (r <= 0 || tipo === 'alcance' || tipo === 'engajamento') return '';
  const u = UNIDADE[tipo];
  return ` O criativo que mais trouxe resultado foi "${nomeLimpo(top.nome)}", com ${int(r)} ${r === 1 ? u.um : u.varios}.`;
}

/** "no ar desde 12/06/2026 · 133 dias" — data de início em São Paulo. */
export function desdeQuando(inicioIso: string | null | undefined, agora: Date = new Date()): string | null {
  if (!inicioIso) return null;
  const d = new Date(inicioIso);
  if (Number.isNaN(d.getTime())) return null;
  const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const dias = Math.max(0, Math.floor((agora.getTime() - d.getTime()) / 86_400_000));
  return `desde ${data} · ${dias === 1 ? '1 dia' : `${int(dias)} dias`}`;
}
