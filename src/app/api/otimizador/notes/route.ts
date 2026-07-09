import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureOptimizerManualNotesTable } from '@/lib/optimizer';

// Observações manuais do gestor por nível (cliente/campanha/conjunto/criativo). Registro
// humano — nem tudo o Otimizador consegue decidir sozinho ("cliente pediu manter ativo",
// "WhatsApp demorando para responder"). Também é lida no próximo ciclo de análise
// (ver weekly/route.ts) e injetada no payload como contexto pra IA não repetir a mesma sugestão.

type NoteRow = {
  id: string;
  cliente_id: string;
  nivel: string;
  objeto_id: string | null;
  objeto_nome: string | null;
  autor_id: string | null;
  autor_nome: string | null;
  texto: string;
  created_at: string;
};

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureOptimizerManualNotesTable(pool);
    const { rows } = await pool.query<NoteRow>(
      `SELECT id, cliente_id, nivel, objeto_id, objeto_nome, autor_id, autor_nome, texto, created_at
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
  };
  if (!body.cliente_id || !body.nivel || !body.texto?.trim()) {
    return Response.json({ error: 'cliente_id, nivel e texto são obrigatórios.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureOptimizerManualNotesTable(pool);
    const { rows } = await pool.query<NoteRow>(
      `INSERT INTO public.optimizer_manual_notes
        (cliente_id, nivel, objeto_id, objeto_nome, autor_id, autor_nome, texto)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, cliente_id, nivel, objeto_id, objeto_nome, autor_id, autor_nome, texto, created_at`,
      [body.cliente_id, body.nivel, body.objeto_id ?? null, body.objeto_nome ?? null, body.autor_id ?? null, body.autor_nome ?? null, body.texto.trim()],
    );
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
