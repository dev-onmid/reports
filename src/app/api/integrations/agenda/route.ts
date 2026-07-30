import { makeServerPool } from '@/lib/server-db';
import { conferirSegredoIntegracao, respostaSegredo } from '@/lib/integration-secret';
import { upsertEvento, pareceEvento, type EventoInput, type EventoResultado } from '@/lib/agenda-intake';

/**
 * Agenda do dia, enviada pelo Make (que é quem lê o Google Calendar).
 *
 * Autenticação por segredo compartilhado em `x-onmid-secret` — mesmo contrato
 * do intake de reuniões do TLDV, sem sessão de browser.
 */

// Um lote pode trazer a agenda do dia inteiro da equipe; cada evento resolve
// cliente por nome. O teto default de 10s do Hobby derruba lote grande.
export const maxDuration = 60;

function extrairEventos(body: unknown): EventoInput[] {
  if (Array.isArray(body)) return body as EventoInput[];
  const b = body as { eventos?: unknown; events?: unknown } | null;
  const lista = b?.eventos ?? b?.events;
  if (Array.isArray(lista)) return lista as EventoInput[];
  // Evento único no corpo raiz — o Make manda assim quando o cenário itera lá.
  // `pareceEvento` evita que um corpo vazio conte como "1 evento" e vire um erro
  // confuso em vez de um "nenhum_evento" honesto.
  return pareceEvento(b) ? [b as EventoInput] : [];
}

export async function POST(req: Request) {
  const auth = conferirSegredoIntegracao(req);
  if (auth !== 'ok') return respostaSegredo(auth);

  const pool = makeServerPool();
  try {
    const body = await req.json().catch(() => null);
    const eventos = extrairEventos(body);
    if (!eventos.length) {
      return Response.json({ ok: false, erro: 'nenhum_evento' });
    }

    const resultados: EventoResultado[] = [];
    for (const ev of eventos) {
      // Um evento ruim não derruba o lote — o Make manda a agenda inteira de
      // uma vez, e perder o dia por causa de uma linha seria pior.
      try {
        resultados.push(await upsertEvento(pool, ev));
      } catch (err) {
        resultados.push({
          ok: false,
          external_id: String(ev?.external_id ?? ev?.id ?? ''),
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const gravados = resultados.filter(r => r.ok).length;
    return Response.json({ ok: true, gravados, total: resultados.length, resultados });
  } catch (err) {
    // HTTP 200 mesmo em falha: o Make trata 5xx como "Couldn't connect" e
    // esconde o corpo, então o erro real nunca chegaria a quem monta o cenário.
    return Response.json({
      ok: false,
      erro: 'falha_interna',
      detalhe: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await pool.end();
  }
}
