import type { makeServerPool } from '@/lib/server-db';

type Pool = ReturnType<typeof makeServerPool>;

/**
 * Caixa de entrada de notificações do painel do Início.
 *
 * A distinção central é entre EVENTO e ESTADO, e ela existe para o inbox não
 * virar mentira:
 *
 * - **Evento** é um ponto no tempo (relatório ficou pronto, reunião às 16h30).
 *   Entra uma vez, via `registrarEvento`, e fica no histórico.
 * - **Estado** é uma condição que dura (conta secando, CPL acima da meta).
 *   Entra via `upsertSinal` e SAI sozinha por `resolverSinais` quando a fonte
 *   deixa de reportá-la.
 *
 * Sem a auto-resolução, "conta vai secar" continuaria na caixa depois da
 * recarga — e uma caixa cheia de problema já resolvido é pior que nenhuma,
 * porque treina a equipe a ignorar tudo.
 */

export type NotificacaoSeveridade = 'critico' | 'atencao' | 'info';

export type NotificacaoTipo =
  | 'saldo'      // conta de anúncio secando
  | 'cpl'        // decisão pendente do Otimizador
  | 'social'     // dias sem post
  | 'instancia'  // WhatsApp desconectado
  | 'relatorio'  // relatório disponível
  | 'reuniao'    // resumo de reunião chegou
  | 'agenda'     // reunião de hoje
  | 'sistema';

export type NotificacaoRow = {
  id: string;
  user_id: string;
  tipo: NotificacaoTipo;
  severidade: NotificacaoSeveridade;
  titulo: string;
  descricao: string | null;
  href: string | null;
  client_id: string | null;
  signal_key: string;
  importante: boolean;
  lida_em: string | null;
  resolvido_em: string | null;
  created_at: string;
};

/**
 * `user_id = ''` significa "da agência" (todo mundo vê).
 *
 * É string vazia em vez de NULL porque o Postgres considera NULLs distintos num
 * índice único — com NULL, o mesmo sinal da agência entraria duplicado a cada
 * execução do cron, que é exatamente o que o `signal_key` existe pra impedir.
 */
export const AGENCIA = '';

let schemaReady: Promise<void> | null = null;

export function ensureNotificacoesSchema(pool: Pool): Promise<void> {
  schemaReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS public.notificacoes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL,
      severidade TEXT NOT NULL DEFAULT 'info',
      titulo TEXT NOT NULL,
      descricao TEXT,
      href TEXT,
      client_id TEXT,
      signal_key TEXT NOT NULL,
      importante BOOLEAN NOT NULL DEFAULT false,
      lida_em TIMESTAMPTZ,
      resolvido_em TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS notificacoes_signal_idx
      ON public.notificacoes (user_id, signal_key);
    CREATE INDEX IF NOT EXISTS notificacoes_feed_idx
      ON public.notificacoes (user_id, resolvido_em, created_at DESC);
  `).then(() => undefined).catch(() => undefined);
  return schemaReady;
}

export type SinalInput = {
  /** Vazio = da agência. Normalmente o `clients.gestor_id`. */
  userId?: string | null;
  tipo: NotificacaoTipo;
  /**
   * Chave determinística do sinal — é ela que garante idempotência.
   *
   * Inclua a janela quando o alerta deve reaparecer: `saldo:{conta}:{AAAA-MM-DD}`
   * renasce a cada dia (o alerta de saldo repete todo dia por decisão do
   * Matheus), enquanto `cpl:{cliente}:{semana}` aparece uma vez por semana.
   */
  signalKey: string;
  severidade?: NotificacaoSeveridade;
  titulo: string;
  descricao?: string | null;
  href?: string | null;
  clientId?: string | null;
};

/**
 * Grava/atualiza um sinal de ESTADO. Rodar duas vezes não duplica.
 *
 * O `lida_em` é preservado de propósito: se a condição persiste e o gestor já
 * leu, reabrir como não-lida a cada execução do cron seria spam. Para o alerta
 * voltar a chamar atenção, use uma janela no `signalKey` (ver acima).
 */
export async function upsertSinal(pool: Pool, s: SinalInput): Promise<void> {
  await ensureNotificacoesSchema(pool);
  await pool.query(
    `INSERT INTO public.notificacoes
       (user_id, tipo, severidade, titulo, descricao, href, client_id, signal_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, signal_key) DO UPDATE SET
       titulo = $4, descricao = $5, href = $6, severidade = $3,
       resolvido_em = NULL, updated_at = NOW()`,
    [
      s.userId || AGENCIA, s.tipo, s.severidade ?? 'info', s.titulo,
      s.descricao ?? null, s.href ?? null, s.clientId ?? null, s.signalKey,
    ],
  ).catch(() => {});
}

/**
 * Fecha os sinais de um tipo que a fonte não reporta mais.
 *
 * `chavesAtivas` é a lista completa do que ainda está valendo AGORA. Tudo
 * daquele tipo que não estiver nela é marcado como resolvido e sai do feed.
 *
 * ⚠️ Chame apenas quando a fonte respondeu com sucesso. Se a Meta falhar e a
 * lista vier vazia, isso resolveria todos os alertas de saldo por engano —
 * silenciando exatamente o que precisa ser visto.
 */
export async function resolverSinais(pool: Pool, tipo: NotificacaoTipo, chavesAtivas: string[]): Promise<void> {
  await ensureNotificacoesSchema(pool);
  await pool.query(
    `UPDATE public.notificacoes
        SET resolvido_em = NOW(), updated_at = NOW()
      WHERE tipo = $1 AND resolvido_em IS NULL AND NOT (signal_key = ANY($2::text[]))`,
    [tipo, chavesAtivas],
  ).catch(() => {});
}

/**
 * Fecha sinais de um tipo mais velhos que `horas`.
 *
 * Serve para sinais cuja chave já carrega a data (ex.: `saldo:{conta}:{dia}`),
 * que renascem a cada dia e por isso nunca sairiam pela lista de chaves ativas —
 * a do dia seguinte é outra. Sem isso o feed acumularia um alerta por dia.
 *
 * É por idade, não por lista, de propósito: `resolverSinais` recebe o conjunto
 * ativo de UM destino, e o alerta de saldo roda por destino — resolver pela
 * lista aqui apagaria os alertas dos outros grupos configurados.
 */
export async function resolverSinaisAntigos(pool: Pool, tipo: NotificacaoTipo, horas: number): Promise<void> {
  await ensureNotificacoesSchema(pool);
  await pool.query(
    `UPDATE public.notificacoes
        SET resolvido_em = NOW(), updated_at = NOW()
      WHERE tipo = $1 AND resolvido_em IS NULL
        AND created_at < NOW() - ($2 || ' hours')::interval`,
    [tipo, String(Math.max(1, Math.round(horas)))],
  ).catch(() => {});
}

/** Notificação de EVENTO: entra uma vez e não é auto-resolvida. */
export async function registrarEvento(pool: Pool, s: SinalInput): Promise<void> {
  await ensureNotificacoesSchema(pool);
  await pool.query(
    `INSERT INTO public.notificacoes
       (user_id, tipo, severidade, titulo, descricao, href, client_id, signal_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, signal_key) DO NOTHING`,
    [
      s.userId || AGENCIA, s.tipo, s.severidade ?? 'info', s.titulo,
      s.descricao ?? null, s.href ?? null, s.clientId ?? null, s.signalKey,
    ],
  ).catch(() => {});
}

export type FiltroFeed = 'todas' | 'importantes' | 'lidas';

/**
 * Feed do usuário: o que é dele + o que é da agência.
 *
 * Resolvido nunca aparece — o item sai quando o problema acaba, que é o sinal
 * honesto. Só o filtro "lidas" olha o histórico.
 */
export async function listar(
  pool: Pool, userId: string, filtro: FiltroFeed = 'todas', limit = 50,
): Promise<NotificacaoRow[]> {
  await ensureNotificacoesSchema(pool);
  const cond =
    filtro === 'importantes' ? 'AND importante = true AND resolvido_em IS NULL'
    : filtro === 'lidas' ? 'AND lida_em IS NOT NULL'
    : 'AND resolvido_em IS NULL';
  const { rows } = await pool.query(
    `SELECT * FROM public.notificacoes
      WHERE (user_id = $1 OR user_id = '') ${cond}
      ORDER BY (lida_em IS NULL) DESC,
               CASE severidade WHEN 'critico' THEN 0 WHEN 'atencao' THEN 1 ELSE 2 END,
               created_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows as NotificacaoRow[];
}

export async function contadores(pool: Pool, userId: string): Promise<{ naoLidas: number; importantes: number }> {
  await ensureNotificacoesSchema(pool);
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE lida_em IS NULL)                     AS nao_lidas,
       COUNT(*) FILTER (WHERE importante = true AND lida_em IS NULL) AS importantes
     FROM public.notificacoes
     WHERE (user_id = $1 OR user_id = '') AND resolvido_em IS NULL`,
    [userId],
  );
  return { naoLidas: Number(rows[0]?.nao_lidas ?? 0), importantes: Number(rows[0]?.importantes ?? 0) };
}

/**
 * Marca lida/importante. O `WHERE` inclui o usuário de propósito: sem isso,
 * qualquer um marcaria a notificação de outra pessoa passando o id.
 */
export async function marcarNotificacoes(
  pool: Pool, userId: string, ids: string[], patch: { lida?: boolean; importante?: boolean },
): Promise<number> {
  if (!ids.length) return 0;
  await ensureNotificacoesSchema(pool);
  const sets: string[] = ['updated_at = NOW()'];
  if (patch.lida !== undefined) sets.push(patch.lida ? 'lida_em = COALESCE(lida_em, NOW())' : 'lida_em = NULL');
  if (patch.importante !== undefined) sets.push(`importante = ${patch.importante ? 'true' : 'false'}`);
  const { rowCount } = await pool.query(
    `UPDATE public.notificacoes SET ${sets.join(', ')}
      WHERE id = ANY($1::uuid[]) AND (user_id = $2 OR user_id = '')`,
    [ids, userId],
  );
  return rowCount ?? 0;
}
