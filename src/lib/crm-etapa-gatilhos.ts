/**
 * Gatilhos que miram uma etapa do Kanban pelo RÓTULO.
 *
 * `client_conversion_eventos_custom.status_gatilho` e
 * `crm_followup_regras.status_gatilho` (e `crm_followup_mensagens.status_destino`)
 * guardam o nome da etapa como texto, por cliente, sem chave estrangeira para
 * `crm_stages`. Renomear a etapa sem realinhar deixava o gatilho morto em
 * silêncio; excluir, idem. Desde 2026-10-23 o próprio cliente edita as etapas,
 * então as duas rotas (`/api/crm/stages/[id]`) passam por aqui.
 *
 * ⚠️ O gatilho é do CLIENTE, não do funil: se outra etapa do cliente (outro
 * funil) ainda tem o rótulo antigo, o gatilho continua servindo a ela e NÃO se
 * mexe — por isso `rotuloSegueEmUso` vem antes de realinhar ou barrar.
 */

type Consulta = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

/** Outra etapa do cliente (qualquer funil) ainda usa este rótulo? */
export async function rotuloSegueEmUso(pool: Consulta, clientId: string, rotulo: string, exceto: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM public.crm_stages
      WHERE client_id = $1 AND LOWER(TRIM(label)) = LOWER(TRIM($2)) AND id::text <> $3
      LIMIT 1`,
    [clientId, rotulo, exceto],
  );
  return rows.length > 0;
}

/** Quantas automações (conversão + follow-up) disparam por este rótulo. */
export async function contarGatilhos(pool: Consulta, clientId: string, rotulo: string): Promise<number> {
  let total = 0;
  for (const tabela of ['client_conversion_eventos_custom', 'crm_followup_regras']) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.${tabela}
        WHERE client_id = $1 AND LOWER(TRIM(status_gatilho)) = LOWER(TRIM($2))`,
      [clientId, rotulo],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    total += Number(rows[0]?.n) || 0;
  }
  return total;
}

/**
 * Leva os gatilhos do rótulo antigo para o novo. Mesma régua do saneamento do
 * Kanban (`crm-saneamento.ts`): conversão só muda se o destino ainda não tem
 * gatilho igual (unique por status). Best-effort — falha não desfaz o rename.
 */
export async function realinharGatilhos(pool: Consulta, clientId: string, de: string, para: string): Promise<number> {
  const { rowCount: conv } = await pool.query(
    `UPDATE public.client_conversion_eventos_custom c
        SET status_gatilho = $1
      WHERE c.client_id = $2 AND LOWER(c.status_gatilho) = LOWER($3)
        AND NOT EXISTS (
          SELECT 1 FROM public.client_conversion_eventos_custom d
           WHERE d.client_id = $2 AND LOWER(d.status_gatilho) = LOWER($1)
        )`,
    [para, clientId, de],
  ).catch(() => ({ rowCount: 0 }));
  const { rowCount: fup } = await pool.query(
    `UPDATE public.crm_followup_regras
        SET status_gatilho = $1
      WHERE client_id = $2 AND status_gatilho = $3`,
    [para, clientId, de],
  ).catch(() => ({ rowCount: 0 }));
  await pool.query(
    `UPDATE public.crm_followup_mensagens m
        SET status_destino = $1
       FROM public.crm_followup_regras rg
      WHERE m.regra_id = rg.id AND rg.client_id = $2 AND m.status_destino = $3`,
    [para, clientId, de],
  ).catch(() => {});
  return (conv ?? 0) + (fup ?? 0);
}
