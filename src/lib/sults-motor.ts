/**
 * Motor do envio de leads para o SULTS: varredura → fila → POST.
 *
 * Roda a cada minuto pela crontab da VPS. Sequencial de propósito — o SULTS não
 * publica limite de requisição, e disparar em paralelo contra um CRM de cliente
 * para descobrir o teto na marra não vale o risco.
 */

import type { Pool } from 'pg';
import {
  criarNegocioSults, ensureSultsSchema, listarConexoesSultsAtivas,
  SultsError, type ConexaoSults,
} from '@/lib/sults-server';
import { montarPayloadSults, type ConfigSults, type LeadParaSults } from '@/lib/sults';

const POR_TICK = 25;
const MAX_TENTATIVAS = 6;
/** Backoff por tentativa (minutos). A última repete de hora em hora até o teto. */
const BACKOFF_MIN = [1, 5, 15, 60, 60, 60];

const COLUNAS_LEAD = `
  l.id, l.nome, l.numero, l.email, l.canal, l.origin, l.temperatura, l.valor_rs,
  l.regiao_cidade, l.regiao_uf, l.utm_source, l.utm_medium, l.utm_campaign,
  l.utm_content, l.utm_term, l.campaign_name, l.adset_name, l.ad_name,
  l.source_url, l.created_at
`;

function config(conn: ConexaoSults): ConfigSults {
  return {
    responsavelId: conn.responsavel_id,
    etapaId: conn.etapa_id,
    origemId: conn.origem_id,
    campanhaId: conn.campanha_id,
    mapaOrigem: conn.mapa_origem,
  };
}

/**
 * Enfileira os leads do cliente ainda não enfileirados.
 *
 * ⚠️ `created_at >= conn.desde` é o que impede o despejo histórico: sem o
 * corte, ligar a integração de um cliente antigo criaria centenas de negócios
 * no CRM dele, e a API de Expansão não publica DELETE para desfazer.
 *
 * O ON CONFLICT DO NOTHING na unique (client_id, lead_id) faz a varredura ser
 * idempotente — pode rodar mil vezes que enfileira cada lead uma vez só.
 */
export async function varrerLeads(pool: Pool, conn: ConexaoSults): Promise<number> {
  const canais = conn.filtro_canais && conn.filtro_canais.length ? conn.filtro_canais : null;
  const { rowCount } = await pool.query(
    `INSERT INTO public.sults_envios (client_id, lead_id)
     SELECT l.client_id, l.id
       FROM public.crm_leads l
      WHERE l.client_id = $1
        AND l.created_at >= $2::timestamptz
        AND COALESCE(l.time_interno, false) = false
        AND ($3::text[] IS NULL OR lower(COALESCE(l.canal, '')) = ANY($3::text[]))
        -- ⚠️⚠️ Lead que JÁ EXISTE no SULTS nunca volta pra lá. Sem estas três
        -- travas, a ingestão da volta (que cria o lead aqui com created_at de
        -- hoje) fazia a ida devolver o acervo inteiro como negócio NOVO —
        -- ~1.800 duplicados no CondoStore em 16/09/2026, sem DELETE na API.
        -- Três sinais porque cada um cobre uma janela: origin/external_id são
        -- gravados na MESMA transação que cria o lead (não há intervalo em que
        -- o worker o veja sem marca); sults_negocios cobre lead que já existia
        -- e só foi casado por telefone.
        AND COALESCE(l.origin, '') <> 'sults'
        AND COALESCE(l.external_id, '') NOT LIKE 'sults:%'
        AND NOT EXISTS (
          SELECT 1 FROM public.sults_negocios n
           WHERE n.client_id = l.client_id AND n.lead_id = l.id
        )
     ON CONFLICT (client_id, lead_id) DO NOTHING`,
    [conn.client_id, conn.desde, canais ? canais.map(c => c.toLowerCase()) : null],
  );
  return rowCount ?? 0;
}

type Claim = { id: string; lead_id: string; tentativas: number };

/** Reserva atômica de UM envio. SKIP LOCKED protege de ticks sobrepostos. */
async function reservar(pool: Pool, clientId: string): Promise<Claim | null> {
  const { rows: [row] } = await pool.query<Claim>(
    `UPDATE public.sults_envios
        SET status = 'enviando', tentativas = tentativas + 1
      WHERE id = (
        SELECT id FROM public.sults_envios
         WHERE client_id = $1
           AND status IN ('pendente', 'erro')
           AND proximo_em <= NOW()
         ORDER BY proximo_em
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, lead_id, tentativas`,
    [clientId],
  );
  return row ?? null;
}

async function marcarErro(pool: Pool, envioId: string, tentativas: number, erro: string, permanente: boolean) {
  const desiste = permanente || tentativas >= MAX_TENTATIVAS;
  const min = BACKOFF_MIN[Math.min(tentativas - 1, BACKOFF_MIN.length - 1)];
  await pool.query(
    `UPDATE public.sults_envios
        SET status = $2, ultimo_erro = $3, proximo_em = NOW() + ($4 || ' minutes')::interval
      WHERE id = $1`,
    [envioId, desiste ? 'falha' : 'erro', erro.slice(0, 500), String(min)],
  );
}

export type ResultadoSults = {
  client_id: string;
  enfileirados: number;
  enviados: number;
  descartados: number;
  erros: number;
  /** Reservas que ficaram presas em 'enviando' — exigem conferência humana. */
  presos: number;
  erro?: string;
};

async function processarCliente(
  pool: Pool, conn: ConexaoSults, fim: number,
): Promise<ResultadoSults> {
  const r: ResultadoSults = {
    client_id: conn.client_id, enfileirados: 0, enviados: 0, descartados: 0, erros: 0, presos: 0,
  };

  try {
    r.enfileirados = await varrerLeads(pool, conn);
  } catch (err) {
    r.erro = `varredura: ${(err as Error).message}`;
    return r;
  }

  /**
   * ⚠️ Envio preso NÃO é reprocessado automaticamente.
   *
   * Uma linha fica em 'enviando' quando o processo morreu entre o POST e a
   * gravação da resposta — e daí não dá pra saber se o negócio foi criado no
   * SULTS ou não. Reenviar por conta própria criaria um negócio duplicado no
   * CRM do cliente, que a API não deixa apagar. Fica parada, é contada aqui, e
   * a conferência é humana: procurar o lead em Expansão (a listagem aceita
   * filtro por `titulo`) e então gravar o negocio_id à mão ou soltar a linha
   * de volta pra 'pendente'.
   */
  const { rows: [pres] } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM public.sults_envios
      WHERE client_id = $1 AND status = 'enviando' AND created_at < NOW() - INTERVAL '10 minutes'`,
    [conn.client_id],
  );
  r.presos = Number(pres?.n ?? 0);

  const conf = config(conn);
  for (let i = 0; i < POR_TICK && Date.now() < fim; i++) {
    const claim = await reservar(pool, conn.client_id);
    if (!claim) break;

    const { rows: [lead] } = await pool.query<LeadParaSults>(
      `SELECT ${COLUNAS_LEAD} FROM public.crm_leads l WHERE l.id = $1`, [claim.lead_id],
    );
    if (!lead) {
      await pool.query(
        `UPDATE public.sults_envios SET status = 'descartado', ultimo_erro = 'lead removido do CRM' WHERE id = $1`,
        [claim.id],
      );
      r.descartados++;
      continue;
    }

    const montagem = montarPayloadSults(lead, conf);
    if (!montagem.ok) {
      await pool.query(
        `UPDATE public.sults_envios SET status = 'descartado', ultimo_erro = $2 WHERE id = $1`,
        [claim.id, montagem.motivo.slice(0, 500)],
      );
      r.descartados++;
      continue;
    }

    try {
      const negocioId = await criarNegocioSults(conn.api_token as string, montagem.payload);
      await pool.query(
        `UPDATE public.sults_envios
            SET status = 'enviado', negocio_id = $2, enviado_em = NOW(), ultimo_erro = NULL
          WHERE id = $1`,
        [claim.id, negocioId],
      );
      r.enviados++;
    } catch (err) {
      const e = err as SultsError;
      await marcarErro(pool, claim.id, claim.tentativas, e.message, e.permanente === true);
      r.erros++;
      // 401/403 é credencial: insistir com os outros leads do mesmo cliente só
      // queima a fila inteira no mesmo erro.
      if (e.status === 401 || e.status === 403) {
        r.erro = e.message;
        break;
      }
    }
  }

  await pool.query(
    `UPDATE public.sults_connections SET ultima_varredura_em = NOW(), ultimo_erro = $2 WHERE id = $1`,
    [conn.id, r.erro ?? null],
  );
  return r;
}

export async function processarFilaSults(
  pool: Pool, opts: { budgetMs?: number; clientId?: string } = {},
): Promise<{ clientes: ResultadoSults[] }> {
  await ensureSultsSchema(pool);
  const fim = Date.now() + (opts.budgetMs ?? 45_000);
  const conexoes = (await listarConexoesSultsAtivas(pool))
    .filter(c => !opts.clientId || c.client_id === opts.clientId);

  const clientes: ResultadoSults[] = [];
  for (const conn of conexoes) {
    if (Date.now() >= fim) break;
    clientes.push(await processarCliente(pool, conn, fim));
  }
  return { clientes };
}
