import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureFidelidadeSchema, enviadasHoje, lerTravas } from '@/lib/fidelidade-server';

/**
 * Acompanhamento — o que está acontecendo AGORA e o que já aconteceu.
 *
 * A configuração vive na rota irmã; aqui é só operação: progresso de cada
 * rodada e o registro pessoa a pessoa (quem recebeu, quando, com que texto,
 * quem foi pulado e por quê, o que falhou e com qual erro).
 *
 * ⚠️ O `texto` devolvido é o que FOI ENVIADO, gravado no momento do envio —
 * não uma remontagem da mensagem atual da campanha. Se o gestor editar o texto
 * amanhã, o histórico continua contando a verdade de ontem.
 */

const LIMITE = 100;

type LinhaEnvio = {
  id: string; campanha_id: string; campanha: string | null; nome: string | null;
  telefone: string; status: string; motivo: string | null; erro: string | null;
  texto: string | null; cupom: string | null; criado_em: Date; enviado_em: Date | null;
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await ctx.params;

  const url = new URL(req.url);
  const campanhaId = url.searchParams.get('campanhaId');
  const status = url.searchParams.get('status');
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);

  const pool = makeServerPool();
  try {
    await ensureFidelidadeSchema(pool);

    const filtros: string[] = ['e.client_id = $1'];
    const params: unknown[] = [clientId];
    if (campanhaId) { params.push(campanhaId); filtros.push(`e.campanha_id = $${params.length}`); }
    if (status && ['enviada', 'pulada', 'falha', 'pendente'].includes(status)) {
      params.push(status); filtros.push(`e.status = $${params.length}`);
    }
    const where = filtros.join(' AND ');

    const [travas, hoje, execucoes, envios, contagem] = await Promise.all([
      lerTravas(pool, clientId),
      enviadasHoje(pool, clientId),
      pool.query(
        `SELECT x.id, x.campanha_id, f.nome AS campanha, f.ativa, x.status, x.iniciada_em,
                x.concluida_em, x.publico, x.enviadas, x.puladas, x.falhas
           FROM public.fidelidade_execucoes x
           LEFT JOIN public.fidelidade_campanhas f ON f.id = x.campanha_id
          WHERE x.client_id = $1 ${campanhaId ? 'AND x.campanha_id = $2' : ''}
          ORDER BY (x.status = 'rodando') DESC, x.iniciada_em DESC
          LIMIT 20`,
        campanhaId ? [clientId, campanhaId] : [clientId],
      ).catch(() => ({ rows: [] })),
      pool.query<LinhaEnvio>(
        `SELECT e.id, e.campanha_id, f.nome AS campanha, e.nome, e.telefone, e.status,
                e.motivo, e.erro, e.texto, e.cupom, e.criado_em, e.enviado_em
           FROM public.fidelidade_envios e
           LEFT JOIN public.fidelidade_campanhas f ON f.id = e.campanha_id
          WHERE ${where}
          -- Quem já foi ordena pela hora do envio; quem ainda não foi, pela
          -- ordem em que entrou na fila. O COALESCE junta os dois numa régua só.
          ORDER BY COALESCE(e.enviado_em, e.criado_em) DESC
          LIMIT ${LIMITE} OFFSET ${offset}`,
        params,
      ).catch(() => ({ rows: [] as LinhaEnvio[] })),
      pool.query<{ status: string; n: string }>(
        `SELECT e.status, COUNT(*) AS n FROM public.fidelidade_envios e
          WHERE ${campanhaId ? 'e.client_id = $1 AND e.campanha_id = $2' : 'e.client_id = $1'}
          GROUP BY e.status`,
        campanhaId ? [clientId, campanhaId] : [clientId],
      ).catch(() => ({ rows: [] as { status: string; n: string }[] })),
    ]);

    const porStatus: Record<string, number> = {};
    for (const r of contagem.rows) porStatus[r.status] = Number(r.n) || 0;

    return Response.json({
      travas,
      enviadasHoje: hoje,
      porStatus,
      execucoes: execucoes.rows,
      envios: envios.rows,
      temMais: envios.rows.length === LIMITE,
    });
  } catch (err) {
    console.error('[fidelidade acompanhamento]', err);
    return Response.json({ error: 'Falha ao carregar o acompanhamento' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

/**
 * Tentar de novo um envio que falhou.
 *
 * Devolve a linha para a fila em vez de criar outra: assim ela mantém a mesma
 * rodada, e a contagem de público da execução não infla a cada tentativa. Se a
 * execução já tinha terminado, ela volta a rodar — senão o motor nunca olharia
 * para essa fila de novo.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await ctx.params;
  const body = await req.json().catch(() => null) as { reenviar?: string } | null;
  if (!body?.reenviar) return Response.json({ error: 'Informe o envio' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureFidelidadeSchema(pool);
    const { rows: [envio] } = await pool.query<{ execucao_id: string; campanha_id: string }>(
      `UPDATE public.fidelidade_envios
          SET status = 'pendente', erro = NULL, motivo = NULL, enviado_em = NULL
        WHERE id = $1 AND client_id = $2 AND status IN ('falha', 'pulada')
        RETURNING execucao_id, campanha_id`,
      [body.reenviar, clientId],
    );
    if (!envio) return Response.json({ error: 'Envio não encontrado' }, { status: 404 });

    await pool.query(
      `UPDATE public.fidelidade_execucoes
          SET status = 'rodando', concluida_em = NULL,
              falhas = GREATEST(0, falhas - 1)
        WHERE id = $1 AND status = 'concluida'`,
      [envio.execucao_id],
    );
    // A campanha volta para a fila do motor imediatamente.
    await pool.query(
      `UPDATE public.fidelidade_campanhas SET proxima_execucao = NOW() WHERE id = $1`,
      [envio.campanha_id],
    );

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[fidelidade reenviar]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
