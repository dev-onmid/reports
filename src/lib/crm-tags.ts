import type { Pool } from 'pg';
import { memoizarSchema } from '@/lib/schema-memo';

/**
 * Tags de qualificação do lead (2026-10-10) — rótulos LIVRES por cliente
 * ("Implante", "Convênio", "Urgência", "VIP"…), com cor, aplicados pela
 * recepção direto no card do Kanban e no chat.
 *
 * As duas tabelas já existiam (nasceram para segmentar público na aba
 * Disparos — `crm-disparo.ts`), só nunca tinham aparecido no board. O DDL aqui é
 * o MESMO, repetido de propósito: esta lib é o dono da qualificação e não pode
 * depender do módulo de disparos para criar a tabela. `IF NOT EXISTS` nos dois
 * lados torna a ordem irrelevante.
 *
 * ⚠️ Tag é do CLIENTE: toda escrita confere `client_id` da tag E do lead. O
 * usuário de cliente só alcança as rotas pelo proxy (acesso.ts), que resolve o
 * dono da tag pelo id (`clienteDaTag`) — mas a rota confere de novo, porque a
 * equipe da Onmid passa sem o proxy barrar nada.
 */

export type CrmTag = { id: string; name: string; color: string; lead_count?: number };

export const COR_PADRAO_TAG = '#0ea5e9';

/** Paleta oferecida na tela — tons que leem bem sobre o card escuro (#1a1a1a). */
export const PALETA_TAGS = [
  '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899',
  '#14b8a6', '#f97316', '#eab308', '#6366f1', '#84cc16', '#94a3b8',
];

export const NOME_TAG_MAX = 32;

export function normalizarCorTag(cor: unknown): string {
  if (typeof cor !== 'string') return COR_PADRAO_TAG;
  const c = cor.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(c) ? c : COR_PADRAO_TAG;
}

export function normalizarNomeTag(nome: unknown): string | null {
  if (typeof nome !== 'string') return null;
  const n = nome.replace(/\s+/g, ' ').trim().slice(0, NOME_TAG_MAX);
  return n || null;
}

export const ensureCrmTagsSchema = memoizarSchema(async (pool: Pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_lead_tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#0ea5e9',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_tags_client_name_idx
      ON public.crm_lead_tags (client_id, lower(name));
    CREATE TABLE IF NOT EXISTS public.crm_lead_tag_assignments (
      lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL REFERENCES public.crm_lead_tags(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (lead_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS crm_lead_tag_assignments_tag_idx
      ON public.crm_lead_tag_assignments (tag_id);
  `);
});

/**
 * Subquery LATERAL que devolve as tags de um lead como JSON (`[{id,name,color}]`,
 * em ordem alfabética). Entra nas listagens (`/api/crm`, inbox) para o card já
 * chegar com as tags — buscar por lead seria N requisições num board de 500.
 */
export function tagsDoLeadSql(aliasLead: string): string {
  return `(
    SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY lower(t.name)), '[]'::json)
      FROM public.crm_lead_tag_assignments a
      JOIN public.crm_lead_tags t ON t.id = a.tag_id
     WHERE a.lead_id = ${aliasLead}.id
  )`;
}

/** Tags de vários leads de uma vez (`lead_id → tags`), para o inbox. */
export async function tagsPorLead(pool: Pool, leadIds: string[]): Promise<Record<string, CrmTag[]>> {
  if (leadIds.length === 0) return {};
  const { rows } = await pool.query<{ lead_id: string; id: string; name: string; color: string }>(
    `SELECT a.lead_id, t.id, t.name, t.color
       FROM public.crm_lead_tag_assignments a
       JOIN public.crm_lead_tags t ON t.id = a.tag_id
      WHERE a.lead_id = ANY($1::uuid[])
      ORDER BY lower(t.name)`,
    [leadIds],
  );
  const out: Record<string, CrmTag[]> = {};
  for (const r of rows) (out[r.lead_id] ??= []).push({ id: r.id, name: r.name, color: r.color });
  return out;
}

/**
 * Define a lista COMPLETA de tags de um lead (o que não está na lista sai).
 * Só aceita tag do mesmo cliente do lead; tag estranha é ignorada, não aplicada.
 * Bate `updated_at` do lead para o poll incremental do board (`?since=`) enxergar
 * a mudança nas outras telas abertas.
 */
export async function definirTagsDoLead(pool: Pool, clientId: string, leadId: string, tagIds: string[]): Promise<CrmTag[] | null> {
  const { rowCount } = await pool.query(`SELECT 1 FROM public.crm_leads WHERE id = $1 AND client_id = $2`, [leadId, clientId]);
  if (!rowCount) return null;
  const ids = [...new Set(tagIds.filter(t => typeof t === 'string' && /^[0-9a-f-]{36}$/i.test(t)))];
  const { rows: validas } = await pool.query<{ id: string }>(
    `SELECT id FROM public.crm_lead_tags WHERE client_id = $1 AND id = ANY($2::uuid[])`,
    [clientId, ids],
  );
  const aceitas = validas.map(v => v.id);
  await pool.query('BEGIN');
  try {
    await pool.query(`DELETE FROM public.crm_lead_tag_assignments WHERE lead_id = $1 AND NOT (tag_id = ANY($2::uuid[]))`, [leadId, aceitas]);
    if (aceitas.length) {
      await pool.query(
        `INSERT INTO public.crm_lead_tag_assignments (lead_id, tag_id)
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [leadId, aceitas],
      );
    }
    await pool.query(`UPDATE public.crm_leads SET updated_at = NOW() WHERE id = $1`, [leadId]);
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
  return (await tagsPorLead(pool, [leadId]))[leadId] ?? [];
}
