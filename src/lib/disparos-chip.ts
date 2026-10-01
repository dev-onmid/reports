/**
 * Proteção do CHIP nos Disparos — o intervalo entre mensagens e o opt-out.
 *
 * ⚠️⚠️ O defeito que originou este arquivo (medido em produção, 2026-10-01):
 * o piso anti-bloqueio de 90s era aplicado POR CAMPANHA (`zapi_campaigns.next_tick_at`),
 * mas a reputação é do NÚMERO. A PicoLocos tinha TRÊS campanhas rodando na mesma
 * instância, cada uma respeitando seus 90-210s — e o chip levava as três somadas:
 * **122 dos 458 envios (27%) saíram com menos de 90s de distância, com mínimo de
 * 1 SEGUNDO entre duas mensagens**. O teto diário já contava a instância inteira
 * (decisão de 2026-07-31); o intervalo não, e era a metade que mais importa.
 *
 * `zapi_chip_estado` é o relógio do chip: UMA linha por instância, reservada
 * atomicamente a cada envio. Campanha que chega e encontra o chip ocupado espera
 * a vez em vez de atropelar.
 *
 * O opt-out nasceu na mesma rodada: 75 pessoas pediram para parar em 90 dias e
 * continuavam na fila, porque opt-out só existia na Fidelidade. Pessoa marcada
 * como spam é o gatilho de banimento mais direto que existe.
 */
import type { Pool } from 'pg';
import { normalizarTelefoneBR } from '@/lib/cardapioweb-recorrencia';

/** Piso absoluto entre dois envios do MESMO chip (decisão de 2026-07-31). */
export const PISO_INTERVALO_SEG = 90;

/**
 * Frases que são pedido de parar de verdade.
 *
 * ⚠️ Deliberadamente CONSERVADOR. A tentação é casar "cancelar", "sair" e "pare"
 * soltos, mas "quero cancelar meu pedido" e "vou sair agora" são atendimento, não
 * descadastro — marcar isso como opt-out silenciaria cliente que quer comprar.
 * Então: ou a frase é explícita, ou a mensagem INTEIRA é uma palavra de parada.
 */
const FRASES_OPTOUT = [
  /\b(pare|para|parem)\s+(de\s+)?(me\s+)?(mandar|enviar|encher|manda)/i,
  /\bn[ãa]o\s+(quero|desejo)\s+(mais\s+)?(receber|nada|mensagens?)/i,
  /\bn[ãa]o\s+quero\s+mais\b/i,
  /\bn[ãa]o\s+(me\s+)?(mande|envie|manda)\s+(mais|nada)/i,
  /\bme\s+(tira|tire|remova|remove|exclui|exclua)\s+(da|desta|dessa)\s+lista/i,
  /\b(descadastr|desinscrev)/i,
  /\b(sair|remover|excluir)\s+da\s+lista\b/i,
  /\bremover?\s+(meu\s+)?(n[úu]mero|contato)\b/i,
  /\bpara\s+de\s+me\s+(mandar|enviar|perturbar|incomodar)/i,
  /\bn[ãa]o\s+tenho\s+interesse\b/i,
];

/** Mensagem curta que é SÓ a palavra de parada (resposta mais comum de todas). */
const SO_PALAVRA_OPTOUT = /^[\s\p{P}]*(pare|parar|para|stop|sair|cancelar|descadastrar|remover)[\s\p{P}]*$/iu;

export function pedeParaParar(texto: string | null | undefined): boolean {
  const t = String(texto ?? '').trim();
  if (!t || t.length > 300) return false; // texto longo não é comando de parada
  if (SO_PALAVRA_OPTOUT.test(t)) return true;
  return FRASES_OPTOUT.some(re => re.test(t));
}

/**
 * Chave do opt-out: sufixo de 8 dígitos.
 *
 * ⚠️ Oito e não dez de propósito: o mesmo contato chega como 5543999999999,
 * 43999999999 e 4399999999 (DDI e nono dígito), e o sufixo é a única forma que
 * casa as três sem exigir que as duas pontas concordem no formato. O preço é
 * poder bloquear um homônimo de outro DDD dentro da MESMA carteira — e esse erro
 * cai para o lado de NÃO enviar, que é o lado seguro aqui.
 */
export function chaveOptout(telefone: string | null | undefined): string | null {
  const n = normalizarTelefoneBR(telefone ?? '');
  return n && n.length >= 8 ? n.slice(-8) : null;
}

export async function garantirProtecaoChip(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.zapi_chip_estado (
      client_id        UUID        PRIMARY KEY,
      proximo_envio_at TIMESTAMPTZ,
      optout_sync_at   TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS public.zapi_optout (
      client_id  UUID        NOT NULL,
      chave      TEXT        NOT NULL,
      telefone   TEXT,
      motivo     TEXT,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (client_id, chave)
    );
  `);
}

/**
 * Reserva a vez do chip. `true` = pode enviar AGORA e o próximo só depois do
 * intervalo. `false` = outro envio (de qualquer campanha desta instância) está
 * dentro da janela — espere.
 *
 * ⚠️ É um `INSERT ... ON CONFLICT DO UPDATE ... WHERE` de propósito: a condição
 * dentro do UPDATE é o que torna a reserva ATÔMICA. Ler e depois gravar deixaria
 * duas invocações do worker passarem juntas — exatamente o envio de 1 segundo
 * que apareceu na medição.
 */
export async function reservarEnvioNoChip(
  pool: Pool, opts: { clientId: string; intervaloSeg: number },
): Promise<boolean> {
  const seg = Math.max(PISO_INTERVALO_SEG, Math.ceil(opts.intervaloSeg) || PISO_INTERVALO_SEG);
  const { rows } = await pool.query(
    `INSERT INTO public.zapi_chip_estado (client_id, proximo_envio_at)
          VALUES ($1, NOW() + ($2 * INTERVAL '1 second'))
     ON CONFLICT (client_id) DO UPDATE
            SET proximo_envio_at = NOW() + ($2 * INTERVAL '1 second')
          WHERE public.zapi_chip_estado.proximo_envio_at IS NULL
             OR public.zapi_chip_estado.proximo_envio_at <= NOW()
      RETURNING client_id`,
    [opts.clientId, seg],
  );
  return rows.length > 0;
}

/** Quantos segundos faltam para o chip liberar (só para explicar na tela/log). */
export async function esperaDoChip(pool: Pool, clientId: string): Promise<number> {
  const { rows: [r] } = await pool.query<{ faltam: number }>(
    `SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (proximo_envio_at - NOW()))))::int AS faltam
       FROM public.zapi_chip_estado WHERE client_id = $1`,
    [clientId],
  ).catch(() => ({ rows: [] as { faltam: number }[] }));
  return r?.faltam ?? 0;
}

/**
 * Tira da fila quem pediu para parar. Roda ANTES do laço de envio, de uma vez —
 * marcar um por um dentro do laço gastaria a vez do chip em quem nem vai receber.
 *
 * Devolve quantos contatos saíram da fila.
 */
export async function removerOptoutDaFila(
  pool: Pool, opts: { campaignId: string; clientId: string },
): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE public.zapi_numbers n
        SET status = 'optout', error_msg = 'pediu para não receber mais'
      WHERE n.campaign_id = $1
        AND n.status = 'pending'
        AND right(regexp_replace(n.phone, '[^0-9]', '', 'g'), 8) IN (
              SELECT chave FROM public.zapi_optout WHERE client_id = $2)`,
    [opts.campaignId, opts.clientId],
  );
  return rowCount ?? 0;
}

export async function registrarOptout(
  pool: Pool, opts: { clientId: string; telefone: string; motivo: string },
): Promise<boolean> {
  const chave = chaveOptout(opts.telefone);
  if (!chave) return false;
  await pool.query(
    `INSERT INTO public.zapi_optout (client_id, chave, telefone, motivo)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, chave) DO NOTHING`,
    [opts.clientId, chave, String(opts.telefone).slice(0, 40), opts.motivo.slice(0, 200)],
  );
  return true;
}

/**
 * Claim atômico do sync de opt-out: só UMA invocação do worker varre as
 * respostas por instância dentro da janela, mesmo com crons sobrepostos.
 */
export async function podeSincronizarOptout(
  pool: Pool, clientId: string, cadaMinutos = 10,
): Promise<boolean> {
  const { rows } = await pool.query(
    `INSERT INTO public.zapi_chip_estado (client_id, optout_sync_at)
          VALUES ($1, NOW())
     ON CONFLICT (client_id) DO UPDATE SET optout_sync_at = NOW()
          WHERE public.zapi_chip_estado.optout_sync_at IS NULL
             OR public.zapi_chip_estado.optout_sync_at < NOW() - ($2 * INTERVAL '1 minute')
      RETURNING client_id`,
    [clientId, Math.max(1, cadaMinutos)],
  );
  return rows.length > 0;
}

/**
 * Lê as respostas recebidas e registra quem pediu para parar.
 *
 * ⚠️ O escopo são os contatos que ESTA instância abordou (join com as listas das
 * campanhas dela). Sem esse recorte, a varredura leria a caixa de entrada de
 * todos os clientes e um "pare de mandar" dito a um cliente silenciaria o
 * contato na carteira de outro.
 *
 * ⚠️ A decisão de quem pediu para parar é tomada em JS (`pedeParaParar`), não em
 * SQL: o padrão precisa viver num lugar só, senão a regra da varredura e a do
 * resto do sistema divergem na primeira mudança.
 */
export async function sincronizarOptout(
  pool: Pool, opts: { clientId: string; desdeHoras?: number; limite?: number },
): Promise<{ novos: number; analisadas: number }> {
  const horas = Math.max(1, opts.desdeHoras ?? 6);
  const limite = Math.max(1, opts.limite ?? 2000);

  const { rows } = await pool.query<{ numero: string; texto: string }>(
    `SELECT l.numero, m.text AS texto
       FROM public.crm_messages m
       JOIN public.crm_leads l ON l.id = m.lead_id
      WHERE m.direction = 'in'
        AND m.created_at > NOW() - ($2 * INTERVAL '1 hour')
        AND m.text IS NOT NULL
        AND l.numero IS NOT NULL
        AND right(regexp_replace(l.numero, '[^0-9]', '', 'g'), 8) IN (
              SELECT DISTINCT right(regexp_replace(n.phone, '[^0-9]', '', 'g'), 8)
                FROM public.zapi_numbers n
                JOIN public.zapi_campaigns c ON c.id = n.campaign_id
               WHERE c.client_id = $1)
      ORDER BY m.created_at DESC
      LIMIT $3`,
    [opts.clientId, horas, limite],
  ).catch(() => ({ rows: [] as { numero: string; texto: string }[] }));

  let novos = 0;
  for (const r of rows) {
    if (!pedeParaParar(r.texto)) continue;
    const ok = await registrarOptout(pool, {
      clientId: opts.clientId, telefone: r.numero, motivo: String(r.texto).trim().slice(0, 200),
    });
    if (ok) novos++;
  }
  return { novos, analisadas: rows.length };
}
