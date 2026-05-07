-- Adiciona coluna para controle de visibilidade das contas de anúncio Meta
-- Contas desativadas não aparecem na seleção de contas do construtor de relatórios

ALTER TABLE meta_assets_cache ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
