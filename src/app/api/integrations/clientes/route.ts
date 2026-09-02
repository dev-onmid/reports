import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

/**
 * Lista de clientes para a IA de identificação de reunião (Make, Cenário 1).
 *
 * Existe para acabar com o cadastro duplicado: a lista de clientes vivia
 * também num Data Store do Make, que ninguém limpava quando um cliente saía.
 * Resultado — 19 clientes com grafia divergente entre os dois lados e 13 nomes
 * de ex-clientes que a IA ainda enxergava como válidos. Aqui a fonte é uma só,
 * e o `status` diz quem ainda é cliente.
 *
 * Mesma autenticação de /api/integrations/reuniao: segredo compartilhado no
 * header, falhando fechado se a env não estiver configurada.
 */

function segredoConfere(req: NextRequest): 'ok' | 'sem-segredo' | 'negado' {
  const esperado = process.env.MAKE_INTEGRATION_SECRET;
  if (!esperado) return 'sem-segredo';
  const a = Buffer.from(req.headers.get('x-onmid-secret') ?? '');
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'negado';
}

type Row = { name: string; status: string | null; tem_lista: boolean };

export async function GET(req: NextRequest) {
  const auth = segredoConfere(req);
  if (auth === 'sem-segredo') return Response.json({ erro: 'integracao_nao_configurada' }, { status: 503 });
  if (auth === 'negado') return Response.json({ erro: 'nao_autorizado' }, { status: 401 });

  // ?todos=1 inclui inativos. O padrão são só os ativos, porque é o que a IA
  // deve considerar candidato — nome de ex-cliente parecido com um ativo era
  // justamente o risco de a IA escolher o morto.
  const todos = req.nextUrl.searchParams.get('todos') === '1';

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query<Row>(
      `SELECT c.name,
              c.status,
              (l.client_id IS NOT NULL) AS tem_lista
         FROM public.clients c
         LEFT JOIN public.clickup_client_links l ON l.client_id = c.id
        WHERE ($1::boolean OR COALESCE(c.status, 'Ativo') = 'Ativo')
          AND COALESCE(TRIM(c.name), '') <> ''
        ORDER BY c.name ASC`,
      [todos],
    );

    // `texto` é o que o Make injeta direto no prompt — economiza o Aggregator
    // que existia só para transformar registros em linhas.
    //
    // `chaves` existe para o Make conferir, num filtro de uma linha, se o nome
    // que a IA devolveu está mesmo na lista: `chaves contém |Nome|`. Os pipes
    // nas pontas tornam a checagem exata — sem eles, "Sorrifácil Londrina"
    // passaria por casar dentro de "Sorrifácil Londrina Bandeirantes". Montar
    // isso com map()/join() dentro do Make seria possível, mas uma expressão
    // errada lá falha calada e manda toda reunião para o aviso de "não
    // cadastrado"; aqui dá para testar.
    return Response.json({
      total: rows.length,
      clientes: rows.map((r) => ({
        nome: r.name,
        status: r.status ?? 'Ativo',
        tem_lista: r.tem_lista,
      })),
      texto: rows.map((r) => r.name).join('\n'),
      chaves: `|${rows.map((r) => r.name).join('|')}|`,
    });
  } catch (err) {
    console.error('[integracao clientes]', err);
    return Response.json({ erro: 'falha_interna' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

/**
 * Cadastra o cliente novo, chamado pelo cenário de ONBOARDING do Make.
 *
 * Até aqui o onboarding criava o cliente no Drive, no ClickUp e no WhatsApp e
 * esquecia do reports — que é justamente a fonte da identificação de reunião.
 * Consequência prática: a primeira reunião do cliente novo caía em "sem cliente
 * confirmado, 0%, nenhum cliente parecido" (aconteceu com Bodega e Atibaia em
 * 31/08/2026) e ele ficava sem resumo, sem checklist e sem tarefa.
 *
 * Idempotente pelo NOME, não pelo id: o Make repete execução (retry, fila
 * reprocessada) e dois clientes com o mesmo nome fazem a identificação se
 * abster — o remédio viraria a doença. Repetiu, devolve o que já existe.
 */
export async function POST(req: NextRequest) {
  const auth = segredoConfere(req);
  if (auth === 'sem-segredo') return Response.json({ erro: 'integracao_nao_configurada' }, { status: 503 });
  if (auth === 'negado') return Response.json({ erro: 'nao_autorizado' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { nome?: string; name?: string; segmento?: string; status?: string }
    | null;
  const nome = (body?.nome ?? body?.name ?? '').trim();
  if (!nome) return Response.json({ ok: false, erro: 'nome_obrigatorio' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const existente = await pool.query<{ id: string; name: string; status: string | null }>(
      `SELECT id, name, status FROM public.clients
        WHERE lower(TRIM(name)) = lower($1) LIMIT 1`,
      [nome],
    );
    if (existente.rows[0]) {
      const c = existente.rows[0];
      return Response.json({ ok: true, criado: false, cliente: { id: c.id, nome: c.name, status: c.status ?? 'Ativo' } });
    }

    // Mesmo formato de id que a tela usa (client-store.ts), para não existir
    // um segundo padrão de id vivo no banco.
    const id = `client-${Date.now()}`;
    const { rows } = await pool.query<{ id: string; name: string; status: string | null }>(
      `INSERT INTO public.clients (id, name, segment, status, dashboard_type, onboarding_completed)
       VALUES ($1, $2, $3, $4, 'leads', false)
       RETURNING id, name, status`,
      [id, nome, (body?.segmento ?? '').trim(), body?.status ?? 'Ativo'],
    );
    const c = rows[0];
    return Response.json(
      { ok: true, criado: true, cliente: { id: c.id, nome: c.name, status: c.status ?? 'Ativo' } },
      { status: 201 },
    );
  } catch (err) {
    console.error('[integracao clientes POST]', err);
    return Response.json({ erro: 'falha_interna' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
