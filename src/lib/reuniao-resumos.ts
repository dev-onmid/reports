import type { makeServerPool } from '@/lib/server-db';

type Pool = ReturnType<typeof makeServerPool>;

/**
 * Resumos de reunião por cliente — o "backlog" que a aba Demandas da tela do
 * cliente exibe pra retomar contexto entre reuniões.
 *
 * Quem escreve é o webhook `/api/integrations/reuniao/resumo` (Make, no final
 * do cenário do TLDV); quem lê é `/api/clients/[id]/reunioes`. As tarefas da
 * reunião seguem indo pro ClickUp pelo fluxo já existente (`reuniao-intake`) —
 * aqui fica só o texto do resumo, que não tem lugar no ClickUp.
 */

let schemaReady: Promise<void> | null = null;

export function ensureReuniaoResumoSchema(pool: Pool) {
  schemaReady ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.reuniao_resumos (
        id BIGSERIAL PRIMARY KEY,
        client_id TEXT NOT NULL,
        meeting_id TEXT,
        titulo TEXT,
        resumo TEXT NOT NULL,
        doc_url TEXT,
        reuniao_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // O Make reexecuta cenário com frequência — mesma reunião não pode duplicar.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS reuniao_resumos_client_meeting_uq
        ON public.reuniao_resumos (client_id, meeting_id)
        WHERE meeting_id IS NOT NULL
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS reuniao_resumos_client_idx
        ON public.reuniao_resumos (client_id, reuniao_em DESC)
    `);
  })().catch((err) => {
    schemaReady = null; // deixa a próxima chamada tentar de novo
    throw err;
  });
  return schemaReady;
}

export type ResumoInput = {
  clientId: string;
  resumo: string;
  titulo?: string | null;
  meetingId?: string | null;
  docUrl?: string | null;
  /** Data/hora da reunião; ausente = agora. */
  reuniaoEm?: Date | null;
};

export type ResumoRow = {
  id: string;
  meeting_id: string | null;
  titulo: string | null;
  resumo: string;
  doc_url: string | null;
  reuniao_em: string;
  created_at: string;
};

/**
 * Grava (ou atualiza, se a mesma reunião chegar de novo) um resumo.
 * Reexecução do cenário do Make com o mesmo `meeting_id` sobrescreve o texto —
 * a versão mais recente da IA é sempre a que vale.
 */
export async function salvarResumoReuniao(pool: Pool, input: ResumoInput): Promise<{ id: string; atualizado: boolean }> {
  await ensureReuniaoResumoSchema(pool);
  const params = [
    input.clientId,
    input.meetingId?.trim() || null,
    input.titulo?.trim() || null,
    input.resumo.trim(),
    input.docUrl?.trim() || null,
    input.reuniaoEm ?? new Date(),
  ];
  if (params[1]) {
    const { rows: [row] } = await pool.query<{ id: string; inserted: boolean }>(
      `INSERT INTO public.reuniao_resumos (client_id, meeting_id, titulo, resumo, doc_url, reuniao_em)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_id, meeting_id) WHERE meeting_id IS NOT NULL
       DO UPDATE SET titulo = EXCLUDED.titulo, resumo = EXCLUDED.resumo,
                     doc_url = EXCLUDED.doc_url, reuniao_em = EXCLUDED.reuniao_em
       RETURNING id, (xmax = 0) AS inserted`,
      params,
    );
    return { id: row.id, atualizado: !row.inserted };
  }
  const { rows: [row] } = await pool.query<{ id: string }>(
    `INSERT INTO public.reuniao_resumos (client_id, meeting_id, titulo, resumo, doc_url, reuniao_em)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    params,
  );
  return { id: row.id, atualizado: false };
}

export async function listarResumos(pool: Pool, clientId: string, limit = 50): Promise<ResumoRow[]> {
  await ensureReuniaoResumoSchema(pool);
  const { rows } = await pool.query<ResumoRow>(
    `SELECT id, meeting_id, titulo, resumo, doc_url, reuniao_em, created_at
     FROM public.reuniao_resumos
     WHERE client_id = $1
     ORDER BY reuniao_em DESC
     LIMIT $2`,
    [clientId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows;
}

/**
 * Data da reunião como o Make pode mandar: ISO, `dd/mm/yyyy` ou epoch ms.
 * Qualquer coisa irreconhecível vira null (o caller usa "agora").
 */
export function parseDataReuniao(raw: unknown): Date | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw > 1e12 ? raw : raw * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(raw).trim();
  if (!s) return null;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (br) {
    const d = new Date(Date.UTC(+br[3], +br[2] - 1, +br[1], br[4] ? +br[4] + 3 : 12, br[5] ? +br[5] : 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
