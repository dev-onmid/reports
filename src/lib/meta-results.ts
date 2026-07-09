// Contagem de resultados da Meta — fonte única de verdade para "quantos resultados uma
// campanha/conjunto/anúncio gerou", usada por /api/campaigns (dashboard, radar, relatórios) E
// pelo Otimizador. Ficava duplicada nos dois lugares (META_RESULT_ACTIONS e LEAD_ACTIONS) e
// SOMAVA vários action_types que a Meta retorna para o MESMO resultado — inflava 2-3x.
//
// Exemplo real (Sorrifácil Rolândia, jul/2026): uma conversa de WhatsApp aparece
// simultaneamente em `messaging_conversation_started_7d`, `total_messaging_connection` e nas
// versões `onsite_conversion.*`. O Gerenciador de Anúncios conta a conversa UMA vez (campo
// "Resultados"); o código somava as ~3 linhas → 35 conversas onde a Meta mostra 10, e o custo
// por conversa aparecia 3x mais barato do que a realidade (R$21,90 vs R$76,79 real), quebrando
// o julgamento de CPL do Otimizador.
//
// Regra: dentro de cada FAMÍLIA de resultado, conta só o action_type de MAIOR prioridade que
// estiver presente — nunca soma dentro da família. Entre famílias diferentes (leads vs
// conversas), soma, porque são resultados genuinamente distintos (e uma campanha normalmente
// só tem uma família ativa, conforme seu objetivo).

export type MetaAction = { action_type: string; value: string };

// Ordem = prioridade. O primeiro presente na família é o contado; os demais são aliases/
// métricas sobrepostas do mesmo resultado e são ignorados para não duplicar.
export const META_RESULT_FAMILIES: string[][] = [
  // Conversas iniciadas por mensagem (WhatsApp / Direct). "conversation_started" é o que o
  // Gerenciador mostra como "Conversas por mensagem"; connection/first_reply são métricas
  // mais amplas do mesmo evento — só entram como fallback se a principal não existir.
  [
    'onsite_conversion.messaging_conversation_started_7d',
    'messaging_conversation_started_7d',
    'onsite_conversion.total_messaging_connection',
    'total_messaging_connection',
    'onsite_conversion.messaging_first_reply',
  ],
  // Leads (formulário instantâneo / pixel). lead_grouped é o "Leads" do Gerenciador; os demais
  // são o mesmo lead contado por outra origem/atribuição.
  [
    'onsite_conversion.lead_grouped',
    'lead',
    'offsite_conversion.fb_pixel_lead',
    'offsite_conversion.lead',
    'onsite_conversion.lead',
    'onsite_web_lead',
    'onsite_web_app_lead',
  ],
];

// Conta os resultados canônicos de um array `actions` da Meta, sem duplicar dentro da família.
export function countMetaResults(actions: MetaAction[] | undefined | null): number {
  if (!Array.isArray(actions) || actions.length === 0) return 0;
  const byType = new Map<string, number>();
  for (const a of actions) {
    if (!a?.action_type) continue;
    byType.set(a.action_type, (byType.get(a.action_type) ?? 0) + (Number(a.value) || 0));
  }
  let total = 0;
  for (const family of META_RESULT_FAMILIES) {
    for (const type of family) {
      if (byType.has(type)) {
        total += byType.get(type)!;
        break; // só o primeiro presente na família — nunca soma aliases do mesmo resultado
      }
    }
  }
  return total;
}
