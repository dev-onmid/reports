import { proximaExecucao } from '@/lib/fidelidade';

/**
 * Planejador de publicações — regras puras (client-safe).
 *
 * A tela E o motor consomem daqui. Duplicar a validação faria a tela aceitar
 * um agendamento que o servidor recusa (ou pior: o contrário), e publicação
 * é IRREVERSÍVEL — não há endpoint na Meta para desfazer.
 *
 * A recorrência reusa `proximaExecucao` da Fidelidade em vez de reimplementar:
 * ela já resolve BRT e já tem asserts cobrindo virada de semana, mês e ano.
 */

// ------------------------------------------------------------------- Constantes

/** Limite de legenda do Instagram. */
export const LEGENDA_MAX = 2200;

/**
 * Teto da Meta: "Instagram accounts are limited to 100 API-published posts
 * within a 24-hour moving period" — stories contam no MESMO teto.
 */
export const TETO_META_24H = 100;

/** Antecedência mínima de um agendamento. Abaixo disso o cron não alcança. */
export const MIN_ANTECEDENCIA_MIN = 2;

/**
 * ⚠️ O que a API da Meta NÃO expõe em stories. A tela precisa dizer isso, senão
 * o gestor promete ao cliente uma enquete que o sistema nunca vai conseguir pôr.
 * Não é limitação nossa: não existe endpoint para nada disto.
 */
export const STORY_SEM_SUPORTE =
  'A API publica o story como imagem pura. Enquete, sticker de link, caixa de perguntas, ' +
  'música, menção @ e contagem regressiva não existem na API da Meta — story que precisa ' +
  'disso continua sendo postado à mão.';

// ----------------------------------------------------------------------- Tipos

export type TipoPublicacao = 'feed' | 'story' | 'reels';

/**
 * Limites de VÍDEO da Meta. Reels: 3s a 15 min; story em vídeo: até 60s.
 * Validar aqui evita subir 80 MB para a Meta recusar no container.
 */
export const REELS_MIN_SEG = 3;
export const REELS_MAX_SEG = 15 * 60;
export const STORY_VIDEO_MAX_SEG = 60;

/** O que a validação precisa saber da mídia escolhida. */
export type MidiaInfo = { ehVideo: boolean; duracaoSeg?: number | null };

export type StatusAlvo = 'pendente' | 'publicando' | 'publicado' | 'erro';

/** Conta resolvida de um cliente. `null` em igId = cliente sem Instagram utilizável. */
export type ContaCliente = {
  clientId: string;
  clientName: string;
  igId: string | null;
  username: string | null;
};

export type Agendamento =
  | { modo: 'unico'; quando: string }
  | { modo: 'recorrente'; dias: number[]; hora: string; ate: string | null };

export type PublicacaoInput = {
  tipo: TipoPublicacao;
  legenda: string;
  midiaId: string;
  clientIds: string[];
  agendamento: Agendamento;
};

export type Alvo = { clientId: string; clientName: string; igId: string; username: string };

export type MontagemAlvos = {
  alvos: Alvo[];
  /** Clientes pedidos que ficaram de fora, com o motivo em português. */
  descartados: { clientId: string; clientName: string; motivo: string }[];
};

// ------------------------------------------------------------------- Montagem

/**
 * Converte a seleção de clientes na lista do que realmente vai ser publicado.
 *
 * ⚠️ Dedupe por `igId`, não por cliente. Dois clientes da carteira podem apontar
 * para a MESMA conta de Instagram (o social-monitor já convive com isso) — sem o
 * dedupe, selecionar os dois publicaria o mesmo post duas vezes na mesma conta,
 * e não haveria como desfazer.
 *
 * ⚠️ Cliente sem conta resolvida sai da lista COM MOTIVO, em vez de virar um alvo
 * que falha depois. Descobrir na hora da criação é o único momento em que dá para
 * corrigir; descobrir no worker vira um erro silencioso no histórico.
 */
export function montarAlvos(clientIds: string[], contas: ContaCliente[]): MontagemAlvos {
  const porCliente = new Map(contas.map(c => [c.clientId, c]));
  const alvos: Alvo[] = [];
  const descartados: MontagemAlvos['descartados'] = [];
  const igVistos = new Map<string, string>(); // igId -> clientName que ficou com ele

  for (const id of [...new Set(clientIds)]) {
    const conta = porCliente.get(id);
    if (!conta) {
      descartados.push({ clientId: id, clientName: id, motivo: 'cliente não encontrado' });
      continue;
    }
    if (!conta.igId) {
      descartados.push({
        clientId: id, clientName: conta.clientName,
        motivo: 'sem conta de Instagram vinculada',
      });
      continue;
    }
    const dono = igVistos.get(conta.igId);
    if (dono) {
      descartados.push({
        clientId: id, clientName: conta.clientName,
        motivo: `mesma conta @${conta.username ?? conta.igId} já incluída por ${dono}`,
      });
      continue;
    }
    igVistos.set(conta.igId, conta.clientName);
    alvos.push({
      clientId: id, clientName: conta.clientName,
      igId: conta.igId, username: conta.username ?? '',
    });
  }
  return { alvos, descartados };
}

// ------------------------------------------------------------------ Recorrência

function horaValida(hora: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!m) return false;
  const h = Number(m[1]), min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

/**
 * Quando esta publicação deve rodar, em UTC. `null` = nunca mais (série
 * encerrada, ou recorrência sem nenhum dia escolhido).
 *
 * `agora` é PARÂMETRO de propósito: chamar `new Date()` aqui dentro tornaria a
 * função impura e o teste dependente do relógio — mesma decisão de `contarFunil`.
 */
export function proximaOcorrencia(ag: Agendamento, agora: Date): Date | null {
  if (ag.modo === 'unico') {
    const d = new Date(ag.quando);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  if (!horaValida(ag.hora)) return null;
  const proxima = proximaExecucao(ag.dias, ag.hora, agora);
  if (!proxima) return null;
  if (ag.ate) {
    // `ate` é uma data (YYYY-MM-DD) e o limite é INCLUSIVO: repetir "até 30/09"
    // tem de incluir o dia 30 inteiro, senão a última ocorrência some sem aviso.
    const fim = new Date(`${ag.ate}T23:59:59-03:00`);
    if (!Number.isNaN(fim.getTime()) && proxima.getTime() > fim.getTime()) return null;
  }
  return proxima;
}

// ------------------------------------------------------------------- Validação

/**
 * Devolve a lista de problemas. Vazia = pode agendar.
 *
 * `alvos` entra já montado para que a validação enxergue o resultado REAL da
 * seleção (depois do dedupe e dos descartes), não a intenção.
 */
export function validarPublicacao(
  input: PublicacaoInput, alvos: Alvo[], agora: Date, midia?: MidiaInfo | null,
): string[] {
  const erros: string[] = [];

  if (!input.midiaId) erros.push('Escolha a imagem ou o vídeo que será publicado.');
  if (!['feed', 'story', 'reels'].includes(input.tipo)) erros.push('Tipo de publicação inválido.');

  // ⚠️ Casamento tipo × mídia. Vídeo no feed do Instagram É Reels (a Meta
  // unificou) — aceitar "feed + vídeo" criaria um caminho que a API recusa
  // com erro genérico no worker, longe de quem pode corrigir.
  if (midia) {
    const dur = midia.duracaoSeg ?? null;
    if (input.tipo === 'feed' && midia.ehVideo) {
      erros.push('Vídeo no feed do Instagram é Reels — troque o tipo para Reels.');
    }
    if (input.tipo === 'reels' && !midia.ehVideo) {
      erros.push('Reels precisa de um vídeo — para imagem, use Feed ou Story.');
    }
    if (input.tipo === 'reels' && midia.ehVideo && dur !== null) {
      if (dur < REELS_MIN_SEG) erros.push(`O vídeo tem ${Math.round(dur)}s — Reels exige pelo menos ${REELS_MIN_SEG}s.`);
      if (dur > REELS_MAX_SEG) erros.push(`O vídeo tem ${Math.round(dur / 60)} min — Reels aceita até ${REELS_MAX_SEG / 60} min.`);
    }
    if (input.tipo === 'story' && midia.ehVideo && dur !== null && dur > STORY_VIDEO_MAX_SEG) {
      erros.push(`O vídeo tem ${Math.round(dur)}s — story aceita até ${STORY_VIDEO_MAX_SEG}s. Para vídeo maior, use Reels.`);
    }
  }

  // ⚠️ Story não tem legenda no Instagram — a API nem aceita `caption` nesse
  // media_type. Recusar aqui evita o gestor escrever um texto que sumiria.
  if (input.tipo === 'story' && input.legenda.trim()) {
    erros.push('Story não tem legenda no Instagram — apague o texto ou publique no feed.');
  }
  if (input.legenda.length > LEGENDA_MAX) {
    erros.push(`A legenda tem ${input.legenda.length} caracteres — o limite do Instagram é ${LEGENDA_MAX}.`);
  }

  if (alvos.length === 0) erros.push('Nenhuma conta de Instagram selecionada.');

  const ag = input.agendamento;
  if (ag.modo === 'unico') {
    const d = new Date(ag.quando);
    if (Number.isNaN(d.getTime())) {
      erros.push('Data e hora inválidas.');
    } else if (d.getTime() < agora.getTime() + MIN_ANTECEDENCIA_MIN * 60_000) {
      erros.push(`Escolha um horário pelo menos ${MIN_ANTECEDENCIA_MIN} minutos à frente.`);
    }
  } else {
    if (ag.dias.length === 0) erros.push('Escolha pelo menos um dia da semana.');
    if (!horaValida(ag.hora)) erros.push('Horário inválido — use HH:MM.');
    else if (proximaOcorrencia(ag, agora) === null) {
      erros.push('A recorrência não tem nenhuma data futura — confira os dias e a data final.');
    }
  }
  return erros;
}

// -------------------------------------------------------------------- Resumo

const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Frase conferível do agendamento ("toda seg e qui às 09:00"). */
export function resumoAgendamento(ag: Agendamento): string {
  if (ag.modo === 'unico') {
    const d = new Date(ag.quando);
    if (Number.isNaN(d.getTime())) return 'data inválida';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    });
  }
  const dias = [...new Set(ag.dias)].sort((a, b) => a - b).map(d => NOMES_DIA[d] ?? '?');
  if (dias.length === 0) return 'sem dia escolhido';
  const lista = dias.length === 7 ? 'todo dia' : `toda ${dias.join(', ')}`;
  return `${lista} às ${ag.hora}${ag.ate ? ` (até ${ag.ate.split('-').reverse().join('/')})` : ''}`;
}

/**
 * As PRÓXIMAS datas de uma recorrência, para a tela mostrar.
 *
 * ⚠️ "roda toda terça" é abstrato; "próxima terça é 01/09" é conferível — é a
 * mesma razão pela qual os cards da Fidelidade mostram as datas em chips.
 */
export function proximasOcorrencias(ag: Agendamento, agora: Date, quantas = 3): Date[] {
  const saida: Date[] = [];
  let cursor = agora;
  for (let i = 0; i < quantas; i++) {
    const proxima = proximaOcorrencia(ag, cursor);
    if (!proxima) break;
    saida.push(proxima);
    if (ag.modo === 'unico') break;
    cursor = new Date(proxima.getTime() + 60_000);
  }
  return saida;
}
