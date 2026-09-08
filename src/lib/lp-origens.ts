/**
 * Sites e landing pages que enviam lead direto para o Reports.
 *
 * O token da origem É a credencial (vai na URL que a LP chama) e resolve
 * DUAS coisas de uma vez: qual cliente e QUAL site. Por isso a LP não precisa
 * conhecer o client_id — diferente do webhook genérico, cujo token é global e
 * exige client_id no payload.
 *
 * ⚠️ Vários por cliente, de propósito: um cliente pode ter LP de campanha,
 * site institucional e página de indicação ao mesmo tempo. Sem separar, os
 * leads dos três chegam indistinguíveis e não dá para saber qual página
 * converte. É por isso que a chave é (client_id, nome), não client_id.
 */

import type { Pool } from 'pg';

let schemaOk: Promise<void> | null = null;

export function ensureLpOrigensSchema(pool: Pool): Promise<void> {
  if (!schemaOk) {
    schemaOk = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.lp_origens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL,
          nome TEXT NOT NULL,
          url TEXT,
          token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          last_received_at TIMESTAMPTZ,
          total_recebidos INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // dois sites do mesmo cliente não podem ter o mesmo nome: o nome é o que
      // aparece no rastreio do lead, e repetido não distinguiria nada
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_origens_cliente_nome
          ON public.lp_origens (client_id, lower(nome))
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_lp_origens_token ON public.lp_origens (token)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.lp_origens_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          origem_id UUID,
          client_id TEXT,
          raw JSONB NOT NULL,
          resultado TEXT NOT NULL,
          detalhe TEXT,
          lead_id UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_lp_origens_log_cliente
          ON public.lp_origens_log (client_id, created_at DESC)
      `);
    })().catch(err => { schemaOk = null; throw err; });
  }
  return schemaOk;
}

export type LpOrigem = {
  id: string;
  client_id: string;
  nome: string;
  url: string | null;
  token: string;
  enabled: boolean;
  last_received_at: string | null;
  total_recebidos: number;
};

const COLS = 'id, client_id, nome, url, token, enabled, last_received_at, total_recebidos';

export async function listarOrigens(pool: Pool, clientId: string): Promise<LpOrigem[]> {
  await ensureLpOrigensSchema(pool);
  const { rows } = await pool.query<LpOrigem>(
    `SELECT ${COLS} FROM public.lp_origens WHERE client_id = $1 ORDER BY created_at`,
    [clientId],
  );
  return rows;
}

export async function criarOrigem(
  pool: Pool, clientId: string, nome: string, url?: string | null,
): Promise<LpOrigem> {
  await ensureLpOrigensSchema(pool);
  const { rows } = await pool.query<LpOrigem>(
    `INSERT INTO public.lp_origens (client_id, nome, url) VALUES ($1, $2, $3) RETURNING ${COLS}`,
    [clientId, nome.trim(), url?.trim() || null],
  );
  return rows[0];
}

export async function atualizarOrigem(
  pool: Pool, id: string, campos: { nome?: string; url?: string | null; enabled?: boolean },
): Promise<void> {
  await ensureLpOrigensSchema(pool);
  const set: string[] = [];
  const params: unknown[] = [];
  if (campos.nome !== undefined)    { params.push(campos.nome.trim()); set.push(`nome = $${params.length}`); }
  if (campos.url !== undefined)     { params.push(campos.url?.trim() || null); set.push(`url = $${params.length}`); }
  if (campos.enabled !== undefined) { params.push(campos.enabled); set.push(`enabled = $${params.length}`); }
  if (!set.length) return;
  params.push(id);
  await pool.query(`UPDATE public.lp_origens SET ${set.join(', ')} WHERE id = $${params.length}`, params);
}

export async function removerOrigem(pool: Pool, id: string): Promise<void> {
  await ensureLpOrigensSchema(pool);
  await pool.query('DELETE FROM public.lp_origens WHERE id = $1', [id]);
}

/** Resolve cliente + site a partir do token da URL. Desativada não recebe. */
export async function origemPorToken(pool: Pool, token: string): Promise<LpOrigem | null> {
  await ensureLpOrigensSchema(pool);
  const { rows } = await pool.query<LpOrigem>(
    `SELECT ${COLS} FROM public.lp_origens WHERE token = $1 LIMIT 1`, [token],
  );
  return rows[0] ?? null;
}

export async function marcarRecebido(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `UPDATE public.lp_origens
        SET last_received_at = NOW(), total_recebidos = total_recebidos + 1
      WHERE id = $1`, [id],
  );
}

export async function registrarLog(
  pool: Pool,
  dados: { origemId: string | null; clientId: string | null; raw: unknown;
           resultado: string; detalhe?: string | null; leadId?: string | null },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.lp_origens_log (origem_id, client_id, raw, resultado, detalhe, lead_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [dados.origemId, dados.clientId, JSON.stringify(dados.raw),
       dados.resultado, dados.detalhe ?? null, dados.leadId ?? null],
    );
    // poda: o log é diagnóstico, não arquivo — 200 por cliente já mostra padrão
    if (dados.clientId) {
      await pool.query(
        `DELETE FROM public.lp_origens_log
          WHERE client_id = $1
            AND id NOT IN (
              SELECT id FROM public.lp_origens_log
               WHERE client_id = $1 ORDER BY created_at DESC LIMIT 200)`,
        [dados.clientId],
      );
    }
  } catch { /* log nunca derruba a recepção do lead */ }
}

export async function listarLog(pool: Pool, clientId: string, limite = 20) {
  await ensureLpOrigensSchema(pool);
  const { rows } = await pool.query(
    `SELECT l.id, l.origem_id, l.raw, l.resultado, l.detalhe, l.lead_id, l.created_at, o.nome AS origem_nome
       FROM public.lp_origens_log l
       LEFT JOIN public.lp_origens o ON o.id = l.origem_id
      WHERE l.client_id = $1
      ORDER BY l.created_at DESC
      LIMIT $2`,
    [clientId, limite],
  );
  return rows;
}
