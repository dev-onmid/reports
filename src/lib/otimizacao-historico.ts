import type { Pool } from 'pg';

/**
 * Histórico manual de otimizações por conta: o que o gestor fez, quando, em
 * qual canal (Meta/Google/outro) e por quê — inclusive ditado por voz (a
 * transcrição vira `descricao`, `origem='audio'`). É trilha pra outro gestor
 * assumir uma conta sabendo o que já foi mexido, então o registro é IMUTÁVEL
 * de propósito (não existe UPDATE; só DELETE pelo autor ou admin).
 *
 * `otimizacao_agenda` guarda a programação por cliente+canal ("otimizar a cada
 * N dias"). Cliente sem linha nenhuma cai na régua padrão (FREQ_PADRAO_DIAS de
 * otimizacao-ui.ts) sobre o último registro de qualquer canal.
 */
export type OtimizacaoRegistroRow = {
  id: string;
  client_id: string;
  user_id: string | null;
  user_name: string | null;
  canal: string;
  canal_detalhe: string | null;
  acoes: string[];
  descricao: string;
  origem: string;
  created_at: string;
};

export type OtimizacaoAgendaRow = {
  client_id: string;
  canal: string;
  frequencia_dias: number;
};

export async function ensureOtimizacaoHistoricoSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.otimizacao_registros (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      canal TEXT NOT NULL,
      canal_detalhe TEXT,
      acoes TEXT[] NOT NULL DEFAULT '{}',
      descricao TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'texto',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS otimizacao_registros_client_idx
      ON public.otimizacao_registros (client_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS public.otimizacao_agenda (
      client_id TEXT NOT NULL,
      canal TEXT NOT NULL,
      frequencia_dias INT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (client_id, canal)
    );
  `).catch(() => {});
}
