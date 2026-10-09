import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolveClientByName } from '@/lib/reuniao-intake';
import { dataPeloTldv, parseChecklist, parseDataReuniao, salvarResumoReuniao } from '@/lib/reuniao-resumos';
import { conferirSegredoIntegracao, respostaSegredo } from '@/lib/integration-secret';
import { enviarChecklistReuniao } from '@/lib/reuniao-whatsapp';

/**
 * Reunião pronta, chamado pelo Make no FINAL do cenário — irmão da rota
 * `/api/integrations/reuniao` (que cria as tarefas no ClickUp). Este endpoint
 * guarda o pacote da reunião pra aba Reuniões do cliente: resumo (obrigatório),
 * link da gravação, doc e checklist de continuidade (opcionais).
 *
 * Payload esperado (header `x-onmid-secret`):
 *   { "cliente": "<nome>", "resumo": "<texto>",
 *     "titulo"?, "meeting_id"? (dedupe!), "doc_url"?, "data"?,
 *     "gravacao_url"? (aceita recording_url/video_url),
 *     "checklist"?: ["item", ...] | [{texto, feito?}, ...] | "um por linha" }
 *
 * Mesma autenticação (`x-onmid-secret`) e mesma filosofia de resposta: erro de
 * negócio sai como 200 + ok:false pra percorrer a rota de erro do Make legível
 * (5xx lá vira "Couldn't connect" sem corpo). O proxy já libera o subcaminho.
 */

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = conferirSegredoIntegracao(req);
  if (auth !== 'ok') return respostaSegredo(auth);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, erro: 'json_invalido' }, { status: 400 });
  }

  const cliente = typeof body.cliente === 'string' ? body.cliente.trim() : '';

  /**
   * A saída da IA repassada verbatim, como a rota irmã já recebe.
   *
   * O Make NÃO consegue montar `{"resumo": "<texto>"}` à mão: o resumo tem
   * quebra de linha e aspas, e a concatenação quebra o JSON no primeiro
   * apóstrofo de "planejamento do cliente". Repassar `{{203.result}}` inteiro
   * é a única forma que não depende do conteúdo do texto.
   */
  const ia = (body.ia && typeof body.ia === 'object' ? body.ia : {}) as Record<string, unknown>;

  // `resumo` é o nome canônico; `texto` cobre configuração alternativa no Make.
  const resumo = [body.resumo, body.texto, ia.resumo_documento, ia.resumo]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? '';

  if (!cliente) return Response.json({ ok: false, erro: 'cliente_obrigatorio' }, { status: 400 });
  if (!resumo) return Response.json({ ok: false, erro: 'resumo_obrigatorio' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { match, sugestoes, ambiguo, motivo } = await resolveClientByName(pool, cliente);
    if (!match) {
      // Mesmo contrato da rota irmã: cliente novo não é falha de requisição.
      return Response.json({ ok: false, erro: 'cliente_nao_encontrado', nome_recebido: cliente, sugestoes, ambiguo, motivo });
    }

    // `gravacao_url` é o nome canônico; os outros cobrem mapeamento alternativo no Make.
    const gravacao = [body.gravacao_url, body.recording_url, body.video_url, body.gravacao]
      .find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? null;

    // O Make não manda `data`; sem isto a reunião ficaria carimbada com a hora
    // do processamento, que vem em lote e já errou por dias.
    const meetingId = typeof body.meeting_id === 'string' ? body.meeting_id : null;
    const quando = parseDataReuniao(body.data ?? body.reuniao_em) ?? await dataPeloTldv(pool, meetingId);

    const r = await salvarResumoReuniao(pool, {
      clientId: match.id,
      resumo,
      titulo: typeof body.titulo === 'string' ? body.titulo : null,
      meetingId,
      docUrl: typeof body.doc_url === 'string' ? body.doc_url : null,
      recordingUrl: gravacao,
      checklist: parseChecklist(body.checklist ?? body.pendencias ?? ia.checklist ?? body.acoes),
      reuniaoEm: quando,
    });
    // Checklist no grupo do tráfego. Fica DEPOIS de gravar e nunca lança: o
    // resumo já está salvo e a aba Reuniões não pode depender do WhatsApp.
    // A trava de duplicata é o `whatsapp_em`, não o `atualizado` — reexecução
    // do Make com resumo revisado não deve remandar a mensagem.
    const wa = await enviarChecklistReuniao(pool, r.id);

    return Response.json({
      ok: true,
      cliente: { id: match.id, nome: match.name },
      resumo_id: r.id,
      atualizado: r.atualizado,
      whatsapp: wa,
    });
  } catch (err) {
    console.error('[integracao reuniao resumo]', err);
    return Response.json({
      ok: false,
      erro: 'falha_interna',
      detalhe: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await pool.end();
  }
}
