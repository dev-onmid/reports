-- Otimizador v2.0 — Migration
-- Executa de forma idempotente (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

-- ─── 1. Configuração por cliente ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.optimizer_client_config (
  client_id             TEXT PRIMARY KEY,
  modo_operacao         TEXT NOT NULL DEFAULT 'RECOMENDACAO_COM_APROVACAO',
  acoes_pre_aprovadas   TEXT[] NOT NULL DEFAULT '{}',
  orcamento_diario_maximo NUMERIC,
  cpr_emergencia        NUMERIC,
  min_conjuntos_ativos  INTEGER NOT NULL DEFAULT 1,
  max_conjuntos_ativos  INTEGER NOT NULL DEFAULT 20,
  min_dias_aprendizado  INTEGER NOT NULL DEFAULT 7,
  analise_dia_semana    INTEGER NOT NULL DEFAULT 1, -- 1=seg 2=ter 3=qua 4=qui 5=sex
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            TEXT
);

-- Peculiaridades fixas do cliente (ex: "campanhas de bot têm lógica própria, nunca
-- sugerir mover pra outra campanha") — texto livre, entra no payload da IA em toda análise.
ALTER TABLE public.optimizer_client_config
  ADD COLUMN IF NOT EXISTS observacoes_fixas TEXT;

-- ─── 2. Log de execuções automáticas ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.optimizer_execucoes_automaticas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analise_id     UUID,
  client_id      TEXT NOT NULL,
  connection_id  TEXT,
  objeto_tipo    TEXT NOT NULL,   -- campaign | adset | ad
  objeto_id      TEXT NOT NULL,
  objeto_nome    TEXT,
  acao           TEXT NOT NULL,   -- PAUSAR | ATIVAR | AJUSTAR_ORCAMENTO
  parametros     JSONB,
  justificativa  TEXT,
  modo_operacao  TEXT NOT NULL,
  resultado      TEXT NOT NULL DEFAULT 'pendente', -- pendente | sucesso | erro
  erro_detalhe   TEXT,
  executado_em   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS optimizer_execucoes_client_idx
  ON public.optimizer_execucoes_automaticas (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS optimizer_execucoes_analise_idx
  ON public.optimizer_execucoes_automaticas (analise_id);

-- ─── 3. Configurações globais do sistema (chave-valor) ──────────────────────
CREATE TABLE IF NOT EXISTS public.system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- Chaves iniciais do otimizador (inseridas sem sobrescrever se já existirem)
INSERT INTO public.system_settings (key, value) VALUES
  ('otimizador_whatsapp_zapi_client_id', NULL),
  ('otimizador_whatsapp_group_jid',      NULL),
  ('otimizador_whatsapp_ativo',          'false'),
  ('otimizador_notificar_crise_apenas',  'false')
ON CONFLICT (key) DO NOTHING;

-- ─── 4. Colunas novas em optimizer_ai_logs ──────────────────────────────────
ALTER TABLE public.optimizer_ai_logs
  ADD COLUMN IF NOT EXISTS semana_analise           TEXT,
  ADD COLUMN IF NOT EXISTS modo_operacao            TEXT,
  ADD COLUMN IF NOT EXISTS estado_da_conta          TEXT,
  ADD COLUMN IF NOT EXISTS resumo_executivo         TEXT,
  ADD COLUMN IF NOT EXISTS acoes_automaticas_count  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acoes_executadas_count   INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS optimizer_ai_logs_semana_idx
  ON public.optimizer_ai_logs (semana_analise, cliente_id);
