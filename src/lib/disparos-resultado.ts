/**
 * Resultado de uma campanha de disparo: quem respondeu, COMO respondeu, e o que
 * virou pedido/venda depois. Parte pura (client-safe e testável).
 *
 * Pedido do Matheus (2026-10-03): "um modal de ver respostas, identificar
 * solicitação de pedido, rastrear venda e aparecer ali, igual o Cardápio Web —
 * quantos disparos e receita gerada".
 *
 * ⚠️ Achado que motivou a classificação: na Prospeção Clínicas, "15 de 64
 * responderam (23,4%)" — e boa parte eram ROBÔS dos consultórios ("Você entrou
 * em contato com o consultório…", "Não estamos disponíveis no momento…"),
 * chegando no mesmo minuto do envio. Resposta automática não é interesse e não
 * pode inflar a taxa.
 */
import { pedeParaParar } from '@/lib/disparos-chip';

export type ClasseResposta = 'interesse' | 'humana' | 'parar' | 'automatica' | 'sem_resposta';

export const ROTULO_CLASSE: Record<ClasseResposta, string> = {
  interesse: 'Interesse / pedido',
  humana: 'Respondeu',
  parar: 'Pediu para parar',
  automatica: 'Resposta automática',
  sem_resposta: 'Sem resposta',
};

export type MensagemRecebida = { texto: string; em: string; tipo?: string | null };

/** Frases de autoatendimento de empresa — quem escreve isso é um robô. */
export const RE_AUTOMATICA = /(agradece(mos)?( o| seu| pelo)? ?(seu )?contato|obrigad[oa] (pelo|por entrar em) contato|obrigad[oa] pela (sua )?mensagem|n[aã]o (estamos|estou) dispon[ií]ve|(em breve|logo) (retorna|respond|entraremos)|retornaremos|responderemos|hor[aá]rio de (atendimento|funcionamento)|seja (muito )?bem[- ]?vind|mensagem autom[aá]tica|atendimento autom|voc[eê] entrou em contato com|ficamos (muito )?felizes com (o )?seu contato|para agilizar (o |seu |nosso )?atendimento|aguarde (um momento|que)|nosso atendimento funciona|fora do (nosso )?hor[aá]rio|digite (o n[uú]mero|a op[çc][aã]o)|escolha uma (das )?op[çc])/i;

/**
 * Sinal de interesse/pedido. É INDÍCIO para priorizar o atendimento, não prova
 * de compra — a prova é o pedido no Anota AI/Cardápio Web ou a venda no CRM.
 */
export const RE_INTERESSE = /(quero|queria|gostaria|tenho interesse|interess|pedido|pedir|encomend|card[aá]pio|quanto (custa|[eé]|fica|sai|seria)|qual (o )?(valor|pre[çc]o)|valor|pre[çc]o|or[çc]amento|como (fa[çc]o|funciona|pe[çc]o)|agendar|marcar|hor[aá]rio dispon|tem vaga|reserv|delivery|entrega|onde fica|endere[çc]o|aceita|\bpix\b|me (manda|envia|passa)|mais (informa|detalh)|saber mais|pode (me )?(explicar|enviar|mandar))/i;

/** Ninguém digita uma resposta em menos de 5 s depois de receber — é robô. */
const RAPIDO_DEMAIS_MS = 5_000;

export function ehAutomatica(m: MensagemRecebida, enviadoEm: string): boolean {
  if (RE_AUTOMATICA.test(m.texto ?? '')) return true;
  const dt = Date.parse(m.em) - Date.parse(enviadoEm);
  return Number.isFinite(dt) && dt >= 0 && dt < RAPIDO_DEMAIS_MS;
}

export type ConversaClassificada = {
  classe: ClasseResposta;
  /** A resposta que vale mostrar: a 1ª humana; sem humana, a 1ª automática. */
  principal: MensagemRecebida | null;
  recebidas: number;
};

/**
 * ⚠️ Olha TODAS as respostas depois do envio, não só a primeira: consultório
 * com autoatendimento manda o robô primeiro e a recepcionista depois — essa
 * pessoa respondeu de verdade e tem que contar.
 */
export function classificarConversa(enviadoEm: string, msgs: MensagemRecebida[]): ConversaClassificada {
  const ordenadas = [...msgs].sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  if (ordenadas.length === 0) return { classe: 'sem_resposta', principal: null, recebidas: 0 };
  const humanas = ordenadas.filter(m => !ehAutomatica(m, enviadoEm));
  const principal = humanas[0] ?? ordenadas[0];
  let classe: ClasseResposta;
  if (humanas.some(m => pedeParaParar(m.texto))) classe = 'parar';
  else if (humanas.some(m => RE_INTERESSE.test(m.texto ?? ''))) classe = 'interesse';
  else if (humanas.length > 0) classe = 'humana';
  else classe = 'automatica';
  return { classe, principal, recebidas: ordenadas.length };
}

// ─────────────────────────── atribuição de pedidos ───────────────────────────

export type EnvioDisparo = { envioId: string; campanhaId: string; chave: string; enviadoEm: string };
export type PedidoParaAtribuir = { chave: string; criadoEm: string; total: number; cancelado?: boolean };
export type CompraAtribuida = { pedidos: number; receita: number; primeiroPedidoEm: string };

export const JANELA_PEDIDO_DIAS = 7;

/**
 * Pedido do mesmo telefone até N dias depois do disparo conta como resultado.
 *
 * ⚠️ Um pedido conta UMA vez, para o envio MAIS RECENTE antes dele — entre
 * TODAS as campanhas do cliente. A PicoLocos roda 4 campanhas na mesma base;
 * sem isso a mesma venda apareceria em várias e a soma passaria do faturamento.
 * Mesma regra da Fidelidade (`fidelidade-atribuicao.ts`). Cancelado não conta.
 */
export function atribuirPedidosAosEnvios(
  envios: EnvioDisparo[], pedidos: PedidoParaAtribuir[], janelaDias = JANELA_PEDIDO_DIAS,
): Map<string, CompraAtribuida> {
  const janelaMs = janelaDias * 86_400_000;
  const porChave = new Map<string, EnvioDisparo[]>();
  for (const e of envios) {
    if (!e.chave) continue;
    const l = porChave.get(e.chave) ?? []; l.push(e); porChave.set(e.chave, l);
  }
  for (const l of porChave.values()) l.sort((a, b) => Date.parse(a.enviadoEm) - Date.parse(b.enviadoEm));

  const saida = new Map<string, CompraAtribuida>();
  for (const p of pedidos) {
    if (p.cancelado || !p.chave || !(p.total > 0)) continue;
    const t = Date.parse(p.criadoEm);
    const cands = porChave.get(p.chave);
    if (!cands || !Number.isFinite(t)) continue;
    let alvo: EnvioDisparo | null = null;
    for (const e of cands) {
      const te = Date.parse(e.enviadoEm);
      if (te <= t && t - te <= janelaMs) alvo = e; // ordenado: fica com o mais recente
    }
    if (!alvo) continue;
    const atual = saida.get(alvo.envioId) ?? { pedidos: 0, receita: 0, primeiroPedidoEm: p.criadoEm };
    atual.pedidos += 1;
    atual.receita += p.total;
    if (p.criadoEm < atual.primeiroPedidoEm) atual.primeiroPedidoEm = p.criadoEm;
    saida.set(alvo.envioId, atual);
  }
  return saida;
}

// ─────────────────────────────── formatos de saída ───────────────────────────

export type FonteVenda = 'delivery' | 'crm' | null;

export type ResumoDisparo = {
  campaignId: string;
  /** Falso quando a instância não alimenta o CRM — não há como ler respostas. */
  mensuravel: boolean;
  enviados: number;
  /** Pessoas que responderam de verdade (humana + interesse + parar). */
  responderam: number;
  interesse: number;
  parar: number;
  /** Só robô respondeu — fora da taxa. */
  automaticas: number;
  /** % de `responderam` sobre `enviados`; null sem medição ou sem envio. */
  taxa: number | null;
  fonteVenda: FonteVenda;
  /** Pessoas que compraram na janela. */
  compradores: number;
  pedidos: number;
  receita: number;
  /** Venda marcada no CRM (cliente sem delivery). */
  vendasCrm: number;
  receitaCrm: number;
};

export type ContatoResultado = {
  envioId: string;
  nome: string | null;
  telefone: string;
  enviadoEm: string;
  classe: ClasseResposta;
  resposta: { texto: string; em: string; tipo: string | null } | null;
  recebidas: number;
  leadId: string | null;
  compra: CompraAtribuida | null;
  vendaCrm: { valor: number; em: string | null } | null;
};
