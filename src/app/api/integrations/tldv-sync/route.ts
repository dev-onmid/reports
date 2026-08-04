import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { conferirSegredoIntegracao, respostaSegredo } from '@/lib/integration-secret';
import {
  buscarTranscricao,
  dispararReuniaoPronta,
  dispararTranscricaoPronta,
  listarReunioes,
  type TldvMeeting,
} from '@/lib/tldv';

/**
 * Polling do TLDV — substitui o webhook que sumia sozinho do painel.
 *
 * Roda de 5 em 5 minutos (GitHub Actions). Cada execução:
 *   1. pergunta ao TLDV as reuniões recentes;
 *   2. reunião nunca vista → dispara "reunião pronta" (Cenário 1 cria o doc);
 *   3. reunião cujo doc já foi pedido há mais de 3 min → dispara "transcrição
 *      pronta" (v4 resume e cria as tarefas).
 *
 * As duas etapas nunca acontecem na mesma execução de propósito: o v4 precisa
 * que o doc do Cenário 1 já exista no Drive, e segurar a requisição esperando
 * isso estouraria o teto de tempo da função. Uma rodada a mais custa 5 minutos
 * e é o que torna cada execução curta e repetível.
 *
 * Idempotente: quem manda é a tabela `tldv_reunioes`, não o relógio. Se uma
 * execução falhar no meio, a seguinte continua de onde parou; se o webhook do
 * TLDV voltar a funcionar sozinho, os dois convivem sem duplicar nada.
 */

export const maxDuration = 60;

/** Reunião mais antiga que isto não entra mais — evita ressuscitar histórico. */
const JANELA_HORAS = 12;
/** Tempo mínimo entre pedir o doc e mandar a transcrição. */
const ESPERA_DOC_MS = 3 * 60 * 1000;

type Linha = { meeting_id: string; etapa: string; doc_em: string | null };

async function garantirTabela(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.tldv_reunioes (
      meeting_id      TEXT PRIMARY KEY,
      nome            TEXT,
      happened_at     TIMESTAMPTZ,
      etapa           TEXT NOT NULL DEFAULT 'doc',
      doc_em          TIMESTAMPTZ,
      transcricao_em  TIMESTAMPTZ,
      erro            TEXT,
      criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

export async function GET(req: NextRequest) {
  const auth = conferirSegredoIntegracao(req);
  if (auth !== 'ok') return respostaSegredo(auth);

  const pool = makeServerPool();
  const novas: string[] = [];
  const transcritas: string[] = [];
  const erros: string[] = [];

  try {
    await garantirTabela(pool);

    const reunioes = await listarReunioes(20);
    const limite = Date.now() - JANELA_HORAS * 60 * 60 * 1000;
    const recentes = reunioes.filter((m) => {
      const t = m.happenedAt ? Date.parse(m.happenedAt) : NaN;
      return Number.isFinite(t) && t >= limite;
    });

    const { rows } = await pool.query<Linha>(
      'SELECT meeting_id, etapa, doc_em FROM public.tldv_reunioes',
    );
    const conhecidas = new Map(rows.map((r) => [r.meeting_id, r]));

    // Primeira execução: a tabela vazia não significa que nada foi processado
    // — significa que o polling acabou de nascer. Disparar tudo aqui reenviaria
    // reuniões que já viraram doc e tarefa pelo webhook antigo. Só registra.
    const bootstrap = rows.length === 0;

    for (const m of recentes) {
      const ja = conhecidas.get(m.id);

      if (!ja) {
        if (bootstrap) {
          await pool.query(
            `INSERT INTO public.tldv_reunioes (meeting_id, nome, happened_at, etapa, doc_em, transcricao_em)
             VALUES ($1, $2, $3, 'pronta', now(), now()) ON CONFLICT (meeting_id) DO NOTHING`,
            [m.id, m.name ?? null, m.happenedAt ?? null],
          );
          continue;
        }
        try {
          await dispararReuniaoPronta(m as TldvMeeting);
          await pool.query(
            `INSERT INTO public.tldv_reunioes (meeting_id, nome, happened_at, etapa, doc_em)
             VALUES ($1, $2, $3, 'doc', now()) ON CONFLICT (meeting_id) DO NOTHING`,
            [m.id, m.name ?? null, m.happenedAt ?? null],
          );
          novas.push(m.id);
        } catch (err) {
          erros.push(`${m.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }

      if (ja.etapa === 'doc') {
        const pedidoEm = ja.doc_em ? Date.parse(ja.doc_em) : 0;
        if (Date.now() - pedidoEm < ESPERA_DOC_MS) continue;
        try {
          const t = await buscarTranscricao(m.id);
          // Transcrição ainda não pronta no TLDV: tenta de novo na próxima
          // rodada em vez de mandar um bundle vazio pro v4.
          if (!t?.data?.length) continue;
          await dispararTranscricaoPronta(t);
          await pool.query(
            `UPDATE public.tldv_reunioes
                SET etapa = 'pronta', transcricao_em = now(), erro = NULL
              WHERE meeting_id = $1`,
            [m.id],
          );
          transcritas.push(m.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          erros.push(`${m.id}: ${msg}`);
          await pool.query('UPDATE public.tldv_reunioes SET erro = $2 WHERE meeting_id = $1', [m.id, msg]);
        }
      }
    }

    return Response.json({
      ok: true,
      bootstrap,
      vistas: recentes.length,
      docs_pedidos: novas,
      transcricoes_enviadas: transcritas,
      erros,
    });
  } catch (err) {
    console.error('[tldv-sync]', err);
    return Response.json({
      ok: false,
      erro: 'falha_interna',
      detalhe: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await pool.end();
  }
}
