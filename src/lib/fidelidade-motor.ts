import type { Pool } from 'pg';
import { getConnectedClientInstance } from '@/lib/crm-disparo';
import { sendFollowupMessage } from '@/lib/followup-send';
import { lerPedidosDelivery } from '@/lib/delivery-orders';
import { agruparPorCliente, normalizarRegua, normalizarTelefoneBR } from '@/lib/cardapioweb-recorrencia';
import { getConnection, ensureCardapioWebSchema } from '@/lib/cardapioweb';
import {
  aplicarVars, dentroDaJanela, diaPermitido, filtrarPublico, proximaExecucao,
  varsDoDestinatario, type Destinatario, type Travas,
} from '@/lib/fidelidade';
import {
  chavesComOptout, chavesEmCooldown, contatosDaLista, enviadasHoje, lerTravas,
} from '@/lib/fidelidade-server';

/**
 * Motor de envio da Fidelidade — a lógica, sem a casca HTTP.
 *
 * Mora numa lib porque tem DOIS chamadores: o cron (`/api/fidelidade/worker`)
 * e o botão "Disparar 1 agora" da tela. Duplicar isso faria as travas
 * divergirem entre o disparo automático e o manual — exatamente onde não pode.
 *
 * ⚠️ Cada chamada de `processarCampanha` envia NO MÁXIMO UMA mensagem.
 */

export const COLS_DEVIDA = `f.id, f.client_id, f.fonte, f.modelo, f.lista_id, f.nome, f.params,
       f.mensagens, f.cupom, f.imagem_url, f.dias_semana, f.hora, f.teto_publico`;

export type LinhaDevida = {
  id: string; client_id: string; fonte: string; modelo: string | null; lista_id: string | null;
  nome: string | null; params: unknown; mensagens: unknown; cupom: string | null;
  imagem_url: string | null; dias_semana: string | null; hora: string | null;
  teto_publico: number | null;
};

async function adiar(pool: Pool, id: string, ms: number) {
  await pool.query(
    `UPDATE public.fidelidade_campanhas
        SET proxima_execucao = NOW() + ($2 || ' milliseconds')::interval WHERE id = $1`,
    [id, String(Math.round(ms))],
  );
}

async function reagendar(
  pool: Pool, campanha: LinhaDevida, travas: Travas,
) {
  const dias = (campanha.dias_semana ?? '')
    .split(',').map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    // A campanha nunca pode rodar num dia que as travas do cliente proíbem.
    .filter(d => travas.diasSemana.includes(d));
  const proxima = proximaExecucao(dias, campanha.hora ?? '18:00', new Date());
  if (!proxima) {
    // Sem dia válido a campanha ficaria em loop pedindo execução a cada tick.
    await adiar(pool, campanha.id, 6 * 60 * 60_000);
    return null;
  }
  await pool.query(
    `UPDATE public.fidelidade_campanhas SET proxima_execucao = $2, ultima_execucao = NOW() WHERE id = $1`,
    [campanha.id, proxima.toISOString()],
  );
  return proxima;
}

/**
 * `manual` = alguém clicou "Disparar 1 agora" na tela.
 *
 * ⚠️ O clique manual IGNORA dia da semana e janela de horário — é uma decisão
 * explícita de um humano que está olhando, o mesmo princípio já usado no
 * "Disparar agora" do Leadlovers. Todas as demais travas continuam valendo:
 * teto diário, opt-out, cooldown, teto de público e instância conectada. Elas
 * protegem o CHIP do cliente, não a agenda.
 */
export async function processarCampanha(
  pool: Pool, campanha: LinhaDevida, opcoes: { manual?: boolean } = {},
): Promise<Record<string, unknown>> {
  const travas = await lerTravas(pool, campanha.client_id);
  const agora = new Date();

  if (!opcoes.manual && !diaPermitido(travas, agora)) {
    await adiar(pool, campanha.id, 30 * 60_000);
    return { campanha: campanha.id, pulou: 'dia_nao_permitido' };
  }
  if (!opcoes.manual && !dentroDaJanela(travas, agora)) {
    await adiar(pool, campanha.id, 10 * 60_000);
    return { campanha: campanha.id, pulou: 'fora_da_janela' };
  }
  const jaHoje = await enviadasHoje(pool, campanha.client_id);
  if (jaHoje >= travas.tetoDiario) {
    await adiar(pool, campanha.id, 60 * 60_000);
    return { campanha: campanha.id, pulou: 'teto_diario', enviadas_hoje: jaHoje };
  }

  // Execução em andamento? Continua a fila dela.
  const { rows: [aberta] } = await pool.query<{ id: string }>(
    `SELECT id FROM public.fidelidade_execucoes
      WHERE campanha_id = $1 AND status = 'rodando' ORDER BY iniciada_em DESC LIMIT 1`,
    [campanha.id],
  );

  const execucaoId = aberta?.id ?? await abrirExecucao(pool, campanha, travas);
  if (!execucaoId) {
    const proxima = await reagendar(pool, campanha, travas);
    return { campanha: campanha.id, publico: 0, reagendada: proxima?.toISOString() ?? null };
  }

  return enviarProxima(pool, campanha, travas, execucaoId);
}

/** Resolve o público AGORA e monta a fila. Devolve null se não sobrou ninguém. */
async function abrirExecucao(
  pool: Pool, campanha: LinhaDevida, travas: Travas,
): Promise<string | null> {
  const destinatarios = await resolverPublico(pool, campanha);
  if (destinatarios.length === 0) return null;

  const chaves = destinatarios.map(d => d.chave);
  const [optout, cooldown] = await Promise.all([
    travas.optoutAtivo ? chavesComOptout(pool, campanha.client_id, chaves) : Promise.resolve(new Set<string>()),
    chavesEmCooldown(pool, campanha.client_id, chaves, travas.cooldownDias),
  ]);

  const { rows: [exec] } = await pool.query<{ id: string }>(
    `INSERT INTO public.fidelidade_execucoes (campanha_id, client_id, publico)
     VALUES ($1, $2, $3) RETURNING id`,
    [campanha.id, campanha.client_id, destinatarios.length],
  );

  const teto = campanha.teto_publico && campanha.teto_publico > 0 ? campanha.teto_publico : Infinity;
  let aceitos = 0;
  let puladas = 0;

  for (const d of destinatarios) {
    let motivo: string | null = null;
    if (optout.has(d.chave)) motivo = 'optout';
    else if (cooldown.has(d.chave)) motivo = 'cooldown';
    else if (aceitos >= teto) motivo = 'teto_publico';

    if (motivo) puladas++; else aceitos++;

    await pool.query(
      `INSERT INTO public.fidelidade_envios
         (execucao_id, campanha_id, client_id, chave, telefone, nome, status, motivo, cupom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [exec.id, campanha.id, campanha.client_id, d.chave, d.telefone, d.nome,
        motivo ? 'pulada' : 'pendente', motivo, campanha.cupom],
    );
  }

  await pool.query(
    `UPDATE public.fidelidade_execucoes SET puladas = $2 WHERE id = $1`, [exec.id, puladas],
  );
  if (aceitos === 0) {
    await pool.query(
      `UPDATE public.fidelidade_execucoes SET status = 'concluida', concluida_em = NOW() WHERE id = $1`,
      [exec.id],
    );
    return null;
  }
  return exec.id;
}

async function resolverPublico(
  pool: Pool, campanha: LinhaDevida,
): Promise<Destinatario[]> {
  if (campanha.fonte === 'lista') {
    if (!campanha.lista_id) return [];
    const contatos = await contatosDaLista(pool, campanha.lista_id);
    return contatos.map(c => ({ chave: c.chave, telefone: c.telefone, nome: c.nome }));
  }

  if (!campanha.modelo) return [];
  await ensureCardapioWebSchema(pool);
  const conn = await getConnection(pool, campanha.client_id);
  const regua = normalizarRegua({
    janelaDias: conn?.janela_dias, inatividadeDias: conn?.inatividade_dias,
  });
  const { pedidos } = await lerPedidosDelivery(pool, campanha.client_id);
  const clientes = agruparPorCliente(pedidos, regua, new Date().toISOString());
  const pedidosTotal = clientes.reduce((s, c) => s + c.pedidos, 0);
  const receitaTotal = clientes.reduce((s, c) => s + c.receita, 0);

  const publico = filtrarPublico(
    clientes,
    campanha.modelo as Parameters<typeof filtrarPublico>[1],
    (campanha.params ?? {}) as Record<string, number | null>,
    { regua, ticketMedioLoja: pedidosTotal > 0 ? receitaTotal / pedidosTotal : 0 },
  );

  return publico
    .filter(c => c.telefone)
    .map(c => ({
      chave: normalizarTelefoneBR(c.telefone) ?? c.telefone!,
      telefone: c.telefone!,
      nome: c.nome,
      consumo: { pedidos: c.pedidos, ticketMedio: c.ticketMedio, diasDesdeUltima: c.diasDesdeUltima },
    }));
}

/** Envia exatamente UMA mensagem e devolve a campanha para a fila. */
async function enviarProxima(
  pool: Pool, campanha: LinhaDevida, travas: Travas, execucaoId: string,
): Promise<Record<string, unknown>> {
  const { rows: [alvo] } = await pool.query<{
    id: string; telefone: string; nome: string | null; chave: string;
  }>(
    `SELECT id, telefone, nome, chave FROM public.fidelidade_envios
      WHERE execucao_id = $1 AND status = 'pendente' ORDER BY criado_em ASC LIMIT 1`,
    [execucaoId],
  );

  if (!alvo) {
    await pool.query(
      `UPDATE public.fidelidade_execucoes SET status = 'concluida', concluida_em = NOW() WHERE id = $1`,
      [execucaoId],
    );
    const proxima = await reagendar(pool, campanha, travas);
    return { campanha: campanha.id, concluida: execucaoId, reagendada: proxima?.toISOString() ?? null };
  }

  // A instância é conferida AO VIVO a cada envio — credencial guardada não
  // prova que o WhatsApp do cliente está conectado agora.
  const conexao = await getConnectedClientInstance(pool, campanha.client_id);
  if (!conexao.instance) {
    await adiar(pool, campanha.id, 15 * 60_000);
    return { campanha: campanha.id, pulou: 'instancia', motivo: conexao.reason };
  }

  const mensagens = Array.isArray(campanha.mensagens) ? campanha.mensagens as string[] : [];
  const textos = mensagens.filter(m => typeof m === 'string' && m.trim());
  if (textos.length === 0) {
    await pool.query(
      `UPDATE public.fidelidade_envios SET status = 'falha', erro = 'sem mensagem' WHERE id = $1`,
      [alvo.id],
    );
    return { campanha: campanha.id, erro: 'campanha sem mensagem' };
  }

  // Rodízio de texto: variar não é enfeite, é o que evita o padrão que faz o
  // WhatsApp marcar o número. O índice sai do próprio envio, não de um contador
  // global, para dois envios simultâneos não escolherem sempre o mesmo.
  const variacao = Math.floor(Math.random() * textos.length);
  const destinatario: Destinatario = {
    chave: alvo.chave, telefone: alvo.telefone, nome: alvo.nome,
  };
  const vars = varsDoDestinatario(destinatario, await nomeDaLoja(pool, campanha.client_id), campanha.cupom);
  // Modo 'envio': variável sem valor é APAGADA, nunca entregue como {{chave}}.
  const texto = aplicarVars(textos[variacao], vars, 'envio');

  const res = await sendFollowupMessage({
    instance: conexao.instance,
    phone: alvo.telefone,
    tipo: campanha.imagem_url ? 'imagem' : 'texto',
    conteudo: campanha.imagem_url ?? texto,
    vars: { nome: alvo.nome ?? '', telefone: alvo.telefone, legenda: texto },
  });

  if (res.ok) {
    await pool.query(
      `UPDATE public.fidelidade_envios
          SET status = 'enviada', enviado_em = NOW(), variacao = $2, texto = $3 WHERE id = $1`,
      [alvo.id, variacao, texto],
    );
    await pool.query(
      `UPDATE public.fidelidade_execucoes SET enviadas = enviadas + 1 WHERE id = $1`, [execucaoId],
    );
  } else {
    // O texto vai junto mesmo na falha: sem ele não dá para saber se o erro foi
    // do número ou do conteúdo da mensagem.
    await pool.query(
      `UPDATE public.fidelidade_envios SET status = 'falha', erro = $2, texto = $3 WHERE id = $1`,
      [alvo.id, String(res.error ?? 'falha'), texto],
    );
    await pool.query(
      `UPDATE public.fidelidade_execucoes SET falhas = falhas + 1 WHERE id = $1`, [execucaoId],
    );
  }

  await adiar(pool, campanha.id, travas.intervaloMinSeg * 1000);
  return { campanha: campanha.id, telefone: alvo.telefone, enviada: res.ok, variacao };
}

const lojas = new Map<string, string>();
async function nomeDaLoja(pool: Pool, clientId: string): Promise<string> {
  const cache = lojas.get(clientId);
  if (cache) return cache;
  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM public.clients WHERE id = $1`, [clientId],
  ).catch(() => ({ rows: [] as { name: string }[] }));
  const nome = rows[0]?.name ?? 'nossa loja';
  lojas.set(clientId, nome);
  return nome;
}
