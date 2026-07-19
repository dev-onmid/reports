// ── Portal read-only do cliente (CRM) ────────────────────────────────────────
//
// Acesso EXTERNO do cliente final ao próprio funil, por token — mesmo padrão do
// viewer público de relatório (/relatorio/[token]) e dos webhooks por token.
// Decisão de arquitetura (auditoria 2026-07-16): as rotas internas do CRM não
// validam permissão server-side, então dar login no app pro cliente é inseguro.
// O portal expõe uma superfície NOVA e mínima: rotas dedicadas, SELECT-only,
// sempre filtradas pelo client_id resolvido do token. Nada de escrita.
//
// Regras de privacidade do portal:
//  - Leads time_interno nunca aparecem.
//  - `observacao` (anotações internas da agência) nunca sai pro cliente.
//  - Conversas são somente-leitura e só de leads do client_id do token.

import { randomBytes } from 'crypto';
import type { Pool } from 'pg';

let schemaEnsured = false;

export async function ensurePortalSchema(pool: Pool) {
  if (schemaEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_portal_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_access_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS crm_portal_tokens_client_idx
      ON public.crm_portal_tokens (client_id);
  `).catch(err => console.error('[crm-portal schema]', err?.message ?? err));
  schemaEnsured = true;
}

/** Retorna o token ativo do cliente, criando um se não existir. */
export async function getOrCreatePortalToken(pool: Pool, clientId: string): Promise<string> {
  await ensurePortalSchema(pool);
  const { rows: [existing] } = await pool.query<{ token: string }>(
    `SELECT token FROM public.crm_portal_tokens
      WHERE client_id = $1 AND enabled = TRUE
      ORDER BY created_at DESC LIMIT 1`,
    [clientId],
  );
  if (existing?.token) return existing.token;

  const token = randomBytes(24).toString('hex');
  await pool.query(
    `INSERT INTO public.crm_portal_tokens (token, client_id) VALUES ($1, $2)`,
    [token, clientId],
  );
  return token;
}

/** Revoga TODOS os tokens do cliente (o link antigo morre na hora). */
export async function revokePortalTokens(pool: Pool, clientId: string): Promise<void> {
  await ensurePortalSchema(pool);
  await pool.query(
    `UPDATE public.crm_portal_tokens SET enabled = FALSE WHERE client_id = $1`,
    [clientId],
  );
}

export type PortalContext = { clientId: string; clientName: string };

/** Resolve o token → cliente. Null = token inválido/revogado. */
export async function resolvePortalToken(pool: Pool, token: string): Promise<PortalContext | null> {
  await ensurePortalSchema(pool);
  if (!token || token.length < 16) return null;
  const { rows: [row] } = await pool.query<{ client_id: string; name: string | null }>(
    `SELECT t.client_id, c.name
       FROM public.crm_portal_tokens t
       LEFT JOIN public.clients c ON c.id = t.client_id
      WHERE t.token = $1 AND t.enabled = TRUE
      LIMIT 1`,
    [token],
  );
  if (!row) return null;
  pool.query(
    `UPDATE public.crm_portal_tokens SET last_access_at = NOW() WHERE token = $1`,
    [token],
  ).catch(() => null);
  return { clientId: row.client_id, clientName: row.name ?? 'Cliente' };
}
