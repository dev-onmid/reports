-- Otimizador v3 — Fila de decisão ("O que fazer agora")
-- Executa de forma idempotente (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- As rotas também chamam CREATE TABLE/ALTER IF NOT EXISTS na 1ª requisição (self-heal),
-- então aplicar este arquivo é opcional em ambientes já quentes.

-- ─── 1. Workflow por recomendação ────────────────────────────────────────────
-- Cada recomendação achatada (nó ATENÇÃO/URGENTE de uma análise) ganha um status
-- persistente. rec_id é estável: `${analise_id}:${objeto_tipo}:${objeto_id}`.
CREATE TABLE IF NOT EXISTS public.optimizer_recomendacao_status (
  rec_id        TEXT PRIMARY KEY,
  analise_id    UUID,
  cliente_id    TEXT NOT NULL,
  objeto_id     TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente', -- pendente | aplicado | ignorado | em_analise_humana
  autor_id      TEXT,
  autor_nome    TEXT,
  motivo        TEXT,
  undo_payload  JSONB,      -- estado anterior p/ reverter (status/orçamento anteriores + ação inversa)
  atribuido_a   TEXT,       -- analista designado (revisão humana)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS optimizer_rec_status_cliente_idx
  ON public.optimizer_recomendacao_status (cliente_id, status);

-- ─── 2. Colunas de conexão/conta em optimizer_ai_logs ────────────────────────
-- Necessárias para aplicar a ação na conta certa (connection_id) e montar o
-- deep link do Gerenciador de Anúncios (account_id). O weekly já resolve ambos.
ALTER TABLE public.optimizer_ai_logs
  ADD COLUMN IF NOT EXISTS connection_id TEXT,
  ADD COLUMN IF NOT EXISTS account_id    TEXT;
