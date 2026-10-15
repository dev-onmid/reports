import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { expurgarMidia, DIAS_PADRAO, TETO_GB_PADRAO } from '@/lib/crm-midia';

/**
 * Faxina diária da mídia do chat (ver `expurgarMidia`): foto/vídeo/documento
 * acima do prazo saem, áudio é poupado, e um teto de espaço protege o disco —
 * que é compartilhado com a Evolution.
 *
 * ⚠️ Fora de `/api/crm/midia/` de propósito: aquele caminho é a rota que SERVE
 * o arquivo (token de 32 hex) e é liberada por cliente no proxy. Misturar as
 * duas seria pedir para alguém afrouxar a errada.
 *
 * `?dry=1` devolve o plano sem apagar nada.
 */
export const maxDuration = 300;

const SEGREDOS = ['CRON_SECRET', 'REPORTS_CRON_SECRET', 'CRM_CRON_SECRET'];

function autorizado(req: NextRequest): boolean {
  const q = req.nextUrl.searchParams.get('secret');
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return SEGREDOS.some(nome => {
    const v = process.env[nome];
    return Boolean(v) && (q === v || bearer === v);
  });
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'não autorizado' }, { status: 401 });

  const n = (chave: string, padrao: number) => {
    const v = Number(req.nextUrl.searchParams.get(chave));
    return Number.isFinite(v) && v > 0 ? v : padrao;
  };

  const pool = makeServerPool();
  try {
    const r = await expurgarMidia(pool, {
      dias: n('dias', DIAS_PADRAO),
      tetoGb: n('teto', TETO_GB_PADRAO),
      simulacao: req.nextUrl.searchParams.get('dry') === '1',
    });
    const mb = (b: number) => Number((b / 1048576).toFixed(1));
    return Response.json({
      ok: true,
      ...r,
      mbPorPrazo: mb(r.bytesPorPrazo),
      mbPorEspaco: mb(r.bytesPorEspaco),
      mbAntes: mb(r.bytesAntes),
      mbDepois: mb(r.bytesDepois),
    });
  } catch (e) {
    console.error('[midia-expurgo]', e);
    return Response.json({ error: String(e) }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
