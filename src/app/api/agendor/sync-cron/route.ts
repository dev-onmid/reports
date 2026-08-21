import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { normalizarNegocio, type NegocioAgendor, type PessoaAgendor } from '@/lib/agendor';
import {
  agendorFetch, AGENDOR_API, listarConexoesAgendorAtivas, type ConexaoAgendor,
} from '@/lib/agendor-server';
import { buscarPessoaAgendor, conferirFiltros, ingerirNegocioAgendor, posProcessarIngestao } from '@/lib/agendor-ingest';

/**
 * Sincronismo Agendor: backfill do histórico + reconciliação.
 *
 * Duas fases por cliente conectado, no mesmo tick:
 *  1. BACKFILL (uma vez): GET /deals paginado com cursor retomável
 *     (backfill_pagina) — o funil nasce com o passado. Página só avança quando
 *     TODOS os negócios dela entraram (lição do Cardápio Web: avançar com
 *     pendência deixa buraco que ninguém reprocessa).
 *  2. RECONCILIAÇÃO (sempre): GET /deals?updatedAtGt=<última sync - 1h> — pega
 *     o que o webhook perdeu. É a rede de segurança que faltou no Cardápio Web
 *     ("webhook morto = pedidos somem em silêncio", CLAUDE.md).
 *
 * ⚠️ Cadência pela crontab da VPS (GitHub Actions é throttleado — nota
 * sistêmica de 31/07). Sem envio de conversões pra trás: o pós-processamento
 * marca origem 'backfill' e o disparo fica bloqueado lá.
 */
export const maxDuration = 300;
const ORCAMENTO_MS = 240_000;
const POR_PAGINA = 100;

function autorizado(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get('secret') ?? '';
  const valid = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter(Boolean);
  return valid.length > 0 && valid.includes(secret);
}

type Resultado = {
  client_id: string;
  backfill_importados: number;
  backfill_concluido: boolean;
  reconciliados: number;
  erro?: string;
};

async function processarLote(
  pool: ReturnType<typeof makeServerPool>, conn: ConexaoAgendor,
  negocios: NegocioAgendor[], origem: 'backfill' | 'atualizado',
  cachePessoas: Map<string, PessoaAgendor | null>,
): Promise<number> {
  let feitos = 0;
  let falhasDePessoa = 0;
  for (const n of negocios) {
    let pessoa: PessoaAgendor | null = null;
    let pessoaFalhou = false;
    if (n.pessoa.id && conn.api_token) {
      if (!cachePessoas.has(n.pessoa.id)) {
        // Ritmo: 600ms entre buscas ~ 100 req/min. Medido ao vivo na Cinfel:
        // rajada e ate 5 req/s tomavam 429 do Agendor (limite real ~120/min).
        // O cursor de pagina espalha o resto entre execucoes do cron.
        await new Promise(res => setTimeout(res, 600));
        cachePessoas.set(n.pessoa.id, await buscarPessoaAgendor(conn.api_token, n.pessoa.id));
      }
      pessoa = cachePessoas.get(n.pessoa.id) ?? null;
      pessoaFalhou = pessoa === null;
      if (pessoaFalhou) falhasDePessoa++;
    }
    // Freio: muitas falhas de pessoa = rate limit em curso. Abortar SEM avancar
    // a pagina garante que nada entra com dados pela metade em massa — a
    // proxima execucao refaz a pagina inteira (upsert idempotente).
    if (falhasDePessoa > 10) throw new Error('muitas falhas ao buscar pessoas (rate limit?) — pagina sera refeita');
    const { negocio: nf, bloqueado } = await conferirFiltros(conn, n, pessoa, pessoaFalhou);
    if (bloqueado) continue; // fora do filtro: nem log por item no backfill (viraria ruído aos milhares)
    const r = await ingerirNegocioAgendor(pool, conn.client_id, nf, pessoa);
    await posProcessarIngestao(pool, conn, nf, pessoa, r, { sync: origem, dealId: nf.idExterno },
      origem === 'backfill' ? 'backfill' : (r.criado ? 'criado' : 'atualizado'));
    feitos++;
  }
  return feitos;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const inicio = Date.now();
  const pool = makeServerPool();
  const resultados: Resultado[] = [];
  try {
    const soCliente = req.nextUrl.searchParams.get('clientId');
    let conexoes = await listarConexoesAgendorAtivas(pool);
    if (soCliente) conexoes = conexoes.filter(c => c.client_id === soCliente);

    for (const conn of conexoes) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      const r: Resultado = {
        client_id: conn.client_id, backfill_importados: 0,
        backfill_concluido: conn.backfill_concluido, reconciliados: 0,
      };
      const cachePessoas = new Map<string, PessoaAgendor | null>();
      try {
        // ---- fase 1: backfill com cursor
        let pagina = conn.backfill_pagina;
        while (!r.backfill_concluido && Date.now() - inicio < ORCAMENTO_MS) {
          const resp = await agendorFetch<{ data?: Record<string, unknown>[] }>(
            conn.api_token!, `${AGENDOR_API}/deals?page=${pagina}&per_page=${POR_PAGINA}`);
          const negocios = (resp?.data ?? [])
            .map(normalizarNegocio)
            .filter((n): n is NegocioAgendor => n !== null);
          if (negocios.length === 0) {
            r.backfill_concluido = true;
            await pool.query(
              `UPDATE public.agendor_connections
                  SET backfill_concluido = TRUE, ultima_sync_em = NOW() WHERE client_id = $1`,
              [conn.client_id],
            );
            break;
          }
          r.backfill_importados += await processarLote(pool, conn, negocios, 'backfill', cachePessoas);
          pagina += 1;
          await pool.query(
            `UPDATE public.agendor_connections SET backfill_pagina = $2 WHERE client_id = $1`,
            [conn.client_id, pagina],
          );
        }

        // ---- fase 2: reconciliação por updatedAtGt (só depois do backfill,
        // senão o "desde" pularia o que o backfill ainda não alcançou)
        if (r.backfill_concluido && Date.now() - inicio < ORCAMENTO_MS) {
          // 1h de sobreposição: relógio do Agendor e o nosso não precisam
          // concordar, e reprocessar é barato (upsert idempotente).
          const desde = conn.ultima_sync_em
            ? new Date(new Date(conn.ultima_sync_em).getTime() - 3_600_000)
            : new Date(Date.now() - 24 * 3_600_000);
          let pag = 1;
          while (Date.now() - inicio < ORCAMENTO_MS) {
            const resp = await agendorFetch<{ data?: Record<string, unknown>[] }>(
              conn.api_token!,
              `${AGENDOR_API}/deals?updatedAtGt=${encodeURIComponent(desde.toISOString())}&page=${pag}&per_page=${POR_PAGINA}`);
            const negocios = (resp?.data ?? [])
              .map(normalizarNegocio)
              .filter((n): n is NegocioAgendor => n !== null);
            if (negocios.length === 0) break;
            r.reconciliados += await processarLote(pool, conn, negocios, 'atualizado', cachePessoas);
            if (negocios.length < POR_PAGINA) break;
            pag += 1;
          }
          await pool.query(
            `UPDATE public.agendor_connections SET ultima_sync_em = NOW(), ultimo_erro = NULL WHERE client_id = $1`,
            [conn.client_id],
          );
        }
      } catch (err) {
        r.erro = err instanceof Error ? err.message.slice(0, 200) : String(err);
        await pool.query(
          `UPDATE public.agendor_connections SET ultimo_erro = $2 WHERE client_id = $1`,
          [conn.client_id, r.erro],
        ).catch(() => {});
      }
      resultados.push(r);
    }

    const resumo = {
      ok: true,
      conexoes: conexoes.length,
      tookMs: Date.now() - inicio,
      resultados,
    };
    console.log('[agendor sync-cron]', JSON.stringify(resumo));
    return Response.json(resumo);
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
