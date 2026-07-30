import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureOptimizerManualNotesTable, normalizeNoteStatus } from '@/lib/optimizer';
import { getSession, unauthorized } from '@/lib/api-auth';

// Observações manuais do gestor por nível (cliente/campanha/conjunto/criativo). Registro
// humano — nem tudo o Otimizador consegue decidir sozinho ("cliente pediu manter ativo",
// "WhatsApp demorando para responder"). Também é lida no próximo ciclo de análise
// (ver weekly/route.ts) e injetada no payload como contexto pra IA não repetir a mesma sugestão.
//
// Desde o Quadro do Gestor (tela Início), a mesma nota é um cartão que anda entre
// colunas: `status` rapida → andamento → concluida, com `categoria` e `prazo_em`.

type NoteRow = {
  id: string;
  cliente_id: string;
  nivel: string;
  objeto_id: string | null;
  objeto_nome: string | null;
  autor_id: string | null;
  autor_nome: string | null;
  texto: string;
  status: string;
  categoria: string | null;
  prazo_em: string | null;
  concluida_em: string | null;
  created_at: string;
};

const COLS = `id, cliente_id, nivel, objeto_id, objeto_nome, autor_id, autor_nome, texto,
              status, categoria, prazo_em, concluida_em, created_at`;

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureOptimizerManualNotesTable(pool);
    const { rows } = await pool.query<NoteRow>(
      `SELECT ${COLS}
         FROM public.optimizer_manual_notes
        WHERE cliente_id = $1 AND ativo = true
        ORDER BY created_at DESC`,
      [clientId],
    );
    return Response.json({ notes: rows });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    cliente_id?: string; nivel?: string; objeto_id?: string | null; objeto_nome?: string | null;
    texto?: string; autor_id?: string; autor_nome?: string;
    status?: string; categoria?: string | null; prazo_em?: string | null;
  };
  if (!body.cliente_id || !body.nivel || !body.texto?.trim()) {
    return Response.json({ error: 'cliente_id, nivel e texto são obrigatórios.' }, { status: 400 });
  }

  // Autoria vem da SESSÃO quando existe. O corpo era a única fonte antes, o que
  // permitia assinar a nota como outra pessoa; o fallback mantém compatibilidade
  // com os call sites antigos do Otimizador.
  const session = getSession(req);
  const autorId = session?.uid ?? body.autor_id ?? null;

  const pool = makeServerPool();
  try {
    await ensureOptimizerManualNotesTable(pool);
    const { rows } = await pool.query<NoteRow>(
      `INSERT INTO public.optimizer_manual_notes
        (cliente_id, nivel, objeto_id, objeto_nome, autor_id, autor_nome, texto, status, categoria, prazo_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${COLS}`,
      [
        body.cliente_id, body.nivel, body.objeto_id ?? null, body.objeto_nome ?? null,
        autorId, body.autor_nome ?? null, body.texto.trim(),
        normalizeNoteStatus(body.status) ?? 'rapida',
        body.categoria?.trim() || null,
        body.prazo_em || null,
      ],
    );
    return Response.json({ ok: true, note: rows[0] });
  } finally {
    await pool.end();
  }
}

/** Move o cartão de coluna, conclui, ou ajusta categoria/prazo/texto. */
export async function PATCH(req: NextRequest) {
  if (!getSession(req)) return unauthorized();

  const body = await req.json().catch(() => ({})) as {
    id?: string; status?: string; categoria?: string | null; prazo_em?: string | null; texto?: string;
  };
  if (!body.id) return Response.json({ error: 'id obrigatório.' }, { status: 400 });

  const status = body.status === undefined ? null : normalizeNoteStatus(body.status);
  if (body.status !== undefined && !status) {
    return Response.json({ error: 'status inválido. Use rapida, andamento ou concluida.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureOptimizerManualNotesTable(pool);
    // Chave ausente = não mexer. Sem essa distinção, mover o cartão de coluna
    // apagaria a categoria e o prazo que já estavam gravados.
    const { rows } = await pool.query<NoteRow>(
      `UPDATE public.optimizer_manual_notes SET
         status = COALESCE($2, status),
         -- concluir estampa a data; reabrir limpa, senão o cartão fica "concluído em"
         -- com data antiga depois de voltar pro quadro.
         concluida_em = CASE
           WHEN $2 = 'concluida' THEN COALESCE(concluida_em, NOW())
           WHEN $2 IS NULL THEN concluida_em
           ELSE NULL END,
         categoria = CASE WHEN $3::boolean THEN $4 ELSE categoria END,
         prazo_em  = CASE WHEN $5::boolean THEN $6 ELSE prazo_em END,
         texto     = COALESCE($7, texto)
       WHERE id = $1 AND ativo = true
       RETURNING ${COLS}`,
      [
        body.id, status,
        'categoria' in body, body.categoria?.trim() || null,
        'prazo_em' in body, body.prazo_em || null,
        body.texto?.trim() || null,
      ],
    );
    if (!rows[0]) return Response.json({ error: 'Nota não encontrada.' }, { status: 404 });
    return Response.json({ ok: true, note: rows[0] });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id) return Response.json({ error: 'id obrigatório.' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureOptimizerManualNotesTable(pool);
    await pool.query(`UPDATE public.optimizer_manual_notes SET ativo = false WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
