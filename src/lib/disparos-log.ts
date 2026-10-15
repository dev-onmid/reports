/**
 * Auditoria das campanhas de disparo: quem fez, quando e o que mudou.
 *
 * Pedido do Matheus (2026-10-02): "logs de ajustes, quem fez, quando e o que
 * fez". Até aqui NENHUMA rota de Disparos registrava nada — a tabela nem tinha
 * `updated_at` — e o log geral (`activity_logs`) só cobre pagamentos/clientes.
 *
 * ⚠️ A autoria vem SEMPRE da sessão (`getCallerScope` → `users`), nunca do body.
 * ⚠️ `campaign_name` é congelado no registro: campanha renomeada ou excluída
 * continua legível no histórico (mesma lição de `fidelidade_envios.texto`).
 * ⚠️ Sem FK para `zapi_campaigns` de propósito — excluir a campanha não pode
 * apagar o rastro de quem a excluiu.
 */
import type { makeServerPool } from '@/lib/server-db';

type Pool = ReturnType<typeof makeServerPool>;

export type AcaoCampanha =
  | 'criou' | 'editou' | 'iniciou' | 'pausou' | 'retomou' | 'cancelou' | 'excluiu' | 'etiquetou';

export const ROTULO_ACAO: Record<AcaoCampanha, string> = {
  criou: 'criou a campanha',
  editou: 'editou a campanha',
  iniciou: 'iniciou o envio',
  pausou: 'pausou',
  retomou: 'retomou',
  cancelou: 'cancelou',
  excluiu: 'excluiu a campanha',
  etiquetou: 'etiquetou quem já recebeu',
};

/** Campos da campanha que entram no diff, com o nome que o gestor lê. */
export const ROTULO_CAMPO: Record<string, string> = {
  name: 'Nome',
  message: 'Mensagem',
  messages: 'Variações de mensagem',
  image_url: 'Imagem',
  interval_min: 'Intervalo mínimo (s)',
  interval_max: 'Intervalo máximo (s)',
  daily_limit: 'Limite diário',
  active_from: 'Horário inicial (UTC)',
  active_until: 'Horário final (UTC)',
  active_days: 'Dias de disparo',
  starts_at: 'Início',
  ends_at: 'Término',
  label_nome: 'Etiqueta',
  status: 'Status',
};
export const CAMPOS_AUDITADOS = Object.keys(ROTULO_CAMPO);

export type Mudanca = { campo: string; rotulo: string; de: unknown; para: unknown };

/** Normaliza para comparar: arrays viram JSON, datas viram ISO, vazio vira null. */
function norm(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Encurta texto longo no registro — a mensagem inteira já está na campanha. */
function resumir(v: unknown): unknown {
  if (typeof v === 'string' && v.length > 300) return v.slice(0, 297) + '...';
  if (Array.isArray(v)) return v.map(resumir);
  return v;
}

/**
 * Pura. Devolve só o que mudou de verdade, campo a campo, com rótulo.
 * `label_id` NÃO entra sozinho: quem conta a história é `label_nome`.
 */
export function diffCampanha(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  campos: string[] = CAMPOS_AUDITADOS,
): Mudanca[] {
  const out: Mudanca[] = [];
  for (const campo of campos) {
    const a = norm(antes[campo]); const d = norm(depois[campo]);
    if (a === d) continue;
    out.push({ campo, rotulo: ROTULO_CAMPO[campo] ?? campo, de: resumir(antes[campo] ?? null), para: resumir(depois[campo] ?? null) });
  }
  return out;
}

/** Texto curto de uma mudança, para tela e WhatsApp. */
export function descreverMudanca(m: Mudanca): string {
  const fmt = (v: unknown) => {
    if (v === null || v === undefined || v === '') return '(vazio)';
    if (Array.isArray(v)) return `${v.length} item(ns)`;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  return `${m.rotulo}: ${fmt(m.de)} → ${fmt(m.para)}`;
}

let ensured = false;
export async function ensureLogCampanha(pool: Pool): Promise<void> {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.zapi_campaign_log (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id   UUID        NOT NULL,
      campaign_name TEXT,
      user_id       TEXT,
      user_name     TEXT,
      acao          TEXT        NOT NULL,
      mudancas      JSONB,
      detalhes      JSONB,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS zapi_campaign_log_camp_idx ON public.zapi_campaign_log (campaign_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS zapi_campaign_log_data_idx ON public.zapi_campaign_log (created_at DESC)`);
  ensured = true;
}

/**
 * Grava um registro. Nunca lança: auditoria que derruba a operação auditada é
 * pior que auditoria faltando — o erro vai para o console.
 */
export async function registrarLogCampanha(pool: Pool, r: {
  campaignId: string;
  campaignName?: string | null;
  userId: string | null;
  acao: AcaoCampanha;
  mudancas?: Mudanca[];
  detalhes?: Record<string, unknown>;
}): Promise<void> {
  try {
    await ensureLogCampanha(pool);
    let userName: string | null = null;
    if (r.userId) {
      const { rows: [u] } = await pool.query<{ name: string | null }>(`SELECT name FROM public.users WHERE id = $1`, [r.userId]);
      userName = u?.name ?? null;
    }
    await pool.query(
      `INSERT INTO public.zapi_campaign_log (campaign_id, campaign_name, user_id, user_name, acao, mudancas, detalhes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [r.campaignId, r.campaignName ?? null, r.userId, userName, r.acao,
       r.mudancas?.length ? JSON.stringify(r.mudancas) : null,
       r.detalhes ? JSON.stringify(r.detalhes) : null],
    );
  } catch (e) {
    console.error('[disparos-log] falha ao registrar', r.acao, r.campaignId, e);
  }
}

export type RegistroLog = {
  id: string; campaign_id: string; campaign_name: string | null;
  user_name: string | null; acao: AcaoCampanha; mudancas: Mudanca[] | null;
  detalhes: Record<string, unknown> | null; created_at: string;
};

/**
 * Lista registros. Quem não é irrestrito só vê campanhas das próprias
 * instâncias (`zapi_clients.owner_id`) — mesma régua do resto de Disparos.
 */
export async function listarLogCampanha(pool: Pool, opts: {
  campaignId?: string | null; dias?: number; limit?: number;
  unrestricted: boolean; userId: string | null;
}): Promise<RegistroLog[]> {
  await ensureLogCampanha(pool);
  const dias = Math.min(Math.max(opts.dias ?? 10, 1), 90);
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const { rows } = await pool.query<RegistroLog>(
    `SELECT l.id, l.campaign_id, COALESCE(c.name, l.campaign_name) AS campaign_name,
            l.user_name, l.acao, l.mudancas, l.detalhes, l.created_at
       FROM public.zapi_campaign_log l
       LEFT JOIN public.zapi_campaigns c ON c.id = l.campaign_id
       LEFT JOIN public.zapi_clients cl ON cl.id = c.client_id
      WHERE l.created_at > NOW() - ($1::int * INTERVAL '1 day')
        AND ($2::uuid IS NULL OR l.campaign_id = $2::uuid)
        AND ($3::boolean OR cl.owner_id = $4)
      ORDER BY l.created_at DESC
      LIMIT $5`,
    [dias, opts.campaignId ?? null, opts.unrestricted, opts.userId, limit],
  );
  return rows;
}
