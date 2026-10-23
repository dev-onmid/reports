/**
 * De ONDE veio cada venda — para compilar tudo num relatório só sem que uma
 * fonte anule a outra (pedido do Matheus, 2026-10-23).
 *
 * Cliente consultivo vende no WhatsApp, e a venda chega ao CRM pelo próprio
 * atendimento, por planilha/Google Sheets, pelo Datalytics ou pela API de outro
 * CRM (Agendor, SULTS). Cliente de delivery vende no cardápio digital (Anota Aí,
 * Cardápio Web), e essa venda só chega até o anúncio pela compra que a Meta
 * atribuiu (pixel). As fontes SOMAM, e a tela diz quanto veio de cada uma.
 *
 * ⚠️ A compra da Meta só é fonte para quem tem cardápio conectado. Nos outros
 * clientes ela é ECO do CRM: o próprio sistema manda `Purchase` para a Meta
 * quando o lead é ganho (conversions.ts) — somar contaria a venda duas vezes.
 *
 * Pura: o SQL sai daqui como texto, a soma e a descrição são funções.
 */

export type FonteVenda = 'whatsapp' | 'planilha' | 'datalytics' | 'agendor' | 'sults' | 'crm' | 'cardapio';

export const ROTULO_FONTE: Record<FonteVenda, string> = {
  cardapio: 'Cardápio digital',
  whatsapp: 'WhatsApp',
  planilha: 'Planilha',
  datalytics: 'Datalytics',
  agendor: 'Agendor',
  sults: 'SULTS',
  crm: 'CRM (manual)',
};

/** Ordem de exibição: o que mais costuma pesar primeiro. */
export const ORDEM_FONTES: FonteVenda[] = ['cardapio', 'whatsapp', 'planilha', 'datalytics', 'agendor', 'sults', 'crm'];

export type ParcelaFonte = { vendas: number; receita: number };
export type VendasPorFonte = Partial<Record<FonteVenda, ParcelaFonte>>;

/**
 * Fonte de uma linha de `crm_leads` (alias `a`). Quem trouxe o DADO, não o
 * canal de mídia: id externo da integração > arquivo importado (o export
 * "Detalhamento…" é o do Datalytics; o resto é planilha manual ou Google
 * Sheets, que entra pela mesma rota) > conversa de WhatsApp > lançamento manual.
 */
export function fonteVendaSql(a = 'l'): string {
  return `CASE
    WHEN ${a}.external_id LIKE 'agendor:%' THEN 'agendor'
    WHEN ${a}.external_id LIKE 'sults:%' THEN 'sults'
    WHEN ${a}.upload_id IS NOT NULL THEN CASE WHEN EXISTS (
      SELECT 1 FROM public.crm_uploads u WHERE u.id::text = ${a}.upload_id::text AND u.filename ILIKE 'Detalhamento%'
    ) THEN 'datalytics' ELSE 'planilha' END
    WHEN ${a}.instance_id IS NOT NULL OR NULLIF(${a}.ctwa_clid, '') IS NOT NULL OR ${a}.whatsapp_last_message_at IS NOT NULL THEN 'whatsapp'
    ELSE 'crm' END`;
}

export function ehFonte(v: unknown): v is FonteVenda {
  return typeof v === 'string' && v in ROTULO_FONTE;
}

export function somarNaFonte(f: VendasPorFonte, fonte: FonteVenda, vendas: number, receita: number): void {
  const p = f[fonte] ?? { vendas: 0, receita: 0 };
  p.vendas += vendas;
  p.receita += receita;
  f[fonte] = p;
}

export function juntarFontes(...lista: Array<VendasPorFonte | null | undefined>): VendasPorFonte {
  const out: VendasPorFonte = {};
  for (const f of lista) {
    if (!f) continue;
    for (const k of ORDEM_FONTES) {
      const p = f[k];
      if (p && (p.vendas > 0 || p.receita > 0)) somarNaFonte(out, k, p.vendas, p.receita);
    }
  }
  return out;
}

export function totalDasFontes(f: VendasPorFonte | null | undefined): ParcelaFonte {
  let vendas = 0;
  let receita = 0;
  for (const k of ORDEM_FONTES) {
    vendas += f?.[k]?.vendas ?? 0;
    receita += f?.[k]?.receita ?? 0;
  }
  return { vendas, receita };
}

/** Fontes presentes, na ordem de exibição. */
export function fontesPresentes(f: VendasPorFonte | null | undefined): Array<{ fonte: FonteVenda; rotulo: string } & ParcelaFonte> {
  return ORDEM_FONTES
    .filter((k) => (f?.[k]?.vendas ?? 0) > 0 || (f?.[k]?.receita ?? 0) > 0)
    .map((k) => ({ fonte: k, rotulo: ROTULO_FONTE[k], ...f![k]! }));
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "Cardápio digital: 88 vendas · R$ 9.114,63\nWhatsApp: 1 venda · sem valor" — para title. */
export function descreverFontes(f: VendasPorFonte | null | undefined): string | undefined {
  const linhas = fontesPresentes(f).map((p) =>
    `${p.rotulo}: ${p.vendas} ${p.vendas === 1 ? 'venda' : 'vendas'} · ${p.receita > 0 ? brl(p.receita) : 'sem valor'}`);
  return linhas.length ? linhas.join('\n') : undefined;
}
