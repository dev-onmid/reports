import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { ensureFidelidadeSchema } from '@/lib/fidelidade-server';
import { COLS_DEVIDA, processarCampanha, type LinhaDevida } from '@/lib/fidelidade-motor';

/**
 * "Disparar 1 agora" — envia UMA mensagem da campanha, na hora, pela tela.
 *
 * Existe porque a alternativa era o gestor chamar o cron na mão por linha de
 * comando. Um botão com confirmação é a única forma honesta de dar isso a quem
 * opera o sistema.
 *
 * ⚠️ É o MESMO motor do cron (`fidelidade-motor`), não uma segunda
 * implementação: duas versões das travas divergiriam na primeira mudança.
 * O clique ignora dia da semana e janela de horário — decisão explícita de um
 * humano que está olhando —, mas NÃO ignora nada que proteja o número do
 * cliente: teto diário, opt-out, cooldown, teto de público e a exigência de
 * instância conectada continuam valendo.
 */

export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sessao = getSession(req);
  if (!sessao) return unauthorized();
  const { id: clientId } = await ctx.params;

  const body = await req.json().catch(() => null) as { campanhaId?: string } | null;
  if (!body?.campanhaId) return Response.json({ error: 'Informe a campanha' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureFidelidadeSchema(pool);

    // O interruptor do cliente é conferido no JOIN, como no cron: disparo
    // manual não pode ser a porta dos fundos de um cliente desativado.
    const { rows: [campanha] } = await pool.query<LinhaDevida>(
      `SELECT ${COLS_DEVIDA}
         FROM public.fidelidade_campanhas f
         JOIN public.clients c ON c.id = f.client_id
        WHERE f.id = $1 AND f.client_id = $2 AND c.fidelidade_ativa = true`,
      [body.campanhaId, clientId],
    );
    if (!campanha) {
      return Response.json({ error: 'Campanha não encontrada ou fidelidade desativada' }, { status: 404 });
    }

    const resultado = await processarCampanha(pool, campanha, { manual: true });
    return Response.json({ ok: true, resultado });
  } catch (err) {
    console.error('[fidelidade disparar]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
