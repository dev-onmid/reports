import type { makeServerPool } from '@/lib/server-db';

type Pool = ReturnType<typeof makeServerPool>;

/**
 * Reuniões por cliente — o repositório que a aba Reuniões da tela do cliente
 * exibe pra retomar contexto entre reuniões: resumo, link da gravação (TLDV),
 * doc completo e o checklist de continuidade (interativo na tela).
 *
 * Quem escreve é o webhook `/api/integrations/reuniao/resumo` (Make, no final
 * do cenário do TLDV); quem lê é `/api/clients/[id]/reunioes`. As tarefas da
 * reunião seguem indo pro ClickUp pelo fluxo já existente (`reuniao-intake`) —
 * aqui fica o que não tem lugar no ClickUp.
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
    // Aba Reuniões (2026-08-04): link da gravação + checklist de continuidade.
    await pool.query(`
      ALTER TABLE public.reuniao_resumos
        ADD COLUMN IF NOT EXISTS recording_url TEXT,
        ADD COLUMN IF NOT EXISTS checklist JSONB
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

export type ChecklistItem = { texto: string; feito: boolean };

export type ResumoInput = {
  clientId: string;
  resumo: string;
  titulo?: string | null;
  meetingId?: string | null;
  docUrl?: string | null;
  recordingUrl?: string | null;
  checklist?: ChecklistItem[] | null;
  /** Data/hora da reunião; ausente = agora. */
  reuniaoEm?: Date | null;
};

export type ResumoRow = {
  id: string;
  meeting_id: string | null;
  titulo: string | null;
  resumo: string;
  doc_url: string | null;
  recording_url: string | null;
  checklist: ChecklistItem[] | null;
  reuniao_em: string;
  created_at: string;
};

const CHECKLIST_MAX_ITENS = 50;
const CHECKLIST_MAX_CHARS = 400;

/**
 * Checklist como a automação pode mandar: array de strings, array de objetos
 * (`texto`/`item`/`text`/`title` + `feito`/`done`/`checked`) ou um texto único
 * com um item por linha (aceita prefixos "- ", "* ", "1.", "[ ]"/"[x]").
 * Irreconhecível/vazio → null (o campo simplesmente não existe pra reunião).
 */
export function parseChecklist(raw: unknown): ChecklistItem[] | null {
  const itens: ChecklistItem[] = [];
  const push = (texto: unknown, feito: unknown) => {
    const t = String(texto ?? '').trim().slice(0, CHECKLIST_MAX_CHARS);
    if (t) itens.push({ texto: t, feito: feito === true });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') push(item, false);
      else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        push(o.texto ?? o.item ?? o.text ?? o.title ?? o.name, o.feito ?? o.done ?? o.checked);
      }
    }
  } else if (typeof raw === 'string') {
    for (const linha of raw.split(/\r?\n/)) {
      const m = linha.match(/^\s*(?:[-*•]|\d+[.)])?\s*(?:\[( |x|X)\]\s*)?(.*)$/);
      if (m) push(m[2], m[1]?.toLowerCase() === 'x');
    }
  }
  return itens.length > 0 ? itens.slice(0, CHECKLIST_MAX_ITENS) : null;
}

const chaveItem = (texto: string) => texto.trim().toLowerCase();

/**
 * Reenvio da mesma reunião pelo Make NÃO pode desmarcar o que o gestor já
 * riscou na tela: os `feito` da versão gravada são reaplicados por texto.
 */
export function mesclarChecklist(
  novo: ChecklistItem[] | null | undefined,
  existente: ChecklistItem[] | null | undefined,
): ChecklistItem[] | null {
  if (!novo?.length) return existente?.length ? existente : null;
  if (!existente?.length) return novo;
  const feitos = new Set(existente.filter(i => i.feito).map(i => chaveItem(i.texto)));
  return novo.map(i => ({ ...i, feito: i.feito || feitos.has(chaveItem(i.texto)) }));
}

/**
 * Grava (ou atualiza, se a mesma reunião chegar de novo) um resumo.
 * Reexecução do cenário do Make com o mesmo `meeting_id` sobrescreve o texto —
 * a versão mais recente da IA é sempre a que vale.
 */
export async function salvarResumoReuniao(pool: Pool, input: ResumoInput): Promise<{ id: string; atualizado: boolean }> {
  await ensureReuniaoResumoSchema(pool);
  const meetingId = input.meetingId?.trim() || null;

  let checklist = input.checklist?.length ? input.checklist : null;
  if (meetingId) {
    // Reexecução do Make sobrescreve o texto, mas não pode apagar os checks
    // que o gestor já marcou na tela — mescla com o que está gravado.
    const { rows: [atual] } = await pool.query<{ checklist: ChecklistItem[] | null }>(
      'SELECT checklist FROM public.reuniao_resumos WHERE client_id = $1 AND meeting_id = $2',
      [input.clientId, meetingId],
    );
    checklist = mesclarChecklist(checklist, atual?.checklist ?? null);
  }

  const params = [
    input.clientId,
    meetingId,
    input.titulo?.trim() || null,
    input.resumo.trim(),
    input.docUrl?.trim() || null,
    input.recordingUrl?.trim() || null,
    checklist ? JSON.stringify(checklist) : null,
    input.reuniaoEm ?? new Date(),
  ];
  if (meetingId) {
    const { rows: [row] } = await pool.query<{ id: string; inserted: boolean }>(
      `INSERT INTO public.reuniao_resumos (client_id, meeting_id, titulo, resumo, doc_url, recording_url, checklist, reuniao_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (client_id, meeting_id) WHERE meeting_id IS NOT NULL
       DO UPDATE SET titulo = EXCLUDED.titulo, resumo = EXCLUDED.resumo,
                     doc_url = COALESCE(EXCLUDED.doc_url, reuniao_resumos.doc_url),
                     recording_url = COALESCE(EXCLUDED.recording_url, reuniao_resumos.recording_url),
                     checklist = COALESCE(EXCLUDED.checklist, reuniao_resumos.checklist),
                     reuniao_em = EXCLUDED.reuniao_em
       RETURNING id, (xmax = 0) AS inserted`,
      params,
    );
    return { id: row.id, atualizado: !row.inserted };
  }
  const { rows: [row] } = await pool.query<{ id: string }>(
    `INSERT INTO public.reuniao_resumos (client_id, meeting_id, titulo, resumo, doc_url, recording_url, checklist, reuniao_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    params,
  );
  return { id: row.id, atualizado: false };
}

/**
 * Persiste o estado do checklist de uma reunião (checks marcados na tela).
 * Substitui o array inteiro — a UI manda a versão completa que está exibindo.
 */
export async function atualizarChecklist(
  pool: Pool,
  clientId: string,
  resumoId: string,
  checklist: ChecklistItem[],
): Promise<boolean> {
  await ensureReuniaoResumoSchema(pool);
  const { rowCount } = await pool.query(
    'UPDATE public.reuniao_resumos SET checklist = $3 WHERE client_id = $1 AND id = $2',
    [clientId, resumoId, JSON.stringify(checklist.slice(0, CHECKLIST_MAX_ITENS))],
  );
  return (rowCount ?? 0) > 0;
}

export async function listarResumos(pool: Pool, clientId: string, limit = 50): Promise<ResumoRow[]> {
  await ensureReuniaoResumoSchema(pool);
  const { rows } = await pool.query<ResumoRow>(
    `SELECT id, meeting_id, titulo, resumo, doc_url, recording_url, checklist, reuniao_em, created_at
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
