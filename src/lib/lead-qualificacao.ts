/**
 * Qualificação e engajamento do lead — os dois sinais que o Matheus pediu em 16/09/2026
 * para alimentar a otimização do Meta com QUALIDADE, não só com volume de lead.
 *
 * São coisas diferentes de propósito:
 *
 *  - ENGAJADO é automático e determinístico: o lead trocou conversa de verdade. A régua
 *    é contagem de mensagens RECEBIDAS dele. ⚠️ Sem IA no caminho — decisão explícita do
 *    Matheus ("não pode depender de token de IA"): o sinal que vai para o Meta não pode
 *    depender de crédito de API nem de um modelo mudar de ideia.
 *
 *  - QUALIFICADO é manual e humano: o gestor aperta o botão no card. O critério muda por
 *    cliente (condicionamento físico num cliente de esporte, renda em outro, ser
 *    empresário num terceiro) e por isso NÃO é automatizável — é o MQL daquele negócio.
 *
 * ⚠️ Nenhum dos dois é etapa/grau do funil. Convivem com a coluna onde o lead está, como
 * a temperatura já faz. Um lead pode estar em "Agendado" e ser engajado e qualificado.
 */

/** Mensagens recebidas do lead para ele contar como engajado. */
export const MIN_MSGS_ENGAJADO_PADRAO = 3;

/**
 * ⚠️ O padrão é 3, não 8, e o número saiu de medição — não de intuição.
 *
 * Medido em 16/09/2026 sobre 28 dias reais: com o corte em 8 mensagens (o palpite
 * inicial), só Londrigifts (43/sem) e Dominos (30/sem) tinham algum volume, e os
 * demais clientes ficavam abaixo de 25/semana. O Meta precisa de ~50 eventos por
 * semana por conjunto para sair do aprendizado, então um corte alto entrega um sinal
 * que o algoritmo não consegue usar. Com 3, o volume dobra (Londrigifts 85/sem,
 * Dominos 54/sem, Odonto First 44/sem) e o critério continua honesto: três mensagens
 * do lead não é quem mandou só "oi".
 *
 * Por cliente porque a régua certa depende do negócio — ticket alto aguenta ser mais
 * exigente; cliente de volume baixo precisa de corte menor para o sinal existir.
 */
export function minimoEngajamento(configurado?: number | null): number {
  if (configurado == null || !Number.isFinite(configurado)) return MIN_MSGS_ENGAJADO_PADRAO;
  // 1 msg = qualquer "oi" vira engajado (sinal inútil); acima de 20 nunca dispara.
  return Math.min(20, Math.max(1, Math.trunc(configurado)));
}

export function estaEngajado(msgsRecebidas: number, minimo?: number | null): boolean {
  return msgsRecebidas >= minimoEngajamento(minimo);
}

/** Nome da coluna criada nos funis. Constante para o board e o motor concordarem. */
export const COLUNA_ENGAJADO = 'Engajado';

/**
 * O lead deve ser MOVIDO para a coluna Engajado?
 *
 * ⚠️⚠️ A resposta é "só se ele ainda não avançou". O Matheus escolheu movimento
 * automático, mas mover sem essa trava seria destrutivo: um lead em "Agendado" que
 * responde a 3ª mensagem voltaria para o começo do funil, apagando o trabalho do
 * gestor — e, pior, silenciosamente, no meio da noite, pelo cron. O sinal de
 * engajamento vale para o Meta de qualquer jeito (ele é gravado no lead); o que a
 * trava protege é a POSIÇÃO no board.
 *
 * `postoAtual`/`postoEngajado` são os graus do funil (ver funil-etapas.ts): mover só
 * acontece de trás para frente, nunca o contrário.
 */
export function devoMoverParaEngajado(args: {
  engajado: boolean;
  postoAtual: number;
  postoEngajado: number;
  jaEstaNaColuna: boolean;
}): boolean {
  if (!args.engajado || args.jaEstaNaColuna) return false;
  return args.postoAtual < args.postoEngajado;
}
