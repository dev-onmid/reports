import { memoizarSchema } from '@/lib/schema-memo';
import type { makeServerPool } from '@/lib/server-db';
import { classificarEtapa, normalizarEtiqueta, postoDaEtapa, type EtapaFunil } from '@/lib/funil-etapas';

type Pool = ReturnType<typeof makeServerPool>;

const ETAPAS_VALIDAS = new Set<string>(['contato', 'qualificado', 'agendamento', 'comparecimento', 'fechamento', 'perdido']);

/** Uma etapa dentro de um modelo — é o que basta para recriar a coluna. */
export type EtapaModelo = {
  label: string;
  color: string;
  etapa_funil: EtapaFunil;
};

export type FunilModelo = {
  id: string;
  nome: string;
  descricao: string | null;
  etapas: EtapaModelo[];
  cliente_origem: string | null;
  criado_por: string | null;
  created_at: string;
};

async function ensureSchemaInterno(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_funil_modelos (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome           TEXT NOT NULL,
      descricao      TEXT,
      etapas         JSONB NOT NULL,
      cliente_origem TEXT,
      criado_por     TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- ⚠️ Unique por nome NORMALIZADO: salvar duas vezes com o mesmo nome
    -- ATUALIZA o modelo em vez de encher a lista de "Funil Clínica" repetidos.
    CREATE UNIQUE INDEX IF NOT EXISTS crm_funil_modelos_nome_idx
      ON public.crm_funil_modelos (lower(btrim(nome)));
  `);
}

// ⚠️ Memoizada: ALTER/CREATE pede lock mesmo quando é no-op, e estas rotas são
// chamadas junto do board. Mesma lição do apagão do CRM em 16/09/2026.
export const ensureFunilModelosSchema = memoizarSchema(ensureSchemaInterno);

/**
 * Normaliza o que vem do banco/cliente numa lista de etapas utilizável.
 *
 * ⚠️ Etapa sem `etapa_funil` reconhecida cai na auto-classificação pelo rótulo
 * (a mesma do Funil de Performance) — nunca vira `undefined`, senão o modelo
 * criaria coluna órfã que a dashboard não sabe contar.
 */
export function normalizarEtapas(bruto: unknown): EtapaModelo[] {
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<string>();
  const etapas: EtapaModelo[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!label) continue;
    // O Kanban agrupa por RÓTULO: duas colunas com o mesmo nome no mesmo funil
    // deixariam uma delas eternamente vazia (lição do saneamento de 11/08).
    const chave = label.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const etapaBruta = typeof o.etapa_funil === 'string' ? o.etapa_funil : '';
    etapas.push({
      label,
      color: typeof o.color === 'string' && o.color.trim() ? o.color.trim() : '#71717a',
      etapa_funil: (ETAPAS_VALIDAS.has(etapaBruta) ? etapaBruta : classificarEtapa(label)) as EtapaFunil,
    });
  }
  return etapas.slice(0, 40);
}

/** Fotografa as etapas de um funil existente, na ordem do board. */
export async function etapasDoFunil(pool: Pool, funnelId: string): Promise<EtapaModelo[]> {
  const { rows } = await pool.query(
    `SELECT label, color, etapa_funil FROM public.crm_stages WHERE funnel_id = $1 ORDER BY position ASC`,
    [funnelId],
  ).catch(() => pool.query(
    `SELECT label, color, NULL AS etapa_funil FROM public.crm_stages WHERE funnel_id = $1 ORDER BY position ASC`,
    [funnelId],
  ));
  return normalizarEtapas(rows);
}

export async function listarModelos(pool: Pool): Promise<FunilModelo[]> {
  const { rows } = await pool.query(
    `SELECT id, nome, descricao, etapas, cliente_origem, criado_por, created_at
       FROM public.crm_funil_modelos
      ORDER BY lower(btrim(nome)) ASC`,
  );
  return rows.map(r => ({ ...r, etapas: normalizarEtapas(r.etapas) })) as FunilModelo[];
}

export async function buscarModelo(pool: Pool, id: string): Promise<FunilModelo | null> {
  const { rows: [row] } = await pool.query(
    `SELECT id, nome, descricao, etapas, cliente_origem, criado_por, created_at
       FROM public.crm_funil_modelos WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  return { ...row, etapas: normalizarEtapas(row.etapas) } as FunilModelo;
}

/**
 * Grava (ou atualiza, quando o nome já existe) um modelo.
 *
 * ⚠️ O modelo é uma FOTOGRAFIA: editar o funil do cliente depois NÃO muda o
 * modelo, e aplicar o modelo não amarra o funil a ele. Vínculo vivo faria
 * mexer no funil de um cliente alterar o de todos os outros em silêncio.
 */
export async function salvarModelo(
  pool: Pool,
  dados: { nome: string; descricao?: string | null; etapas: EtapaModelo[]; clienteOrigem?: string | null; criadoPor?: string | null },
): Promise<FunilModelo> {
  const { rows: [row] } = await pool.query(
    `INSERT INTO public.crm_funil_modelos (nome, descricao, etapas, cliente_origem, criado_por)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (lower(btrim(nome))) DO UPDATE
        SET etapas = EXCLUDED.etapas,
            descricao = COALESCE(EXCLUDED.descricao, public.crm_funil_modelos.descricao),
            cliente_origem = EXCLUDED.cliente_origem,
            updated_at = NOW()
     RETURNING id, nome, descricao, etapas, cliente_origem, criado_por, created_at`,
    [
      dados.nome.trim(),
      dados.descricao?.trim() || null,
      JSON.stringify(dados.etapas),
      dados.clienteOrigem ?? null,
      dados.criadoPor ?? null,
    ],
  );
  return { ...row, etapas: normalizarEtapas(row.etapas) } as FunilModelo;
}

/** Cria as colunas de um funil recém-nascido a partir das etapas do modelo. */
export async function aplicarEtapasNoFunil(
  pool: Pool,
  funnelId: string,
  clientId: string,
  etapas: EtapaModelo[],
): Promise<void> {
  for (let i = 0; i < etapas.length; i++) {
    const e = etapas[i];
    await pool.query(
      `INSERT INTO public.crm_stages (funnel_id, client_id, label, color, position, etapa_funil)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [funnelId, clientId, e.label, e.color, i, e.etapa_funil],
    );
  }
}

// ─────────────────────────── Aplicar modelo num funil que JÁ EXISTE ──────────
//
// ⚠️ O risco aqui é perder lead, não perder coluna: `crm_leads.status` é TEXTO
// livre, então apagar uma coluna sem levar os leads junto deixa cada um com um
// status que não existe mais — e o Kanban, que agrupa por rótulo, os esconde.
// Por isso toda coluna que sai PRECISA de um destino, e o plano é calculado
// antes (prévia) para o gestor ver quantos leads se mexem.

/** Sentinela: a coluna não está no modelo, mas o gestor quer conservá-la. */
export const MANTER_COLUNA = '__manter__';

export type StageAtual = {
  id: string;
  label: string;
  position: number;
  etapa_funil: EtapaFunil | null;
  leads: number;
};

export type PlanoAplicacao = {
  /** Já existe e continua (o modelo tem uma coluna com o mesmo rótulo). */
  manter: { id: string; label: string; etapa: EtapaFunil; color: string; posicao: number }[];
  /** Está no modelo e ainda não existe no funil. */
  criar: { label: string; color: string; etapa: EtapaFunil; posicao: number }[];
  /** Sai do funil: os leads vão para `destino`. */
  remover: { id: string; label: string; leads: number; destino: string }[];
  /** Fora do modelo, conservada por escolha do gestor. */
  conservar: { id: string; label: string; leads: number; posicao: number }[];
  /** Rótulos que podem receber leads (as colunas do modelo). */
  destinosPossiveis: string[];
  /** Quantos leads mudam de coluna se o plano for aplicado. */
  leadsAfetados: number;
};

const chave = (s: string) => normalizarEtiqueta(s);

/**
 * Destino sugerido para uma coluna que sai: a coluna do modelo com o MESMO
 * grau. Sem grau igual, a de grau mais próximo na escada — mover um lead de
 * "Reagendado" para "Oportunidade" preserva a profundidade dele no funil, que
 * é o que a dashboard conta; jogá-lo no topo apagaria o progresso.
 */
export function destinoSugerido(atual: StageAtual, modelo: EtapaModelo[]): string {
  if (modelo.length === 0) return '';
  const grau = atual.etapa_funil ?? classificarEtapa(atual.label);
  const igual = modelo.find(m => m.etapa_funil === grau);
  if (igual) return igual.label;
  // `nao_lead` e `perdido` ficam fora da escada; sem correspondente, o lead vai
  // para a primeira coluna — inventar um posto para ele seria pior.
  const posto = postoDaEtapa(grau);
  if (posto < 0) return modelo[0].label;
  let melhor = modelo[0];
  let dist = Infinity;
  for (const m of modelo) {
    const p = postoDaEtapa(m.etapa_funil);
    if (p < 0) continue;
    const d = Math.abs(p - posto);
    if (d < dist) { dist = d; melhor = m; }
  }
  return melhor.label;
}

export function planejarAplicacaoModelo(
  atuais: StageAtual[],
  modelo: EtapaModelo[],
  destinos: Record<string, string> = {},
): PlanoAplicacao {
  const plano: PlanoAplicacao = {
    manter: [], criar: [], remover: [], conservar: [],
    destinosPossiveis: modelo.map(m => m.label),
    leadsAfetados: 0,
  };
  const porChaveAtual = new Map(atuais.map(a => [chave(a.label), a]));
  const chavesModelo = new Set(modelo.map(m => chave(m.label)));

  modelo.forEach((m, i) => {
    const existente = porChaveAtual.get(chave(m.label));
    if (existente) {
      // ⚠️ Mantém o ID e o RÓTULO existentes: trocar o rótulo (mesmo só o
      // acento) obrigaria a migrar os leads dessa coluna também, de graça.
      plano.manter.push({ id: existente.id, label: existente.label, etapa: m.etapa_funil, color: m.color, posicao: i });
    } else {
      plano.criar.push({ label: m.label, color: m.color, etapa: m.etapa_funil, posicao: i });
    }
  });

  let extra = modelo.length;
  for (const a of atuais) {
    if (chavesModelo.has(chave(a.label))) continue;
    if (destinos[a.label] === MANTER_COLUNA) {
      plano.conservar.push({ id: a.id, label: a.label, leads: a.leads, posicao: extra++ });
      continue;
    }
    const destino = destinos[a.label] || destinoSugerido(a, modelo);
    plano.remover.push({ id: a.id, label: a.label, leads: a.leads, destino });
    plano.leadsAfetados += a.leads;
  }
  return plano;
}
