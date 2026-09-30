import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  cacheFresco, coletarEGravar, ensureBibliotecaSchema, lerCache, listarContasMeta,
  type CacheRow, type ContaMeta,
} from '@/lib/biblioteca-anuncios';
import type { AnuncioRow, BibliotecaResposta, ContaResumo } from '@/lib/biblioteca-anuncios-ui';

// GET /api/biblioteca-anuncios?days=90&clientId=&refresh=1
//
// Devolve os anúncios que entregaram no Meta no período, de todas as contas da
// carteira (ou de um cliente). Cache por conta (6h). Contas sem cache fresco são
// coletadas AQUI, dentro de um orçamento de tempo; o que não coube volta em
// `pendentes` e a tela chama de novo até zerar — a carteira inteira (40+ contas)
// não cabe numa chamada só e o usuário vê a galeria crescendo em vez de esperar
// em branco. Auth = deny-by-default do proxy.

export const maxDuration = 120;
const ORCAMENTO_MS = 50_000;
const CONCORRENCIA = 3;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const days = Math.min(Math.max(Number(sp.get('days') ?? 90), 7), 365);
  const clientId = sp.get('clientId')?.trim() || undefined;
  const refresh = sp.get('refresh') === '1';
  const started = Date.now();

  const pool = makeServerPool();
  try {
    await ensureBibliotecaSchema(pool);
    const contas = await listarContasMeta(pool, clientId);
    const cache = await lerCache(pool, days, contas);

    // Quem precisa de coleta: sem cache, cache vencido, ou refresh pedido.
    const fila: ContaMeta[] = contas.filter(c => refresh || !cacheFresco(cache.get(c.account_id)));
    const coletadas = new Map<string, CacheRow>();

    let cursor = 0;
    const worker = async () => {
      while (cursor < fila.length && Date.now() - started < ORCAMENTO_MS) {
        const conta = fila[cursor++];
        const row = await coletarEGravar(pool, conta, days);
        coletadas.set(conta.account_id, row);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, fila.length) }, worker));

    const anuncios: AnuncioRow[] = [];
    const resumo: ContaResumo[] = [];
    let pendentes = 0;
    for (const c of contas) {
      const row = coletadas.get(c.account_id) ?? cache.get(c.account_id);
      const aguardando = fila.includes(c) && !coletadas.has(c.account_id);
      if (aguardando) pendentes++;
      const payload = Array.isArray(row?.payload) ? row!.payload : [];
      anuncios.push(...payload);
      resumo.push({
        client_id: c.client_id,
        client_name: c.client_name,
        account_id: c.account_id,
        fetched_at: row?.fetched_at ?? null,
        erro: row?.erro ?? null,
        anuncios: payload.length,
      });
    }

    const body: BibliotecaResposta = { ok: true, days, anuncios, contas: resumo, pendentes, total_contas: contas.length };
    return Response.json(body);
  } catch (err) {
    console.error('[biblioteca-anuncios]', err);
    const body: BibliotecaResposta = { ok: false, days, anuncios: [], contas: [], pendentes: 0, total_contas: 0 };
    return Response.json(body, { status: 500 });
  } finally {
    await pool.end();
  }
}
