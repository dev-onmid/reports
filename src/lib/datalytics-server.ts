/**
 * Integração Datalytics — lado do servidor: conexão por cliente + log cru.
 *
 * O token da conexão É a credencial do webhook (vai na URL que o usuário cola
 * no "Nova integração" do Datalytics). Um token por cliente; a rota pública
 * resolve o cliente pelo token — diferente do webhook genérico, cujo token é
 * global e exige client_id no payload (que o Datalytics não manda).
 */

import type { Pool } from 'pg';

let schemaOk: Promise<void> | null = null;

export function ensureDatalyticsSchema(pool: Pool): Promise<void> {
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
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_datalytics_log_client
          ON public.datalytics_log (client_id, created_at DESC)
      `);
    })().catch(err => { schemaOk = null; throw err; });
  }
  return schemaOk;
}

export type ConexaoDatalytics = {
  id: string;
  client_id: string;
  token: string;
  enabled: boolean;
  last_received_at: string | null;
};

const CONN_COLS = 'id, client_id, token, enabled, last_received_at';

/** Cria a conexão do cliente se ainda não existe (token nasce do default do Postgres). */
export async function garantirConexaoDatalytics(pool: Pool, clientId: string): Promise<ConexaoDatalytics> {
  await ensureDatalyticsSchema(pool);
  const { rows } = await pool.query<ConexaoDatalytics>(
    `INSERT INTO public.datalytics_connections (client_id)
     VALUES ($1)
     ON CONFLICT (client_id) DO UPDATE SET client_id = EXCLUDED.client_id
     RETURNING ${CONN_COLS}`,
    [clientId],
  );
  return rows[0];
}

export async function conexaoPorToken(pool: Pool, token: string): Promise<ConexaoDatalytics | null> {
  await ensureDatalyticsSchema(pool);
  const { rows } = await pool.query<ConexaoDatalytics>(
    `SELECT ${CONN_COLS} FROM public.datalytics_connections WHERE token = $1 LIMIT 1`,
    [token],
  );
  return rows[0] ?? null;
}

export async function setDatalyticsEnabled(pool: Pool, clientId: string, enabled: boolean): Promise<void> {
  await ensureDatalyticsSchema(pool);
  await pool.query(
    `UPDATE public.datalytics_connections SET enabled = $2 WHERE client_id = $1`,
    [clientId, enabled],
  );
}

export type ResultadoLogDatalytics =
  | 'criado' | 'atualizado' | 'sem_telefone' | 'token_invalido'
  | 'desativado' | 'erro' | 'etapa_opaca' | 'teste_get';

/**
 * Grava o payload CRU sempre — é a única forma de descobrir o shape real do
 * webhook do Datalytics depois do primeiro "Testar requisição". Best-effort:
 * falha de log nunca derruba a recepção.
 */
export async function registrarLogDatalytics(pool: Pool, d: {
  clientId: string | null;
  raw: unknown;
  resultado: ResultadoLogDatalytics;
  detalhe?: string | null;
  leadId?: string | null;
}): Promise<void> {
  try {
    await ensureDatalyticsSchema(pool);
    await pool.query(
      `INSERT INTO public.datalytics_log (client_id, raw, resultado, detalhe, lead_id)
       VALUES ($1, $2::jsonb, $3, $4, $5)`,
      [d.clientId, JSON.stringify(d.raw ?? null), d.resultado, d.detalhe ?? null, d.leadId ?? null],
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
    console.error('[datalytics] falha ao logar', err);
  }
}

export type LogDatalytics = {
  id: string;
  resultado: string;
  detalhe: string | null;
  lead_id: string | null;
  raw: unknown;
  created_at: string;
};

export async function listarLogsDatalytics(pool: Pool, clientId: string, limit = 20): Promise<LogDatalytics[]> {
  await ensureDatalyticsSchema(pool);
  const { rows } = await pool.query<LogDatalytics>(
    `SELECT id, resultado, detalhe, lead_id, raw, created_at
       FROM public.datalytics_log
      WHERE client_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [clientId, limit],
  );
  return rows;
}
