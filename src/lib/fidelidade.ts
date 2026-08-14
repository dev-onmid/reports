/**
 * Fidelidade — segmentação de clientes finais por COMPORTAMENTO DE CONSUMO.
 *
 * Lógica PURA e client-safe (a aba importa direto): sem banco, sem fetch, sem
 * Date.now(). O "agora" já vem embutido em `ClienteDelivery.diasDesdeUltima`,
 * calculado por `agruparPorCliente`.
 *
 * ⚠️ Regra de arquitetura herdada do funil de recorrência: o segmento NUNCA é
 * gravado. Ele é função dos pedidos contra a régua, resolvido na leitura e na
 * hora de cada disparo. Uma lista de público congelada mentiria exatamente em
 * quem mudou de comportamento — que é a única coisa que estas campanhas
 * existem para perceber.
 *
 * Esta lib NÃO envia nada e não sabe o que é WhatsApp. Ela responde a uma
 * pergunta só: "dado o histórico de compras, quem se encaixa neste modelo?"
 */

import type { ClienteDelivery, Regua } from '@/lib/cardapioweb-recorrencia';

export const MODELOS = [
  'primeira_recompra', 'em_risco', 'inativo', 'vip', 'reconquistado',
] as const;
export type ModeloId = typeof MODELOS[number];

/**
 * Um campo de régua que o gestor ajusta na tela. O descritor mora aqui (e não
 * na UI) para que a validação do servidor e o formulário nunca divirjam sobre
 * limites — divergir significaria salvar um valor que o filtro rejeita depois.
 */
export type CampoRegua = {
  chave: string;
  rotulo: string;
  ajuda: string;
  sufixo: 'dias' | 'pedidos' | 'R$';
  min: number;
  max: number;
  /** null = automático (hoje só o ticket, que vira 1,5× o ticket médio da loja). */
  padrao: number | null;
};

export type Modelo = {
  id: ModeloId;
  nome: string;
  /** Por que a campanha existe. É o texto que a tela mostra sob o título. */
  objetivo: string;
  campos: CampoRegua[];
  /** Três variações — rodízio de texto é anti-bloqueio, não enfeite. */
  mensagensPadrao: string[];
  /** 0=domingo. Modelos nascem em dias diferentes para não competirem no cooldown. */
  cadenciaPadrao: { diasSemana: number[]; hora: string };
};

const DIAS_MIN: Omit<CampoRegua, 'chave' | 'rotulo' | 'ajuda' | 'padrao'> = {
  sufixo: 'dias', min: 0, max: 365,
};

export const MODELOS_FIDELIDADE: Record<ModeloId, Modelo> = {
  primeira_recompra: {
    id: 'primeira_recompra',
    nome: 'Comprou uma vez só',
    objetivo:
      'Quem experimentou e não voltou. É quase sempre o maior grupo da base e a '
      + 'maior alavanca de recorrência — transformar 1 pedido em 2 vale mais que '
      + 'conquistar um cliente novo.',
    campos: [
      { ...DIAS_MIN, chave: 'diasMin', rotulo: 'Esperar pelo menos', padrao: 10,
        ajuda: 'Tempo desde o único pedido antes de cutucar. Cedo demais soa afobado.' },
      { ...DIAS_MIN, chave: 'diasMax', rotulo: 'E no máximo', padrao: 120,
        ajuda: 'Passado disso o cliente é frio: a mensagem de resgate cabe melhor que a de recompra.' },
    ],
    mensagensPadrao: [
      'Oi, {{primeiro_nome}}! Vi que faz {{dias}} dias que você pediu na {{loja}} pela primeira vez 😊 Bora repetir? Tá tudo pronto pro seu próximo.',
      'E aí, {{primeiro_nome}}! Que tal a segunda rodada? A {{loja}} tá te esperando — é só escolher e pedir 🍽️',
      '{{primeiro_nome}}, faz um tempinho do seu primeiro pedido na {{loja}}. Hoje é um bom dia pra repetir a dose 😉',
    ],
    cadenciaPadrao: { diasSemana: [4], hora: '18:00' },
  },

  em_risco: {
    id: 'em_risco',
    nome: 'Em risco',
    objetivo:
      'Cliente que comprava com constância e passou do ciclo normal de recompra '
      + 'DELE. Agir aqui é barato; esperar virar inativo é caro.',
    campos: [
      { chave: 'pedidosMin', rotulo: 'Com pelo menos', sufixo: 'pedidos', min: 2, max: 50, padrao: 2,
        ajuda: 'Quem só pediu uma vez pertence à campanha de primeira recompra, não a esta.' },
      { ...DIAS_MIN, chave: 'diasMax', rotulo: 'Parado há no máximo', padrao: 90,
        ajuda: 'Teto de segurança: além disso a régua de inatividade da loja já classifica como inativo.' },
    ],
    mensagensPadrao: [
      'Oi, {{primeiro_nome}}! Faz {{dias}} dias que a gente não te vê por aqui 👀 Deu saudade — que tal hoje?',
      '{{primeiro_nome}}, sentimos sua falta na {{loja}}! Seu pedido de sempre continua aqui 😋',
      'E aí, {{primeiro_nome}}? Já vai fazer {{dias}} dias do seu último pedido. Bora matar a vontade hoje?',
    ],
    cadenciaPadrao: { diasSemana: [2], hora: '18:00' },
  },

  inativo: {
    id: 'inativo',
    nome: 'Inativo (resgate)',
    objetivo:
      'Já passou do limite de inatividade da loja. Aqui a mensagem precisa dar '
      + 'um motivo concreto pra voltar — só "sentimos sua falta" costuma não bastar.',
    campos: [
      { chave: 'pedidosMin', rotulo: 'Com pelo menos', sufixo: 'pedidos', min: 2, max: 50, padrao: 2,
        ajuda: 'Cliente de um pedido só entra na campanha de primeira recompra.' },
      { ...DIAS_MIN, chave: 'diasMax', rotulo: 'Sumido há no máximo', padrao: 180,
        ajuda: 'Número muito antigo tende a estar trocado ou desinteressado — e denúncia derruba o WhatsApp da loja.' },
    ],
    mensagensPadrao: [
      '{{primeiro_nome}}, faz {{dias}} dias que você não pede na {{loja}}... bora matar essa saudade hoje? 🍽️',
      'Oi, {{primeiro_nome}}! Já faz um tempão. Preparamos novidades desde o seu último pedido — dá uma olhada 👀',
      'E aí, {{primeiro_nome}}! A {{loja}} sente sua falta. Que tal voltar hoje e ver o que mudou? 😊',
    ],
    cadenciaPadrao: { diasSemana: [3], hora: '17:00' },
  },

  vip: {
    id: 'vip',
    nome: 'VIP — melhores clientes',
    objetivo:
      'Quem compra muito ou gasta acima da média. Mensagem de reconhecimento, '
      + 'não de desconto: dar desconto a quem já compra no preço cheio queima margem.',
    campos: [
      { chave: 'pedidosMin', rotulo: 'A partir de', sufixo: 'pedidos', min: 2, max: 100, padrao: 4,
        ajuda: 'Entra quem bate ESTE número de pedidos OU o ticket abaixo — não precisa dos dois.' },
      { chave: 'ticketMin', rotulo: 'Ou ticket médio de', sufixo: 'R$', min: 0, max: 100000, padrao: null,
        ajuda: 'Vazio = automático: 1,5× o ticket médio da própria loja. Régua relativa não precisa de manutenção.' },
    ],
    mensagensPadrao: [
      'Oi, {{primeiro_nome}}! Você é um dos clientes que mais pede na {{loja}} 💜 Só passei pra agradecer de verdade.',
      '{{primeiro_nome}}, cliente como você faz diferença aqui na {{loja}} 🙏 Obrigado por sempre voltar!',
      'E aí, {{primeiro_nome}}! Já são {{pedidos}} pedidos com a gente 😍 Muito obrigado — a casa é sua.',
    ],
    cadenciaPadrao: { diasSemana: [5], hora: '17:00' },
  },

  reconquistado: {
    id: 'reconquistado',
    nome: 'Reconquistado (reforço)',
    objetivo:
      'Sumiu, voltou agora. A segunda compra no intervalo curto é o que decide '
      + 'se ele vira recorrente de novo ou some outra vez — esta é a janela.',
    campos: [
      { ...DIAS_MIN, chave: 'diasMax', rotulo: 'Voltou há no máximo', padrao: 15,
        ajuda: 'Janela curta de propósito: o reforço só funciona enquanto a boa lembrança está fresca.' },
    ],
    mensagensPadrao: [
      'Que bom te ver de volta, {{primeiro_nome}}! 🎉 Espero que tenha gostado — a {{loja}} tá aqui quando quiser.',
      'Oi, {{primeiro_nome}}! Ficamos felizes com seu retorno 💜 Se precisar de algo, é só chamar.',
      '{{primeiro_nome}}, obrigado por voltar à {{loja}}! Qualquer dia desses a gente se vê de novo 😉',
    ],
    cadenciaPadrao: { diasSemana: [1], hora: '18:00' },
  },
};

export const ORDEM_MODELOS: ModeloId[] = [
  'primeira_recompra', 'em_risco', 'inativo', 'vip', 'reconquistado',
];

// ------------------------------------------------------------------ Régua

export type ParamsRegua = Record<string, number | null>;

export function paramsPadrao(modelo: ModeloId): ParamsRegua {
  const out: ParamsRegua = {};
  for (const c of MODELOS_FIDELIDADE[modelo].campos) out[c.chave] = c.padrao;
  return out;
}

/**
 * Sanitiza o que veio da tela/banco contra o descritor do modelo.
 *
 * Campo ausente cai no padrão; fora da faixa é grampeado. Isso é o que permite
 * confiar em `params` dentro do filtro sem revalidar nada lá.
 */
export function normalizarParams(modelo: ModeloId, bruto: unknown): ParamsRegua {
  const entrada = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const out: ParamsRegua = {};
  for (const c of MODELOS_FIDELIDADE[modelo].campos) {
    const v = entrada[c.chave];
    if (v === null && c.padrao === null) { out[c.chave] = null; continue; }
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) { out[c.chave] = c.padrao; continue; }
    out[c.chave] = Math.min(c.max, Math.max(c.min, Math.round(n * 100) / 100));
  }
  return out;
}

export type ContextoFiltro = {
  regua: Regua;
  /** Ticket médio da loja inteira — base da régua relativa do VIP. */
  ticketMedioLoja: number;
};

function num(p: ParamsRegua, chave: string, modelo: ModeloId): number {
  const v = p[chave];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const campo = MODELOS_FIDELIDADE[modelo].campos.find(c => c.chave === chave);
  return campo?.padrao ?? 0;
}

/**
 * Quem se encaixa no modelo, AGORA.
 *
 * Duas exclusões valem para todos e não são configuráveis:
 *  - sem telefone não há como enviar (cliente identificado só pelo id interno
 *    do Cardápio Web fica de fora);
 *  - a etapa vem da régua da própria loja, então "em risco" já significa coisas
 *    diferentes numa pizzaria semanal e num japonês mensal.
 *
 * Sobreposição entre VIP e Reconquistado é possível de propósito (o mesmo
 * cliente é as duas coisas). Quem resolve isso é o cooldown por pessoa na hora
 * do envio, não este filtro — cada segmento deve responder com a verdade.
 */
export function filtrarPublico(
  clientes: ClienteDelivery[],
  modelo: ModeloId,
  params: ParamsRegua,
  ctx: ContextoFiltro,
): ClienteDelivery[] {
  const p = normalizarParams(modelo, params);
  const comFone = clientes.filter(c => !!c.telefone);

  switch (modelo) {
    case 'primeira_recompra': {
      const min = num(p, 'diasMin', modelo);
      const max = num(p, 'diasMax', modelo);
      return comFone.filter(c =>
        c.pedidos === 1 && c.diasDesdeUltima >= min && c.diasDesdeUltima <= max);
    }
    case 'em_risco': {
      const pedidosMin = num(p, 'pedidosMin', modelo);
      const max = num(p, 'diasMax', modelo);
      return comFone.filter(c =>
        c.etapa === 'em_risco' && c.pedidos >= pedidosMin && c.diasDesdeUltima <= max);
    }
    case 'inativo': {
      const pedidosMin = num(p, 'pedidosMin', modelo);
      const max = num(p, 'diasMax', modelo);
      return comFone.filter(c =>
        c.etapa === 'inativo' && c.pedidos >= pedidosMin && c.diasDesdeUltima <= max);
    }
    case 'vip': {
      const pedidosMin = num(p, 'pedidosMin', modelo);
      const ticketMin = p.ticketMin ?? ctx.ticketMedioLoja * 1.5;
      // Só cliente VIVO: elogiar quem já sumiu soa desatento, e o resgate dele
      // é papel das campanhas de risco/inatividade.
      return comFone.filter(c =>
        (c.etapa === 'recorrente' || c.etapa === 'reconquistado')
        && (c.pedidos >= pedidosMin || c.ticketMedio >= ticketMin));
    }
    case 'reconquistado': {
      const max = num(p, 'diasMax', modelo);
      return comFone.filter(c => c.etapa === 'reconquistado' && c.diasDesdeUltima <= max);
    }
  }
}

export type ResumoSegmento = {
  pessoas: number;
  /** Tudo que este grupo já gastou na loja. Mede o que está em jogo. */
  receitaHistorica: number;
  ticketMedio: number;
  /** Mediana de dias parados — melhor que média, que uma cauda longa distorce. */
  diasParadoMediano: number | null;
};

export function resumirSegmento(publico: ClienteDelivery[]): ResumoSegmento {
  if (publico.length === 0) {
    return { pessoas: 0, receitaHistorica: 0, ticketMedio: 0, diasParadoMediano: null };
  }
  const receita = publico.reduce((s, c) => s + c.receita, 0);
  const pedidos = publico.reduce((s, c) => s + c.pedidos, 0);
  const dias = publico.map(c => c.diasDesdeUltima).sort((a, b) => a - b);
  const m = Math.floor(dias.length / 2);
  return {
    pessoas: publico.length,
    receitaHistorica: receita,
    ticketMedio: pedidos > 0 ? receita / pedidos : 0,
    diasParadoMediano: dias.length % 2 ? dias[m] : Math.round((dias[m - 1] + dias[m]) / 2),
  };
}

// ------------------------------------------------------------------ Mensagem

/** As únicas variáveis que o motor consegue preencher de verdade. */
export const VARIAVEIS = [
  { chave: 'primeiro_nome', descricao: 'Primeiro nome do cliente' },
  { chave: 'nome', descricao: 'Nome completo, como veio no pedido' },
  { chave: 'dias', descricao: 'Dias desde o último pedido' },
  { chave: 'pedidos', descricao: 'Quantos pedidos já fez' },
  { chave: 'ticket', descricao: 'Ticket médio dele, formatado em reais' },
  { chave: 'loja', descricao: 'Nome da loja' },
] as const;

const CHAVES_VALIDAS = new Set<string>(VARIAVEIS.map(v => v.chave));

export function primeiroNome(nome: string | null | undefined): string {
  const limpo = (nome ?? '').trim();
  if (!limpo) return '';
  return limpo.split(/\s+/)[0];
}

export function moedaBR(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Valores de um cliente real para as variáveis da mensagem.
 *
 * Mesma sintaxe `{{chave}}` do `interpolate` de followup-send, para que a
 * prévia da tela e o envio futuro nunca rendam textos diferentes.
 */
export type ClienteParaVars = Pick<ClienteDelivery, 'nome' | 'pedidos' | 'ticketMedio' | 'diasDesdeUltima'>;

export function varsDoCliente(c: ClienteParaVars, loja: string): Record<string, string> {
  const nome = c.nome?.trim() || '';
  return {
    nome,
    primeiro_nome: primeiroNome(nome) || 'tudo bem',
    dias: String(Math.max(0, Math.round(c.diasDesdeUltima))),
    pedidos: String(c.pedidos),
    ticket: moedaBR(c.ticketMedio),
    loja,
  };
}

export function aplicarVars(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);
}

/**
 * Variáveis escritas na mensagem que o motor não sabe preencher.
 *
 * Existe porque um `{{cupom}}` inventado não falha em lugar nenhum: ele
 * simplesmente vai como texto cru para o WhatsApp do consumidor. Melhor a tela
 * avisar antes.
 */
export function variaveisDesconhecidas(texto: string): string[] {
  const achadas = texto.match(/\{\{(\w+)\}\}/g) ?? [];
  const fora = achadas
    .map(t => t.slice(2, -2))
    .filter(k => !CHAVES_VALIDAS.has(k));
  return [...new Set(fora)];
}

/** Mensagem vazia não pode ser salva como variação — viraria envio em branco. */
export function limparMensagens(bruto: unknown, modelo: ModeloId): string[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  const limpas = lista
    .map(m => (typeof m === 'string' ? m.trim() : ''))
    .filter(m => m.length > 0)
    .slice(0, 3);
  return limpas.length > 0 ? limpas : [...MODELOS_FIDELIDADE[modelo].mensagensPadrao];
}

// ------------------------------------------------------------------ Travas

/**
 * Travas anti-bloqueio. Valem por CLIENTE (não por campanha): a reputação é do
 * chip, então duas campanhas do mesmo número somam no mesmo teto — a mesma
 * razão pela qual o teto diário dos Disparos conta a instância inteira.
 */
export type Travas = {
  intervaloMinSeg: number;
  tetoDiario: number;
  janelaInicio: string;
  janelaFim: string;
  diasSemana: number[];
  cooldownDias: number;
  optoutAtivo: boolean;
};

/**
 * Pisos que a tela não deixa furar. 120s e 50/dia são a decisão do Matheus;
 * o piso ABSOLUTO de 90s é o mesmo do motor de Disparos, que já vive em
 * produção — nenhuma campanha nova pode nascer mais agressiva que ele.
 */
export const PISO_INTERVALO_SEG = 90;
export const TRAVAS_PADRAO: Travas = {
  intervaloMinSeg: 120,
  tetoDiario: 50,
  janelaInicio: '09:00',
  janelaFim: '20:00',
  diasSemana: [1, 2, 3, 4, 5, 6],
  cooldownDias: 7,
  optoutAtivo: true,
};

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizarTravas(bruto: unknown): Travas {
  const e = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const inteiro = (v: unknown, padrao: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
  };
  const hora = (v: unknown, padrao: string) =>
    (typeof v === 'string' && HORA_RE.test(v) ? v : padrao);

  const dias = Array.isArray(e.diasSemana)
    ? [...new Set(e.diasSemana.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : TRAVAS_PADRAO.diasSemana;

  return {
    intervaloMinSeg: inteiro(e.intervaloMinSeg, TRAVAS_PADRAO.intervaloMinSeg, PISO_INTERVALO_SEG, 3600),
    tetoDiario: inteiro(e.tetoDiario, TRAVAS_PADRAO.tetoDiario, 1, 500),
    janelaInicio: hora(e.janelaInicio, TRAVAS_PADRAO.janelaInicio),
    janelaFim: hora(e.janelaFim, TRAVAS_PADRAO.janelaFim),
    // Sem dia nenhum a campanha nunca rodaria e a tela não teria como explicar.
    diasSemana: dias.length > 0 ? dias : TRAVAS_PADRAO.diasSemana,
    cooldownDias: inteiro(e.cooldownDias, TRAVAS_PADRAO.cooldownDias, 0, 90),
    optoutAtivo: e.optoutAtivo === undefined ? true : e.optoutAtivo !== false,
  };
}

/**
 * Quantos dias a campanha leva para varrer o público inteiro, dadas as travas.
 *
 * A tela mostra isso porque é a informação que ninguém calcula de cabeça: um
 * segmento de 600 pessoas a 50/dia não é "um disparo", são 12 dias de fila.
 */
export function diasParaVarrer(pessoas: number, travas: Travas): number {
  if (pessoas <= 0) return 0;
  const porJanela = capacidadeDaJanela(travas);
  return porJanela > 0 ? Math.ceil(pessoas / porJanela) : 0;
}

/**
 * Teto REAL de um dia: o menor entre o teto declarado e o que cabe na janela de
 * horário no ritmo mínimo. Uma janela de 1h a 1 msg/2min entrega 30, não 50 —
 * exibir 50 seria prometer o que o motor não vai cumprir.
 */
export function capacidadeDaJanela(travas: Travas): number {
  const [hi, mi] = travas.janelaInicio.split(':').map(Number);
  const [hf, mf] = travas.janelaFim.split(':').map(Number);
  let minutos = (hf * 60 + mf) - (hi * 60 + mi);
  if (minutos <= 0) minutos += 24 * 60; // janela que vira o dia
  const cabe = Math.floor((minutos * 60) / Math.max(1, travas.intervaloMinSeg));
  return Math.max(0, Math.min(travas.tetoDiario, cabe));
}

export const DIAS_SEMANA_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
