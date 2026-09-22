// Nomes de evento que a Meta aceita com action_source 'business_messaging'
// (Conversions API for Business Messaging). Qualquer outro nome volta 400
// "Evento de mensagem com tipo de evento inválido" (error_subcode 2804066) —
// inclusive os nomes de pixel de site, como 'Lead' e 'Contact'.
// Fonte: developers.facebook.com/docs/marketing-api/conversions-api/business-messaging
// Módulo puro (client-safe): usado pelo envio e pela tela de Eventos por Status.

export const EVENTOS_MENSAGEM_META = [
  'LeadSubmitted',
  'QualifiedLead',
  'Purchase',
  'InitiateCheckout',
  'AddToCart',
  'ViewContent',
  'OrderCreated',
  'OrderShipped',
  'OrderDelivered',
  'OrderCanceled',
  'OrderReturned',
  'CartAbandoned',
  'RatingProvided',
  'ReviewProvided',
] as const;

export type EventoMensagemMeta = (typeof EVENTOS_MENSAGEM_META)[number];

// Nomes internos/antigos que têm equivalente oficial. 'Contact' e 'Lead_Engajado'
// ficam de fora de propósito: não existe evento de mensagem que os represente, e
// mapear para LeadSubmitted contaria o mesmo lead duas vezes.
const APELIDOS: Record<string, EventoMensagemMeta> = {
  lead: 'LeadSubmitted',
  lead_qualificado: 'QualifiedLead',
  leadqualificado: 'QualifiedLead',
  qualificado: 'QualifiedLead',
  compra: 'Purchase',
  venda: 'Purchase',
};

const chave = (nome: string) => nome.trim().toLowerCase().replace(/\s+/g, '_');

/** Nome oficial aceito pela Meta, ou null quando o evento não existe para mensagens. */
export function eventoMensagemMeta(nome: string | null | undefined): EventoMensagemMeta | null {
  if (!nome) return null;
  const k = chave(nome);
  const oficial = EVENTOS_MENSAGEM_META.find(e => e.toLowerCase() === k);
  return oficial ?? APELIDOS[k] ?? null;
}
