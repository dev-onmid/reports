import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureDiscadorSchema, normalizarTelefone } from '@/lib/discador';

type ContatoEntrada = {
  empresa?: string | null;
  nome_contato?: string | null;
  telefone?: string | null;
  telefone2?: string | null;
  cidade?: string | null;
  segmento?: string | null;
  email?: string | null;
  cnpj?: string | null;
};

const LIMITE_CONTATOS = 5000;

function texto(v: unknown, max = 200): string | null {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

/** Listas com os contadores — é o que a lateral da tela mostra. */
export async function GET(req: NextRequest) {
  if (!getSession(req)) return unauthorized();
  const pool = makeServerPool();
  try {
    await ensureDiscadorSchema(pool);
    const { rows } = await pool.query(`
      SELECT l.id, l.nome, l.client_id, l.arquivada, l.created_at, l.updated_at,
             c.name AS client_name,
             COALESCE(n.total, 0)      AS total,
             COALESCE(n.fila, 0)       AS fila,
             COALESCE(n.ligados, 0)    AS ligados,
             COALESCE(n.atenderam, 0)  AS atenderam,
             COALESCE(n.leads, 0)      AS leads
        FROM public.discador_listas l
        LEFT JOIN public.clients c ON c.id = l.client_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE status = 'fila')::int AS fila,
                 COUNT(*) FILTER (WHERE tentativas > 0)::int AS ligados,
                 COUNT(*) FILTER (WHERE status IN ('atendeu','retornar'))::int AS atenderam,
                 COUNT(*) FILTER (WHERE lead_id IS NOT NULL)::int AS leads
            FROM public.discador_contatos x WHERE x.lista_id = l.id
        ) n ON TRUE
       ORDER BY l.arquivada ASC, l.updated_at DESC`);
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

/**
 * Cria a lista com os contatos já normalizados. Telefone inválido sai;
 * telefone repetido dentro do arquivo fica uma vez só; e, por padrão, número
 * que já está em OUTRA lista é pulado — ligar duas vezes para a mesma empresa
 * em campanhas diferentes é o erro mais fácil de cometer com lista grande.
 */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return unauthorized();

  let body: { nome?: unknown; client_id?: unknown; contatos?: unknown; pular_repetidos?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido.' }, { status: 400 });
  }
  const nome = texto(body.nome, 120);
  if (!nome) return Response.json({ error: 'Dê um nome à lista.' }, { status: 400 });
  if (!Array.isArray(body.contatos) || body.contatos.length === 0) {
    return Response.json({ error: 'A lista veio sem contatos.' }, { status: 400 });
  }
  if (body.contatos.length > LIMITE_CONTATOS) {
    return Response.json({ error: `Máximo de ${LIMITE_CONTATOS} contatos por lista.` }, { status: 400 });
  }
  const clientId = texto(body.client_id, 120);
  const pularRepetidos = body.pular_repetidos !== false;

  // Normaliza e tira repetidos do próprio arquivo (fica a primeira ocorrência).
  const vistos = new Set<string>();
  const validos: Array<Required<ContatoEntrada> & { telefone: string }> = [];
  let semTelefone = 0;
  let repetidosNoArquivo = 0;
  for (const bruto of body.contatos as ContatoEntrada[]) {
    const tel = normalizarTelefone(bruto?.telefone);
    const tel2 = normalizarTelefone(bruto?.telefone2);
    const principal = tel ?? tel2;
    if (!principal) { semTelefone++; continue; }
    if (vistos.has(principal)) { repetidosNoArquivo++; continue; }
    vistos.add(principal);
    validos.push({
      empresa: texto(bruto.empresa),
      nome_contato: texto(bruto.nome_contato, 120),
      telefone: principal,
      telefone2: tel && tel2 && tel2 !== tel ? tel2 : null,
      cidade: texto(bruto.cidade, 120),
      segmento: texto(bruto.segmento, 120),
      email: texto(bruto.email, 160),
      cnpj: texto(bruto.cnpj, 20),
    });
  }
  if (validos.length === 0) {
    return Response.json({ error: 'Nenhum contato com telefone válido.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureDiscadorSchema(pool);

    let jaEmOutraLista = 0;
    let paraInserir = validos;
    if (pularRepetidos) {
      const { rows } = await pool.query<{ telefone: string }>(
        `SELECT DISTINCT telefone FROM public.discador_contatos WHERE telefone = ANY($1::text[])`,
        [validos.map(v => v.telefone)],
      );
      const existentes = new Set(rows.map(r => r.telefone));
      paraInserir = validos.filter(v => !existentes.has(v.telefone));
      jaEmOutraLista = validos.length - paraInserir.length;
      if (paraInserir.length === 0) {
        return Response.json({ error: 'Todos esses telefones já estão em outra lista.' }, { status: 409 });
      }
    }

    // Transação num client dedicado (pool.query descarta a conexão em erro — ver resultado/route.ts).
    const tx = await pool.connect();
    let lista: { id: string };
    try {
      await tx.query('BEGIN');
      ({ rows: [lista] } = await tx.query(
        `INSERT INTO public.discador_listas (nome, client_id, criado_por) VALUES ($1, $2, $3) RETURNING *`,
        [nome, clientId, session.uid],
      ));
      // Um INSERT só, por arrays paralelos — 5.000 linhas em uma ida ao banco.
      await tx.query(
      `INSERT INTO public.discador_contatos
         (lista_id, posicao, empresa, nome_contato, telefone, telefone2, cidade, segmento, email, cnpj)
       SELECT $1, p, e, nc, t, t2, ci, se, em, cn
         FROM UNNEST($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
              AS u(p, e, nc, t, t2, ci, se, em, cn)`,
      [
        lista.id,
        paraInserir.map((_, i) => i + 1),
        paraInserir.map(v => v.empresa),
        paraInserir.map(v => v.nome_contato),
        paraInserir.map(v => v.telefone),
        paraInserir.map(v => v.telefone2),
        paraInserir.map(v => v.cidade),
        paraInserir.map(v => v.segmento),
        paraInserir.map(v => v.email),
        paraInserir.map(v => v.cnpj),
      ],
      );
      await tx.query('COMMIT');
    } catch (err) {
      await tx.query('ROLLBACK').catch(() => null);
      throw err;
    } finally {
      tx.release();
    }

    return Response.json({
      lista,
      inseridos: paraInserir.length,
      sem_telefone: semTelefone,
      repetidos_no_arquivo: repetidosNoArquivo,
      ja_em_outra_lista: jaEmOutraLista,
    }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[discador POST listas]', msg);
    return Response.json({ error: 'Não foi possível criar a lista.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
