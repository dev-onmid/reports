import type { Pool } from 'pg';

/**
 * Restos vivos do Otimizador de Campanhas, removido em 2026-08-22 a pedido do
 * Matheus ("agora otimizo todas as campanhas com claudecode").
 *
 * O produto (telas, análise semanal por IA, fila de decisões) morreu, mas três
 * pedaços continuam sendo usados por OUTROS módulos e foram extraídos pra cá:
 *  - o Quadro do Gestor no Início grava em optimizer_manual_notes
 *    (rota /api/otimizador/notes + painel do Início);
 *  - a Luna lê optimizer_client_config antes de executar ação em campanha
 *    (limites de segurança por cliente);
 *  - os tipos de ação/objeto usados pelo executor (optimizer-execucao.ts,
 *    também mantido — é ele que pausa/ativa/ajusta orçamento pela Luna).
 */

export type OptimizerAcaoTipo = 'PAUSAR' | 'ATIVAR' | 'AJUSTAR_ORCAMENTO';
export type OptimizerObjetoTipo = 'campaign' | 'adset' | 'ad';
export type OptimizerPeriodKey = 'yesterday' | 'last_3d' | 'last_7d' | 'this_month' | 'last_month' | 'last_21d' | 'last_30d' | 'last_90d';

export async function ensureOptimizerClientConfigTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.optimizer_client_config (
      client_id             TEXT PRIMARY KEY,
      modo_operacao         TEXT NOT NULL DEFAULT 'RECOMENDACAO_COM_APROVACAO',
      acoes_pre_aprovadas   TEXT[] NOT NULL DEFAULT '{}',
      orcamento_diario_maximo NUMERIC,
      cpr_emergencia        NUMERIC,
      min_conjuntos_ativos  INTEGER NOT NULL DEFAULT 1,
      max_conjuntos_ativos  INTEGER NOT NULL DEFAULT 20,
      min_dias_aprendizado  INTEGER NOT NULL DEFAULT 7,
      analise_dia_semana    INTEGER NOT NULL DEFAULT 1,
      ativo                 BOOLEAN NOT NULL DEFAULT true,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by            TEXT
    );
    ALTER TABLE public.optimizer_client_config
      ADD COLUMN IF NOT EXISTS observacoes_fixas TEXT;
  `).catch(() => {});
}

export async function ensureOptimizerManualNotesTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.optimizer_manual_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cliente_id TEXT NOT NULL,
      nivel TEXT NOT NULL,
      objeto_id TEXT,
      objeto_nome TEXT,
      autor_id TEXT,
      autor_nome TEXT,
      texto TEXT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS optimizer_manual_notes_cliente_idx
      ON public.optimizer_manual_notes (cliente_id, ativo, created_at DESC);
    ALTER TABLE public.optimizer_manual_notes
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'rapida',
      ADD COLUMN IF NOT EXISTS categoria TEXT,
      ADD COLUMN IF NOT EXISTS prazo_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS concluida_em TIMESTAMPTZ;
  `).catch(() => {});
}

/** Colunas do Quadro do Gestor (Início). */
export const NOTE_STATUS = ['rapida', 'andamento', 'concluida'] as const;
export type NoteStatus = typeof NOTE_STATUS[number];

export function normalizeNoteStatus(v: unknown): NoteStatus | null {
  return typeof v === 'string' && (NOTE_STATUS as readonly string[]).includes(v) ? v as NoteStatus : null;
}
