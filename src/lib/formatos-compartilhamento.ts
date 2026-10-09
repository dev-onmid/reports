// ── Links públicos da biblioteca "Formatos de Criativos" ─────────────────────
//
// Mesmo modelo do portal do CRM e do viewer de relatório: quem tem o link vê
// SÓ aquele conteúdo. A página pública (/formatos/[token]) e as rotas
// /api/formatos-publico/[token]/* não carregam sessão nenhuma e só entregam o
// que está no escopo do token: a biblioteca inteira ('todos') ou um formato
// ('12'). Nada de escrita, nenhum dado de cliente, nenhum caminho para o resto
// do sistema.
//
// O token (32 hex) é a credencial. Revogar é imediato: o link morre na hora.

import { randomBytes } from 'crypto';
import type { Pool } from 'pg';
import dados from '@/lib/formatos-criativos.json';

type FormatoBruto = {
  numero: number; titulo: string; descricao: string; grupo: string;
  exemplos: { nome: string; tipo: string; arquivo: string }[];
};
const FORMATOS = (dados as { formatos: FormatoBruto[] }).formatos;

export const TOKEN_REGEX = /^[a-f0-9]{32}$/;

export type LinkFormatos = {
  token: string;
  escopo: string;
  criado_por_nome: string | null;
  criado_em: string;
  acessos: number;
  ultimo_acesso: string | null;
};

let schemaOk = false;
async function ensureSchema(pool: Pool) {
  if (schemaOk) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.formatos_links (
      token TEXT PRIMARY KEY,
      escopo TEXT NOT NULL,
      criado_por TEXT,
      criado_por_nome TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revogado_em TIMESTAMPTZ,
      acessos INT NOT NULL DEFAULT 0,
      ultimo_acesso TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS formatos_links_escopo_idx ON public.formatos_links (escopo) WHERE revogado_em IS NULL;
  `);
  schemaOk = true;
}

/** 'todos' ou o número de um formato que existe. Qualquer outra coisa é recusada. */
export function escopoValido(escopo: unknown): string | null {
  const e = String(escopo ?? '').trim();
  if (e === 'todos') return e;
  return FORMATOS.some((f) => String(f.numero) === e) ? e : null;
}

/** Os formatos que um escopo deixa ver, sem os ids do Drive. */
export function formatosDoEscopo(escopo: string) {
  const lista = escopo === 'todos' ? FORMATOS : FORMATOS.filter((f) => String(f.numero) === escopo);
  return lista.map((f) => ({
    numero: f.numero,
    titulo: f.titulo,
    descricao: f.descricao,
    grupo: f.grupo,
    exemplos: f.exemplos.map((e) => ({ nome: e.nome, tipo: e.tipo, arquivo: e.arquivo })),
  }));
}

/** O arquivo de mídia pertence a um formato que o escopo cobre? */
export function arquivoNoEscopo(escopo: string, arquivo: string): boolean {
  return formatosDoEscopo(escopo).some((f) => f.exemplos.some((e) => e.arquivo === arquivo));
}

/** Reaproveita o link ativo do mesmo escopo; senão cria um. */
export async function gerarLink(
  pool: Pool,
  escopo: string,
  autor: { id: string | null; nome: string | null },
): Promise<LinkFormatos> {
  await ensureSchema(pool);
  const { rows: [existente] } = await pool.query<LinkFormatos>(
    `SELECT token, escopo, criado_por_nome, criado_em, acessos, ultimo_acesso
       FROM public.formatos_links WHERE escopo = $1 AND revogado_em IS NULL
      ORDER BY criado_em DESC LIMIT 1`,
    [escopo],
  );
  if (existente) return existente;
  const token = randomBytes(16).toString('hex');
  const { rows: [novo] } = await pool.query<LinkFormatos>(
    `INSERT INTO public.formatos_links (token, escopo, criado_por, criado_por_nome)
     VALUES ($1, $2, $3, $4)
     RETURNING token, escopo, criado_por_nome, criado_em, acessos, ultimo_acesso`,
    [token, escopo, autor.id, autor.nome],
  );
  return novo;
}

export async function listarLinks(pool: Pool): Promise<LinkFormatos[]> {
  await ensureSchema(pool);
  const { rows } = await pool.query<LinkFormatos>(
    `SELECT token, escopo, criado_por_nome, criado_em, acessos, ultimo_acesso
       FROM public.formatos_links WHERE revogado_em IS NULL ORDER BY criado_em DESC`,
  );
  return rows;
}

export async function revogarLink(pool: Pool, token: string): Promise<boolean> {
  await ensureSchema(pool);
  const r = await pool.query(
    `UPDATE public.formatos_links SET revogado_em = NOW() WHERE token = $1 AND revogado_em IS NULL`,
    [token],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Escopo do token ativo, ou null. `contar` registra o acesso (só na abertura da página). */
export async function resolverToken(pool: Pool, token: string, contar = false): Promise<string | null> {
  if (!TOKEN_REGEX.test(token)) return null;
  await ensureSchema(pool);
  const { rows: [r] } = contar
    ? await pool.query<{ escopo: string }>(
        `UPDATE public.formatos_links SET acessos = acessos + 1, ultimo_acesso = NOW()
          WHERE token = $1 AND revogado_em IS NULL RETURNING escopo`,
        [token],
      )
    : await pool.query<{ escopo: string }>(
        `SELECT escopo FROM public.formatos_links WHERE token = $1 AND revogado_em IS NULL`,
        [token],
      );
  return r?.escopo ?? null;
}
