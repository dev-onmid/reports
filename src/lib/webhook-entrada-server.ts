/**
 * Webhooks de entrada de lead — vários por cliente, cada um com um nome.
 *
 * Nasceu como "integração Datalytics" (um webhook por cliente, sem nome) e foi
 * generalizado: hoje o gestor cria quantos webhooks quiser e nomeia cada um
 * ("Datalytics", "Formulário do site", "RD Station"…). O nome organiza só a
 * TELA — a lista de webhooks e o log de recepções. O lead continua entrando
 * exatamente como antes: o canal é derivado do payload (UTM, click id), e a
 * coluna `canal` segue marcada como porta de entrada, o que `canalSql()` já
 * sabe descartar. Nada de gráfico, dashboard ou funil muda por causa do nome.
 *
 * ⚠️ A tabela física continua se chamando `datalytics_connections`, de
 * propósito. Renomear exigiria um RENAME irreversível de um lado e, do outro,
 * o `CREATE TABLE IF NOT EXISTS` de uma versão anterior recriaria a tabela
 * VAZIA num rollback — e a URL que a Cost Odonto já tem colada no painel dela
 * (328 leads desde 12/08) passaria a responder 401. Nome de tabela é barato;
 * webhook em produção que para de receber, não.
 *
 * O token da conexão É a credencial (vai na URL). A rota pública resolve o
 * cliente pelo token — diferente do webhook genérico, cujo token é global e
 * exige client_id no payload.
 */

import type { Pool } from 'pg';

let schemaOk: Promise<void> | null = null;

export function ensureWebhookEntradaSchema(pool: Pool): Promise<void> {
  if (!schemaOk) {
    schemaOk = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.datalytics_connections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL UNIQUE,
          token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          last_received_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        ALTER TABLE public.datalytics_connections
          ADD COLUMN IF NOT EXISTS nome TEXT
      `);
      // Toda conexão que já existia veio da integração Datalytics — é esse o
      // nome honesto dela, e é como o gestor vai reconhecê-la na lista.
      await pool.query(`
        UPDATE public.datalytics_connections
           SET nome = 'Datalytics'
         WHERE nome IS NULL OR btrim(nome) = ''
      `);
      // ⚠️ É esta constraint que impedia mais de um webhook por cliente.
      // O nome do índice é o que o Postgres gerou quando a tabela nasceu com
      // `client_id TEXT NOT NULL UNIQUE`.
      await pool.query(`
        ALTER TABLE public.datalytics_connections
          DROP CONSTRAINT IF EXISTS datalytics_connections_client_id_key
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_datalytics_connections_client
          ON public.datalytics_connections (client_id, created_at)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.datalytics_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT,
          raw JSONB NOT NULL,
          resultado TEXT NOT NULL,
          detalhe TEXT,
          lead_id UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Sem isto o log não consegue dizer QUAL webhook recebeu o quê — que é
      // justamente o que o nome passa a servir para responder.
      await pool.query(`
        ALTER TABLE public.datalytics_log
          ADD COLUMN IF NOT EXISTS conexao_id UUID
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_datalytics_log_client
          ON public.datalytics_log (client_id, created_at DESC)
      `);
    })().catch(err => { schemaOk = null; throw err; });
  }
  return schemaOk;
}

export type WebhookEntrada = {
  id: string;
  client_id: string;
  nome: string;
  token: string;
  enabled: boolean;
  last_received_at: string | null;
  created_at: string;
};

const COLS = `id, client_id, COALESCE(NULLIF(btrim(nome), ''), 'Webhook') AS nome,
              token, enabled, last_received_at, created_at`;

const NOME_MAX = 60;

/** Nome exibível: sem espaço sobrando, com teto, e nunca vazio. */
export function normalizarNomeWebhook(bruto: unknown, padrao = 'Webhook'): string {
  const s = typeof bruto === 'string' ? bruto.replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, NOME_MAX) : padrao;
}

export async function listarWebhooks(pool: Pool, clientId: string): Promise<WebhookEntrada[]> {
  await ensureWebhookEntradaSchema(pool);
  const { rows } = await pool.query<WebhookEntrada>(
    `SELECT ${COLS} FROM public.datalytics_connections
      WHERE client_id = $1
      ORDER BY created_at, id`,
    [clientId],
  );
  return rows;
}

/**
 * Cria um webhook novo (o token nasce do default do Postgres).
 *
 * ⚠️ Não existe mais lazy-create: a versão anterior criava a conexão só de
 * abrir a aba, e foi isso que gerou 6 dos 7 registros em produção — todos com
 * "nunca recebeu". Webhook agora só nasce quando alguém clica em criar.
 */
export async function criarWebhook(pool: Pool, clientId: string, nome: string): Promise<WebhookEntrada> {
  await ensureWebhookEntradaSchema(pool);
  const { rows } = await pool.query<WebhookEntrada>(
    `INSERT INTO public.datalytics_connections (client_id, nome)
     VALUES ($1, $2)
     RETURNING ${COLS}`,
    [clientId, normalizarNomeWebhook(nome)],
  );
  return rows[0];
}

export async function conexaoPorToken(pool: Pool, token: string): Promise<WebhookEntrada | null> {
  await ensureWebhookEntradaSchema(pool);
  const { rows } = await pool.query<WebhookEntrada>(
    `SELECT ${COLS} FROM public.datalytics_connections WHERE token = $1 LIMIT 1`,
    [token],
  );
  return rows[0] ?? null;
}

/**
 * Renomeia e/ou liga/desliga. O `client_id` no WHERE não é decoração: sem ele,
 * um id de outro cliente passaria.
 */
export async function atualizarWebhook(
  pool: Pool, clientId: string, id: string,
  campos: { nome?: string; enabled?: boolean },
): Promise<WebhookEntrada | null> {
  await ensureWebhookEntradaSchema(pool);
  const nome = campos.nome === undefined ? null : normalizarNomeWebhook(campos.nome);
  const { rows } = await pool.query<WebhookEntrada>(
    `UPDATE public.datalytics_connections
        SET nome    = COALESCE($3, nome),
            enabled = COALESCE($4, enabled)
      WHERE client_id = $1 AND id = $2::uuid
      RETURNING ${COLS}`,
    [clientId, id, nome, campos.enabled ?? null],
  );
  return rows[0] ?? null;
}

/**
 * Exclui o webhook. O log fica: é histórico do que ENTROU, e apagá-lo faria a
 * trilha de um lead que existe no CRM sumir junto.
 */
export async function excluirWebhook(pool: Pool, clientId: string, id: string): Promise<boolean> {
  await ensureWebhookEntradaSchema(pool);
  const { rowCount } = await pool.query(
    `DELETE FROM public.datalytics_connections WHERE client_id = $1 AND id = $2::uuid`,
    [clientId, id],
  );
  return (rowCount ?? 0) > 0;
}

export type ResultadoLogWebhook =
  | 'criado' | 'atualizado' | 'sem_telefone' | 'token_invalido'
  | 'desativado' | 'erro' | 'etapa_opaca' | 'teste_get';

/**
 * Grava o payload CRU sempre — é a única forma de descobrir o shape real de um
 * webhook novo depois do primeiro disparo de teste. Best-effort: falha de log
 * nunca derruba a recepção.
 */
export async function registrarLogWebhook(pool: Pool, d: {
  clientId: string | null;
  conexaoId?: string | null;
  raw: unknown;
  resultado: ResultadoLogWebhook;
  detalhe?: string | null;
  leadId?: string | null;
}): Promise<void> {
  try {
    await ensureWebhookEntradaSchema(pool);
    await pool.query(
      `INSERT INTO public.datalytics_log (client_id, conexao_id, raw, resultado, detalhe, lead_id)
       VALUES ($1, $2::uuid, $3::jsonb, $4, $5, $6)`,
      [d.clientId, d.conexaoId ?? null, JSON.stringify(d.raw ?? null), d.resultado, d.detalhe ?? null, d.leadId ?? null],
    );
    // Poda: só as últimas 200 por cliente interessam (o log existe pra
    // inspecionar o shape e depurar recepções recentes, não é histórico).
    if (d.clientId) {
      await pool.query(
        `DELETE FROM public.datalytics_log
          WHERE client_id = $1
            AND id NOT IN (
              SELECT id FROM public.datalytics_log
               WHERE client_id = $1
               ORDER BY created_at DESC
               LIMIT 200
            )`,
        [d.clientId],
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[webhook-entrada] falha ao logar', err);
  }
}

export type LogWebhook = {
  id: string;
  resultado: string;
  detalhe: string | null;
  lead_id: string | null;
  conexao_id: string | null;
  webhook_nome: string | null;
  raw: unknown;
  created_at: string;
};

export async function listarLogsWebhook(pool: Pool, clientId: string, limit = 20): Promise<LogWebhook[]> {
  await ensureWebhookEntradaSchema(pool);
  const { rows } = await pool.query<LogWebhook>(
    `SELECT l.id, l.resultado, l.detalhe, l.lead_id, l.conexao_id, l.raw, l.created_at,
            NULLIF(btrim(c.nome), '') AS webhook_nome
       FROM public.datalytics_log l
       LEFT JOIN public.datalytics_connections c ON c.id = l.conexao_id
      WHERE l.client_id = $1
      ORDER BY l.created_at DESC
      LIMIT $2`,
    [clientId, limit],
  );
  return rows;
}
